import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../../lib/api'
import { useNavigate } from 'react-router-dom'
import DebateHeadline from './DebateHeadline'
import MatchVotePanel from './MatchVotePanel'
import MatchVoteModal from './MatchVoteModal'
import Trophy from './Trophy'
import './TournamentBracket.css'
import './MatchVote.css'

//contestants.length -1
//in order of nomination if public, if invite only, they can set bracket
//track left and right, track level,

// The field always has to be a power of two, or the pairings don't halve cleanly.
// A 12-person debate becomes a 16-slot bracket with 4 empty slots.
const nextPowerOfTwo = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, 2)))

// EMPTY is a seat that will NEVER be filled — padding, because the field wasn't a
// power of two. It is deliberately NOT null.
//
// null already means something else: "this match hasn't been decided yet". Using
// one value for both is a real bug — an undecided slot then looks like a bye, and
// whoever is opposite it gets promoted for free. In a 3-person half that put the
// bye contestant in the final before the other two had played.
const EMPTY = Symbol('empty seat')
const isPerson = (slot) => !!slot && slot !== EMPTY

// padToBracket — seat everyone in order, then pad the rest with EMPTY. Whoever
// faces an EMPTY seat walks into the next round on a bye.
const padToBracket = (contestants) => {
    const size = nextPowerOfTwo(contestants.length)
    const slots = new Array(size).fill(EMPTY)
    contestants.forEach((c, i) => { slots[i] = c })
    return slots
}

// buildRounds — the whole half-bracket, derived from nothing but the win counts.
//
// There is no per-match state anywhere: round r holds whoever has r wins, and a
// contestant's position is fixed by where they were seeded. That's what makes this
// safe to re-render from a server payload — the bracket is a pure function of
// (seeds, wins), so a refresh can never desync it from a local click history.
//
// A BYE counts as a win, tracked separately in `bonus` so it isn't confused with a
// vote. Without it, someone who walked through round 1 would need a win they never
// had a chance to earn, and would sit stuck in round 2 forever.
const buildRounds = (seedSlots, wins) => {
    const bonus = {}
    const winsOf = (c) => (wins[c.id] || 0) + (bonus[c.id] || 0)
    const rounds = [seedSlots]

    for (let r = 1; rounds[r - 1].length > 1; r++) {
        const prev = rounds[r - 1]
        const next = []
        for (let i = 0; i < prev.length; i += 2) {
            const a = prev[i]
            const b = prev[i + 1]
            // Both seats dead: nothing can ever come out of this corner.
            if (a === EMPTY && b === EMPTY) next.push(EMPTY)
            // A real player against a seat that will never fill: a genuine bye.
            else if (isPerson(a) && b === EMPTY) { bonus[a.id] = (bonus[a.id] || 0) + 1; next.push(a) }
            else if (a === EMPTY && isPerson(b)) { bonus[b.id] = (bonus[b.id] || 0) + 1; next.push(b) }
            // One side is still being decided upstream — NOT a bye. Waiting.
            else if (!isPerson(a) || !isPerson(b)) next.push(null)
            // A real match: whoever has cleared this round stands here.
            else next.push(winsOf(a) >= r ? a : winsOf(b) >= r ? b : null)
        }
        rounds.push(next)
    }
    return { rounds, winsOf }
}

const displayName = (c) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || 'TBD'

// slotKey — the coordinate a bracket position and a debate_matches row agree on.
//
// The server keys matches on GEOMETRY (side, round, position) rather than on the
// pair of people in them, because the layout is computed here from the seeding
// and geometry is the only thing both ends can name the same way. Get this key
// wrong and a decided match reappears as undecided, so it is one function.
const slotKey = (side, round, position) => `${side}:${round}:${position}`

