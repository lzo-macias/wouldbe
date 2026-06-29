const { client, withTransaction } = require("../index.js")
const { blendFinalScores, getEndorsementLeaderboard } = require("../content/postEndoresments")

// ============================================================================
// debate_results — the final, locked, announced outcome of a debate. PK is
// result_id; UNIQUE (debate_id) means a debate has at most one result row.
//
// The point of this table is defensibility: we freeze the EXACT math used to
// pick the winner (crowd_score_data / judge_score_data / endorsement_multiplier
// / final_calculation) so a contestant dispute can be answered with the numbers
// that were live at announce time. result_type mirrors debates.win_type plus the
// two terminal states 'no_contest' and 'voided'.
//
// Flow: calculateDebateResult (pure read/compute, no writes) -> announceDebateResult
// (persists + locks + stamps announced_at) -> voidDebateResult (terminal void).
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const RESULT_TYPES = ["sponsor_decision", "general_vote", "hybrid", "no_contest", "voided"]

// Default dispute window: 7 days after announce. The schema comment cites 7–14;
// the caller can override via announceDebateResult({ dispute_window_days }).
const DEFAULT_DISPUTE_WINDOW_DAYS = 7

// ----------------------------------------------------------------------------
// calculateDebateResult — PURE read/compute (no writes). Reads the debate's
// win_type, its finalists, and every scoring signal, then returns the ranked
// finalists, the chosen winner, and the frozen math. Persistence is left to
// announceDebateResult so this can be called for previews without committing.
//
// win_type semantics:
//   sponsor_decision -> ranked by aggregated judge scores (sum of avg-per-criterion).
//   general_vote     -> ranked by the 80/20 crowd blend (votes 0.8 / endorsements 0.2).
//   hybrid           -> same 80/20 crowd blend (hybrid_crowd_weight_pct governs how the
//                       crowd result combines with a sponsor decision at the routing
//                       layer; here we surface the crowd math and the crowd leader).
// ----------------------------------------------------------------------------
const calculateDebateResult = async ({ debate_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const debateRes = await db.query(
            `SELECT id, win_type, hybrid_crowd_weight_pct, status FROM debates WHERE id = $1`,
            [debate_id]
        )
        if (debateRes.rows.length === 0) throw httpError(404, "debate not found")
        const debate = debateRes.rows[0]

        // Finalists only. (Winners get promoted to 'winner' later; at calc time the
        // contenders are the locked finalist set.)
        const finalistsRes = await db.query(
            `SELECT id AS contestant_id, user_id
             FROM contestants
             WHERE debate_id = $1 AND status = 'finalist'
             ORDER BY joined_at ASC`,
            [debate_id]
        )
        const finalists = finalistsRes.rows
        const finalistIds = finalists.map((f) => f.contestant_id)

        if (finalistIds.length === 0) {
            return {
                debate_id,
                win_type: debate.win_type,
                result_type: "no_contest",
                winner_contestant_id: null,
                ranked: [],
                final_calculation: { reason: "no finalists to score", win_type: debate.win_type },
                crowd_score_data: null,
                judge_score_data: null,
                endorsement_multiplier: null,
            }
        }

        // --- crowd signal: valid (non-invalidated) votes per finalist, weighted ---
        // weight defaults to 1.0; coordinated-behavior detection can lower it.
        const votesRes = await db.query(
            `SELECT contestant_id,
                    COALESCE(SUM(weight), 0)::float AS votes,
                    COUNT(*)::int                   AS raw_votes
             FROM debate_votes
             WHERE debate_id = $1
               AND invalidated_at IS NULL
               AND contestant_id = ANY($2::uuid[])
             GROUP BY contestant_id`,
            [debate_id, finalistIds]
        )
        const voteByContestant = new Map(
            votesRes.rows.map((r) => [r.contestant_id, { votes: r.votes, raw_votes: r.raw_votes }])
        )

        // --- endorsement signal: decayed endorsement score per contestant ---
        const leaderboard = await getEndorsementLeaderboard({ debate_id })
        const endorseByContestant = new Map(
            leaderboard.map((r) => [r.contestant_id, r.endorsement_score])
        )

        // --- judge signal: avg score per (contestant, criterion), summed per contestant ---
        // Per-criterion average across judges, then sum the per-criterion averages so a
        // contestant scored on more criteria isn't penalized vs. judge head-count noise.
        const judgeRes = await db.query(
            `SELECT contestant_id, SUM(crit_avg)::float AS judge_total
             FROM (
                 SELECT contestant_id, criterion_id, AVG(score)::float AS crit_avg
                 FROM debate_judge_scores
                 WHERE debate_id = $1
                   AND contestant_id = ANY($2::uuid[])
                 GROUP BY contestant_id, criterion_id
             ) per_crit
             GROUP BY contestant_id`,
            [debate_id, finalistIds]
        )
        const judgeByContestant = new Map(
            judgeRes.rows.map((r) => [r.contestant_id, r.judge_total])
        )

        // Assemble the rows the blend function expects.
        const blendInput = finalists.map((f) => ({
            contestant_id: f.contestant_id,
            votes: voteByContestant.get(f.contestant_id)?.votes || 0,
            endorsement_score: endorseByContestant.get(f.contestant_id) || 0,
        }))

        const crowdRanked = blendFinalScores(blendInput).map((r) => {
            const f = finalists.find((x) => x.contestant_id === r.contestant_id)
            return {
                ...r,
                user_id: f ? f.user_id : null,
                raw_votes: voteByContestant.get(r.contestant_id)?.raw_votes || 0,
            }
        })

        // crowd_score_data — frozen breakdown of the blended crowd math.
        const crowd_score_data = {
            method: "blended_80_20",
            vote_weight: 0.8,
            endorsement_weight: 0.2,
            rows: crowdRanked,
        }
        // endorsement_multiplier — kept for the schema column; we record the raw
        // endorsement leaderboard scores that fed the blend (no legacy multiplier).
        const endorsement_multiplier = {
            method: "decayed_endorsement_leaderboard",
            scores: leaderboard.map((r) => ({
                contestant_id: r.contestant_id,
                endorsement_score: r.endorsement_score,
                raw_endorsements: r.raw_endorsements,
            })),
        }

        let ranked
        let result_type
        let judge_score_data = null

        if (debate.win_type === "sponsor_decision") {
            // Judge-panel scoring decides. Rank by summed per-criterion averages.
            const judgeRanked = finalists
                .map((f) => ({
                    contestant_id: f.contestant_id,
                    user_id: f.user_id,
                    judge_total: judgeByContestant.get(f.contestant_id) || 0,
                }))
                .sort((a, b) => b.judge_total - a.judge_total)
                .map((r, i) => ({ rank: i + 1, ...r }))
            judge_score_data = { method: "sum_of_criterion_averages", rows: judgeRanked }
            ranked = judgeRanked
            result_type = "sponsor_decision"
        } else {
            // general_vote and hybrid both rank on the crowd blend here.
            ranked = crowdRanked
            result_type = debate.win_type // 'general_vote' | 'hybrid'
        }

        const winner_contestant_id = ranked.length ? ranked[0].contestant_id : null

        const final_calculation = {
            win_type: debate.win_type,
            result_type,
            hybrid_crowd_weight_pct: debate.hybrid_crowd_weight_pct ?? null,
            winner_contestant_id,
            ranked,
            finalist_count: finalists.length,
            computed_at: new Date().toISOString(),
        }

        return {
            debate_id,
            win_type: debate.win_type,
            result_type,
            winner_contestant_id,
            ranked,
            final_calculation,
            crowd_score_data,
            judge_score_data,
            endorsement_multiplier,
        }
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// getDebateResult — the persisted (announced) result row for a debate, or null.
// ----------------------------------------------------------------------------
const getDebateResult = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const { rows } = await client.query(
            `SELECT * FROM debate_results WHERE debate_id = $1`,
            [debate_id]
        )
        return rows[0] || null
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// announceDebateResult — calculate (fresh), then persist + lock + announce in one
// transaction. The UNIQUE(debate_id) constraint makes this announce-once: a second
// call surfaces 23505 -> 409. Also promotes the winning contestant to 'winner'.
// Pass { result_type, winner_contestant_id, notes } to override the computed
// winner (e.g. a sponsor_decision the panel made off-platform).
// ----------------------------------------------------------------------------
const announceDebateResult = async ({
    debate_id,
    result_type = null,
    winner_contestant_id = null,
    notes = null,
    dispute_window_days = DEFAULT_DISPUTE_WINDOW_DAYS,
}) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (result_type !== null && !RESULT_TYPES.includes(result_type)) {
        throw httpError(400, `result_type must be one of: ${RESULT_TYPES.join(", ")}`)
    }
    try {
        return await withTransaction(async (tx) => {
            const calc = await calculateDebateResult({ debate_id }, tx)

            const finalResultType = result_type || calc.result_type
            const finalWinner =
                winner_contestant_id !== null ? winner_contestant_id : calc.winner_contestant_id

            const final_calculation = {
                ...calc.final_calculation,
                announced_result_type: finalResultType,
                announced_winner_contestant_id: finalWinner,
                winner_override: winner_contestant_id !== null,
            }

            const insertRes = await tx.query(
                `INSERT INTO debate_results
                    (debate_id, winner_contestant_id, result_type,
                     crowd_score_data, judge_score_data, endorsement_multiplier,
                     final_calculation, locked_at, announced_at, dispute_window_ends_at, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7,
                         NOW(), NOW(), NOW() + ($8 || ' days')::interval, $9)
                 RETURNING *`,
                [
                    debate_id,
                    finalWinner,
                    finalResultType,
                    calc.crowd_score_data,
                    calc.judge_score_data,
                    calc.endorsement_multiplier,
                    final_calculation,
                    String(dispute_window_days),
                    notes,
                ]
            )

            // Promote the winning contestant; demote nobody else here (runner_up is a
            // separate workflow). Only acts when a winner was chosen.
            if (finalWinner) {
                await tx.query(
                    `UPDATE contestants SET status = 'winner'
                     WHERE id = $1 AND debate_id = $2 AND status = 'finalist'`,
                    [finalWinner, debate_id]
                )
            }

            return insertRes.rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "a result has already been announced for this debate")
        if (err.code === "23503") throw httpError(400, "debate_id or winner_contestant_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid result_type")
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// voidDebateResult — terminal void of an announced result. Sets result_type to
// 'voided', clears the winner, and records the reason in notes + final_calculation.
// Idempotent-ish: re-voiding just refreshes the reason. Requires an existing row.
// ----------------------------------------------------------------------------
const voidDebateResult = async ({ debate_id, reason }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!reason) throw httpError(400, "reason is required to void a result")
    try {
        return await withTransaction(async (tx) => {
            const existing = await tx.query(
                `SELECT * FROM debate_results WHERE debate_id = $1 FOR UPDATE`,
                [debate_id]
            )
            if (existing.rows.length === 0) throw httpError(404, "no result to void for this debate")

            const prevCalc = existing.rows[0].final_calculation || {}
            const newCalc = {
                ...prevCalc,
                voided: true,
                void_reason: reason,
                voided_at: new Date().toISOString(),
            }

            const { rows } = await tx.query(
                `UPDATE debate_results
                 SET result_type = 'voided',
                     winner_contestant_id = NULL,
                     final_calculation = $2,
                     notes = COALESCE(notes || E'\\n', '') || $3
                 WHERE debate_id = $1
                 RETURNING *`,
                [debate_id, newCalc, `VOIDED: ${reason}`]
            )

            // Roll the promoted winner back to finalist so the standings reflect the void.
            await tx.query(
                `UPDATE contestants SET status = 'finalist'
                 WHERE debate_id = $1 AND status = 'winner'`,
                [debate_id]
            )

            return rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

module.exports = {
    RESULT_TYPES,
    calculateDebateResult,
    getDebateResult,
    announceDebateResult,
    voidDebateResult,
}
