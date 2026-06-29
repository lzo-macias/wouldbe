const { client, withTransaction } = require("../index.js");

// ============================================================================
// account_actions — append-only audit log of every moderation/admin action taken
// AGAINST a user account (suspend, ban, restrict a feature, force a logout …).
//
// WHY this shape:
//  - This is the table you reach for when defending a "you wrongfully banned me"
//    complaint. It is append-only: an action is never deleted or edited. A
//    "reversal" is recorded by STAMPING reversed_at/reversed_by/reversal_reason
//    onto the original row (it stays in effect-history), not by removing it.
//  - performed_by_user_id references users(id) (NOT admin_users), so callers pass
//    the acting admin's USER id. performed_by_system flips true for automated
//    actions (then performed_by_user_id is null).
// ============================================================================

// Action kinds the table CHECK allows.
const ACTION_TYPES = [
    "suspend", "unsuspend", "ban", "unban", "restrict_feature",
    "restore_feature", "force_password_reset", "force_logout",
];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createAccountAction(...) — write one action row against a user.
// actor_admin_id is the acting admin's USER id (req.admin.user_id), mapped to the
// performed_by_user_id column; pass null + performed_by_system:true for automated
// actions. duration_hours/effective_until are for temporary actions.
const createAccountAction = async ({
    user_id,
    action_type,
    reason_category,
    reason_details = null,
    actor_admin_id = null,
    performed_by_system = false,
    duration_hours = null,
    effective_until = null,
} = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!ACTION_TYPES.includes(action_type)) {
        throw httpError(400, `action_type must be one of: ${ACTION_TYPES.join(", ")}`);
    }
    if (!reason_category || !String(reason_category).trim()) {
        throw httpError(400, "reason_category is required");
    }
    if (!actor_admin_id && !performed_by_system) {
        throw httpError(400, "an actor (actor_admin_id) or performed_by_system is required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO account_actions
               (target_user_id, action_type, reason_category, reason_details,
                performed_by_user_id, performed_by_system, duration_hours, effective_until)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [user_id, action_type, reason_category, reason_details,
             actor_admin_id, performed_by_system, duration_hours, effective_until]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "target_user_id or actor does not exist");
        if (err.code === "23514") throw httpError(400, "value violates a constraint on account_actions");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getAccountActionsForUser(...) — the action history for one user, newest first.
const getAccountActionsForUser = async ({ user_id } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT aa.*,
                    actor.username AS performed_by_username
             FROM account_actions aa
             LEFT JOIN users actor ON actor.id = aa.performed_by_user_id
             WHERE aa.target_user_id = $1
             ORDER BY aa.created_at DESC`,
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

// reverseAccountAction(...) — record that an action was reversed. Append-only:
// the original row stays, we stamp reversed_at/reversed_by/reversal_reason once.
// Runs in a transaction so the "not already reversed" check and the write are
// atomic (no double-reversal race). reversed_by_user_id is the acting admin's
// USER id (req.admin.user_id).
const reverseAccountAction = async ({ id, reversed_by_user_id = null, reversal_reason = null } = {}) => {
    if (!id) throw httpError(400, "id is required");
    return withTransaction(async (tx) => {
        try {
            const cur = await tx.query(
                `SELECT id, reversed_at FROM account_actions WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "no account action with that id");
            if (row.reversed_at) throw httpError(409, "account action is already reversed");

            const upd = await tx.query(
                `UPDATE account_actions
                    SET reversed_at         = now(),
                        reversed_by_user_id = $2,
                        reversal_reason     = $3
                  WHERE id = $1
                  RETURNING *`,
                [id, reversed_by_user_id, reversal_reason]
            );
            return upd.rows[0];
        } catch (err) {
            if (err.code === "23503") throw httpError(400, "reversed_by_user_id does not exist");
            if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
            if (err.status) throw err;
            console.error(err);
            throw err;
        }
    });
};

module.exports = {
    ACTION_TYPES,
    createAccountAction,
    getAccountActionsForUser,
    reverseAccountAction,
};
