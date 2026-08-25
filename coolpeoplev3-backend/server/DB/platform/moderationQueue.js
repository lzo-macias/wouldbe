const { client, withTransaction } = require("../index.js");

// ============================================================================
// moderation_queue — the HUMAN-review queue (Trust & Safety pillar). An item of
// content lands here when something (an automated scan, a user report, an
// appeal, a CSAM signal, a DMCA claim, or a live-stream review) needs a human
// to look at it inside a documented SLA window. Moderators claim an item, then
// resolve it; resolving can also flip the underlying content_items row and (for
// 'manual' verdicts) leave a moderation_events evidence row, so those writes go
// through a transaction.
//
// Mirrors the migration exactly (1779234282879_my-first-migration.js):
//   queue_type ∈ auto_flagged|user_reported|appeal|csam_suspected|
//                dmca_claim|live_stream_review
//   priority   : integer, CHECK priority BETWEEN 1 AND 5 (1 = CSAM/most urgent)
//   status     ∈ open|in_review|resolved|escalated   (default 'open')
//   sla_deadline : timestamptz NOT NULL (computed at enqueue time)
//
// FK NOTE: assigned_to_user_id / resolved_by_user_id REFERENCE users(id) — NOT
// admin_users(id). A moderator IS a user (with an admin_users row), so we store
// the admin's USERS id (req.admin.user_id) in these columns, never req.admin.id.
// content_item_id REFERENCES content_items(id).
// ============================================================================

// Valid reasons an item enters the queue (mirrors the table CHECK).
const QUEUE_TYPES = [
    "auto_flagged", "user_reported", "appeal", "csam_suspected",
    "dmca_claim", "live_stream_review",
];
// Full lifecycle (the table CHECK). 'open' is the initial state.
const QUEUE_STATUSES = ["open", "in_review", "resolved", "escalated"];
// Statuses an item is considered still "open" for SLA/list purposes.
const OPEN_STATUSES = ["open", "in_review"];

