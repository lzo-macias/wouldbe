import { useCallback, useEffect, useState } from 'react'
import api from '../../../lib/api'
import MatchVoteModal from './MatchVoteModal'
import './MatchVotePanel.css'

// ============================================================================
// MatchVotePanel — the votes, between the title and the bracket.
//
// THIS IS THE ONLY PLACE A BRACKET IS PUT UP FOR VOTING in a typed debate. The
// conversations below are for reading; when you open one, its match arrives
// here. Keeping the ballot out of the reading surface is the whole point: a vote
// button inside a message thread invites a verdict from someone who has read one
// answer, and the panel sitting above the bracket is where a person looks when
// they are deciding rather than reading.
//
// IT IS ALSO THE BANNER. There used to be a separate "voting open — open the
// ballot" bar elsewhere on the page saying the same thing about the same match,
// which left a reader wondering whether they were two different votes.
//
// IT SHOWS EVERY BALLOT OPEN TO YOU, from the server — not the ones you happened
// to click. That was the earlier version and it was wrong in both directions:
// the panel held one match until you went hunting for the others, and forgot all
// of them the moment you reloaded.
//
// SIGNED IN, THIS IS PERSISTENT. Which matches you can vote on, and which you
// have already scored, are facts about the debate and your account — so they
// survive a refresh, a new tab, and coming back tomorrow. SIGNED OUT there is
// nothing to remember: the list still renders (you can see what is open and when
// it closes) and the ballot asks you to sign in, and when the session ends it is
// gone because it was never stored.
//
// EVERY CARD CARRIES ITS DEADLINE. Voting on a match closes one grace period
// after its answers were released — the room gets as long to judge it as the
// contestants got to write it — and a ballot with no closing time on it is one
// people come back to find gone.
// ============================================================================

