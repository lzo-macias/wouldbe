const { client, withTransaction } = require("../index.js")

// ============================================================================
// post_endorsements — the 3-second-hold "I endorse this" interaction; the
// strongest signal for the general-vote winner multiplier. endorsement_type is
// 'general' (endorse a user), 'debates' or 'wouldbe' (endorse a post). Partial
// UNIQUE indexes enforce one endorsement per (post, endorser) for debate/wouldbe
// and one per (endorser, endorsed_user) for general. hold_seconds >= 3 (DB CHECK)
// is the "actually watched" gate.
// NOTE: ownership (endorser == caller) is enforced at the ROUTE by passing
// endorser_user_id = req.user.id — never trust a body-supplied endorser.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const ENDORSEMENT_TYPES = ["general", "debates", "wouldbe"]

const createEndorsement = async ({
    post_id,
    endorser_user_id,
    prompt_id,
    debate_id,
    endorsement_type,
    endorsed_user_id,
    contestant_id,
    hold_seconds,
    video_seconds_watched,
    endorsement_text,
    criterion_id,
    criterion_rating,
    experiment_variant,
}) => {
    if (!endorser_user_id) throw httpError(401, "must be signed in to endorse")
    if (!ENDORSEMENT_TYPES.includes(endorsement_type)) {
        throw httpError(400, `endorsement_type must be one of: ${ENDORSEMENT_TYPES.join(", ")}`)
    }
    if (hold_seconds == null || Number(hold_seconds) < 3) {
        throw httpError(400, "endorsement requires a hold of at least 3 seconds")
    }
    try {
        const SQL = `
            INSERT INTO post_endorsements (
                post_id,
                endorser_user_id,
                prompt_id,
                debate_id,
                endorsement_type,
                endorsed_user_id,
                contestant_id,
                hold_seconds,
                video_seconds_watched,
                endorsement_text,
                criterion_id,
                criterion_rating,
                experiment_variant
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *;
        `
        const result = await client.query(SQL, [
            post_id,
            endorser_user_id,
            prompt_id,
            debate_id,
            endorsement_type,
            endorsed_user_id,
            contestant_id,
            hold_seconds,
            video_seconds_watched,
            endorsement_text,
            criterion_id,
            criterion_rating,
            experiment_variant,
        ])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "you have already endorsed this")
        if (err.code === "23514") throw httpError(400, "an endorsement field violates a constraint (hold_seconds >= 3, criterion_rating 1–5)")
        if (err.code === "23503") throw httpError(400, "a referenced id (post, user, contestant, prompt, debate) does not exist")
        console.error(err)
        throw err
    }
}

