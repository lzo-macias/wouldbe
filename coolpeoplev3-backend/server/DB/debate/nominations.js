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
// nominee (the popularity tally), joined to the nominee's public identity — and
// to their own campaign, if they have one — so a caller can render the face, the
// name and a link to the campaign without a second round of lookups. The
// join is to users only — nominator identities are deliberately NOT exposed
// here; who nominated whom stays private, only the tally is public.
const getDebateNominationCounts = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                n.nominee_user_id,
                COUNT(DISTINCT n.nominator_user_id)::int AS nomination_count,
                u.first_name,
                u.last_name,
                u.username,
                u.profile_photo_url,
                -- The one public URL a user sets for their socials (instagram,
                -- a linktree, a campaign site). Null for most people. It is
                -- validated to http/https on the WRITE path (normalizeLink in
                -- DB/platform/users.js) precisely because it gets rendered as an
                -- href — do NOT re-derive that check per reader, but do keep
                -- rel="noopener noreferrer" on the anchor.
                u.link,
                w.id AS wouldbe_id
            FROM nominations AS n
            JOIN users AS u ON u.id = n.nominee_user_id
            -- The nominee's own campaign, if they have one, so a nomination card
            -- can link straight to it. LATERAL + LIMIT 1 rather than a plain
            -- LEFT JOIN: a user may hold several campaigns and a second
            -- one-to-many join would duplicate the nomination rows and inflate
            -- the tally this query exists to compute.
            --
            -- PUBLIC RULE, deliberately narrower than "their newest": only a
            -- launched, non-retired campaign. An unpaid draft or one still in the
            -- review queue is not something the owner has published, and this
            -- payload is readable by anyone looking at the debate. wouldbe_id is
            -- null when they have none — the card should treat it as optional.
            LEFT JOIN LATERAL (
                SELECT w2.id, w2.created_at
                FROM wouldbe AS w2
                WHERE w2.user_id = n.nominee_user_id
                  AND w2.retired IS NOT TRUE
                  AND w2.launch_status = 'active'
                ORDER BY w2.created_at DESC
                LIMIT 1
            ) AS w ON TRUE
            WHERE n.debate_id = $1
            GROUP BY n.nominee_user_id, u.id, w.id
            ORDER BY nomination_count DESC, u.username ASC;
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
