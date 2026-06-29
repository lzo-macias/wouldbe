const { client } = require("../index.js")

// ============================================================================
// comments — free-text replies on a post, threaded one level deep via
// parent_comment_id. Same moderation pipeline as posts (moderation_status).
// Soft-deleted via removed_at (never hard-deleted, to preserve reply chains).
// author_user_id is supplied by the route from the token, never the body.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// createComment — post a comment (or a one-level reply via parent_comment_id).
const createComment = async ({ post_id, author_user_id, parent_comment_id = null, body }, db = client) => {
    if (!author_user_id) throw httpError(401, "authentication required")
    if (!post_id) throw httpError(400, "post_id is required")
    if (!body || !body.trim()) throw httpError(400, "body is required")
    try {
        const SQL = `
            INSERT INTO comments (post_id, author_user_id, parent_comment_id, body)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `
        const result = await db.query(SQL, [post_id, author_user_id, parent_comment_id, body])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "post_id, author_user_id, or parent_comment_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid comment")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getCommentsForPost — all non-removed comments on a post, oldest first. Flat
// list carrying parent_comment_id so callers can thread one level client-side.
const getCommentsForPost = async ({ post_id }) => {
    if (!post_id) throw httpError(400, "post_id is required")
    try {
        const SQL = `
            SELECT *
            FROM comments
            WHERE post_id = $1
              AND removed_at IS NULL
            ORDER BY created_at ASC;
        `
        const result = await client.query(SQL, [post_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// updateComment — edit a comment's body. Author-owned: scoped to author_user_id
// so a caller can only edit their own. COALESCE keeps the existing body when no
// new body is supplied. Won't touch removed comments.
const updateComment = async ({ id, author_user_id, body = null }, db = client) => {
    if (!author_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "id is required")
    try {
        const SQL = `
            UPDATE comments
            SET body = COALESCE($1, body)
            WHERE id = $2
              AND author_user_id = $3
              AND removed_at IS NULL
            RETURNING *;
        `
        const result = await db.query(SQL, [body, id, author_user_id])
        if (result.rows.length === 0) throw httpError(404, "comment not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid comment")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// softDeleteComment — stamp removed_at (and optional removed_reason). Never hard
// deletes. Author-owned by default; pass an admin path separately if needed.
const softDeleteComment = async ({ id, author_user_id, removed_reason = null }, db = client) => {
    if (!author_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "id is required")
    try {
        const SQL = `
            UPDATE comments
            SET removed_at = NOW(),
                removed_reason = $1,
                moderation_status = 'removed'
            WHERE id = $2
              AND author_user_id = $3
              AND removed_at IS NULL
            RETURNING *;
        `
        const result = await db.query(SQL, [removed_reason, id, author_user_id])
        if (result.rows.length === 0) throw httpError(404, "comment not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid comment")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

module.exports = {
    createComment,
    getCommentsForPost,
    updateComment,
    softDeleteComment,
}
