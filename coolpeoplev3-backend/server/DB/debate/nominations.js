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
                w.id AS wouldbe_id,
                -- EVERY active campaign, not just the newest: a nominee can hold
                -- more than one and the board is asked to show "any active
                -- wouldbes". wouldbe_id above is kept for callers that still
                -- read a single id.
                COALESCE(wl.wouldbes, '[]'::jsonb) AS wouldbes,
                -- The 1-5s this person has been given across every criterion, in
                -- this debate. This is a SUM OF SCORES, not a count of ballots:
                -- it is what "aligning with criteria" means — five criteria
                -- scored 4 each is 20, and someone scored on more matches has
                -- more of them. Both ballot kinds count: the bracket ballots
                -- (debate_match_vote_scores) and the final-round one
                -- (debate_vote_scores). Invalidated ballots are excluded by the
                -- subqueries, which is why this is not one join.
                COALESCE(pts.vote_points, 0)::int AS vote_points,
                COALESCE(pts.scored_ballots, 0)::int AS scored_ballots
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
            -- The same rule, aggregated: ONE row out (a json array), so this
            -- cannot duplicate nomination rows either. Titles come down with it,
            -- which is what saves the board a request per campaign.
            LEFT JOIN LATERAL (
                -- jsonb, not json: this column lands in a GROUP BY (the query
                -- aggregates nominators per nominee) and the json type has no
                -- equality operator, so grouping on it is a hard parse error.
                SELECT jsonb_agg(
                           jsonb_build_object('id', w3.id, 'title', w3.title)
                           ORDER BY w3.created_at DESC
                       ) AS wouldbes
                FROM wouldbe AS w3
                WHERE w3.user_id = n.nominee_user_id
                  AND w3.retired IS NOT TRUE
                  AND w3.launch_status = 'active'
            ) AS wl ON TRUE
            -- Their score total in THIS debate, via their contestant row. A
            -- nominee who never entered has none, and COALESCE reads that as 0
            -- rather than dropping the row.
            LEFT JOIN LATERAL (
                SELECT
                    (
                        SELECT COALESCE(SUM(ms.score), 0)
                        FROM debate_match_vote_scores ms
                        JOIN debate_match_votes mv
                          ON mv.vote_id = ms.vote_id AND mv.invalidated_at IS NULL
                        WHERE ms.contestant_id = c.id
                    ) + (
                        SELECT COALESCE(SUM(vs.score), 0)
                        FROM debate_vote_scores vs
                        JOIN debate_votes dv
                          ON dv.vote_id = vs.vote_id AND dv.invalidated_at IS NULL
                        WHERE vs.contestant_id = c.id
                    ) AS vote_points,
                    (
                        SELECT COUNT(DISTINCT mv.vote_id)
                        FROM debate_match_votes mv
                        WHERE mv.contestant_id = c.id AND mv.invalidated_at IS NULL
                    ) AS scored_ballots
                FROM contestants c
                WHERE c.debate_id = n.debate_id
                  AND c.user_id = n.nominee_user_id
                LIMIT 1
            ) AS pts ON TRUE
            WHERE n.debate_id = $1
            GROUP BY n.nominee_user_id, u.id, w.id, wl.wouldbes,
                     pts.vote_points, pts.scored_ballots
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
