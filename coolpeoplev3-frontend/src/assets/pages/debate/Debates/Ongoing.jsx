import React, { useMemo, useState } from 'react'
import './TournamentBracket.css'

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

// Slot — one capsule in the bracket. Clickable only while its match is the live
// one and both sides are filled; a decided match stays on screen as a record.
function Slot({ contestant, onVote, isWinner, isLive, isEliminated }) {
    if (!isPerson(contestant)) {
        return <div className="bracket-slot bracket-slot--empty" aria-hidden="true" />
    }
    const className = [
        'bracket-slot',
        isWinner && 'bracket-slot--winner',
        isEliminated && 'bracket-slot--out',
        isLive && 'bracket-slot--live',
    ].filter(Boolean).join(' ')

    const content = (
        <>
            {contestant.profile_photo_url
                ? <img className="bracket-avatar" src={contestant.profile_photo_url} alt="" />
                : <span className="bracket-avatar bracket-avatar--blank" aria-hidden="true" />}
            <span className="bracket-name">{displayName(contestant)}</span>
        </>
    )

    // A button only when it does something. Rendering a disabled button for every
    // decided slot would put the whole bracket in the tab order for no reason.
    return isLive
        ? <button type="button" className={className} onClick={() => onVote(contestant)}>{content}</button>
        : <div className={className}>{content}</div>
}

// Match — the pair, plus the connector elbow drawn in CSS.
function Match({ pair, roundIndex, winsOf, onVote }) {
    const [a, b] = pair
    const decided = [a, b].find((c) => isPerson(c) && winsOf(c) > roundIndex) || null
    // Live only when there are two real people and neither has advanced yet.
    const isLive = isPerson(a) && isPerson(b) && !decided

    return (
        <li className="bracket-match">
            {[a, b].map((c, i) => (
                <Slot
                    key={isPerson(c) ? c.id : `empty-${roundIndex}-${i}`}
                    contestant={c}
                    onVote={onVote}
                    isLive={isLive}
                    isWinner={!!decided && isPerson(c) && decided.id === c.id}
                    isEliminated={!!decided && isPerson(c) && decided.id !== c.id}
                />
            ))}
        </li>
    )
}

// Half — one side of the mirrored bracket. `side` is only a class: the right half
// is the same markup flipped in CSS, so there is one layout to maintain, not two.
function Half({ rounds, winsOf, onVote, side }) {
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
                            winsOf={winsOf}
                            onVote={onVote}
                        />
                    ))}
                </ul>
            ))}
        </div>
    )
}

function TournamentBracket({ contestants = [], vote }) {
    // id -> wins. The ONLY state: everything else on screen is derived from it.
    const [wins, setWins] = useState({})

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

    // Casting a vote is one increment. The bracket recomputes itself from the new
    // count, so nothing here has to know which round we're in or who moves where.
    const castVote = (contestant) => {
        setWins((prev) => ({ ...prev, [contestant.id]: (prev[contestant.id] || 0) + 1 }))
        if (vote) vote(contestant)
    }

    if (contestants.length < 2) {
        return <p className="bracket-empty">The bracket opens once at least two contestants have entered.</p>
    }

    return (
        <div className="bracket">
            <Half rounds={left.rounds} winsOf={left.winsOf} onVote={castVote} side="left" />

            <div className="bracket-final">
                <span className="bracket-final-label">Final</span>
                <ul className="bracket-round bracket-round--final">
                    <Match
                        pair={[finalistLeft, finalistRight]}
                        roundIndex={championRound - 1}
                        winsOf={winsOf}
                        onVote={castVote}
                    />
                </ul>
                <div className={`bracket-champion ${champion ? 'is-crowned' : ''}`}>
                    {champion
                        ? <>
                            {champion.profile_photo_url && (
                                <img className="bracket-avatar" src={champion.profile_photo_url} alt="" />
                            )}
                            <span className="bracket-name">{displayName(champion)}</span>
                        </>
                        : <span className="bracket-name">{finalIsLive ? 'Cast the deciding vote' : 'Winner'}</span>}
                </div>
            </div>

            <Half rounds={right.rounds} winsOf={right.winsOf} onVote={castVote} side="right" />
        </div>
    )
}

function Ongoing({ contestants, debate }) {
  return (
    <div className="ongoing">
        <div className="ongoing-stream">
            embedd livetream
        </div>
        <div className="ongoing-bracket">
            <TournamentBracket contestants={contestants} />
        </div>
    </div>
  )
}

export default Ongoing
export { TournamentBracket }