// Slot — one capsule in the bracket. Never a button any more: voting happens on
// the ballot the host puts up, not by clicking a face, and a clickable face
// alongside a real ballot is two contradictory ways to decide the same match.
function Slot({ contestant, isWinner, isLive, isEliminated, onOpen }) {
    if (!isPerson(contestant)) {
        return <div className="bracket-slot bracket-slot--empty" aria-hidden="true" />
    }
    const className = [
        'bracket-slot',
        isWinner && 'bracket-slot--winner',
        isEliminated && 'bracket-slot--out',
        isLive && 'bracket-slot--live',
        onOpen && 'bracket-slot--linked',
    ].filter(Boolean).join(' ')

    // A button only when there is somewhere to go. In a TYPED debate every match
    // has a page — the prompt, both answers, the thread — so the whole capsule
    // is the way in; in a live one there is nothing behind it and a clickable
    // face would be a dead end.
    if (onOpen) {
        return (
            <button type="button" className={className} onClick={onOpen}>
                {contestant.profile_photo_url
                    ? <img className="bracket-avatar" src={contestant.profile_photo_url} alt="" />
                    : <span className="bracket-avatar bracket-avatar--blank" aria-hidden="true" />}
                <span className="bracket-name">{displayName(contestant)}</span>
            </button>
        )
    }

    return (
        <div className={className}>
            {contestant.profile_photo_url
                ? <img className="bracket-avatar" src={contestant.profile_photo_url} alt="" />
                : <span className="bracket-avatar bracket-avatar--blank" aria-hidden="true" />}
            <span className="bracket-name">{displayName(contestant)}</span>
        </div>
    )
}

// Match — the pair, the connector elbow drawn in CSS, and (when there is one to
// show) the one action this match currently offers.
//
// THREE STATES, and they are not interchangeable:
//   a vote is open here          -> everyone gets "Vote now"
//   live, host, nothing open yet -> the host gets "Put it to a vote"
//   anything else                -> no button; there is nothing to press
// ROUND_MARK — the badge on the wire of a match that has not been played.
//
// A different mark per round, because "these two haven't faced off yet" means
// something different in an opening round than in the final, and a bracket of
// identical grey pills tells you only that nothing has happened anywhere. The
// depth is counted FROM THE END: round 1 of a 4-field is a semifinal and should
// say so, while round 1 of a 32-field is an opener.
const roundMark = (roundIndex, side, totalSideRounds) => {
    if (side === 'final') return { label: 'Final', cls: 'final' }
    const fromEnd = totalSideRounds - roundIndex
    if (fromEnd === 1) return { label: 'Semi', cls: 'semi' }
    if (fromEnd === 2) return { label: 'Quarter', cls: 'quarter' }
    return { label: `R${roundIndex + 1}`, cls: 'early' }
}

function Match({ pair, roundIndex, side, position, winsOf, serverMatch, isHost, canRunVotes, onOpenVote, onShowBallot, onOpenMatch, sideRounds, isTyped = false }) {
    const [a, b] = pair
    const decided = [a, b].find((c) => isPerson(c) && winsOf(c) > roundIndex) || null
    // Live only when there are two real people and neither has advanced yet.
    const isLive = isPerson(a) && isPerson(b) && !decided
    const voteOpen = serverMatch?.voting_state === 'open'
    // Both seats filled and nobody through yet — the match that is next to
    // happen, which is the one the wire should shout about.
    const pending = isPerson(a) && isPerson(b) && !decided
    const mark = roundMark(roundIndex, side, sideRounds)
    const open = onOpenMatch ? () => onOpenMatch({ side, round: roundIndex, position }) : null
    // A SEAT THAT CHANGED HANDS. Somebody who was not in this debate answered
    // its prompt, out-liked one of the two contestants, and took their place.
    // The bracket has to show it: a seat that appears from nowhere between two
    // rounds is otherwise indistinguishable from a bug, and the whole mechanic
    // is only meaningful if the room can see it happen.
    const backdoor = !!serverMatch?.backdoor_at

    return (
        <li
            className={`bracket-match${pending ? ' is-pending' : ''}${
                open ? ' is-linked' : ''
            }${backdoor ? ' is-backdoor' : ''} bracket-match--${mark.cls}`}
        >
            {backdoor && (
                <span className="bracket-backdoor" title="An outside answer out-liked a contestant and took their seat">
                    backdoor
                </span>
            )}
            {/* The wire's badge. It sits ON the connector and is a click target
                in its own right: the ask was that clicking the wire between two
                contestants takes you to their match, not only the capsules. */}
            {pending && (
                open ? (
                    <button type="button" className="bracket-mark" onClick={open}>
                        {mark.label}
                    </button>
                ) : (
                    <span className="bracket-mark" aria-hidden="true">{mark.label}</span>
                )
            )}
            {[a, b].map((c, i) => (
                <Slot
                    key={isPerson(c) ? c.id : `empty-${roundIndex}-${i}`}
                    contestant={c}
                    isLive={isLive || voteOpen}
                    isWinner={!!decided && isPerson(c) && decided.id === c.id}
                    isEliminated={!!decided && isPerson(c) && decided.id !== c.id}
                    onOpen={open}
                />
            ))}

            {/* VOTE NOW belongs to the LIVE bracket only. There the host puts one
                match to the room and the bracket is where the room is looking.
                In a typed debate every released match is votable at once, so this
                put a green button under half the board and competed with the vote
                panel above it for the same click. There, the panel is the only
                way in and this capsule opens the conversation instead. */}
            {voteOpen && !isTyped && (
                <button
                    type="button"
                    className="mv-matchbtn mv-matchbtn--open"
                    onClick={() => onShowBallot(serverMatch)}
                >
                    Vote now
                </button>
            )}
            {!voteOpen && isLive && isHost && canRunVotes && (
                <button
                    type="button"
                    className="mv-matchbtn"
                    onClick={() =>
                        onOpenVote({
                            round: roundIndex,
                            side,
                            position,
                            contestant_a_id: a.id,
                            contestant_b_id: b.id,
                        })
                    }
                >
                    Put it to a vote
                </button>
            )}
        </li>
    )
}

