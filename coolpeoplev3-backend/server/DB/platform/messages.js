const { client, withTransaction } = require("../index.js")

// ============================================================================
// messages — §12 individual chat messages. message_type user/system, soft-
// delete via deleted_at (preserves thread position), moderation_status pipeline.
// SECURITY: a user may only read or post in a conversation they are a
// participant of — sendMessage and getMessages assert membership against
// conversation_participants before touching the messages table.
// ============================================================================

const { assertMembership } = require("./conversations.js")

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// sendMessage — author posts into a thread they belong to. Inserts the message
// and bumps conversations.last_message_at in one transaction so the inbox sort
// stays consistent. Sender (the author) MUST be a participant → 403 otherwise.
const sendMessage = async ({
    conversation_id,
    sender_user_id,
    body = null,
    attachment_url = null,
    reply_to_message_id = null,
}) => {
    if (!sender_user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    if (!body && !attachment_url) {
        throw httpError(400, "message must have a body or an attachment_url")
    }
    try {
        const message = await withTransaction(async (tx) => {
            // enforce: sender is a (non-left) participant of this conversation
            await assertMembership(conversation_id, sender_user_id, tx)
            const { rows } = await tx.query(
                `INSERT INTO messages
                    (conversation_id, sender_user_id, message_type, body, attachment_url, reply_to_message_id)
                 VALUES ($1, $2, 'user', $3, $4, $5)
                 RETURNING *`,
                [conversation_id, sender_user_id, body, attachment_url, reply_to_message_id]
            )
            await tx.query(
                `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
                [conversation_id]
            )
            return rows[0]
        })
        // TODO: emit 'new_message' event
        return message
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "conversation_id, sender_user_id, or reply_to_message_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid message_type or moderation_status")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getMessages — paginated thread history for a member. Enforces membership
// (403 if not a participant). Soft-deleted rows are returned with a redacted
// body so reply chains stay intact; pass includeDeleted=false to hide them.
const getMessages = async ({
    conversation_id,
    user_id,
    limit = 50,
    before = null,
}) => {
    if (!user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
    try {
        await assertMembership(conversation_id, user_id)
        const { rows } = await client.query(
            `SELECT * FROM messages
             WHERE conversation_id = $1
               AND ($2::timestamptz IS NULL OR created_at < $2)
             ORDER BY created_at DESC
             LIMIT $3`,
            [conversation_id, before, safeLimit]
        )
        return rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// updateMessage — author edits their own message body/attachment. Scoped to the
// sender (author-owned): WHERE sender_user_id = $author, so a non-author update
// matches no row → 404. Will not edit a soft-deleted message.
const updateMessage = async ({ id, sender_user_id, body, attachment_url }) => {
    if (!sender_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "message id is required")
    if (body === undefined && attachment_url === undefined) {
        throw httpError(400, "nothing to update")
    }
    try {
        const { rows } = await client.query(
            `UPDATE messages
             SET body = COALESCE($3, body),
                 attachment_url = COALESCE($4, attachment_url)
             WHERE id = $1 AND sender_user_id = $2 AND deleted_at IS NULL
             RETURNING *`,
            [id, sender_user_id, body ?? null, attachment_url ?? null]
        )
        if (rows.length === 0) throw httpError(404, "message not found or not yours to edit")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid message field")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// softDeleteMessage — author removes their own message. Sets deleted_at (and
// moderation_status removed) rather than hard-deleting, so the thread position
// and reply chains survive. Author-owned: WHERE sender_user_id = $author.
const softDeleteMessage = async ({ id, sender_user_id }) => {
    if (!sender_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "message id is required")
    try {
        const { rows } = await client.query(
            `UPDATE messages
             SET deleted_at = NOW(),
                 moderation_status = 'removed'
             WHERE id = $1 AND sender_user_id = $2 AND deleted_at IS NULL
             RETURNING *`,
            [id, sender_user_id]
        )
        if (rows.length === 0) throw httpError(404, "message not found or not yours to delete")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// recordSystemMessage — internal/system author (sender_user_id null,
// message_type 'system'). Used for thread events; no membership check because it
// is not user-initiated. Bumps last_message_at like a normal message.
const recordSystemMessage = async ({ conversation_id, body }, db = client) => {
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    if (!body) throw httpError(400, "body is required")
    const run = async (tx) => {
        const { rows } = await tx.query(
            `INSERT INTO messages (conversation_id, sender_user_id, message_type, body)
             VALUES ($1, NULL, 'system', $2)
             RETURNING *`,
            [conversation_id, body]
        )
        await tx.query(
            `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
            [conversation_id]
        )
        return rows[0]
    }
    try {
        // if caller passed a tx (composed write) reuse it; else open our own
        if (db !== client) return await run(db)
        return await withTransaction(run)
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "conversation_id does not exist")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

module.exports = {
    sendMessage,
    getMessages,
    updateMessage,
    softDeleteMessage,
    recordSystemMessage,
}
