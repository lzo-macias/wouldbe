import { useCallback, useEffect, useState } from 'react'
import api from '../../../lib/api'
import DebateHeadline from './DebateHeadline'
import DebateReplay from './DebateReplay'
import TopResponses from './TopResponses'
import Trophy from './Trophy'
import './MatchVote.css'

// ============================================================================
// Past — what a finished debate shows: who won it, how it was argued, and what
// the room talked about.
//
// This screen exists because crowning is now a REAL backend event. Winning the
// final writes debate_results (winner_contestant_id + the frozen bracket) and
// flips the debate to 'closed' — at which point AnyDebate's phase map sends the
// page here. Before, that transition replaced a live tournament with the single
// sentence "This debate has concluded", which threw away the one thing anyone
// arriving late wants to see.
//
// Two reads here, both public:
//   GET /debates/:id/result   the announced row, or null
//   GET /debates/:id/matches  every match, for the read-only board
// (DebateReplay makes a third, for the stream/VOD, and owns it.)
//
// NO BRACKET. The board is the live screen's instrument — it exists to show
// which match is up next and to put one to a vote, and neither is a question a
// finished debate has. Once the winner is on record the tree underneath is
// spent, so this screen states the outcome and gets out of the way. /matches is
// still read: it is what says a bracket ever ran at all, and it feeds the match
// count in the headline.
// ============================================================================

const displayName = (c) =>
    [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.username || 'Someone'

function Past({ debate, contestants = [], criteria = [] }) {
    const debateId = debate?.id
    const [result, setResult] = useState(null)
    const [matches, setMatches] = useState([])
    const [loaded, setLoaded] = useState(false)

    const load = useCallback(async () => {
        if (!debateId) return
        // Settled together: a result with no board behind it, or a board with no
        // result, would both render as half a page. Neither read failing is
        // fatal — the fallback line below is still a valid answer.
        const [res, mts] = await Promise.all([
            api.get(`/api/debates/${debateId}/result`).catch(() => ({ data: null })),
            api.get(`/api/debates/${debateId}/matches`).catch(() => ({ data: [] })),
        ])
        setResult(res.data || null)
        setMatches(mts.data || [])
        setLoaded(true)
    }, [debateId])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (!cancelled) await load()
        })()
        return () => { cancelled = true }
    }, [load])

    // How many ballots produced this outcome. crowd_score_data.per_match is the
    // frozen per-match count crownBracketChampion writes, so the number comes
    // out of the same row as the winner — no extra request, and it can't drift
    // from the result it is describing.
    const ballots = Object.values(result?.crowd_score_data?.per_match || {})
        .flat()
        .reduce((n, row) => n + (row.votes || 0), 0)

    const champion = contestants.find((c) => c.id === result?.winner_contestant_id) || null
    const runnerUpId = result?.final_calculation?.runner_up_contestant_id
    const runnerUp = contestants.find((c) => c.id === runnerUpId) || null

    if (!loaded) return <p className="dbt-status">Loading…</p>

    // Cancelled, or closed without ever running a bracket. Nothing to show but
    // the fact of it — which is what this line was always for.
    if (!result && !matches.length) {
        return <p className="dbt-status">This debate has concluded.</p>
    }

    return (
        <div className="past">
            {/* Which debate, whose it was, what was at stake, when it ran. A
                finished debate is mostly read by people who were not there. */}
            <DebateHeadline
                debate={debate}
                result={result}
                stats={{
                    contestants: contestants.length,
                    matches: matches.length,
                    ballots,
                    criteria: criteria.length,
                }}
            />

            <div className="ongoing">
            <div className="mv-crown">
                <span className="dbt-label mv-crown-kicker">
                    {debate?.status === 'cancelled' ? (
                        'cancelled'
                    ) : (
                        <>
                            <Trophy size={14} /> winner
                        </>
                    )}
                </span>
                {champion ? (
                    <div className="mv-crown-who">
                        {champion.profile_photo_url ? (
                            <img src={champion.profile_photo_url} alt="" />
                        ) : (
                            <span className="mv-crown-blank" aria-hidden="true">
                                {displayName(champion).charAt(0)}
                            </span>
                        )}
                        <div>
                            <h2>{displayName(champion)}</h2>
                            <p>
                                Won the bracket
                                {runnerUp ? <> — beat {displayName(runnerUp)} in the final</> : null}
                                {result?.final_calculation?.final_decided_by_host
                                    ? ", on the host's call after a tied vote"
                                    : ''}
                                .
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="mv-note">
                        The bracket didn't produce a winner. Nothing was crowned.
                    </p>
                )}
            </div>

            {/* WAS THIS TYPED OR SPOKEN — and if it was spoken, can I still
                watch it. Both are the first thing someone reading this after the
                fact wants to know, and the winner card above answers neither. */}
            <DebateReplay debate={debate} />

            {/* What the room actually engaged with. Renders nothing at all for a
                live debate or one nobody commented on — an empty "most talked
                about" says the opposite of what it means. */}
            <TopResponses debateId={debate?.id} title="Most talked about in this debate" />
            </div>
        </div>
    )
}

export default Past