// Half — one side of the mirrored bracket. `side` is only a class: the right half
// is the same markup flipped in CSS, so there is one layout to maintain, not two.
function Half({ rounds, winsOf, side, matchBySlot, isHost, canRunVotes, onOpenVote, onShowBallot, onOpenMatch, sideRounds, isTyped }) {
    // The final is drawn in the middle by the parent, so the last entry (the lone
    // finalist) is not rendered as a column here.
    const columns = rounds.slice(0, -1)
    return (
        <div className={`bracket-half bracket-half--${side}`}>
            {columns.map((slots, roundIndex) => (
                <ul className="bracket-round" key={roundIndex}>
                    {Array.from({ length: slots.length / 2 }, (_, i) => (
                        <Match
                            key={i}
                            pair={[slots[i * 2], slots[i * 2 + 1]]}
                            roundIndex={roundIndex}
                            side={side}
                            position={i}
                            winsOf={winsOf}
                            serverMatch={matchBySlot[slotKey(side, roundIndex, i)]}
                            isHost={isHost}
                            canRunVotes={canRunVotes}
                            onOpenVote={onOpenVote}
                            onShowBallot={onShowBallot}
                            onOpenMatch={onOpenMatch}
                            sideRounds={sideRounds}
                            isTyped={isTyped}
                        />
                    ))}
                </ul>
            ))}
        </div>
    )
}

/**
 * TournamentBracket — the board.
 *
 * `wins` NOW COMES FROM THE SERVER (one per closed match a contestant won) and
 * is no longer local state. That is the whole point of persisting matches: a
 * refresh, a second viewer and the host's own screen all show the same board,
 * where before each browser kept its own click history and they diverged the
 * moment anyone reloaded.
 */
