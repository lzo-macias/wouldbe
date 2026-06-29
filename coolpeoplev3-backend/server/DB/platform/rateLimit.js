const { client } = require("../index.js");

// ============================================================================
// rate_limit_violations — READ side only.
//
// The WRITE side lives in server/middleware/index.js (the rateLimit() middleware
// INSERTs a violation row when a bucket overflows). This module is purely for the
// admin console / abuse investigation: list violations and count violations from
// a given IP. High counts from one IP/user signal bots or coordinated activity.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// listRateLimitViolations(filters) — the abuse-investigation feed. All filters
// optional. Newest first. since (ISO/timestamptz) bounds the window.
const listRateLimitViolations = async ({
    user_id = null,
    rate_limit_type = null,
    ip_address = null,
    action_taken = null,
    since = null,
    limit = 100,
} = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT rlv.*, u.username
             FROM rate_limit_violations rlv
             LEFT JOIN users u ON u.id = rlv.user_id
             WHERE ($1::uuid IS NULL OR rlv.user_id = $1)
               AND ($2::text IS NULL OR rlv.rate_limit_type = $2)
               AND ($3::inet IS NULL OR rlv.ip_address = $3)
               AND ($4::text IS NULL OR rlv.action_taken = $4)
               AND ($5::timestamptz IS NULL OR rlv.created_at >= $5)
             ORDER BY rlv.created_at DESC
             LIMIT $6`,
            [user_id, rate_limit_type, ip_address, action_taken, since,
             Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "a filter value is malformed (uuid/inet/timestamp)");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// countViolationsForIP(...) — how many violations from one IP (optionally since a
// cutoff). The headline number for "is this IP abusive?".
const countViolationsForIP = async ({ ip_address, since = null } = {}) => {
    if (!ip_address) throw httpError(400, "ip_address is required");
    try {
        const { rows } = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM rate_limit_violations
             WHERE ip_address = $1::inet
               AND ($2::timestamptz IS NULL OR created_at >= $2)`,
            [ip_address, since]
        );
        return rows[0].count;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "ip_address must be a valid IP / since must be a valid timestamp");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    listRateLimitViolations,
    countViolationsForIP,
};
