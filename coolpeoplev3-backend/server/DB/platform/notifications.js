const { client, withTransaction } = require("../index.js");

// ============================================================================
// §17 notifications — append-only log of every candidate-facing notification.
//
// TWO classes of column, by design (see the migration):
//   - DECISION columns (recipient_user_id, wouldbe_id, notification_type,
//     criteria_version_id, trigger_snapshot, consent_id, channel): WRITE-ONCE.
//     They are the neutrality evidence and must never be edited after insert.
//   - DELIVERY-LIFECYCLE columns (status, suppression_reason, *_at, error_message):
//     the only columns that get updated, and the timestamps are stamped once.
//
// queueNotification is therefore the only writer of decision data; the mark*/
// suppress* writers only move the lifecycle forward and refuse to clobber an
// already-terminal row.
// ============================================================================

const NOTIFICATION_TYPES = [
    "wouldbe_launched",
    "goal_progress",
    "near_goal",
    "contentious_race",
    "ideology_match",
];
const CHANNELS = ["email", "sms", "push", "in_app"];

// columns safe to return everywhere (the table holds no secrets, but we keep the
// projection explicit so a future sensitive column isn't leaked by accident).
const COLS = `
    id, recipient_user_id, wouldbe_id, notification_type, channel,
    criteria_version_id, trigger_snapshot, consent_id,
    status, suppression_reason, system_job_id, scheduled_for,
    sent_at, delivered_at, failed_at, error_message, created_at
`;

// ---- write (decision row) --------------------------------------------------