// removeEndorsement — undo an endorsement. Owner-scoped when endorser_user_id is
// passed (the route should pass req.user.id) so a caller can only remove their own.
const removeEndorsement = async ({ id, endorser_user_id = null }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const result = await client.query(
            `DELETE FROM post_endorsements
             WHERE id = $1
               AND ($2::uuid IS NULL OR endorser_user_id = $2)
             RETURNING *;`,
            [id, endorser_user_id]
        )
        if (!result.rows.length) throw httpError(404, "endorsement not found or not yours")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

const getEndorsementsForPost = async ({ post_id }) => {
    if (!post_id) throw httpError(400, "post_id is required")
    try {
        const result = await client.query(
            `SELECT * FROM post_endorsements WHERE post_id = $1 ORDER BY created_at DESC`,
            [post_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getEndorsementsForContestant = async ({ contestant_id }) => {
    if (!contestant_id) throw httpError(400, "contestant_id is required")
    try {
        const result = await client.query(
            `SELECT * FROM post_endorsements WHERE contestant_id = $1 ORDER BY created_at DESC`,
            [contestant_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getEndorsementsGivenByUser = async ({ endorser_user_id }) => {
    if (!endorser_user_id) throw httpError(400, "endorser_user_id is required")
    try {
        const result = await client.query(
            `SELECT * FROM post_endorsements WHERE endorser_user_id = $1 ORDER BY created_at DESC`,
            [endorser_user_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// computeEndorsementMultiplier — the vote-weight boost a contestant earns from
// endorsements. (Replaces the earlier per-contestant "multiplier" idea, which a
// weighted blend supersedes — see blendFinalScores below.)
// ----------------------------------------------------------------------------

// Final-result weighting: the final VOTE is 80% of the score, earned
// endorsements are 20%. Votes dominate (a clear vote win can't be overturned),
// but endorsements tip close races. Exchange rate = 0.2/0.8 = 0.25: a vote
// leader keeps the win unless their vote-share margin is under 0.25× the
// opponent's endorsement-share margin.
const VOTE_WEIGHT = 0.8;

// blendFinalScores — PURE function (no DB). Given each finalist's raw vote count
// and (decayed) endorsement score, normalize EACH signal to a share of its total
// and blend voteWeight / (1 - voteWeight). You cannot add raw vote and endorsement
// counts (different scales) — normalizing to shares first is what makes the 80/20
// meaningful. §9 calculateDebateResult gathers the inputs (finalist votes +
// getEndorsementLeaderboard scores) and calls this; returns finalists ranked by
// final_score.
const blendFinalScores = (rows = [], { voteWeight = VOTE_WEIGHT } = {}) => {
    const endorseWeight = 1 - voteWeight;
    const num = (v) => Number(v) || 0;
    const totalVotes = rows.reduce((s, r) => s + num(r.votes), 0);
    const totalEndorse = rows.reduce((s, r) => s + num(r.endorsement_score), 0);
    return rows
        .map((r) => {
            const vote_share = totalVotes ? num(r.votes) / totalVotes : 0;
            const endorsement_share = totalEndorse ? num(r.endorsement_score) / totalEndorse : 0;
            return {
                contestant_id: r.contestant_id,
                votes: num(r.votes),
                endorsement_score: num(r.endorsement_score),
                vote_share,
                endorsement_share,
                final_score: voteWeight * vote_share + endorseWeight * endorsement_share,
            };
        })
        .sort((a, b) => b.final_score - a.final_score)
        .map((r, i) => ({ rank: i + 1, ...r }));
};

// ----------------------------------------------------------------------------
// getEndorsementLeaderboard — rank a debate's contestants by their endorsement
// score, where REPEAT endorsements from the SAME user to the SAME contestant
// decay geometrically (repeat_decay^(n-1): 1st full, 2nd ×decay, 3rd ×decay²…).
// So a superfan can't dominate by endorsing every post, but genuine repeat
// support still counts a little. Ties broken by nomination count (distinct
// nominators of the contestant's user in this debate), then earliest entry — a
// fully deterministic order, so "who made the top 10" is never disputable.
// repeat_decay ∈ (0,1]: 1 = no decay (raw sum), 0.5 = each repeat worth half.
// ----------------------------------------------------------------------------
const getEndorsementLeaderboard = async ({ debate_id, repeat_decay = 0.5, limit = null }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const decay = Number(repeat_decay)
    if (!(decay > 0 && decay <= 1)) throw httpError(400, "repeat_decay must be in (0, 1]")
    try {
        const SQL = `
            WITH endo AS (
                SELECT
                    e.contestant_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY e.endorser_user_id, e.contestant_id
                        ORDER BY e.created_at
                    ) - 1 AS repeat_index
                FROM post_endorsements e
                WHERE e.debate_id = $1
                  AND e.endorsement_type = 'debates'
                  AND e.contestant_id IS NOT NULL
            ),
            scored AS (
                SELECT
                    contestant_id,
                    SUM(power($2::numeric, repeat_index))::float AS endorsement_score,
                    COUNT(*)::int AS raw_endorsements
                FROM endo
                GROUP BY contestant_id
            )
            SELECT
                c.id   AS contestant_id,
                c.user_id,
                COALESCE(s.endorsement_score, 0)::float AS endorsement_score,
                COALESCE(s.raw_endorsements, 0)::int     AS raw_endorsements,
                COUNT(DISTINCT n.nominator_user_id)::int AS nominations
            FROM contestants c
            LEFT JOIN scored s     ON s.contestant_id = c.id
            LEFT JOIN nominations n ON n.nominee_user_id = c.user_id AND n.debate_id = $1
            WHERE c.debate_id = $1
              AND c.status NOT IN ('withdrawn', 'disqualified')
            GROUP BY c.id, c.user_id, s.endorsement_score, s.raw_endorsements, c.joined_at
            ORDER BY endorsement_score DESC, nominations DESC, c.joined_at ASC
            ${limit ? "LIMIT $3" : ""};
        `
        const params = limit ? [debate_id, decay, limit] : [debate_id, decay]
        const result = await client.query(SQL, params)
        // rank is positional after the deterministic ORDER BY
        return result.rows.map((r, i) => ({ rank: i + 1, ...r }))
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// lockFinalists — promote a debate's top-N endorsement-leaders to 'finalist'
// (default 10). Re-runnable: it also demotes any stale finalist that dropped out
// of the top N back to 'active'. The promote/demote run in one transaction so the
// finalist set is always consistent. After this, the vote layer only accepts
// votes for finalists (see assertFinalistEligible in contestants.js).
// ----------------------------------------------------------------------------
const lockFinalists = async ({ debate_id, topN = 10, repeat_decay = 0.5 }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const board = await getEndorsementLeaderboard({ debate_id, repeat_decay, limit: topN })
    const topIds = board.map((r) => r.contestant_id)
    try {
        return await withTransaction(async (tx) => {
            if (topIds.length) {
                await tx.query(
                    `UPDATE contestants SET status = 'finalist'
                     WHERE debate_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
                    [debate_id, topIds]
                )
                await tx.query(
                    `UPDATE contestants SET status = 'active'
                     WHERE debate_id = $1 AND status = 'finalist' AND id <> ALL($2::uuid[])`,
                    [debate_id, topIds]
                )
            }
            const { rows } = await tx.query(
                `SELECT id AS contestant_id, user_id FROM contestants
                 WHERE debate_id = $1 AND status = 'finalist'`,
                [debate_id]
            )
            return { debate_id, finalists: rows, leaderboard: board }
        })
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

module.exports = {
    createEndorsement,
    removeEndorsement,
    getEndorsementsForPost,
    getEndorsementsForContestant,
    getEndorsementsGivenByUser,
    getEndorsementLeaderboard,
    lockFinalists,
    blendFinalScores,
    VOTE_WEIGHT,
}
