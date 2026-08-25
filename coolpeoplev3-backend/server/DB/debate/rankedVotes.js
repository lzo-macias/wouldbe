const { client, withTransaction } = require("../index.js")
const { assertFinalistEligible } = require("./contestants")

// ============================================================================
// debate_final_round_ranked_votes — the final round forces ranked choice: each
// voter submits an ORDER over contestants (rank 1 = first choice). One row per
// (voter, contestant); UNIQUE also on (voter, rank) so a ballot can't repeat a
// rank. A re-submission REPLACES the voter's prior ballot (delete + insert in a
// transaction). getRankedChoiceResult runs instant-runoff over the ballots.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// submitRankedBallot — record/replace a voter's ranked ballot. rankings is an
// array of { contestant_id, rank }. acknowledged_criteria is verified by the
// route's requireCriteriaAck middleware, so we stamp it true server-side.
const submitRankedBallot = async ({
    debate_id,
    voter_user_id,
    rankings,
    acknowledged_at,
}, db = client) => {
    if (!debate_id || !voter_user_id) throw httpError(400, "debate_id and voter_user_id are required")
    if (!Array.isArray(rankings) || rankings.length === 0) {
        throw httpError(400, "rankings must be a non-empty array of { contestant_id, rank }")
    }
    const seenRanks = new Set()
    const seenContestants = new Set()
    for (const r of rankings) {
        if (!r || !r.contestant_id || !Number.isInteger(r.rank) || r.rank < 1) {
            throw httpError(400, "each ranking needs a contestant_id and an integer rank >= 1")
        }
        if (seenRanks.has(r.rank)) throw httpError(400, `duplicate rank ${r.rank}`)
        if (seenContestants.has(r.contestant_id)) throw httpError(400, "a contestant appears more than once")
        seenRanks.add(r.rank)
        seenContestants.add(r.contestant_id)
    }
    const run = async (tx) => {
        // Ranked ballots ARE the final round — every ranked contestant must be a
        // locked finalist (no-op only if finalists aren't locked yet).
        await assertFinalistEligible(debate_id, rankings.map((r) => r.contestant_id), tx)
        await tx.query(
            `DELETE FROM debate_final_round_ranked_votes WHERE debate_id = $1 AND voter_user_id = $2`,
            [debate_id, voter_user_id]
        )
        const result = await tx.query(
            `INSERT INTO debate_final_round_ranked_votes
                 (debate_id, voter_user_id, contestant_id, rank, acknowledged_criteria, acknowledged_at)
             SELECT $1, $2, c, r, true, COALESCE($5, NOW())
             FROM unnest($3::uuid[], $4::int[]) AS t(c, r)
             RETURNING *;`,
            [
                debate_id,
                voter_user_id,
                rankings.map((r) => r.contestant_id),
                rankings.map((r) => r.rank),
                acknowledged_at,
            ]
        )
        return result.rows
    }
    try {
        // If the caller already gave us a tx (db !== pool), reuse it; else open one
        // so the delete + insert replace is atomic.
        return db === client ? await withTransaction(run) : await run(db)
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "debate_id, voter_user_id or a contestant_id does not exist")
        if (err.code === "23514") throw httpError(400, "rank must be >= 1")
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed")
        console.error(err)
        throw err
    }
}

// getRankedChoiceResult — instant-runoff (IRV) over the submitted ballots.
// Each round counts every ballot's highest-ranked surviving contestant; if one
// holds a majority it wins, else the contestant with the fewest first-place
// votes is eliminated and the round repeats. Returns the winner, the per-round
// counts, and the ballot total.
const getRankedChoiceResult = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const { rows } = await client.query(
            `SELECT voter_user_id, contestant_id, rank
             FROM debate_final_round_ranked_votes
             WHERE debate_id = $1
             ORDER BY voter_user_id, rank`,
            [debate_id]
        )

        // Group into one ordered preference list (by rank) per voter.
        const ballots = new Map(); // voter_user_id -> [contestant_id ordered by rank]
        for (const r of rows) {
            if (!ballots.has(r.voter_user_id)) ballots.set(r.voter_user_id, [])
            ballots.get(r.voter_user_id).push(r.contestant_id)
        }
        const ballotLists = [...ballots.values()]
        const totalBallots = ballotLists.length
        if (totalBallots === 0) {
            return { debate_id, winner: null, total_ballots: 0, rounds: [] }
        }

        const eliminated = new Set()
        const rounds = []
        let winner = null

        while (!winner) {
            // Tally each ballot's top surviving choice.
            const counts = {}
            let active = 0
            for (const list of ballotLists) {
                const top = list.find((c) => !eliminated.has(c))
                if (top === undefined) continue // exhausted ballot
                counts[top] = (counts[top] || 0) + 1
                active++
            }
            const standings = Object.entries(counts)
                .map(([contestant_id, votes]) => ({ contestant_id, votes }))
                .sort((a, b) => b.votes - a.votes)

            if (standings.length === 0) break // everyone exhausted; no winner

            const leader = standings[0]
            if (leader.votes * 2 > active || standings.length === 1) {
                winner = leader.contestant_id
                rounds.push({ round: rounds.length + 1, active_ballots: active, standings, winner })
                break
            }

            // Eliminate the lowest; ties broken by first-encountered lowest.
            const loser = standings[standings.length - 1].contestant_id
            eliminated.add(loser)
            rounds.push({ round: rounds.length + 1, active_ballots: active, standings, eliminated: loser })
        }

        return { debate_id, winner, total_ballots: totalBallots, rounds }
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    submitRankedBallot,
    getRankedChoiceResult,
}