const fullName = (c) =>
    [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.username || 'TBD'

// "closes in 4h" while it matters, a date when it is further off. A countdown to
// something three days away is noise; one to something this afternoon is the
// whole reason to press the button now.
const closesIn = (iso) => {
    if (!iso) return ''
    const ms = new Date(iso).getTime() - Date.now()
    if (ms <= 0) return 'voting closed'
    const h = Math.floor(ms / 3600000)
    if (h < 1) return `closes in ${Math.max(1, Math.round(ms / 60000))}m`
    if (h < 24) return `closes in ${h}h`
    return `closes ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }).format(new Date(iso))}`
}

// The side matters: a round has a match 1 on each half of the bracket, and
// naming both of them "Round 2 · Match 1" made two different ballots look like
// the same one listed twice.
const roundLabel = (m) =>
    m.side === 'final'
        ? 'The Final'
        : `Round ${m.round + 1} · ${m.side === 'left' ? 'Left' : 'Right'} ${m.position + 1}`

function Face({ person, size = 26 }) {
    return person?.profile_photo_url ? (
        <img className="mvp-face" style={{ width: size, height: size }} src={person.profile_photo_url} alt="" />
    ) : (
        <span className="mvp-face mvp-face--blank" style={{ width: size, height: size }} aria-hidden="true">
            {fullName(person).charAt(0)}
        </span>
    )
}

/**
 * @param {object} debate    the debate row
 * @param {array}  ballots   [{ key, match, criteria, my_vote }] — every match
 *                           opened this session, oldest first
 * @param {string} activeKey the conversation currently being read
 * @param {Function} onVoted (key) => void, so the owner can mark it voted
 */
function MatchVotePanel({ debate, activeKey = null, refreshKey = 0 }) {
    // Hoisted out of the dependency array: an optional chain in a dep list is
    // an expression the compiler cannot memoise around.
    const debateId = debate?.id
    const [ballots, setBallots] = useState([])
    const [open, setOpen] = useState(null)
    const signedIn = !!localStorage.getItem('token')

    const load = useCallback(async () => {
        if (!debateId) return
        try {
            const { data } = await api.get(`/api/debates/${debateId}/ballots`)
            setBallots(data.ballots || [])
        } catch (err) {
            console.error('[MatchVotePanel] ballots failed', err)
        }
    }, [debateId])

    // Re-read when the debate changes and whenever the page says something moved
    // (a conversation opened a match that had no vote row yet).
    useEffect(() => {
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [load, refreshKey])

    const empty = !ballots.length

    return (
        <section className="mvp">
            <div className="mvp-head">
                <div>
                    <span className="dbt-label">votes</span>
                    <p className="mvp-lede">
                        {empty
                            ? 'Nothing to vote on yet — a match opens for voting when its answers are released.'
                            : signedIn
                              ? `${ballots.filter((b) => !b.my_vote).length} of ${ballots.length} still to score.`
                              : `${ballots.length} match${ballots.length === 1 ? '' : 'es'} open — sign in to vote.`}
                    </p>
                </div>
                {!empty && signedIn && (
                    <span className="mvp-count">
                        {ballots.filter((b) => b.my_vote).length}/{ballots.length} voted
                    </span>
                )}
            </div>

            {!empty && (
                <div className="mvp-cards">
                    {ballots.map((b) => {
                        const [a, c] = b.match.contestants || []
                        return (
                            <button
                                key={b.match.id}
                                type="button"
                                className={[
                                    'mvp-card',
                                    b.my_vote && 'is-done',
                                    b.key === activeKey && 'is-reading',
                                ].filter(Boolean).join(' ')}
                                                onClick={() => {
                                    if (!signedIn) return window.location.assign('/login')
                                    setOpen(b)
                                }}
                            >
                                <span className="mvp-card-round">
                                    {b.key === activeKey && <i className="mvp-dot" aria-hidden="true" />}
                                    {roundLabel(b.match)}
                                </span>
                                <span className="mvp-card-who">
                                    <Face person={a} size={30} />
                                    <span className="mvp-vs">v</span>
                                    <Face person={c} size={30} />
                                    <span className="mvp-names">
                                        {fullName(a)} <em>v</em> {fullName(c)}
                                    </span>
                                </span>
                                {/* The card IS the banner now. It used to be a
                                    strip up here and a separate "voting open —
                                    open the ballot" bar somewhere else, which
                                    said the same thing twice about the same
                                    match and left a reader wondering whether
                                    they were two different votes. */}
                                <span className="mvp-card-foot">
                                    <span className="mvp-card-line">
                                        {b.my_vote
                                            ? 'Your ballot is in.'
                                            : 'Read them both, then say who won.'}
                                        {/* The closing time, on every card. A
                                            ballot with no deadline on it is one
                                            people come back to find gone. */}
                                        <em className="mvp-closes">{closesIn(b.closes_at)}</em>
                                    </span>
                                    {/* THE GREEN TAG, on every open ballot. Green
                                        is "live" everywhere else on this page —
                                        the pulsing dot, the open-round rail — so
                                        a match still taking votes wears it here
                                        too, signed in or not. Signed out it is
                                        still the way in; it lands on the login
                                        and the line beside it says so.

                                        Once you have voted it stops being live:
                                        the tag goes quiet and offers a way back
                                        rather than shouting for a decision you
                                        have already made. */}
                                    {/* Three states, three treatments:
                                        gold  — sign in, the app's action colour
                                                and the same button the rest of
                                                the page uses to send you there
                                        green — vote now, because green is LIVE
                                                everywhere on this page
                                        quiet — already voted, a way back rather
                                                than a shout */}
                                    <span
                                        className={`mvp-card-cta${
                                            b.my_vote ? '' : signedIn ? ' is-open' : ' is-signin'
                                        }`}
                                    >
                                        {b.my_vote ? 'Change it' : signedIn ? 'Vote now' : 'Sign in'}
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}

            {open && (
                <MatchVoteModal
                    debate={debate}
                    match={open.match}
                    criteria={open.criteria}
                    myVote={open.my_vote}
                    isHost={false}
                    onClose={() => setOpen(null)}
                    onVoted={() => {
                        // Re-read rather than patching state: the server is what
                        // makes "I voted on this" survive the next reload, so it
                        // should be what this panel believes too.
                        setOpen(null)
                        load()
                    }}
                />
            )}
        </section>
    )
}

export default MatchVotePanel
