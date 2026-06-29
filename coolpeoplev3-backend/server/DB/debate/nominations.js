const { client } = require("../index.js")

// ============================================================================
// nominations — user A nominates user B for a debate; B can enter free. Also a
// popularity signal, but NOT used in the final-winner math. One row per
// (debate, nominator, nominee); nominator != nominee. nominator_user_id always
// comes from the caller's token, never the body.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// createNomination — record that nominator nominates nominee for a debate.
const createNomination = async ({ debate_id, nominator_user_id, nominee_user_id }, db = client) => {
    if (!nominator_user_id) throw httpError(401, "authentication required")
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!nominee_user_id) throw httpError(400, "nominee_user_id is required")
    if (nominator_user_id === nominee_user_id) {
        throw httpError(400, "you cannot nominate yourself")
    }
    try {
        const SQL = `
            INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
            VALUES ($1, $2, $3)
            RETURNING *;
        `
        const result = await db.query(SQL, [debate_id, nominator_user_id, nominee_user_id])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "you have already nominated this user for this debate")
        if (err.code === "23503") throw httpError(400, "debate_id or nominee_user_id does not exist")
        if (err.code === "23514") throw httpError(400, "you cannot nominate yourself")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// deleteNomination — retract a nomination. Scoped to the nominator so a caller
// can only undo their own. Returns the deleted row (or undefined if none).
const deleteNomination = async ({ debate_id, nominator_user_id, nominee_user_id }, db = client) => {
    if (!nominator_user_id) throw httpError(401, "authentication required")
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!nominee_user_id) throw httpError(400, "nominee_user_id is required")
    try {
        const SQL = `
            DELETE FROM nominations
            WHERE debate_id = $1 AND nominator_user_id = $2 AND nominee_user_id = $3
            RETURNING *;
        `
        const result = await db.query(SQL, [debate_id, nominator_user_id, nominee_user_id])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getDebateNominationCounts — for a debate, the count of distinct nominators per
// nominee (the popularity tally).
const getDebateNominationCounts = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                nominee_user_id,
                COUNT(DISTINCT nominator_user_id)::int AS nomination_count
            FROM nominations
            WHERE debate_id = $1
            GROUP BY nominee_user_id
            ORDER BY nomination_count DESC;
        `
        const result = await client.query(SQL, [debate_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getNominationsReceived — every nomination a user has been the nominee of,
// newest first.
const getNominationsReceived = async ({ nominee_user_id }) => {
    if (!nominee_user_id) throw httpError(400, "nominee_user_id is required")
    try {
        const SQL = `
            SELECT *
            FROM nominations
            WHERE nominee_user_id = $1
            ORDER BY created_at DESC;
        `
        const result = await client.query(SQL, [nominee_user_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// hasUserBeenNominatedForDebate — boolean gate: has anyone nominated this user
// for this debate (drives the free-entry path).
const hasUserBeenNominatedForDebate = async ({ debate_id, nominee_user_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!nominee_user_id) throw httpError(400, "nominee_user_id is required")
    try {
        const SQL = `
            SELECT 1 FROM nominations
            WHERE debate_id = $1 AND nominee_user_id = $2
            LIMIT 1;
        `
        const result = await client.query(SQL, [debate_id, nominee_user_id])
        return result.rows.length > 0
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

module.exports = {
    createNomination,
    deleteNomination,
    getDebateNominationCounts,
    getNominationsReceived,
    hasUserBeenNominatedForDebate,
}