function TournamentBracket({
    contestants = [],
    wins = {},
    matchBySlot = {},
    isHost = false,
    canRunVotes = false,
    onOpenVote = () => {},
    onShowBallot = () => {},
    // Only a TYPED debate has somewhere for a match to lead — the prompt, both
    // answers, the thread. Left undefined for a live one, which is what turns
    // the capsules back into plain divs.
    onOpenMatch = null,
    // 'typed' | 'live'. Decides whether the bracket carries a vote button at all.
    debateFormat = 'live',
}) {
    const { left, right, championRound } = useMemo(() => {
        const slots = padToBracket(contestants)
        const half = slots.length / 2
        const leftHalf = buildRounds(slots.slice(0, half), wins)
        // Rounds counted from the half: 16 seeds -> 8 a side -> 3 rounds to
        // produce a finalist, and a 4th win takes the whole thing.
        return {
            left: leftHalf,
            right: buildRounds(slots.slice(half), wins),
            championRound: leftHalf.rounds.length,
        }
    }, [contestants, wins])

    const finalistLeft = left.rounds[left.rounds.length - 1][0]
    const finalistRight = right.rounds[right.rounds.length - 1][0]
    const winsOf = (c) => Math.max(left.winsOf(c), right.winsOf(c))
    const champion = [finalistLeft, finalistRight].find((c) => isPerson(c) && winsOf(c) >= championRound) || null
    const finalIsLive = isPerson(finalistLeft) && isPerson(finalistRight) && !champion

    if (contestants.length < 2) {
        return <p className="bracket-empty">The bracket opens once at least two contestants have entered.</p>
    }

    // ROUNDS A SIDE ACTUALLY PLAYS. championRound is the number of wins it takes
    // to win the whole thing, which counts the final — so the rounds played on a
    // side is one fewer. Passing the larger number made every match name itself
    // one round too early: an 8-person semifinal came out as "Quarter".
    const sideRounds = championRound - 1
    const isTyped = debateFormat === 'typed'
    const halfProps = { matchBySlot, isHost, canRunVotes, onOpenVote, onShowBallot, onOpenMatch, sideRounds, isTyped }

    return (
        <div className="bracket">
            <Half rounds={left.rounds} winsOf={left.winsOf} side="left" {...halfProps} />

            <div className="bracket-final">
                {/* THE CROWN IS THE LABEL. Once the final is decided, the word
                    "FINAL" has nothing left to tell anyone — the column is
                    obviously the final — so the trophy takes its place and the
                    winner is the gold capsule directly under it. There is no
                    separate champion pill any more: repeating the winner's name
                    a second time below the match they just won said it twice and
                    made the column look like it had one more round to play. */}
                {champion ? (
                    <div className="bracket-crown" title={`${displayName(champion)} won`}>
                        <Trophy size={26} />
                    </div>
                ) : (
                    <span className="bracket-final-label">
                        {finalIsLive ? 'Final — live' : 'Final'}
                    </span>
                )}
                <ul
                    className={`bracket-round bracket-round--final ${
                        champion ? 'is-decided' : ''
                    }`}
                >
                    <Match
                        /* Once it is decided the winner takes the TOP seat, so
                           the crown above the column is directly over them. The
                           final has no incoming connector geometry to preserve
                           (the elbows are drawn inside the halves), so the order
                           of these two carries no other meaning — and a crown
                           sitting over the beaten finalist because they happened
                           to come from the right half would be a picture that
                           says the wrong thing. */
                        pair={
                            champion
                                ? [
                                      champion,
                                      champion === finalistLeft ? finalistRight : finalistLeft,
                                  ]
                                : [finalistLeft, finalistRight]
                        }
                        roundIndex={championRound - 1}
                        side="final"
                        position={0}
                        winsOf={winsOf}
                        serverMatch={matchBySlot[slotKey('final', championRound - 1, 0)]}
                        isHost={isHost}
                        canRunVotes={canRunVotes}
                        onOpenVote={onOpenVote}
                        onShowBallot={onShowBallot}
                        onOpenMatch={onOpenMatch}
                        sideRounds={sideRounds}
                        isTyped={isTyped}
                    />
                </ul>
            </div>

            <Half rounds={right.rounds} winsOf={right.winsOf} side="right" {...halfProps} />
        </div>
    )
}

// How often every open page asks whether a vote has gone up. Six seconds is the
// slowest interval that still feels like "it appeared" to someone watching the
// stream, and it is one small query — the answer is usually { match: null }.
const POLL_MS = 6000

/**
 * Ongoing — the live screen: the stream, the bracket, and the vote the host puts
 * up on one match at a time.
 *
 * TWO READS, deliberately separate:
 *   GET /matches       the board. Every closed match with a winner is one win,
 *                      which is what advances people. Re-read after any write.
 *   GET /matches/open  the ballot currently up, polled. Returns { match: null }
 *                      when there isn't one — that is the normal answer, not an
 *                      error, so it never blanks the screen.
 *
 * The ballot AUTO-OPENS when the host puts one up: "put the vote screen up for
 * all users" is the feature, so it cannot wait behind a button nobody knows to
 * press. Dismissing it is remembered per match (`dismissed`), so it does not
 * fight someone who closed it on purpose — the banner stays as the way back in.
 */
