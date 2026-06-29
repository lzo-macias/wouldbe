const { client } = require("../index.js");

// ============================================================================
// user_blocks — USER-to-USER blocks (NOT admin/moderation actions). Used to
// filter feeds, hide comments, suppress mentions/messages between two users.
//
// SECURITY: blocker_user_id is always the authenticated caller (set by the
// route from req.user.id) — NEVER taken from the request body. These writers
// take it as an argument; the route is responsible for sourcing it safely.
//
// NOTE: this file is DB-only by design. The routes for user blocks
// (userBlocksRoutes) are owned elsewhere — do not add an Express router here.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// blockUser(...) — create a block. The table's UNIQUE(blocker, blocked) makes a
// duplicate block a 23505 → surfaced as 409. The CHECK (blocker != blocked)
// makes a self-block a 23514 → 400.
const blockUser = async ({ blocker_user_id, blocked_user_id } = {}) => {
    if (!blocker_user_id) throw httpError(400, "blocker_user_id is required");
    if (!blocked_user_id) throw httpError(400, "blocked_user_id is required");
    if (blocker_user_id === blocked_user_id) {
        throw httpError(400, "you cannot block yourself");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
             VALUES ($1, $2)
             RETURNING *`,
            [blocker_user_id, blocked_user_id]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "you have already blocked this user");
        if (err.code === "23503") throw httpError(400, "that user does not exist");
        if (err.code === "23514") throw httpError(400, "you cannot block yourself");
        if (err.code === "22P02") throw httpError(400, "user id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// unblockUser(...) — remove a block. Idempotent-ish: 404 if no such block so the
// caller knows nothing changed.
const unblockUser = async ({ blocker_user_id, blocked_user_id } = {}) => {
    if (!blocker_user_id) throw httpError(400, "blocker_user_id is required");
    if (!blocked_user_id) throw httpError(400, "blocked_user_id is required");
    try {
        const { rows } = await client.query(
            `DELETE FROM user_blocks
              WHERE blocker_user_id = $1 AND blocked_user_id = $2
             RETURNING *`,
            [blocker_user_id, blocked_user_id]
        );
        if (!rows.length) throw httpError(404, "no such block to remove");
        return rows[0];
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "user id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getMyBlocks(...) — the caller's outgoing blocks, newest first, with the blocked
// user's username for display.
const getMyBlocks = async ({ blocker_user_id } = {}) => {
    if (!blocker_user_id) throw httpError(400, "blocker_user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT ub.*, blocked.username AS blocked_username
             FROM user_blocks ub
             LEFT JOIN users blocked ON blocked.id = ub.blocked_user_id
             WHERE ub.blocker_user_id = $1
             ORDER BY ub.created_at DESC`,
            [blocker_user_id]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "blocker_user_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// isBlockedBy(...) — is user_id blocked BY possible_blocker_user_id? Boolean gate
// for feed/comment/mention filtering. Honors expires_at (an expired block does
// not count).
const isBlockedBy = async ({ user_id, possible_blocker_user_id } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!possible_blocker_user_id) throw httpError(400, "possible_blocker_user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT 1
             FROM user_blocks
             WHERE blocker_user_id = $1
               AND blocked_user_id = $2
               AND (expires_at IS NULL OR expires_at > now())
             LIMIT 1`,
            [possible_blocker_user_id, user_id]
        );
        return rows.length > 0;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "user id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    blockUser,
    unblockUser,
    getMyBlocks,
    isBlockedBy,
};
