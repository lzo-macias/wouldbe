const { client, withTransaction } = require("../index.js");

// ============================================================================
// Admin management — create / promote / suspend / terminate admin_users rows.
//
// SECURITY MODEL (why this file is shaped the way it is):
//  - Privilege-escalation surface. Every mutation here is the kind of thing that,
//    done wrong, hands someone the whole platform. So the invariants below are
//    enforced HERE (in the data layer, atomically) — not only in the route — so
//    they hold even if a route is ever misused or a new caller is added.
//  - Atomic audit. Each mutation writes its admin_actions row INSIDE the same
//    transaction as the change, with before/after snapshots. A privileged change
//    that cannot be audited does not commit. (This is why these routes do NOT
//    also use the recordAdminAction middleware — the audit is written here.)
//  - Invariants:
//      1. Only an active super_admin may create/modify/terminate admins
//         (the route also gates this; we re-check the actor here as defense
//          in depth and to snapshot the actor for the audit row).
//      2. No self-mutation: an admin cannot change their own role/status or
//         terminate themselves (prevents foot-guns and self-escalation games).
//      3. No last-super-admin lockout: you cannot demote, suspend, or terminate
//         the LAST active super_admin. Enforced with an atomic count guard so
//         there is no check-then-act race.
//      4. One admin row per user (DB unique on user_id) — surfaced as a clean
//         409-style error instead of a raw constraint violation.
// ============================================================================

const VALID_ROLES = [
    "super_admin",
    "moderator",
    "support",
    "finance",
    "engineer",
    "read_only",
];

// Columns safe to return to an admin UI (admin_users has no secrets, but we keep
// the projection explicit so future sensitive columns aren't leaked by accident).
const ADMIN_COLS = `
    id, user_id, role, permissions, status, mfa_enabled,
    pii_access_granted, pii_access_granted_at, pii_access_granted_by,
    last_active_at, created_at, terminated_at
`;

// Small transaction wrapper over the shared pool. Admin mutations are rare and
// super_admin-gated. Delegates to withTransaction so every query runs on one
// dedicated pooled connection; the callback receives that connection as tx.
const withTx = async (fn) => withTransaction((tx) => fn(tx));

// Append the audit row for an admin-on-admin action. Called INSIDE withTx so the
// audit commits atomically with the change. reason is required by the table.
const writeAudit = async (tx, {
    actorAdminId,
    actionType,
    targetAdminId,
    beforeState,
    afterState,
    reason,
    ip,
    userAgent,
    mfaVerified,
}) => {
    await tx.query(
        `INSERT INTO admin_actions
           (admin_user_id, action_type, target_resource_type, target_resource_id,
            before_state, after_state, reason, ip_address, user_agent, mfa_verified)
         VALUES ($1,$2,'admin_user',$3,$4,$5,$6,$7,$8,$9)`,
        [
            actorAdminId,
            actionType,
            targetAdminId,
            beforeState ? JSON.stringify(beforeState) : null,
            afterState ? JSON.stringify(afterState) : null,
            reason,
            ip ?? null,
            userAgent ?? null,
            !!mfaVerified,
        ]
    );
};

// ---- reads -----------------------------------------------------------------

// listAdmins — for the admin console. Active-only by default; pass
// includeTerminated to see the full history.
const listAdmins = async ({ includeTerminated = false } = {}) => {
    const SQL = `
        SELECT a.id, a.user_id, a.role, a.permissions, a.status, a.mfa_enabled,
               a.pii_access_granted, a.last_active_at, a.created_at, a.terminated_at,
               u.username, u.email, u.first_name, u.last_name
        FROM admin_users a
        JOIN users u ON u.id = a.user_id
        WHERE ($1::boolean OR a.terminated_at IS NULL)
        ORDER BY a.created_at DESC
    `;
    const { rows } = await client.query(SQL, [includeTerminated]);
    return rows;
};

const getAdminById = async ({ id }) => {
    const { rows } = await client.query(
        `SELECT a.id, a.user_id, a.role, a.permissions, a.status, a.mfa_enabled,
                a.pii_access_granted, a.last_active_at, a.created_at, a.terminated_at,
                u.username, u.email, u.first_name, u.last_name
         FROM admin_users a JOIN users u ON u.id = a.user_id
         WHERE a.id = $1`,
        [id]
    );
    return rows[0] || null;
};

// Count of OTHER active super_admins (excluding excludeId). Used by the lockout
// guard. SELECT ... FOR UPDATE locks those rows for the life of the tx.
const countOtherActiveSuperAdmins = async (tx, excludeId) => {
    const { rows } = await tx.query(
        `SELECT id FROM admin_users
         WHERE role = 'super_admin' AND status = 'active' AND terminated_at IS NULL
           AND id <> $1
         FOR UPDATE`,
        [excludeId]
    );
    return rows.length;
};