// queueNotification — append a new notification in 'queued' status. Writes ALL
// the write-once decision evidence; this is the only place those columns are set.
// trigger_snapshot is required (it is the per-send proof of the objective inputs).
const queueNotification = async ({
    recipient_user_id,
    wouldbe_id = null,
    notification_type,
    channel,
    criteria_version_id = null,
    trigger_snapshot,
    consent_id = null,
    system_job_id = null,
    scheduled_for = null,
    db = client,
}) => {
    if (!recipient_user_id) throw httpError(400, "recipient_user_id is required");
    if (!NOTIFICATION_TYPES.includes(notification_type)) {
        throw httpError(400, `notification_type must be one of: ${NOTIFICATION_TYPES.join(", ")}`);
    }
    if (!CHANNELS.includes(channel)) {
        throw httpError(400, `channel must be one of: ${CHANNELS.join(", ")}`);
    }
    if (trigger_snapshot == null || typeof trigger_snapshot !== "object" || Array.isArray(trigger_snapshot)) {
        throw httpError(400, "trigger_snapshot (a JSON object) is required");
    }
    try {
        const { rows } = await db.query(
            `INSERT INTO notifications
               (recipient_user_id, wouldbe_id, notification_type, channel,
                criteria_version_id, trigger_snapshot, consent_id,
                system_job_id, scheduled_for, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued')
             RETURNING ${COLS}`,
            [
                recipient_user_id,
                wouldbe_id,
                notification_type,
                channel,
                criteria_version_id,
                JSON.stringify(trigger_snapshot),
                consent_id,
                system_job_id,
                scheduled_for,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "duplicate notification");
        if (err.code === "23503") throw httpError(400, "a referenced row does not exist");
        if (err.code === "23514") throw httpError(400, "a field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid/json field is malformed");
        console.error(err);
        throw err;
    }
};

// ---- lifecycle marks (only the delivery columns move) ----------------------
//
// Each mark is a guarded UPDATE: it only fires from a state that legitimately
// precedes it, and stamps its timestamp once (the WHERE clause's *_at IS NULL
// makes the stamp idempotent / no-clobber). Returns the updated row, or throws
// 404 if the id doesn't exist and 409 if the transition isn't allowed.

const fetchOne = async (db, id) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM notifications WHERE id = $1`, [id]);
    return rows[0] || null;
};

// markNotificationSent — queued -> sent (stamps sent_at once).
const markNotificationSent = async ({ id, db = client }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await db.query(
            `UPDATE notifications
                SET status = 'sent', sent_at = COALESCE(sent_at, now())
              WHERE id = $1 AND status = 'queued'
              RETURNING ${COLS}`,
            [id]
        );
        if (rows[0]) return rows[0];
        return throwTransition(db, id);
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "id is malformed");
        console.error(err);
        throw err;
    }
};

// markNotificationDelivered — sent -> delivered (stamps delivered_at once).
const markNotificationDelivered = async ({ id, db = client }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await db.query(
            `UPDATE notifications
                SET status = 'delivered', delivered_at = COALESCE(delivered_at, now())
              WHERE id = $1 AND status = 'sent'
              RETURNING ${COLS}`,
            [id]
        );
        if (rows[0]) return rows[0];
        return throwTransition(db, id);
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "id is malformed");
        console.error(err);
        throw err;
    }
};

// markNotificationFailed — queued|sent -> failed (stamps failed_at, records error).
const markNotificationFailed = async ({ id, error = null, db = client }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await db.query(
            `UPDATE notifications
                SET status = 'failed',
                    failed_at = COALESCE(failed_at, now()),
                    error_message = $2
              WHERE id = $1 AND status IN ('queued','sent')
              RETURNING ${COLS}`,
            [id, error]
        );
        if (rows[0]) return rows[0];
        return throwTransition(db, id);
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "id is malformed");
        console.error(err);
        throw err;
    }
};

// suppressNotification — queued -> suppressed, recording WHY it was not sent
// (consent_revoked, frequency_cap, quiet_hours, ...). Only a still-queued row can
// be suppressed; an already-sent one cannot be retroactively unsent.
const suppressNotification = async ({ id, suppression_reason, db = client }) => {
    if (!id) throw httpError(400, "id is required");
    if (!suppression_reason) throw httpError(400, "suppression_reason is required");
    try {
        const { rows } = await db.query(
            `UPDATE notifications
                SET status = 'suppressed', suppression_reason = $2
              WHERE id = $1 AND status = 'queued'
              RETURNING ${COLS}`,
            [id, suppression_reason]
        );
        if (rows[0]) return rows[0];
        return throwTransition(db, id);
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "id is malformed");
        console.error(err);
        throw err;
    }
};

// shared 404/409 resolver for a no-op guarded UPDATE.
const throwTransition = async (db, id) => {
    const existing = await fetchOne(db, id);
    if (!existing) throw httpError(404, "notification not found");
    throw httpError(409, `notification is '${existing.status}'; transition not allowed`);
};

// ---- reads -----------------------------------------------------------------

// getUserNotifications({ user_id }) — the recipient's own history, newest first.
// Uses idx_notifications_recipient (recipient_user_id, created_at).
const getUserNotifications = async ({ user_id, limit = 100 } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${COLS} FROM notifications
             WHERE recipient_user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [user_id, Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "user_id is malformed");
        console.error(err);
        throw err;
    }
};

// listNotifications({...}) — admin audit view. Filterable by recipient, wouldbe,
// type, channel, status. Drives "did every candidate get treated the same?".
const listNotifications = async ({
    recipient_user_id = null,
    wouldbe_id = null,
    notification_type = null,
    channel = null,
    status = null,
    limit = 200,
} = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT ${COLS} FROM notifications
             WHERE ($1::uuid IS NULL OR recipient_user_id = $1)
               AND ($2::uuid IS NULL OR wouldbe_id = $2)
               AND ($3::text IS NULL OR notification_type = $3)
               AND ($4::text IS NULL OR channel = $4)
               AND ($5::text IS NULL OR status = $5)
             ORDER BY created_at DESC
             LIMIT $6`,
            [
                recipient_user_id,
                wouldbe_id,
                notification_type,
                channel,
                status,
                Math.min(Number(limit) || 200, 1000),
            ]
        );
        return rows;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a filter field is malformed");
        console.error(err);
        throw err;
    }
};

// tiny helper so routes can map thrown errors to status codes
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    NOTIFICATION_TYPES,
    CHANNELS,
    queueNotification,
    markNotificationSent,
    markNotificationDelivered,
    markNotificationFailed,
    suppressNotification,
    getUserNotifications,
    listNotifications,
};
