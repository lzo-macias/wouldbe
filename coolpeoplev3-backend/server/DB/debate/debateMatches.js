const { client } = require("../index.js")
const { getDebateCriteria, ensureDebateCriteria } = require("./debateCriteria")

// ============================================================================
// Bracket-match crowd voting — the vote screen a host puts up mid-debate.
//
// THE FLOW, end to end:
//   1. host clicks a live match          -> openMatchVoting()   (voting_state 'open')
//   2. everyone in the room scores both  -> castMatchVote()      (1–5 per criterion)
//   3. host closes it                    -> closeMatchVoting()   (winner decided)
//   4. the winner's win count advances them in the bracket       (listDebateMatches)
//
// WHO MAY OPEN ONE: the host (the debate's sponsor), and only for a debate whose
// win_type is 'general_vote' or 'hybrid'. A 'sponsor_decision' debate is decided
// by a judge — putting a crowd ballot on screen there would collect votes that
// cannot legally decide anything, which is worse than not offering the button.
//
// WHO WON, per ballot, is DERIVED from the scores rather than clicked: the
// ballot's whole claim is "these numbers are why". Deriving it means the pick
// and the reasoning can never disagree. Equal totals stay a draw (contestant_id
// NULL) instead of forcing a preference the voter didn't express.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// The two win types whose winner the room decides. 'sponsor_decision' is
// deliberately absent — see the header.
const CROWD_WIN_TYPES = ["general_vote", "hybrid"]
// A debate is only votable while it is actually running. 'no_posting' is still
// live (posting is frozen, the stream is not).
const LIVE_STATUSES = ["live", "no_posting"]

const MAX_COMMENT = 500

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