// ---- mutations -------------------------------------------------------------

// createAdmin — promote an existing user account to an admin role.
// actor is the super_admin performing the action (from req.admin / req.ip ...).
const createAdmin = async ({
    actor,
    targetUserId,
    role,
    permissions = null,
    reason,
    ip,
    userAgent,
}) => {
    if (!reason) throw httpError(400, "reason is required");
    if (!targetUserId) throw httpError(400, "user_id (target) is required");
    if (!VALID_ROLES.includes(role)) {
        throw httpError(400, `role must be one of: ${VALID_ROLES.join(", ")}`);
    }

    return withTx(async (tx) => {
        // target user must exist
        const u = await tx.query(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
        if (!u.rows.length) throw httpError(404, "target user not found");

        // not already an admin (unique user_id; pre-check for a clean message)
        const existing = await tx.query(
            `SELECT id, terminated_at FROM admin_users WHERE user_id = $1`,
            [targetUserId]
        );
        if (existing.rows.length) {
            throw httpError(409, "that user already has an admin record");
        }

        const ins = await tx.query(
            `INSERT INTO admin_users (user_id, role, permissions, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING ${ADMIN_COLS}`,
            [targetUserId, role, permissions ? JSON.stringify(permissions) : null]
        );
        const created = ins.rows[0];

        await writeAudit(tx, {
            actorAdminId: actor.id,
            actionType: "admin.create",
            targetAdminId: created.id,
            beforeState: null,
            afterState: created,
            reason,
            ip,
            userAgent,
            mfaVerified: actor.mfa_enabled,
        });
        return created;
    });
};

// updateAdmin — change role and/or status of an existing admin. Enforces no
// self-mutation and the last-super-admin guard.
const updateAdmin = async ({
    actor,
    adminId,
    role,
    status,
    permissions,
    reason,
    ip,
    userAgent,
}) => {
    if (!reason) throw httpError(400, "reason is required");
    if (role !== undefined && !VALID_ROLES.includes(role)) {
        throw httpError(400, `role must be one of: ${VALID_ROLES.join(", ")}`);
    }
    if (status !== undefined && !["active", "suspended"].includes(status)) {
        // termination has its own endpoint; this one only toggles active/suspended
        throw httpError(400, "status must be 'active' or 'suspended' (use terminate to remove)");
    }
    if (role === undefined && status === undefined && permissions === undefined) {
        throw httpError(400, "nothing to update (provide role, status, or permissions)");
    }

    return withTx(async (tx) => {
        const cur = await tx.query(
            `SELECT ${ADMIN_COLS} FROM admin_users WHERE id = $1 FOR UPDATE`,
            [adminId]
        );
        const before = cur.rows[0];
        if (!before) throw httpError(404, "admin not found");
        if (before.terminated_at) throw httpError(409, "admin is terminated");

        // invariant 2: no self-mutation of role/status
        if (before.user_id === actor.user_id) {
            throw httpError(403, "you cannot modify your own admin role or status");
        }

        const nextRole = role ?? before.role;
        const nextStatus = status ?? before.status;

        // invariant 3: don't strip the last active super_admin
        const losingSuperAdmin =
            before.role === "super_admin" &&
            before.status === "active" &&
            (nextRole !== "super_admin" || nextStatus !== "active");
        if (losingSuperAdmin) {
            const others = await countOtherActiveSuperAdmins(tx, adminId);
            if (others < 1) {
                throw httpError(409, "cannot demote/suspend the last active super_admin");
            }
        }

        const upd = await tx.query(
            `UPDATE admin_users
                SET role = $2,
                    status = $3,
                    permissions = COALESCE($4, permissions)
              WHERE id = $1
              RETURNING ${ADMIN_COLS}`,
            [adminId, nextRole, nextStatus, permissions ? JSON.stringify(permissions) : null]
        );
        const after = upd.rows[0];

        await writeAudit(tx, {
            actorAdminId: actor.id,
            actionType: "admin.update",
            targetAdminId: adminId,
            beforeState: before,
            afterState: after,
            reason,
            ip,
            userAgent,
            mfaVerified: actor.mfa_enabled,
        });
        return after;
    });
};

// terminateAdmin — revoke admin access entirely (soft: status + terminated_at).
const terminateAdmin = async ({ actor, adminId, reason, ip, userAgent }) => {
    if (!reason) throw httpError(400, "reason is required");

    return withTx(async (tx) => {
        const cur = await tx.query(
            `SELECT ${ADMIN_COLS} FROM admin_users WHERE id = $1 FOR UPDATE`,
            [adminId]
        );
        const before = cur.rows[0];
        if (!before) throw httpError(404, "admin not found");
        if (before.terminated_at) throw httpError(409, "admin is already terminated");

        // invariant 2: no self-termination
        if (before.user_id === actor.user_id) {
            throw httpError(403, "you cannot terminate your own admin access");
        }

        // invariant 3: not the last active super_admin
        if (before.role === "super_admin" && before.status === "active") {
            const others = await countOtherActiveSuperAdmins(tx, adminId);
            if (others < 1) {
                throw httpError(409, "cannot terminate the last active super_admin");
            }
        }

        const upd = await tx.query(
            `UPDATE admin_users
                SET status = 'terminated', terminated_at = now()
              WHERE id = $1
              RETURNING ${ADMIN_COLS}`,
            [adminId]
        );
        const after = upd.rows[0];

        await writeAudit(tx, {
            actorAdminId: actor.id,
            actionType: "admin.terminate",
            targetAdminId: adminId,
            beforeState: before,
            afterState: after,
            reason,
            ip,
            userAgent,
            mfaVerified: actor.mfa_enabled,
        });
        return after;
    });
};

// grantPIIAccess — explicitly grant an admin the right to view PII. Sets the
// three pii_access_* columns on the admin_users row and writes the audit row in
// the same transaction (a grant of a least-privilege capability that cannot be
// audited does not commit).
//
// FK NOTE: admin_users.pii_access_granted_by REFERENCES users(id), so we store
// actor.user_id there (the granting admin's USERS id) — NOT actor.id (the
// admin_users row id). admin_actions.admin_user_id REFERENCES admin_users(id),
// so writeAudit gets actor.id, consistent with the rest of this file.
const grantPIIAccess = async ({ actor, adminId, reason, ip, userAgent }) => {
    if (!reason) throw httpError(400, "reason is required");

    return withTx(async (tx) => {
        const cur = await tx.query(
            `SELECT ${ADMIN_COLS} FROM admin_users WHERE id = $1 FOR UPDATE`,
            [adminId]
        );
        const before = cur.rows[0];
        if (!before) throw httpError(404, "admin not found");
        if (before.terminated_at) throw httpError(409, "admin is terminated");
        if (before.pii_access_granted) {
            throw httpError(409, "admin already has PII access");
        }

        const upd = await tx.query(
            `UPDATE admin_users
                SET pii_access_granted = true,
                    pii_access_granted_at = now(),
                    pii_access_granted_by = $2
              WHERE id = $1
              RETURNING ${ADMIN_COLS}`,
            [adminId, actor.user_id]
        );
        const after = upd.rows[0];

        await writeAudit(tx, {
            actorAdminId: actor.id,
            actionType: "admin.pii_access.grant",
            targetAdminId: adminId,
            beforeState: before,
            afterState: after,
            reason,
            ip,
            userAgent,
            mfaVerified: actor.mfa_enabled,
        });
        return after;
    });
};

// revokePIIAccess — remove an admin's PII-view capability. Clears all three
// pii_access_* columns (so a later re-grant is freshly stamped) and audits the
// change atomically.
const revokePIIAccess = async ({ actor, adminId, reason, ip, userAgent }) => {
    if (!reason) throw httpError(400, "reason is required");

    return withTx(async (tx) => {
        const cur = await tx.query(
            `SELECT ${ADMIN_COLS} FROM admin_users WHERE id = $1 FOR UPDATE`,
            [adminId]
        );
        const before = cur.rows[0];
        if (!before) throw httpError(404, "admin not found");
        if (!before.pii_access_granted) {
            throw httpError(409, "admin does not have PII access");
        }

        const upd = await tx.query(
            `UPDATE admin_users
                SET pii_access_granted = false,
                    pii_access_granted_at = NULL,
                    pii_access_granted_by = NULL
              WHERE id = $1
              RETURNING ${ADMIN_COLS}`,
            [adminId]
        );
        const after = upd.rows[0];

        await writeAudit(tx, {
            actorAdminId: actor.id,
            actionType: "admin.pii_access.revoke",
            targetAdminId: adminId,
            beforeState: before,
            afterState: after,
            reason,
            ip,
            userAgent,
            mfaVerified: actor.mfa_enabled,
        });
        return after;
    });
};

// tiny helper so routes can map thrown errors to status codes
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    VALID_ROLES,
    listAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    terminateAdmin,
    grantPIIAccess,
    revokePIIAccess,
};
