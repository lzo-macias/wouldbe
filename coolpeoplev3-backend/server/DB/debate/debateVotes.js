const { client } = require("../index.js")
const { assertFinalistEligible } = require("./contestants")

// ============================================================================
// debate_votes — one general vote per user per debate (UNIQUE debate_id,
// voter_user_id). debate_vote_scores — optional per-criterion 1–5 scores hung
// off a parent vote (UNIQUE vote_id, contestant_id, criterion_id).
//
// Both writers accept an optional `db` executor (defaults to the pool) so a
// route can wrap castDebateVote + addVoteScores in one withTransaction and make
// the vote and its scores atomic. See [[project_db_pool_transactions]].
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// castDebateVote — record a general vote. `weight` is intentionally NOT a
// parameter: it's an anti-fraud trust score (DB default 1.000) that only
// coordinated-behavior detection may lower — a voter must never set their own.
// voter_ip / voter_device_fingerprint should be supplied by the route from the
// request context, not the client body.
const castDebateVote = async ({
    debate_id,
    voter_user_id,
    contestant_id,
    acknowledged_criteria,
    acknowledged_at,
    rules_version_seen,
    view_minutes_logged,
    voter_ip,
    voter_device_fingerprint,
}, db = client) => {
    if (!voter_user_id) throw httpError(400, "must be signed in to vote")
    if (!debate_id || !contestant_id) throw httpError(400, "debate_id and contestant_id are required")
    if (!rules_version_seen) throw httpError(400, "rules_version_seen is required")
    if (acknowledged_criteria !== true) {
        throw httpError(400, "must acknowledge the voting criteria to vote")
    }
    try {
        // Final round: once finalists are locked, only they are votable. No-op
        // before lock-in. Runs on `db` so it shares the caller's transaction.
        await assertFinalistEligible(debate_id, contestant_id, db)
        const SQL = `
            INSERT INTO debate_votes (
                debate_id,
                voter_user_id,
                contestant_id,
                acknowledged_criteria,
                acknowledged_at,
                rules_version_seen,
                view_minutes_logged,
                voter_ip,
                voter_device_fingerprint
            )
            VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6, COALESCE($7, 0), $8, $9)
            RETURNING *;
        `

        const result = await db.query(SQL, [
            debate_id,
            voter_user_id,
            contestant_id,
            acknowledged_criteria,
            acknowledged_at,
            rules_version_seen,
            view_minutes_logged,
            voter_ip,
            voter_device_fingerprint,
        ])

        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "you have already voted in this debate")
        if (err.code === "23503") throw httpError(400, "debate_id, voter_user_id or contestant_id does not exist")
        if (err.code === "23514") throw httpError(400, "a vote field violates a check constraint")
        if (err.code === "22P02") throw httpError(400, "a uuid or ip field is malformed")
        console.error(err)
        throw err
    }
}

// addVoteScores — attach per-criterion 1–5 scores to an existing vote. Takes the
// parent vote_id plus an array of { contestant_id, criterion_id, score }, written
// as ONE multi-row INSERT (atomic on its own). score_id/created_at default.

const addVoteScores = async ({ 
    vote_id, 
    scores 
}, db = client) => {
    if (!vote_id) throw httpError(400, "vote_id is required")
    if (!Array.isArray(scores) || scores.length === 0) {
        throw httpError(400, "scores must be a non-empty array of { contestant_id, criterion_id, score }")
    }
    for (const s of scores) {
        if (!s || !s.contestant_id || !s.criterion_id || s.score == null) {
            throw httpError(400, "each score needs contestant_id, criterion_id and score")
        }
        if (!Number.isInteger(s.score) || s.score < 1 || s.score > 5) {
            throw httpError(400, "score must be an integer between 1 and 5")
        }
    }
    try {
        const SQL = `
            INSERT INTO debate_vote_scores (vote_id, contestant_id, criterion_id, score)
            SELECT $1, c, k, v
            FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS t(c, k, v)
            RETURNING *;
        `

        const result = await db.query(SQL, [
            vote_id,
            scores.map((s) => s.contestant_id),
            scores.map((s) => s.criterion_id),
            scores.map((s) => s.score),
        ])

        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "a score for this vote/contestant/criterion already exists")
        if (err.code === "23503") throw httpError(400, "vote_id, contestant_id or criterion_id does not exist")
        if (err.code === "23514") throw httpError(400, "score must be between 1 and 5")
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed")
        console.error(err)
        throw err
    }
}



// getMyVote — the caller's vote in a debate plus any per-criterion scores they
// recorded. Returns null when they haven't voted.
const getMyVote = async ({ debate_id, voter_user_id }) => {
    if (!debate_id || !voter_user_id) throw httpError(400, "debate_id and voter_user_id are required")
    try {
        const v = await client.query(
            `SELECT * FROM debate_votes WHERE debate_id = $1 AND voter_user_id = $2`,
            [debate_id, voter_user_id]
        )
        const vote = v.rows[0]
        if (!vote) return null
        const s = await client.query(
            `SELECT * FROM debate_vote_scores WHERE vote_id = $1`,
            [vote.vote_id]
        )
        return { vote, scores: s.rows }
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getVoteTally — per-contestant totals for a debate. Counts only valid votes
// (invalidated_at IS NULL) and reports both a raw count and the weighted sum
// (weight is the anti-fraud trust score).
const getVoteTally = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                contestant_id,
                COUNT(*)::int               AS votes,
                COALESCE(SUM(weight), 0)::float AS weighted_votes
            FROM debate_votes
            WHERE debate_id = $1
              AND invalidated_at IS NULL
            GROUP BY contestant_id
            ORDER BY weighted_votes DESC, votes DESC;
        `
        const result = await client.query(SQL, [debate_id])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// invalidateVote — fraud/forensics action (internal only). Soft-invalidates a
// vote so it stops counting in the tally. Idempotent guard: only invalidates a
// vote that's still counting.
const invalidateVote = async ({ vote_id, invalidation_reason }, db = client) => {
    if (!vote_id) throw httpError(400, "vote_id is required")
    if (!invalidation_reason || !invalidation_reason.trim()) {
        throw httpError(400, "invalidation_reason is required")
    }
    try {
        const SQL = `
            UPDATE debate_votes
            SET invalidated_at = NOW(), invalidation_reason = $2
            WHERE vote_id = $1 AND invalidated_at IS NULL
            RETURNING *;
        `
        const result = await db.query(SQL, [vote_id, invalidation_reason])
        if (!result.rows.length) throw httpError(409, "vote not found or already invalidated")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

module.exports = {
    castDebateVote,
    addVoteScores,
    getMyVote,
    getVoteTally,
    invalidateVote,
}
