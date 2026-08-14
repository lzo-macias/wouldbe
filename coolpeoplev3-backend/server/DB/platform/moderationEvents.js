const { client, withTransaction } = require("../index.js");
const { setModerationStatus } = require("./contentItems.js");

// tiny helper so routes can map thrown errors to status codes
const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// ============================================================================
// moderation_events — every automated AND manual scan of a content_item writes a
// row here. This is the evidence chain (e.g. for a CSAM NCMEC report), so the
// table is append-only: we never UPDATE/DELETE an event, only INSERT new ones.
//
// SECURITY MODEL:
//  - recordModerationEvent + applyAutoDecision are INTERNAL (vendor/system
//    callbacks; gated by requireInternal at the route). Users never write here.
//  - getModerationEventsForItem is admin-only (it exposes raw provider responses
//    and category scores).
//  - applyAutoDecision runs in a transaction: it records the event AND, if the
//    verdict/confidence policy dictates, calls setModerationStatus on the parent
//    content_item in the SAME tx, so the evidence row and the decision commit
//    together (or not at all).
// ============================================================================

// enum vocabularies straight from the migration CHECK constraints.
const PROVIDERS = [
    "hive", "openai_moderation", "openai_vision", "photodna",
    "thorn_safer", "perspective", "aws_rekognition", "manual",
    // self-hosted nudity classifier behind the avatar/image pipeline
    // (added with the CHECK in migration 1782200000000)
    "nudenet",
];
const RESULTS = ["clean", "flagged", "rejected", "inconclusive", "error"];

const COLS = `
    id, content_item_id, provider, provider_version, result,
    confidence_score, category_scores, raw_response, scanned_at,
    scan_duration_ms, cost_cents, reviewed_by_user_id
`;

// Auto-decision policy thresholds. Kept simple + in one place so the rules are
// auditable. Tune here, not scattered through the code.
const AUTO_REJECT_CONFIDENCE = 0.9;   // 'rejected' verdict at/above this → status 'rejected'
const AUTO_FLAG_CONFIDENCE = 0.7;     // 'flagged' verdict at/above this → 'pending_human_review'

// Validate the shared INSERT inputs and return the param array.
const validateEventInput = ({
    content_item_id,
    provider,
    result,
    confidence_score = null,
    reviewed_by_user_id = null,
}) => {
    if (!content_item_id) throw httpError(400, "content_item_id is required");
    if (!PROVIDERS.includes(provider)) {
        throw httpError(400, `provider must be one of: ${PROVIDERS.join(", ")}`);
    }
    if (!RESULTS.includes(result)) {
        throw httpError(400, `result must be one of: ${RESULTS.join(", ")}`);
    }
    if (
        confidence_score !== null &&
        (typeof confidence_score !== "number" || confidence_score < 0 || confidence_score > 1)
    ) {
        throw httpError(400, "confidence_score must be a number between 0 and 1");
    }
    return { reviewed_by_user_id };
};

// Composable insert (accepts db=client or a tx). Returns the new event row.
const insertEvent = async ({
    content_item_id,
    provider,
    provider_version = null,
    result,
    confidence_score = null,
    category_scores = null,
    raw_response = null,
    scan_duration_ms = null,
    cost_cents = null,
    reviewed_by_user_id = null,
}, db = client) => {
    const { rows } = await db.query(
        `INSERT INTO moderation_events
           (content_item_id, provider, provider_version, result, confidence_score,
            category_scores, raw_response, scan_duration_ms, cost_cents,
            reviewed_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING ${COLS}`,
        [
            content_item_id, provider, provider_version, result, confidence_score,
            category_scores ? JSON.stringify(category_scores) : null,
            raw_response ? JSON.stringify(raw_response) : null,
            scan_duration_ms, cost_cents, reviewed_by_user_id,
        ]
    );
    return rows[0];
};

// ---- reads -----------------------------------------------------------------

// getModerationEventsForItem — full scan history for one content_item, newest
// first. Admin-only (exposes raw provider payloads).
const getModerationEventsForItem = async ({ content_item_id }) => {
    if (!content_item_id) throw httpError(400, "content_item_id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${COLS} FROM moderation_events
              WHERE content_item_id = $1
              ORDER BY scanned_at DESC`,
            [content_item_id]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "content_item_id must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// ---- mutations -------------------------------------------------------------

// recordModerationEvent — INTERNAL. A provider/system records a single scan
// result. Does NOT change the content_item's status (that is applyAutoDecision's
// job, or a human's). Pure append to the evidence chain.
const recordModerationEvent = async (input) => {
    const norm = validateEventInput(input);
    try {
        return await insertEvent({ ...input, reviewed_by_user_id: norm.reviewed_by_user_id });
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "content item or reviewer does not exist");
        if (err.code === "23514") throw httpError(400, "event violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// applyAutoDecision — INTERNAL. Records the scan event AND, in the SAME
// transaction, applies a moderation_status to the parent content_item when the
// verdict + confidence cross a policy threshold. Keeps the event (evidence) and
// the decision atomic.
//
// POLICY (intentionally simple, documented here):
//   result 'rejected' AND confidence >= AUTO_REJECT_CONFIDENCE
//        → content_item.moderation_status = 'rejected'
//   result 'flagged'  AND confidence >= AUTO_FLAG_CONFIDENCE
//        → content_item.moderation_status = 'pending_human_review'
//   result 'clean'
//        → content_item.moderation_status = 'approved'
//   anything else (inconclusive / error / low-confidence flag)
//        → no status change; the item waits for another scan or a human.
//
// Returns { event, content_item } where content_item is the (possibly updated)
// row, or null if no status change was applied / the item was not found.
const applyAutoDecision = async (input) => {
    const norm = validateEventInput(input);
    const { content_item_id, result, confidence_score = null } = input;

    // Decide the target status (if any) from the policy above. Done outside the
    // tx so the rule is easy to read; the writes happen inside.
    let nextStatus = null;
    let removed_reason = null;
    if (result === "rejected" && confidence_score !== null && confidence_score >= AUTO_REJECT_CONFIDENCE) {
        nextStatus = "rejected";
    } else if (result === "flagged" && confidence_score !== null && confidence_score >= AUTO_FLAG_CONFIDENCE) {
        nextStatus = "pending_human_review";
    } else if (result === "clean") {
        nextStatus = "approved";
    }

    try {
        return await withTransaction(async (tx) => {
            const event = await insertEvent(
                { ...input, reviewed_by_user_id: norm.reviewed_by_user_id },
                tx
            );

            let content_item = null;
            if (nextStatus) {
                // setModerationStatus is the single source of truth for status
                // changes; we pass the tx so it commits with the event.
                content_item = await setModerationStatus(
                    { id: content_item_id, moderation_status: nextStatus, removed_reason },
                    tx
                );
            }
            return { event, content_item, applied_status: nextStatus };
        });
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "content item or reviewer does not exist");
        if (err.code === "23514") throw httpError(400, "auto-decision violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

module.exports = {
    PROVIDERS,
    RESULTS,
    AUTO_REJECT_CONFIDENCE,
    AUTO_FLAG_CONFIDENCE,
    getModerationEventsForItem,
    recordModerationEvent,
    applyAutoDecision,
};