// _loadDebate — the debate row plus sponsor_user_id, which is what "am I the
// host?" actually compares against. debates.sponsor_id is a SPONSORS id, so
// comparing it to a user id never matches (the same trap debateFull documents).
const _loadDebate = async ({ debate_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const { rows } = await db.query(
        `SELECT d.*, s.user_id AS sponsor_user_id
         FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id]
    )
    if (!rows.length) throw httpError(404, "debate not found")
    return rows[0]
}

// assertHostCanRunVotes — the full gate on the host's side of the screen, in the
// order the host would want it reported.
const assertHostCanRunVotes = async ({ debate_id, user_id }, db = client) => {
    const debate = await _loadDebate({ debate_id }, db)
    if (!user_id || debate.sponsor_user_id !== user_id) {
        throw httpError(403, "only the host of this debate can run a match vote")
    }
    if (!CROWD_WIN_TYPES.includes(debate.win_type)) {
        throw httpError(
            409,
            "this debate is decided by a judge, so a room vote cannot decide a match"
        )
    }
    if (!LIVE_STATUSES.includes(debate.status)) {
        throw httpError(409, `this debate is ${debate.status} — match votes only run while it is live`)
    }
    return debate
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

// The two contestants, joined to their identity, in one shape both the ballot
// and the bracket can render.
const MATCH_SELECT = `
    SELECT
        m.*,
        ca.user_id            AS a_user_id,
        ua.first_name         AS a_first_name,
        ua.last_name          AS a_last_name,
        ua.username           AS a_username,
        ua.profile_photo_url  AS a_photo_url,
        cb.user_id            AS b_user_id,
        ub.first_name         AS b_first_name,
        ub.last_name          AS b_last_name,
        ub.username           AS b_username,
        ub.profile_photo_url  AS b_photo_url
    FROM debate_matches m
    JOIN contestants ca ON ca.id = m.contestant_a_id
    JOIN users ua       ON ua.id = ca.user_id
    JOIN contestants cb ON cb.id = m.contestant_b_id
    JOIN users ub       ON ub.id = cb.user_id
`

// _shape — flatten the a_/b_ columns into two contestant objects. The frontend
// renders both sides with one component, so it should not have to know which
// prefix belongs to which seat.
const _shape = (row) => {
    if (!row) return null
    const {
        a_user_id, a_first_name, a_last_name, a_username, a_photo_url,
        b_user_id, b_first_name, b_last_name, b_username, b_photo_url,
        ...match
    } = row
    return {
        ...match,
        contestants: [
            {
                contestant_id: match.contestant_a_id,
                user_id: a_user_id,
                first_name: a_first_name,
                last_name: a_last_name,
                username: a_username,
                profile_photo_url: a_photo_url,
            },
            {
                contestant_id: match.contestant_b_id,
                user_id: b_user_id,
                first_name: b_first_name,
                last_name: b_last_name,
                username: b_username,
                profile_photo_url: b_photo_url,
            },
        ],
    }
}

// listDebateMatches — every match on record for a debate. This is what the
// bracket reads: a decided match is a persisted fact, so a refresh (or a second
// viewer) sees exactly the same board.
const listDebateMatches = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const { rows } = await client.query(
        `${MATCH_SELECT} WHERE m.debate_id = $1 ORDER BY m.round, m.side, m.position`,
        [debate_id]
    )
    return rows.map(_shape)
}

const getMatchById = async ({ match_id }, db = client) => {
    if (!match_id) throw httpError(400, "match_id is required")
    const { rows } = await db.query(`${MATCH_SELECT} WHERE m.id = $1`, [match_id])
    return _shape(rows[0])
}

// getMatchTally — the count, the per-criterion averages, and the written
// comments. One read per shape rather than one giant join, because the three
// answer different questions and only the first is needed to decide the match.
const getMatchTally = async ({ match_id }) => {
    if (!match_id) throw httpError(400, "match_id is required")

    const [counts, averages, comments] = await Promise.all([
        client.query(
            `SELECT contestant_id,
                    COUNT(*)::int                   AS votes,
                    COALESCE(SUM(weight), 0)::float AS weighted_votes
             FROM debate_match_votes
             WHERE match_id = $1 AND invalidated_at IS NULL
             GROUP BY contestant_id`,
            [match_id]
        ),
        client.query(
            `SELECT s.contestant_id,
                    s.criterion_id,
                    ROUND(AVG(s.score)::numeric, 2)::float AS avg_score,
                    COUNT(*)::int                          AS scores
             FROM debate_match_vote_scores s
             JOIN debate_match_votes v ON v.vote_id = s.vote_id
             WHERE v.match_id = $1 AND v.invalidated_at IS NULL
             GROUP BY s.contestant_id, s.criterion_id`,
            [match_id]
        ),
        client.query(
            `SELECT v.vote_id, v.contestant_id, v.comment, v.created_at,
                    u.username, u.first_name, u.last_name, u.profile_photo_url
             FROM debate_match_votes v
             JOIN users u ON u.id = v.voter_user_id
             WHERE v.match_id = $1
               AND v.invalidated_at IS NULL
               AND v.comment IS NOT NULL AND v.comment <> ''
             ORDER BY v.created_at DESC
             LIMIT 50`,
            [match_id]
        ),
    ])

    // A draw is a row with contestant_id NULL; it is reported separately rather
    // than dropped, because "12 people couldn't split them" is a result.
    const decisive = counts.rows.filter((r) => r.contestant_id)
    const draws = counts.rows.find((r) => !r.contestant_id)

    return {
        counts: decisive.sort((a, b) => b.weighted_votes - a.weighted_votes),
        draws: draws ? draws.votes : 0,
        total_ballots: counts.rows.reduce((n, r) => n + r.votes, 0),
        averages: averages.rows,
        comments: comments.rows,
    }
}

// getMyMatchVote — the caller's ballot for a match, scores included. Null when
// they haven't voted; that's what puts the ballot on screen rather than the
// result.
const getMyMatchVote = async ({ match_id, voter_user_id }) => {
    if (!match_id || !voter_user_id) throw httpError(400, "match_id and voter_user_id are required")
    const { rows } = await client.query(
        `SELECT * FROM debate_match_votes WHERE match_id = $1 AND voter_user_id = $2`,
        [match_id, voter_user_id]
    )
    const vote = rows[0]
    if (!vote) return null
    const scores = await client.query(
        `SELECT * FROM debate_match_vote_scores WHERE vote_id = $1`,
        [vote.vote_id]
    )
    return { ...vote, scores: scores.rows }
}

// getOpenMatch — the one ballot currently up, everything needed to render it.
//
// viewer_user_id is OPTIONAL and only widens the answer (their own ballot).
// The live tally is withheld from voters on purpose: a running count on screen
// tells people which way the room is going before they score, which is exactly
// the pressure a per-criterion ballot exists to remove. The host sees it,
// because they are the one deciding when the vote has run long enough.
const getOpenMatch = async ({ debate_id, viewer_user_id = null }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const debate = await _loadDebate({ debate_id })

    const { rows } = await client.query(
        `${MATCH_SELECT} WHERE m.debate_id = $1 AND m.voting_state = 'open' LIMIT 1`,
        [debate_id]
    )
    const match = _shape(rows[0])
    const is_host = !!viewer_user_id && debate.sponsor_user_id === viewer_user_id
    if (!match) {
        return { match: null, is_host, can_run_votes: CROWD_WIN_TYPES.includes(debate.win_type) }
    }

    const [criteria, my_vote, tally] = await Promise.all([
        getDebateCriteria({ debate_id }),
        viewer_user_id ? getMyMatchVote({ match_id: match.id, voter_user_id: viewer_user_id }) : null,
        is_host ? getMatchTally({ match_id: match.id }) : null,
    ])

    return {
        match,
        criteria,
        my_vote,
        tally,
        is_host,
        can_run_votes: CROWD_WIN_TYPES.includes(debate.win_type),
    }
}

// ---------------------------------------------------------------------------
// host actions
// ---------------------------------------------------------------------------

// openMatchVoting — put the vote screen up for one match.
//
// Idempotent on the SAME match: re-opening what is already open returns it
// rather than erroring, so a host double-click or a second tab is harmless.
// A DIFFERENT match while one is open is a 409 that names the open one — the
// alternative (auto-closing it) would decide a match the host didn't mean to
// decide, and the count that decided it would already be gone from the screen.
const openMatchVoting = async ({
    debate_id,
    host_user_id,
    round,
    side,
    position,
    contestant_a_id,
    contestant_b_id,
}, db = client) => {
    const debate = await assertHostCanRunVotes({ debate_id, user_id: host_user_id }, db)

    if (round == null || position == null || !side) {
        throw httpError(400, "round, side and position are required")
    }
    if (!contestant_a_id || !contestant_b_id) {
        throw httpError(400, "contestant_a_id and contestant_b_id are required")
    }
    if (contestant_a_id === contestant_b_id) {
        throw httpError(400, "a match needs two different contestants")
    }
    if (!["left", "right", "final"].includes(side)) {
        throw httpError(400, "side must be left, right or final")
    }

    // Both seats must belong to THIS debate. Without this a crafted body could
    // seat a contestant from another debate into the bracket; the foreign keys
    // alone would allow it.
    const { rows: seats } = await db.query(
        `SELECT id FROM contestants WHERE id = ANY($1::uuid[]) AND debate_id = $2`,
        [[contestant_a_id, contestant_b_id], debate_id]
    )
    if (seats.length !== 2) {
        throw httpError(400, "both contestants must be entrants in this debate")
    }

    const { rows: open } = await db.query(
        `SELECT id, round, side, position FROM debate_matches
         WHERE debate_id = $1 AND voting_state = 'open'`,
        [debate_id]
    )
    const already = open[0]

    // The criteria are resolved BEFORE the ballot goes up, so nobody can be
    // shown a ballot with nothing on it to score.
    const criteria = await ensureDebateCriteria(
        { debate_id, category: debate.category },
        db
    )

    const { rows } = await db.query(
        `INSERT INTO debate_matches
            (debate_id, round, side, position, contestant_a_id, contestant_b_id,
             voting_state, opened_at, opened_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,'open',NOW(),$7)
         ON CONFLICT (debate_id, round, side, position) DO UPDATE
            SET contestant_a_id  = EXCLUDED.contestant_a_id,
                contestant_b_id  = EXCLUDED.contestant_b_id,
                voting_state     = 'open',
                opened_at        = COALESCE(debate_matches.opened_at, NOW()),
                opened_by_user_id = EXCLUDED.opened_by_user_id,
                closed_at        = NULL,
                updated_at       = NOW()
         WHERE debate_matches.voting_state <> 'closed'
         RETURNING *`,
        [debate_id, round, side, position, contestant_a_id, contestant_b_id, host_user_id]
    )

    if (!rows.length) {
        // The DO UPDATE ... WHERE filtered the row out: this slot is already
        // decided. Re-opening it would let a settled match be replayed.
        if (already) throw httpError(409, "a vote is already open for another match")
        throw httpError(409, "this match has already been decided")
    }

    // Another match was open and this one is not it. The insert above can only
    // have got here if the open row IS this slot (the partial unique index would
    // have raised 23505 otherwise) — but say it plainly rather than rely on that.
    if (already && already.id !== rows[0].id) {
        throw httpError(409, "a vote is already open for another match")
    }

    // Re-read through MATCH_SELECT so the caller gets the same shape (both
    // contestants, joined to their identity) every other read hands back.
    const match = await getMatchById({ match_id: rows[0].id }, db)
    return { match, criteria }
}

// ---------------------------------------------------------------------------
// crowning the debate
// ---------------------------------------------------------------------------

// crownBracketChampion — the final is decided, so the DEBATE has a winner.
//
// Winning the final is the whole tournament, so it is recorded where every other
// part of the platform looks for a debate's outcome: debate_results (UNIQUE per
// debate). Leaving the champion implicit in a debate_matches row would mean the
// result the payouts, the profile and the archive all read stayed empty.
//
// WHY NOT announceDebateResult(): that function recomputes the winner from
// debate_votes + endorsements — the FINAL-ROUND ballot's math, not a bracket's.
// A bracket champion won seven head-to-heads; ranking them by a debate-wide vote
// they never took would announce a different person. It also opens its own
// transaction, so it could not join the close that produced the winner. What is
// shared is the TABLE and its contract, which is what matters.
//
// final_calculation freezes the bracket itself — every match, who was in it, who
// won it, and by what count. That is the answer to "why did this person win",
// and it has to survive the matches being edited or a contestant being deleted.
const crownBracketChampion = async ({ match, db = client }) => {
    if (match.side !== "final" || !match.winner_contestant_id) return null

    const debate_id = match.debate_id
    const [{ rows: everyMatch }, { rows: everyCount }] = await Promise.all([
        db.query(
            `SELECT id, round, side, position, contestant_a_id, contestant_b_id,
                    winner_contestant_id, decided_by_host, voting_state, closed_at
             FROM debate_matches WHERE debate_id = $1
             ORDER BY round, side, position`,
            [debate_id]
        ),
        db.query(
            `SELECT match_id, contestant_id,
                    COUNT(*)::int                   AS votes,
                    COALESCE(SUM(weight), 0)::float AS weighted_votes
             FROM debate_match_votes
             WHERE debate_id = $1 AND invalidated_at IS NULL
             GROUP BY match_id, contestant_id`,
            [debate_id]
        ),
    ])

    const countsByMatch = {}
    for (const row of everyCount) {
        ;(countsByMatch[row.match_id] ||= []).push({
            // A NULL contestant_id is a ballot that scored the pair level.
            contestant_id: row.contestant_id,
            votes: row.votes,
            weighted_votes: row.weighted_votes,
        })
    }

    const runnerUp =
        match.winner_contestant_id === match.contestant_a_id
            ? match.contestant_b_id
            : match.contestant_a_id

    const final_calculation = {
        method: "bracket",
        champion_contestant_id: match.winner_contestant_id,
        runner_up_contestant_id: runnerUp,
        final_decided_by_host: match.decided_by_host,
        matches: everyMatch.map((m) => ({
            round: m.round,
            side: m.side,
            position: m.position,
            contestant_a_id: m.contestant_a_id,
            contestant_b_id: m.contestant_b_id,
            winner_contestant_id: m.winner_contestant_id,
            decided_by_host: m.decided_by_host,
            closed_at: m.closed_at,
            tally: countsByMatch[m.id] || [],
        })),
    }

    // result_type mirrors the debate's win_type — this is the room's verdict in
    // a general_vote debate and the crowd half of a hybrid one.
    const debate = await _loadDebate({ debate_id }, db)

    // ON CONFLICT rather than announce-once: the host breaking a tie on the
    // final runs through here a second time, and a result row that disagreed
    // with the bracket would be worse than one that moved. locked_at and
    // announced_at keep their ORIGINAL values — the announcement happened when
    // it happened; the correction is inside final_calculation.
    const { rows } = await db.query(
        `INSERT INTO debate_results
            (debate_id, winner_contestant_id, result_type,
             crowd_score_data, final_calculation,
             locked_at, announced_at, dispute_window_ends_at, notes)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW() + INTERVAL '7 days', $6)
         ON CONFLICT (debate_id) DO UPDATE
            SET winner_contestant_id = EXCLUDED.winner_contestant_id,
                crowd_score_data     = EXCLUDED.crowd_score_data,
                final_calculation    = EXCLUDED.final_calculation,
                notes                = EXCLUDED.notes
         RETURNING *`,
        [
            debate_id,
            match.winner_contestant_id,
            CROWD_WIN_TYPES.includes(debate.win_type) ? debate.win_type : "general_vote",
            JSON.stringify({ per_match: countsByMatch }),
            JSON.stringify(final_calculation),
            "Winner of the head-to-head bracket.",
        ]
    )

    // The two people who reached the final. Everyone else keeps 'active': they
    // were knocked out, and 'eliminated' is not a status this schema has —
    // inventing one here would break the check constraint.
    await db.query(
        `UPDATE contestants SET status = 'winner'
         WHERE id = $1 AND debate_id = $2 AND status <> 'disqualified'`,
        [match.winner_contestant_id, debate_id]
    )
    await db.query(
        `UPDATE contestants SET status = 'runner_up'
         WHERE id = $1 AND debate_id = $2 AND status NOT IN ('disqualified', 'winner')`,
        [runnerUp, debate_id]
    )

    // ONE STANDING ARROW FOR WINNING, streamed or written — this is the same
    // call either way, because winning a bracket is the same achievement
    // whichever way the arguments were made.
    //
    // Idempotent (a unique index on user + debate + kind), so a re-crown or a
    // corrected result cannot mint a second one. Best-effort: a trophy failing
    // to write must not roll back the result it is celebrating.
    try {
        const { awardDebateWin } = require("./trophies")
        await awardDebateWin({ debate_id, winner_contestant_id: match.winner_contestant_id }, db)
    } catch (err) {
        console.error("[crown] could not award the winner's arrow", err)
    }

    // The tournament is over, so the debate is. Guarded on the live statuses so
    // this can never resurrect a cancelled debate.
    await db.query(
        `UPDATE debates
         SET status = 'closed',
             results_announce_at = COALESCE(results_announce_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND status IN ('live', 'no_posting')`,
        [debate_id]
    )

    return rows[0]
}

// closeMatchVoting — take the screen down and decide the match.
//
// The count decides it. A tie does NOT auto-resolve: the match closes with no
// winner and the host is told to break it, because picking one at random (or by
// row order) would eliminate someone on a coin toss the room never saw.
const closeMatchVoting = async ({ match_id, host_user_id, winner_contestant_id = null }, db = client) => {
    const existing = await getMatchById({ match_id }, db)
    if (!existing) throw httpError(404, "match not found")
    await assertHostCanRunVotes({ debate_id: existing.debate_id, user_id: host_user_id }, db)
    if (existing.voting_state === "closed") {
        throw httpError(409, "this match is already closed")
    }

    const seats = [existing.contestant_a_id, existing.contestant_b_id]
    if (winner_contestant_id && !seats.includes(winner_contestant_id)) {
        throw httpError(400, "the winner must be one of the two contestants in this match")
    }

    const { rows: counts } = await db.query(
        `SELECT contestant_id, COALESCE(SUM(weight), 0)::float AS weighted_votes
         FROM debate_match_votes
         WHERE match_id = $1 AND invalidated_at IS NULL AND contestant_id IS NOT NULL
         GROUP BY contestant_id
         ORDER BY weighted_votes DESC`,
        [match_id]
    )

    let winner = winner_contestant_id
    let decided_by_host = !!winner_contestant_id
    let tie = false

    if (!winner) {
        if (!counts.length) {
            // Nobody voted. Closing with no winner is honest; the host can
            // re-decide by passing a winner explicitly.
            tie = true
        } else if (counts.length === 1) {
            winner = counts[0].contestant_id
        } else if (counts[0].weighted_votes > counts[1].weighted_votes) {
            winner = counts[0].contestant_id
        } else {
            tie = true
        }
    }

    await db.query(
        `UPDATE debate_matches
         SET voting_state = 'closed',
             closed_at = NOW(),
             winner_contestant_id = $2,
             decided_by_host = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [match_id, winner, decided_by_host]
    )

    // Re-read rather than shaping the UPDATE's RETURNING: that row has no
    // identity columns on it, so _shape would hand back two nameless seats.
    const match = await getMatchById({ match_id }, db)
    // Winning the final wins the debate. Same transaction as the close, so the
    // match and the result it produced can never disagree.
    const result = await crownBracketChampion({ match, db })
    return { match, tie, winner_contestant_id: winner, result }
}

// setMatchWinner — break a tie (or correct a mistake) on a match that is already
// closed. Host-only, and recorded as decided_by_host so the bracket can say the
// call came from the host rather than the count.
//
// ONE-WAY: once the final is settled the debate closes, and assertHostCanRunVotes
// refuses a closed debate. Correcting an announced champion is deliberately not a
// button — that goes through the dispute/void path in debateResults.js.
const setMatchWinner = async ({ match_id, host_user_id, winner_contestant_id }, db = client) => {
    const existing = await getMatchById({ match_id }, db)
    if (!existing) throw httpError(404, "match not found")
    await assertHostCanRunVotes({ debate_id: existing.debate_id, user_id: host_user_id }, db)
    if (!winner_contestant_id) throw httpError(400, "winner_contestant_id is required")
    if (![existing.contestant_a_id, existing.contestant_b_id].includes(winner_contestant_id)) {
        throw httpError(400, "the winner must be one of the two contestants in this match")
    }
    await db.query(
        `UPDATE debate_matches
         SET winner_contestant_id = $2,
             decided_by_host = true,
             voting_state = 'closed',
             closed_at = COALESCE(closed_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [match_id, winner_contestant_id]
    )
    const match = await getMatchById({ match_id }, db)
    const result = await crownBracketChampion({ match, db })
    return { match, result }
}

// ---------------------------------------------------------------------------
// the ballot
// ---------------------------------------------------------------------------

// _impliedWinner — who the numbers picked.
//
// Weighted by each criterion's published weight, so a rubric that says clarity
// is worth 30% actually means it. Equal totals return null: a draw is a real
// ballot, not a missing one.
const _impliedWinner = (scores, criteriaById, seats) => {
    const totals = { [seats[0]]: 0, [seats[1]]: 0 }
    for (const s of scores) {
        const weight = Number(criteriaById.get(s.criterion_id)?.weight ?? 0)
        totals[s.contestant_id] += weight * s.score
    }
    if (totals[seats[0]] === totals[seats[1]]) return { winner: null, totals }
    return {
        winner: totals[seats[0]] > totals[seats[1]] ? seats[0] : seats[1],
        totals,
    }
}

// castMatchVote — one ballot: a 1–5 on every criterion for BOTH contestants,
// plus an optional line of writing.
//
// FULL COVERAGE IS REQUIRED. A partial ballot ("I only scored my guy on the one
// criterion he's good at") is not comparable to a complete one, and averaging
// the two together would quietly weight it more per criterion scored. Say so at
// submit time instead.
//
// The vote and its scores are written on the CALLER'S transaction so they cannot
// half-commit — a vote row with no scores behind it would be a pick with no
// stated reason, which is the one thing this ballot is meant to prevent.
const castMatchVote = async ({
    match_id,
    voter_user_id,
    scores,
    // TYPED DEBATES ONLY: the winner the voter picked. A written debate is voted
    // the other way round from a live one — you decide who won, then say why on
    // the rubric — so the pick is the input and the scores explain it, rather
    // than the scores being the input and the pick a derivation.
    winner_contestant_id = null,
    comment = null,
    rules_version_seen = null,
    voter_ip = null,
    voter_device_fingerprint = null,
}, db = client) => {
    if (!voter_user_id) throw httpError(400, "must be signed in to vote")
    const match = await getMatchById({ match_id }, db)
    if (!match) throw httpError(404, "match not found")
    if (match.voting_state !== "open") {
        throw httpError(409, "voting on this match is closed")
    }

    const debate = await _loadDebate({ debate_id: match.debate_id }, db)
    if (!CROWD_WIN_TYPES.includes(debate.win_type)) {
        throw httpError(409, "this debate is not decided by a room vote")
    }
    if (!LIVE_STATUSES.includes(debate.status)) {
        throw httpError(409, "this debate is not live")
    }

    // A contestant cannot vote in their own match. Voting in the debate at large
    // is fine — scoring the head-to-head you are standing in is not.
    const { rows: self } = await db.query(
        `SELECT 1 FROM contestants
         WHERE id = ANY($1::uuid[]) AND user_id = $2`,
        [[match.contestant_a_id, match.contestant_b_id], voter_user_id]
    )
    if (self.length) throw httpError(403, "you cannot vote on your own match")

    const seats = [match.contestant_a_id, match.contestant_b_id]
    const criteria = await getDebateCriteria({ debate_id: match.debate_id })
    if (!criteria.length) throw httpError(409, "this debate has no judging criteria to score")
    const criteriaById = new Map(criteria.map((c) => [c.criterion_id, c]))

    if (!Array.isArray(scores) || !scores.length) {
        throw httpError(400, "scores must be an array of { contestant_id, criterion_id, score }")
    }

    // WHICH BALLOT IS THIS. The format decides, not the request — a client
    // cannot opt into the looser rule by omitting a field.
    //
    //   live   every criterion, both contestants, and the winner is DERIVED from
    //          the weighted totals. You are scoring a performance you watched.
    //   typed  you PICK the winner, score them on every criterion, and scoring
    //          the person you did not pick is optional. You have read two written
    //          answers and already know which one you thought was better; making
    //          the pick a by-product of ten sliders would be asking you to
    //          reverse-engineer your own conclusion.
    const isTyped = debate.format === "typed"
    if (isTyped) {
        // THE WINDOW, checked on the write as well as the read. The panel hides a
        // closed ballot, but a request arriving a second after it shut must be
        // refused by the server — a vote counted after the bracket has moved on
        // decides a match that is already over.
        const { rows: p } = await db.query(
            `SELECT p.response_deadline, d.vote_window_hours
             FROM prompts p JOIN debates d ON d.id = p.debate_id
             WHERE p.debate_id = $1 AND p.bracket_round = $2
               AND p.bracket_side = $3 AND p.bracket_position = $4`,
            [match.debate_id, match.round, match.side, match.position]
        )
        const closesAt = p[0]?.response_deadline
            ? new Date(p[0].response_deadline).getTime() +
              Number(p[0].vote_window_hours || 0) * 3600e3
            : null
        if (closesAt && Date.now() > closesAt) {
            throw httpError(409, "voting on this match has closed")
        }
        if (!winner_contestant_id) throw httpError(400, "pick who won this match")
        if (!seats.includes(winner_contestant_id)) {
            throw httpError(400, "the winner must be one of the two contestants in this match")
        }
    }

    const seen = new Set()
    for (const s of scores) {
        if (!s || !s.contestant_id || !s.criterion_id || s.score == null) {
            throw httpError(400, "each score needs contestant_id, criterion_id and score")
        }
        if (!seats.includes(s.contestant_id)) {
            throw httpError(400, "scores may only be given to the two contestants in this match")
        }
        if (!criteriaById.has(s.criterion_id)) {
            throw httpError(400, "a score refers to a criterion that is not part of this debate")
        }
        if (!Number.isInteger(s.score) || s.score < 1 || s.score > 5) {
            throw httpError(400, "score must be a whole number between 1 and 5")
        }
        const key = `${s.contestant_id}:${s.criterion_id}`
        if (seen.has(key)) throw httpError(400, "a criterion was scored twice for the same contestant")
        seen.add(key)
    }
    if (isTyped) {
        // The winner must be fully scored: a pick with no rubric behind it is
        // the thing this ballot exists to prevent.
        const winnerScored = criteria.filter((c) => seen.has(`${winner_contestant_id}:${c.criterion_id}`)).length
        if (winnerScored !== criteria.length) {
            throw httpError(400, "score the contestant you picked on every criterion")
        }
        // The other one is ALL OR NOTHING. A half-scored opponent is not
        // comparable to a fully scored one and would drag their average down on
        // the criteria the voter simply skipped rather than the ones they
        // thought were weak.
        const other = seats.find((id) => id !== winner_contestant_id)
        const otherScored = criteria.filter((c) => seen.has(`${other}:${c.criterion_id}`)).length
        if (otherScored !== 0 && otherScored !== criteria.length) {
            throw httpError(400, "score the other contestant on every criterion, or skip them entirely")
        }
    } else if (seen.size !== criteria.length * 2) {
        throw httpError(400, "score every criterion for both contestants before submitting")
    }

    const trimmed = comment == null ? null : String(comment).trim() || null
    if (trimmed && trimmed.length > MAX_COMMENT) {
        throw httpError(400, `your note must be ${MAX_COMMENT} characters or fewer`)
    }

    // Typed: the voter said so. Live: the numbers did.
    const derived = _impliedWinner(scores, criteriaById, seats)
    const winner = isTyped ? winner_contestant_id : derived.winner
    const totals = derived.totals

    try {
        const { rows } = await db.query(
            `INSERT INTO debate_match_votes
                (match_id, debate_id, voter_user_id, contestant_id, comment,
                 acknowledged_criteria, acknowledged_at, rules_version_seen,
                 voter_ip, voter_device_fingerprint)
             VALUES ($1,$2,$3,$4,$5,true,NOW(),$6,$7,$8)
             RETURNING *`,
            [
                match_id,
                match.debate_id,
                voter_user_id,
                winner,
                trimmed,
                rules_version_seen,
                voter_ip,
                voter_device_fingerprint,
            ]
        )
        const vote = rows[0]

        const inserted = await db.query(
            `INSERT INTO debate_match_vote_scores (vote_id, contestant_id, criterion_id, score)
             SELECT $1, c, k, v
             FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS t(c, k, v)
             RETURNING *`,
            [
                vote.vote_id,
                scores.map((s) => s.contestant_id),
                scores.map((s) => s.criterion_id),
                scores.map((s) => s.score),
            ]
        )

        return { vote, scores: inserted.rows, implied_winner: winner, totals }
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "you have already voted on this match")
        if (err.code === "23503") throw httpError(400, "a contestant or criterion in this ballot does not exist")
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed")
        console.error(err)
        throw err
    }
}

module.exports = {
    CROWD_WIN_TYPES,
    assertHostCanRunVotes,
    listDebateMatches,
    getMatchById,
    getMatchTally,
    getMyMatchVote,
    getOpenMatch,
    openMatchVoting,
    closeMatchVoting,
    setMatchWinner,
    crownBracketChampion,
    castMatchVote,
}
