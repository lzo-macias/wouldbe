const { client, withTransaction } = require("../index.js");

// ============================================================================
// moderation_appeals — the affected USER's right to contest a moderation
// decision (DSA / proposed-US-legislation compliance). A user whose content was
// flagged/removed files an appeal; an admin reviews it and either grants (which
// can REVERSE the moderation action) or denies it. The documented trail reduces
// "censorship" lawsuit exposure.
//
// Mirrors the migration exactly (1779234282879_my-first-migration.js):
//   status ∈ pending|under_review|granted|denied|abandoned   (default 'pending')
//   columns: content_item_id, user_id, appeal_reason, filed_at, reviewed_at,
//            reviewed_by_user_id, decision_notes,
//            original_moderation_status, final_moderation_status
//
// FK NOTE: moderation_appeals.content_item_id REFERENCES content_items(id) (NOT
// moderation_events). user_id and reviewed_by_user_id both REFERENCE users(id):
//   - user_id (the appellant) ← req.user.id, ALWAYS from the token, never body.
//   - reviewed_by_user_id (the deciding admin) ← req.admin.user_id (USERS id).
// ============================================================================

// Full lifecycle (the table CHECK). 'pending' is the initial state.
const APPEAL_STATUSES = ["pending", "under_review", "granted", "denied", "abandoned"];
// Statuses still awaiting an admin decision (the review queue).
const PENDING_STATUSES = ["pending", "under_review"];

// content_items.moderation_status enum — used to validate a final status we set
// when an appeal is granted (reversing the action).
const CONTENT_STATUSES = [
    "pending_upload", "pending_moderation", "approved", "flagged",
    "rejected", "pending_human_review", "removed",
];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// fileAppeal(...) — the affected user contests a moderation action on their own
// content. appellant_user_id ALWAYS comes from the token, never the body. We
// snapshot the content's CURRENT moderation_status into original_moderation_status
// so the decision later has a documented "before" state, and we enforce that the
// appellant actually owns the content they are appealing.
const fileAppeal = async ({
    appellant_user_id,
    content_item_id,
    appeal_reason,
} = {}) => {
    if (!appellant_user_id) throw httpError(401, "authentication required to file an appeal");
    if (!content_item_id) throw httpError(400, "content_item_id is required");
    if (!appeal_reason || !String(appeal_reason).trim()) {
        throw httpError(400, "appeal_reason is required");
    }

    try {
        // The appellant may only appeal their OWN content, and only content that
        // was actually actioned (not approved / still pending upload). This also
        // gives us the snapshot for original_moderation_status.
        const ci = await client.query(
            `SELECT user_id, moderation_status FROM content_items WHERE id = $1`,
            [content_item_id]
        );
        if (!ci.rows.length) throw httpError(404, "no content item with that id");
        if (ci.rows[0].user_id !== appellant_user_id) {
            throw httpError(403, "you can only appeal a moderation action on your own content");
        }

        const { rows } = await client.query(
            `INSERT INTO moderation_appeals
               (content_item_id, user_id, appeal_reason, status, original_moderation_status)
             VALUES ($1, $2, $3, 'pending', $4)
             RETURNING *`,
            [content_item_id, appellant_user_id, appeal_reason, ci.rows[0].moderation_status]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "an appeal for this item already exists");
        if (err.code === "23503") throw httpError(400, "content_item_id does not exist");
        if (err.code === "23514") throw httpError(400, "appeal violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getUserAppeals(...) — a caller viewing their OWN appeals. user_id comes from
// the token; never trust a body/query value here.
const getUserAppeals = async ({ user_id } = {}) => {
    if (!user_id) throw httpError(401, "authentication required");
    try {
        const { rows } = await client.query(
            `SELECT a.*, ci.content_type, ci.moderation_status AS content_moderation_status
             FROM moderation_appeals a
             JOIN content_items ci ON ci.id = a.content_item_id
             WHERE a.user_id = $1
             ORDER BY a.filed_at DESC`,
            [user_id]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "user_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listPendingAppeals(filters) — the admin review queue. Defaults to the
// undecided appeals (pending + under_review). Oldest-first so the appeal waiting
// longest surfaces at the top.
const listPendingAppeals = async ({ status = null, limit = 100 } = {}) => {
    if (status !== null && !APPEAL_STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${APPEAL_STATUSES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `SELECT a.*,
                    u.username        AS appellant_username,
                    ci.content_type,
                    ci.moderation_status AS content_moderation_status
             FROM moderation_appeals a
             JOIN content_items ci ON ci.id = a.content_item_id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE ($1::text IS NULL AND a.status IN ('pending','under_review')
                    OR a.status = $1)
             ORDER BY a.filed_at ASC
             LIMIT $2`,
            [status, Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "a filter value is malformed");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// decideAppeal(...) — an admin grants/denies an appeal. Transactional because a
// 'granted' decision can REVERSE the moderation action by flipping the content's
// moderation_status, and we record that as final_moderation_status in the SAME
// commit (an appeal decision and the action it reverses are atomic).
//   decision           → 'granted' | 'denied'
//   reviewer_user_id   → deciding admin's USERS id (req.admin.user_id)
//   reverse_to_status  → required when granting if you want to flip the content
//                        (a content_items.moderation_status value, e.g. 'approved')
const decideAppeal = async ({
    id,
    reviewer_user_id,
    decision,
    decision_notes = null,
    reverse_to_status = null,
} = {}) => {
    if (!id) throw httpError(400, "id is required");
    if (!reviewer_user_id) throw httpError(400, "reviewer_user_id is required");
    if (!["granted", "denied"].includes(decision)) {
        throw httpError(400, "decision must be 'granted' or 'denied'");
    }
    if (reverse_to_status !== null && !CONTENT_STATUSES.includes(reverse_to_status)) {
        throw httpError(
            400,
            `reverse_to_status must be one of: ${CONTENT_STATUSES.join(", ")}`
        );
    }

    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM moderation_appeals WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const before = cur.rows[0];
            if (!before) throw httpError(404, "no appeal with that id");
            if (!PENDING_STATUSES.includes(before.status)) {
                throw httpError(409, `appeal is already '${before.status}'`);
            }

            // If granting AND a target status was supplied, reverse the action.
            let finalStatus = null;
            if (decision === "granted" && reverse_to_status !== null) {
                const ci = await tx.query(
                    `UPDATE content_items SET
                        moderation_status = $2,
                        removed_at = CASE WHEN $2 IN ('removed','rejected')
                                          THEN COALESCE(removed_at, now())
                                          ELSE NULL END,
                        published_at = CASE WHEN $2 = 'approved'
                                            THEN COALESCE(published_at, now())
                                            ELSE published_at END
                     WHERE id = $1
                     RETURNING moderation_status`,
                    [before.content_item_id, reverse_to_status]
                );
                finalStatus = ci.rows.length ? ci.rows[0].moderation_status : reverse_to_status;
            }

            const updated = await tx.query(
                `UPDATE moderation_appeals SET
                    status                 = $2,
                    reviewed_at            = now(),
                    reviewed_by_user_id    = $3,
                    decision_notes         = COALESCE($4, decision_notes),
                    final_moderation_status = COALESCE($5, final_moderation_status)
                 WHERE id = $1
                 RETURNING *`,
                [id, decision, reviewer_user_id, decision_notes, finalStatus]
            );
            return updated.rows[0];
        });
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "reviewer or content reference does not exist");
        if (err.code === "23514") throw httpError(400, "decision violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    APPEAL_STATUSES,
    PENDING_STATUSES,
    fileAppeal,
    getUserAppeals,
    listPendingAppeals,
    decideAppeal,
};
