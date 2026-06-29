const { client } = require("../index.js");

// ============================================================================
// admin_actions — READ side only.
//
// The WRITE side lives elsewhere on purpose:
//   - the recordAdminAction middleware appends the standard audit row after a
//     2xx admin request, and
//   - admins.js writes its own atomic before/after audit rows inside the same
//     transaction as each privileged change.
// This module never inserts; it only exposes the audit trail to the admin
// console (browse the log, see everything done to one resource, or by one admin).
//
// admin_actions columns (FK: admin_user_id REFERENCES admin_users(id)):
//   id, admin_user_id, action_type, target_resource_type, target_resource_id,
//   before_state, after_state, reason, ip_address, user_agent, mfa_verified,
//   created_at
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Shared projection. JOIN to admin_users + users so the UI can show who acted
// without an N+1. ip_address is cast to text (inet → JSON-friendly).
const SELECT_BASE = `
    SELECT aa.id, aa.admin_user_id, aa.action_type,
           aa.target_resource_type, aa.target_resource_id,
           aa.before_state, aa.after_state, aa.reason,
           aa.ip_address::text AS ip_address, aa.user_agent,
           aa.mfa_verified, aa.created_at,
           au.role AS admin_role,
           u.username AS admin_username, u.email AS admin_email
    FROM admin_actions aa
    JOIN admin_users au ON au.id = aa.admin_user_id
    JOIN users u ON u.id = au.user_id
`;

// listAdminActions(filters) — the audit browser. All filters optional; newest
// first. action_type / target_resource_type are exact matches; the date window
// is inclusive on both ends when provided.
const listAdminActions = async ({
    admin_user_id = null,
    action_type = null,
    target_resource_type = null,
    target_resource_id = null,
    mfa_verified = null,
    created_after = null,
    created_before = null,
    limit = 100,
} = {}) => {
    try {
        const { rows } = await client.query(
            `${SELECT_BASE}
             WHERE ($1::uuid IS NULL OR aa.admin_user_id = $1)
               AND ($2::text IS NULL OR aa.action_type = $2)
               AND ($3::text IS NULL OR aa.target_resource_type = $3)
               AND ($4::uuid IS NULL OR aa.target_resource_id = $4)
               AND ($5::boolean IS NULL OR aa.mfa_verified = $5)
               AND ($6::timestamptz IS NULL OR aa.created_at >= $6)
               AND ($7::timestamptz IS NULL OR aa.created_at <= $7)
             ORDER BY aa.created_at DESC
             LIMIT $8`,
            [
                admin_user_id,
                action_type,
                target_resource_type,
                target_resource_id,
                mfa_verified === null || mfa_verified === undefined ? null : !!mfa_verified,
                created_after,
                created_before,
                Math.min(Number(limit) || 100, 500),
            ]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "an id/date filter is malformed");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getActionsForResource(...) — full history for one polymorphic target (e.g.
// every admin action taken against a given admin_user / user / report).
const getActionsForResource = async ({ resource_type, resource_id, limit = 200 }) => {
    if (!resource_type) throw httpError(400, "resource_type is required");
    if (!resource_id) throw httpError(400, "resource_id is required");
    try {
        const { rows } = await client.query(
            `${SELECT_BASE}
             WHERE aa.target_resource_type = $1
               AND aa.target_resource_id = $2
             ORDER BY aa.created_at DESC
             LIMIT $3`,
            [resource_type, resource_id, Math.min(Number(limit) || 200, 500)]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "resource_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getActionsByAdmin(...) — everything one admin has done. Newest first.
const getActionsByAdmin = async ({ admin_user_id, limit = 200 }) => {
    if (!admin_user_id) throw httpError(400, "admin_user_id is required");
    try {
        const { rows } = await client.query(
            `${SELECT_BASE}
             WHERE aa.admin_user_id = $1
             ORDER BY aa.created_at DESC
             LIMIT $2`,
            [admin_user_id, Math.min(Number(limit) || 200, 500)]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "admin_user_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = { listAdminActions, getActionsForResource, getActionsByAdmin };