// SLA window (in hours) per queue_type, lower = tighter. csam_suspected = 24h is
// the regulator-facing commitment; the rest are operational defaults. Used only
// to COMPUTE sla_deadline when the caller doesn't supply one explicitly.
const SLA_HOURS = {
    csam_suspected: 24,
    live_stream_review: 24,
    dmca_claim: 48,
    user_reported: 72,
    auto_flagged: 72,
    appeal: 168,
};
// Default triage priority per queue_type (1 = most urgent), used when the caller
// doesn't pass a priority explicitly.
const QUEUE_PRIORITY = {
    csam_suspected: 1,
    dmca_claim: 2,
    live_stream_review: 2,
    user_reported: 3,
    auto_flagged: 4,
    appeal: 5,
};

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// enqueueForReview(...) — system/internal path: put a content item in front of a
// human. Computes sla_deadline (NOT NULL in the schema) from queue_type unless
// an explicit sla_deadline is supplied; computes a default priority likewise.
// Always starts 'open' and unassigned.
const enqueueForReview = async ({
    content_item_id,
    queue_type,
    priority = null,
    sla_deadline = null,
} = {}) => {
    if (!content_item_id) throw httpError(400, "content_item_id is required");
    if (!QUEUE_TYPES.includes(queue_type)) {
        throw httpError(400, `queue_type must be one of: ${QUEUE_TYPES.join(", ")}`);
    }
    const prio = priority ?? QUEUE_PRIORITY[queue_type] ?? 5;
    if (!Number.isInteger(prio) || prio < 1 || prio > 5) {
        throw httpError(400, "priority must be an integer between 1 and 5");
    }

    try {
        // Compute sla_deadline as now() + interval when the caller didn't give one.
        // Done in SQL so the deadline is anchored to the DB clock.
        const hours = SLA_HOURS[queue_type] ?? 72;
        const { rows } = await client.query(
            `INSERT INTO moderation_queue
               (content_item_id, queue_type, priority, status, sla_deadline)
             VALUES (
                $1, $2, $3, 'open',
                COALESCE($4::timestamptz, now() + ($5 || ' hours')::interval)
             )
             RETURNING *`,
            [content_item_id, queue_type, prio, sla_deadline, String(hours)]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "this item is already queued");
        if (err.code === "23503") throw httpError(400, "content_item_id does not exist");
        if (err.code === "23514") throw httpError(400, "queue row violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listOpenQueue(filters) — the moderator work list. Defaults to the still-open
// items (open + in_review); pass status to narrow, or include_closed to see
// everything. Sorted by priority (most urgent first) then oldest-first so the
// item closest to breaching its SLA surfaces at the top.
const listOpenQueue = async ({
    status = null,
    queue_type = null,
    assigned_to_user_id = null,
    include_closed = false,
    limit = 100,
} = {}) => {
    if (status !== null && !QUEUE_STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${QUEUE_STATUSES.join(", ")}`);
    }
    if (queue_type !== null && !QUEUE_TYPES.includes(queue_type)) {
        throw httpError(400, `queue_type must be one of: ${QUEUE_TYPES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `SELECT q.*,
                    ci.user_id          AS content_owner_user_id,
                    ci.moderation_status AS content_moderation_status,
                    ci.content_type,
                    assignee.username   AS assigned_to_username
             FROM moderation_queue q
             JOIN content_items ci ON ci.id = q.content_item_id
             LEFT JOIN users assignee ON assignee.id = q.assigned_to_user_id
             WHERE ($1::text IS NULL OR q.status = $1)
               AND ($2::boolean OR q.status IN ('open','in_review'))
               AND ($3::text IS NULL OR q.queue_type = $3)
               AND ($4::uuid IS NULL OR q.assigned_to_user_id = $4)
             ORDER BY q.priority ASC, q.created_at ASC
             LIMIT $5`,
            [
                status,
                include_closed,
                queue_type,
                assigned_to_user_id,
                Math.min(Number(limit) || 100, 500),
            ]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "a filter value is malformed");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// assignQueueItem(...) — a moderator claims an item. Moves it to 'in_review' and
// stamps assignee + assigned_at. assignee_user_id is the moderator's USERS id
// (req.admin.user_id). Only an open/in_review item can be (re)assigned.
const assignQueueItem = async ({ id, assignee_user_id } = {}) => {
    if (!id) throw httpError(400, "id is required");
    if (!assignee_user_id) throw httpError(400, "assignee_user_id is required");
    try {
        const { rows } = await client.query(
            `UPDATE moderation_queue SET
                assigned_to_user_id = $2,
                assigned_at         = now(),
                status              = 'in_review'
             WHERE id = $1
               AND status IN ('open','in_review')
             RETURNING *`,
            [id, assignee_user_id]
        );
        if (!rows.length) {
            // Distinguish "not found" from "already resolved/escalated".
            const exists = await client.query(
                `SELECT status FROM moderation_queue WHERE id = $1`,
                [id]
            );
            if (!exists.rows.length) throw httpError(404, "no queue item with that id");
            throw httpError(409, `cannot assign an item in '${exists.rows[0].status}' state`);
        }
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "assignee_user_id does not exist");
        if (err.code === "22P02") throw httpError(400, "an id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// resolveQueueItem(...) — a moderator closes an item. Transactional because it
// can ALSO change the underlying content (content_items.moderation_status) and
// leave a manual moderation_events evidence row in the SAME commit, so the
// queue close and its side-effects are atomic. Pass content_moderation_status to
// flip the content; omit it to close the queue row only.
//   status      → 'resolved' (default) or 'escalated'
//   resolution  → short outcome code/string (free text in the schema)
const resolveQueueItem = async ({
    id,
    resolver_user_id,
    status = "resolved",
    resolution = null,
    resolution_notes = null,
    content_moderation_status = null,
} = {}) => {
    if (!id) throw httpError(400, "id is required");
    if (!resolver_user_id) throw httpError(400, "resolver_user_id is required");
    if (!["resolved", "escalated"].includes(status)) {
        throw httpError(400, "status must be 'resolved' or 'escalated'");
    }
    const CONTENT_STATUSES = [
        "pending_upload", "pending_moderation", "approved", "flagged",
        "rejected", "pending_human_review", "removed",
    ];
    if (
        content_moderation_status !== null &&
        !CONTENT_STATUSES.includes(content_moderation_status)
    ) {
        throw httpError(
            400,
            `content_moderation_status must be one of: ${CONTENT_STATUSES.join(", ")}`
        );
    }

    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM moderation_queue WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const before = cur.rows[0];
            if (!before) throw httpError(404, "no queue item with that id");
            if (before.status === "resolved") {
                throw httpError(409, "queue item is already resolved");
            }

            const updated = await tx.query(
                `UPDATE moderation_queue SET
                    status           = $2,
                    resolution       = COALESCE($3, resolution),
                    resolution_notes = COALESCE($4, resolution_notes),
                    resolved_at      = now(),
                    resolved_by_user_id = $5
                 WHERE id = $1
                 RETURNING *`,
                [id, status, resolution, resolution_notes, resolver_user_id]
            );
            const queueRow = updated.rows[0];

            // Optional side-effects, atomic with the close.
            if (content_moderation_status !== null) {
                await tx.query(
                    `UPDATE content_items SET
                        moderation_status = $2,
                        removed_at = CASE WHEN $2 IN ('removed','rejected')
                                          THEN COALESCE(removed_at, now())
                                          ELSE removed_at END
                     WHERE id = $1`,
                    [before.content_item_id, content_moderation_status]
                );
                // Manual moderation event — the human decision evidence row.
                await tx.query(
                    `INSERT INTO moderation_events
                       (content_item_id, provider, result, reviewed_by_user_id)
                     VALUES ($1, 'manual', $2, $3)`,
                    [
                        before.content_item_id,
                        content_moderation_status === "approved" ? "clean"
                            : content_moderation_status === "rejected"
                                || content_moderation_status === "removed" ? "rejected"
                            : "flagged",
                        resolver_user_id,
                    ]
                );
            }
            return queueRow;
        });
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "resolver or content reference does not exist");
        if (err.code === "23514") throw httpError(400, "resolution violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getQueueSLAMetrics(filters) — a small dashboard aggregate for the moderation
// console. Kept deliberately simple: one pass over the queue producing
//   - open / in_review / resolved / escalated counts
//   - how many still-open items are PAST their sla_deadline (breached)
//   - the oldest still-open created_at and worst (earliest) open sla_deadline
// "open" here means status IN ('open','in_review'). Optional queue_type filter.
const getQueueSLAMetrics = async ({ queue_type = null } = {}) => {
    if (queue_type !== null && !QUEUE_TYPES.includes(queue_type)) {
        throw httpError(400, `queue_type must be one of: ${QUEUE_TYPES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'open')                       AS open_count,
                COUNT(*) FILTER (WHERE status = 'in_review')                  AS in_review_count,
                COUNT(*) FILTER (WHERE status = 'resolved')                   AS resolved_count,
                COUNT(*) FILTER (WHERE status = 'escalated')                  AS escalated_count,
                COUNT(*) FILTER (
                    WHERE status IN ('open','in_review') AND sla_deadline < now()
                )                                                             AS sla_breached_count,
                MIN(created_at)   FILTER (WHERE status IN ('open','in_review')) AS oldest_open_at,
                MIN(sla_deadline) FILTER (WHERE status IN ('open','in_review')) AS soonest_open_deadline
             FROM moderation_queue
             WHERE ($1::text IS NULL OR queue_type = $1)`,
            [queue_type]
        );
        const m = rows[0];
        return {
            open_count: Number(m.open_count),
            in_review_count: Number(m.in_review_count),
            resolved_count: Number(m.resolved_count),
            escalated_count: Number(m.escalated_count),
            sla_breached_count: Number(m.sla_breached_count),
            oldest_open_at: m.oldest_open_at,
            soonest_open_deadline: m.soonest_open_deadline,
        };
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "a filter value is malformed");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    QUEUE_TYPES,
    QUEUE_STATUSES,
    OPEN_STATUSES,
    enqueueForReview,
    listOpenQueue,
    assignQueueItem,
    resolveQueueItem,
    getQueueSLAMetrics,
};