function Ongoing({
    contestants = [],
    debate,
    criteria = [],
    isHost = false,
    onDebateChanged,
    // The panel reads its own ballots; the page only says which conversation is
    // being read, and nudges it when opening one may have created a vote row.
    readingKey = null,
    ballotNudge = 0,
}) {
    const debateId = debate?.id
    const navigate = useNavigate()
    // A typed debate is READ, not watched: every match has a page holding its
    // prompt, both answers and the conversation. A live one has none of that
    // yet, so its bracket stays unclickable rather than leading nowhere.
    const goToMatch =
        debate?.format === 'typed'
            ? ({ side, round, position }) =>
                  navigate(`/debate/${debateId}/match/${side}:${round}:${position}`)
            : null
    const [matches, setMatches] = useState([])
    const [live, setLive] = useState(null)   // the /matches/open payload
    // Which match's ballot this browser has dismissed. ONE piece of state, not a
    // dismissed flag plus a visible flag: the ballot is visible whenever a vote
    // is open and this is not the match you closed, which is a derived fact.
    // Holding it as its own boolean lets the two disagree — a stale `visible`
    // could keep a closed vote's ballot on screen after the host took it down.
    const [dismissed, setDismissed] = useState(null)
    const [error, setError] = useState(null)

    // A room vote can only decide a match in a debate the room decides. In a
    // sponsor_decision debate a judge picks the winner, so the host gets no
    // button — collecting votes that cannot legally decide anything is worse
    // than not offering it. The API refuses too; this only hides the affordance.
    const canRunVotes = live?.can_run_votes ?? ['general_vote', 'hybrid'].includes(debate?.win_type)

    const loadMatches = useCallback(async () => {
        if (!debateId) return
        try {
            const { data } = await api.get(`/api/debates/${debateId}/matches`)
            setMatches(data)
        } catch (err) {
            console.error('[Ongoing] match list failed', err)
        }
    }, [debateId])

    const loadOpen = useCallback(async () => {
        if (!debateId) return
        try {
            const { data } = await api.get(`/api/debates/${debateId}/matches/open`)
            setLive(data)
            return data
        } catch (err) {
            console.error('[Ongoing] open match poll failed', err)
        }
    }, [debateId])

    // The board once, the open ballot on a timer. Wrapped in an async IIFE
    // rather than called bare: a setState-ing function invoked straight from an
    // effect body is what react-hooks/set-state-in-effect flags.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (cancelled) return
            await Promise.all([loadMatches(), loadOpen()])
        })()
        const t = setInterval(() => { loadOpen() }, POLL_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [loadMatches, loadOpen])

    const openMatch = live?.match || null

    // The vote screen is UP whenever the host has one open and this browser
    // hasn't dismissed that particular match — derived, not stored, so it can
    // never be left showing a ballot the host already closed.
    // A TYPED debate's matches open themselves, so `openMatch` is always
    // populated — auto-opening the live modal over the page would put a ballot
    // in front of someone who came to read. There, the vote panel is the only
    // way in.
    const showBallot =
        !!openMatch && debate?.format !== 'typed' && dismissed !== openMatch.id

    // id -> wins. ONE win per closed match won; a tie (no winner) advances
    // nobody, which is exactly what the bracket should show until the host
    // breaks it.
    const wins = useMemo(() => {
        const out = {}
        for (const m of matches) {
            if (m.voting_state === 'closed' && m.winner_contestant_id) {
                out[m.winner_contestant_id] = (out[m.winner_contestant_id] || 0) + 1
            }
        }
        return out
    }, [matches])

    const matchBySlot = useMemo(() => {
        const out = {}
        for (const m of matches) out[slotKey(m.side, m.round, m.position)] = m
        // The open one comes from the poll, which is fresher than the list.
        if (openMatch) out[slotKey(openMatch.side, openMatch.round, openMatch.position)] = openMatch
        return out
    }, [matches, openMatch])

    // HOST: put the screen up on one match.
    const openVote = async (slot) => {
        setError(null)
        try {
            await api.post(`/api/debates/${debateId}/matches/open`, slot)
            setDismissed(null)
            await Promise.all([loadMatches(), loadOpen()])
        } catch (err) {
            setError(err.response?.data?.error || 'Could not put that match to a vote.')
        }
    }

    // The LIVE host-opened ballot landed: re-read so it flips to "your ballot is
    // in". Distinct from the typed panel's onVoted prop, which marks one of the
    // accumulated ballots voted without a round trip.
    const onLiveVoted = async () => {
        await loadOpen()
    }

    // A close returns { match, tie, result }. `result` is only present when the
    // match that closed was the FINAL — the debate has a champion, is now
    // 'closed' server-side, and this page belongs on the concluded screen. The
    // parent re-read is what moves it there.
    const onCloseVoting = async (data) => {
        await Promise.all([loadMatches(), loadOpen()])
        if (data?.result) onDebateChanged?.()
    }

    const contestantCount = contestants.length
    // A FOR-FUN DEBATE IS ONE QUESTION. There is no bracket to draw, no match to
    // put to a vote, and nobody advancing — everyone answers the same prompt and
    // likes decide it. Rendering an eight-slot tree with four names in it and a
    // "nothing to vote on yet" panel describes a tournament that will never
    // happen.
    const isForFun = !!debate?.is_for_fun

    return (
        <div className="ongoing">
            {/* WHICH DEBATE AM I WATCHING. The live screen used to open straight
                onto a stream and a bracket with the title, the prize, the host
                and the date nowhere on it — every one of those lives on screen
                1, which you have already left by the time this renders. */}
            <DebateHeadline
                debate={debate}
                stats={{
                    contestants: contestants.length,
                    matches: matches.length,
                    criteria: criteria.length,
                }}
            />

            {/* THE VOTES, between the title and the bracket. Only a typed
                debate has them here: a live one's ballot is put up by the host,
                one at a time, on the bracket itself. */}
            {debate?.format === 'typed' && !isForFun && (
                <MatchVotePanel
                    debate={debate}
                    activeKey={readingKey}
                    refreshKey={ballotNudge}
                />
            )}

            {/* A typed debate has nothing to embed, and no rail either: which
                round is open, when it closes and how many answers are in is one
                row per match in the conversation sidebar below. A second copy of
                it up here was the same information in a worse place. */}
            {debate?.format !== 'typed' && (
                <div className="ongoing-stream">
                    embedd livetream
                </div>
            )}

            {/* The banner is the persistent way back to a ballot someone
                dismissed, and the host's status line the rest of the time. */}
            {openMatch && debate?.format !== 'typed' ? (
                <div className="mv-banner mv-banner--live">
                    <div>
                        <span className="dbt-label mv-live">voting open</span>
                        <p>
                            {openMatch.contestants
                                .map((c) => c.first_name || c.username)
                                .join(' vs ')}
                            {' — '}
                            {live?.my_vote
                                ? 'your ballot is in.'
                                : 'score them both and say who won.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="dbt-btn dbt-btn--gold"
                        onClick={() => setDismissed(null)}
                    >
                        {live?.my_vote ? 'See my ballot' : 'Open the ballot'}
                    </button>
                </div>
            ) : isHost && canRunVotes && debate?.format !== 'typed' && contestantCount >= 2 ? (
                <div className="mv-banner">
                    <div>
                        <span className="dbt-label">host</span>
                        <p>
                            Pick a live match in the bracket and put it to a vote — the room
                            scores both contestants and the winner advances.
                        </p>
                    </div>
                </div>
            ) : null}

            {error && <p className="dbt-error mv-banner" role="alert">{error}</p>}

            {!isForFun && (
            <div className="ongoing-bracket">
                <TournamentBracket
                    contestants={contestants}
                    wins={wins}
                    matchBySlot={matchBySlot}
                    isHost={isHost}
                    canRunVotes={canRunVotes}
                    onOpenVote={openVote}
                    onShowBallot={() => setDismissed(null)}
                    onOpenMatch={goToMatch}
                    debateFormat={debate?.format}
                />
            </div>
            )}

            {showBallot && openMatch && (
                <MatchVoteModal
                    debate={debate}
                    match={openMatch}
                    criteria={live?.criteria || []}
                    myVote={live?.my_vote || null}
                    tally={live?.tally || null}
                    isHost={!!live?.is_host || isHost}
                    onClose={() => setDismissed(openMatch.id)}
                    onVoted={onLiveVoted}
                    onCloseVoting={onCloseVoting}
                />
            )}
        </div>
    )
}

export default Ongoing
export { TournamentBracket }
