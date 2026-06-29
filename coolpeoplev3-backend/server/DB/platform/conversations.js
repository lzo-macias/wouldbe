const { client, withTransaction } = require("../index.js")

// ============================================================================
// conversations + conversation_participants — §12 messaging threads.
// A conversation is the thread (type: direct/group/system); participants are
// its membership rows (role member/admin, last_read_at for unread badges,
// left_at for soft-leave). SECURITY: a user may only read a conversation they
// are a participant of — every reader path runs through assertMembership().
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const CONVERSATION_TYPES = ["direct", "group", "system"]

// assertMembership — throws 403 unless user_id is a (non-left) participant of
// conversation_id. Composable: pass a tx to run inside a transaction.
const assertMembership = async (conversation_id, user_id, db = client) => {
    const { rows } = await db.query(
        `SELECT 1 FROM conversation_participants
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
         LIMIT 1`,
        [conversation_id, user_id]
    )
    if (rows.length === 0) {
        throw httpError(403, "you are not a participant of this conversation")
    }
}

// createConversation — insert the thread plus a participant row for the creator
// (as admin) and one for every other invited user. Runs in a transaction so a
// thread is never left without its membership rows.
const createConversation = async ({
    creator_user_id,
    participant_user_ids = [],
    type = "direct",
    title = null,
}) => {
    if (!creator_user_id) throw httpError(401, "authentication required")
    if (!CONVERSATION_TYPES.includes(type)) {
        throw httpError(400, `type must be one of: ${CONVERSATION_TYPES.join(", ")}`)
    }
    if (!Array.isArray(participant_user_ids)) {
        throw httpError(400, "participant_user_ids must be an array")
    }

    // de-dupe and always include the creator; creator is the admin
    const others = participant_user_ids.filter((id) => id && id !== creator_user_id)
    const memberIds = [...new Set(others)]

    try {
        return await withTransaction(async (tx) => {
            const convoRes = await tx.query(
                `INSERT INTO conversations (type, title, created_by_user_id)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [type, title, creator_user_id]
            )
            const conversation = convoRes.rows[0]

            // creator joins as admin
            await tx.query(
                `INSERT INTO conversation_participants (conversation_id, user_id, role)
                 VALUES ($1, $2, 'admin')`,
                [conversation.id, creator_user_id]
            )

            // invited members
            for (const uid of memberIds) {
                await tx.query(
                    `INSERT INTO conversation_participants (conversation_id, user_id, role)
                     VALUES ($1, $2, 'member')`,
                    [conversation.id, uid]
                )
            }

            const partsRes = await tx.query(
                `SELECT * FROM conversation_participants
                 WHERE conversation_id = $1
                 ORDER BY joined_at ASC`,
                [conversation.id]
            )
            return { ...conversation, participants: partsRes.rows }
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "duplicate participant in conversation")
        if (err.code === "23503") throw httpError(400, "creator_user_id or a participant_user_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid conversation type or participant role")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// listConversationsForUser — the caller's active (non-left) threads, newest
// activity first. last_message_at drives inbox sort; created_at is the fallback.
const listConversationsForUser = async ({ user_id }) => {
    if (!user_id) throw httpError(401, "authentication required")
    try {
        const { rows } = await client.query(
            `SELECT c.*, cp.role, cp.last_read_at, cp.joined_at
             FROM conversations c
             JOIN conversation_participants cp ON cp.conversation_id = c.id
             WHERE cp.user_id = $1 AND cp.left_at IS NULL
             ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
            [user_id]
        )
        return rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getConversationById — full thread + participant list. Enforces membership
// (403 if the caller is not a participant), 404 if the thread does not exist.
const getConversationById = async ({ conversation_id, user_id }) => {
    if (!user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    try {
        await assertMembership(conversation_id, user_id)
        const convoRes = await client.query(
            `SELECT * FROM conversations WHERE id = $1`,
            [conversation_id]
        )
        if (convoRes.rows.length === 0) throw httpError(404, "conversation not found")
        const partsRes = await client.query(
            `SELECT * FROM conversation_participants
             WHERE conversation_id = $1
             ORDER BY joined_at ASC`,
            [conversation_id]
        )
        return { ...convoRes.rows[0], participants: partsRes.rows }
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// addParticipant — the actor must be a participant to add others. Re-adding a
// user who previously left clears left_at instead of erroring on the unique key.
const addParticipant = async ({ conversation_id, actor_user_id, user_id }) => {
    if (!actor_user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    if (!user_id) throw httpError(400, "user_id is required")
    try {
        return await withTransaction(async (tx) => {
            await assertMembership(conversation_id, actor_user_id, tx)
            // Added users are always 'member' — role is NOT client-settable here,
            // so a non-admin can't add someone (or themselves) as 'admin'
            // (privilege escalation). Promotion belongs in a dedicated admin path.
            const { rows } = await tx.query(
                `INSERT INTO conversation_participants (conversation_id, user_id, role)
                 VALUES ($1, $2, 'member')
                 ON CONFLICT (conversation_id, user_id) DO UPDATE SET
                    left_at = NULL,
                    role = 'member',
                    joined_at = NOW()
                 RETURNING *`,
                [conversation_id, user_id]
            )
            return rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "conversation_id or user_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid participant role")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// removeParticipant — soft-removal of another member. Actor must be a member of
// the thread; sets left_at so the thread keeps rendering for everyone else.
const removeParticipant = async ({ conversation_id, actor_user_id, user_id }) => {
    if (!actor_user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    if (!user_id) throw httpError(400, "user_id is required")
    try {
        return await withTransaction(async (tx) => {
            await assertMembership(conversation_id, actor_user_id, tx)
            const { rows } = await tx.query(
                `UPDATE conversation_participants
                 SET left_at = NOW()
                 WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
                 RETURNING *`,
                [conversation_id, user_id]
            )
            if (rows.length === 0) throw httpError(404, "participant not found in conversation")
            return rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// markConversationRead — stamp the caller's last_read_at to now (clears unread
// badge). Enforces membership.
const markConversationRead = async ({ conversation_id, user_id }) => {
    if (!user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    try {
        const { rows } = await client.query(
            `UPDATE conversation_participants
             SET last_read_at = NOW()
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
             RETURNING *`,
            [conversation_id, user_id]
        )
        if (rows.length === 0) throw httpError(403, "you are not a participant of this conversation")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// leaveConversation — the caller soft-leaves their own thread membership.
const leaveConversation = async ({ conversation_id, user_id }) => {
    if (!user_id) throw httpError(401, "authentication required")
    if (!conversation_id) throw httpError(400, "conversation_id is required")
    try {
        const { rows } = await client.query(
            `UPDATE conversation_participants
             SET left_at = NOW()
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
             RETURNING *`,
            [conversation_id, user_id]
        )
        if (rows.length === 0) throw httpError(403, "you are not a participant of this conversation")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

module.exports = {
    CONVERSATION_TYPES,
    assertMembership,
    createConversation,
    listConversationsForUser,
    getConversationById,
    addParticipant,
    removeParticipant,
    markConversationRead,
    leaveConversation,
}
