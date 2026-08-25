const { client } = require("../index.js");

// ============================================================================
// user_strikes — moderation strike ledger (Trust & Safety). An admin issues a
// strike against a user (warning → … → permanent_ban). Strikes accumulate to
// drive auto-escalation and the DMCA repeat-infringer policy. A struck user may
// appeal their own strike; admins/cron can expire a strike off the active record.
//
// Mirrors the migration CHECKs exactly:
//   strike_type ∈ warning|temporary_suspension|permanent_ban|
//                 content_removal|feature_restriction
//   severity    : integer BETWEEN 1 AND 5
//   issued_by_user_id : null = automated; an admin's user id otherwise
// ============================================================================

const STRIKE_TYPES = [
    "warning", "temporary_suspension", "permanent_ban",
    "content_removal", "feature_restriction",
];
// Appeal outcomes (table column is free text; we constrain at the app layer).
const APPEAL_STATUSES = ["pending", "upheld", "overturned", "reduced"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// issueStrike(...) — admin-only writer. issued_by_user_id is the acting admin's
// user id (null for automated escalation). A strike may optionally link to the
// content that triggered it and/or the report it resolved.
const issueStrike = async ({
    user_id,
    strike_type,
    severity,
    reason,
    details = null,
    related_content_item_id = null,
    related_report_id = null,
    issued_by_user_id = null,
    expires_at = null,
}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!STRIKE_TYPES.includes(strike_type)) {
        throw httpError(400, `strike_type must be one of: ${STRIKE_TYPES.join(", ")}`);
    }
    const sev = Number(severity);
    if (!Number.isInteger(sev) || sev < 1 || sev > 5) {
        throw httpError(400, "severity must be an integer between 1 and 5");
    }
    if (!reason || !String(reason).trim()) throw httpError(400, "reason is required");

    try {
        const { rows } = await client.query(
            `INSERT INTO user_strikes
               (user_id, strike_type, severity, reason, details,
                related_content_item_id, related_report_id, issued_by_user_id, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                user_id, strike_type, sev, reason, details,
                related_content_item_id, related_report_id, issued_by_user_id, expires_at,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "user, content, report, or issuer does not exist");
        if (err.code === "23514") throw httpError(400, "strike violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getStrikesForUser(...) — the full strike history for one user, newest first.
// Pass activeOnly to exclude expired strikes.
const getStrikesForUser = async ({ user_id, activeOnly = false }) => {
    if (!user_id) throw httpError(400, "user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT s.*, issuer.username AS issued_by_username
             FROM user_strikes s
             LEFT JOIN users issuer ON issuer.id = s.issued_by_user_id
             WHERE s.user_id = $1
               AND ($2::boolean IS NOT TRUE
                    OR s.expires_at IS NULL OR s.expires_at > now())
             ORDER BY s.issued_at DESC`,
            [user_id, activeOnly]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "user_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getActiveStrikeCount(...) — count of currently-active strikes (no expiry, or
// expiry in the future). Drives auto-escalation thresholds.
const getActiveStrikeCount = async ({ user_id }) => {
    if (!user_id) throw httpError(400, "user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM user_strikes
             WHERE user_id = $1
               AND (expires_at IS NULL OR expires_at > now())`,
            [user_id]
        );
        return rows[0].count;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "user_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// appealStrike(...) — the STRUCK user appeals their own strike. appellant_user_id
// comes from the token; it must match the strike's user_id (enforced here so it
// holds even if a route is misused). Sets appealed = true; appeal_status begins
// 'pending'. Re-appealing an already-appealed strike is a 409.
const appealStrike = async ({ id, appellant_user_id, appeal_status = "pending" }) => {
    if (!appellant_user_id) throw httpError(401, "authentication required to appeal");
    if (!APPEAL_STATUSES.includes(appeal_status)) {
        throw httpError(400, `appeal_status must be one of: ${APPEAL_STATUSES.join(", ")}`);
    }
    try {
        const cur = await client.query(
            `SELECT user_id, appealed FROM user_strikes WHERE id = $1`,
            [id]
        );
        if (!cur.rows.length) throw httpError(404, "no strike with that id");
        if (cur.rows[0].user_id !== appellant_user_id) {
            throw httpError(403, "you can only appeal your own strike");
        }
        if (cur.rows[0].appealed) throw httpError(409, "this strike has already been appealed");

        const { rows } = await client.query(
            `UPDATE user_strikes
                SET appealed = true, appeal_status = $2
              WHERE id = $1
              RETURNING *`,
            [id, appeal_status]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// expireStrike(...) — admin/cron expires a strike off the active record by
// stamping expires_at = now() (if not already expired). Returns the row.
const expireStrike = async ({ id }) => {
    try {
        const { rows } = await client.query(
            `UPDATE user_strikes
                SET expires_at = LEAST(COALESCE(expires_at, now()), now())
              WHERE id = $1
              RETURNING *`,
            [id]
        );
        if (!rows.length) throw httpError(404, "no strike with that id");
        return rows[0];
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// countExpiredStrikes() — for the §16 strike-expiry cron. Strike expiry is
// PURELY TIME-BASED via expires_at: there is NO status/expired flag on the table
// (see migration), and every read path that cares about "active" already filters
// `expires_at IS NULL OR expires_at > now()`. So a strike is effectively expired
// the instant its expires_at passes — there is nothing to flip in a sweep.
// This helper just reports how many strikes have a non-null expires_at in the
// past, so the cron has something observable to log. It is intentionally a
// read-only no-op writer; the real "expiry" happens implicitly at query time.
const countExpiredStrikes = async () => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM user_strikes
          WHERE expires_at IS NOT NULL
            AND expires_at <= now()`
    );
    return rows[0].count;
};

module.exports = {
    STRIKE_TYPES,
    APPEAL_STATUSES,
    issueStrike,
    getStrikesForUser,
    getActiveStrikeCount,
    appealStrike,
    expireStrike,
    countExpiredStrikes,
};
