import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import api from '../../../lib/api'
import Header from '../../../component/header/Header'
import NominateCard from './NominateCard'
import CriteriaAndPromptsCard from './CriteriaAndPromptsCard'
import Nominated from './Nominated'
import { votingStarted } from './boardSignals'
import MatchConversations from './MatchConversations'
import Ongoing from './Ongoing'
import Past from './Past'
import NominateModal from './NominateModal'
import JoinDebateModal from './JoinDebateModal'
import './DebateCards.css'

// ============================================================================
// AnyDebate — one debate's detail page, in three phases:
//   "1" before it starts, "2" while it's live, "3" once it's over.
//
// Everything on screen comes from a single read, GET /api/debates/:id/full,
// which returns { debate, is_sponsor, contestants, nominations, rules,
// criteria, ... }. Auth is optional there: a token only widens the response.
// ============================================================================

// Popups are declared at module scope. Defined inside AnyDebate they'd be a new
// component type on every render, so React would unmount and remount them —
// and, as written before, they returned nothing at all (a bare JSX expression
// statement is discarded), so neither ever appeared.
function SignUpPopUp({ message, onClose }) {
    return (
        <div className="dbt-scrim" onClick={onClose}>
            {/* The scrim closes on click; the panel stops the bubble so clicking
                inside the dialog doesn't dismiss it. */}
            <div className="dbt-popup" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="dbt-popup-close" onClick={onClose}>
                    x
                </button>
                <p>to {message} you must have a wouldbe account</p>
                <div className="dbt-popup-actions">
                    <a href="/signup">Sign up</a>
                    <a href="/login">Log in</a>
                </div>
            </div>
        </div>
    )
}

// NominationBanner — what a `?invite=<token>` link resolves to on this page.
//
// The token arrives in a text message or an email and is the ONLY thing that
// ties a stranger opening this URL back to the invite row. It is resolved
// server-side (GET /api/nomination-invites/:token) because the address it was
// sent to must never reach the browser in full: this URL is forwardable, and a
// page that rendered a real email address would be a harvesting endpoint for
// whoever ends up with the link. What comes back is masked — `l\u2022\u2022\u2022\u2022@gmail.com` —
// which is enough for the real nominee to recognise themselves and useless to
// anyone else.
//
// Four states, because a dead link should say WHY rather than silently render
// nothing — someone who was texted this deserves better than a blank page.
function NominationBanner({ invite, signedIn }) {
    if (!invite) return null

    if (invite.status === 'expired' || invite.status === 'revoked') {
        return (
            <div className="dbt-invite dbt-invite--dead">
                <p className="dbt-invite-lede">
                    This nomination link has expired. The debate is still below — anyone
                    can nominate you again.
                </p>
            </div>
        )
    }

    // Already converted into a real nomination: there is nothing left to claim,
    // and telling them to "claim" it would send them to a signup they don't need.
    if (invite.claimed || invite.status === 'nominated') {
        return (
            <div className="dbt-invite">
                <p className="dbt-invite-kicker">You were nominated</p>
                <p className="dbt-invite-lede">
                    <strong>{invite.nominated_by}</strong> nominated you for this debate,
                    and it's already on your account.
                </p>
            </div>
        )
    }

    return (
        <div className="dbt-invite">
            <p className="dbt-invite-kicker">You were nominated</p>
            <p className="dbt-invite-lede">
                <strong>{invite.nominated_by}</strong> nominated you for{' '}
                <strong>{invite.debate_title}</strong>. A nomination lets you enter free.
            </p>
            <p className="dbt-invite-detail">
                {signedIn ? (
                    <>
                        It's being held for <strong>{invite.email_masked}</strong>. If that
                        isn't the address on this account, sign up with it and the
                        nomination transfers.
                    </>
                ) : (
                    <>
                        It's being held for <strong>{invite.email_masked}</strong>. Create
                        an account with that address and it becomes a real nomination.
                    </>
                )}
            </p>
            {!signedIn && (
                <div className="dbt-popup-actions">
                    <a href="/signup">Sign up to claim it</a>
                    <a href="/login">Log in</a>
                </div>
            )}
        </div>
    )
}

// Two different refusals, and they are not interchangeable:
//
//   'closed'        — the debate itself is invitation-only. Nothing the viewer
//                     can do about it; createContestant would 403 either way.
//   'not-nominated' — entry is open, but nobody has put THIS person forward yet.
//                     That one is actionable, so it says what has to happen.
//
// A nomination cannot come from yourself: the API rejects self-nomination, which
// is why the wording is "someone else" rather than "you must be nominated".
function MustBeNominatedPopUp({ reason, onClose }) {
    return (
        <div className="dbt-scrim" onClick={onClose}>
            <div className="dbt-popup" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="dbt-popup-close" onClick={onClose}>
                    x
                </button>
                {reason === 'closed' ? (
                    <p>
                        You must be nominated by another person to compete; pay-to-enter
                        is not active for this debate
                    </p>
                ) : (
                    <p>
                        Someone else has to nominate you before you can take part in this
                        debate. Share it with anyone who'd put you forward — a nomination
                        from another person is what opens entry.
                    </p>
                )}
            </div>
        </div>
    )
}

// phaseOf — which screen to show.
//
// STATUS WINS, and status alone is total: the debates_status check constraint
// allows exactly six values, and every one of them maps to a phase. The clock is
// only a fallback for a value the constraint doesn't know about.
//
// Deferring to the clock was wrong and is why this page showed the wrong screen
// for every debate in the database: a debate whose scheduled start has passed
// but which nobody has flipped to 'live' is still open_entry — entry is open,
// the stream never started. Reading that as "live" put an empty tournament
// bracket where the entry card belongs, so the two pre-debate cards could never
// render. A stale schedule is a scheduling problem, not a lifecycle transition.
const PHASE_BY_STATUS = {
    draft: '1',       // sponsor's own unpublished draft — only they can see it
    open_entry: '1',  // pre-debate: criteria, prompts, nominate, join
    live: '2',        // the stream + the bracket
    no_posting: '2',  // still live, posting frozen
    closed: '3',
    cancelled: '3',
}

const phaseOf = (debate) => {
    if (!debate) return null
    const byStatus = PHASE_BY_STATUS[debate.status]
    if (byStatus) return byStatus

    // Unknown status — fall back to the schedule rather than rendering nothing.
    const startsAt = debate.start_at || debate.start_date
    if (!startsAt) return '1'
    const start = new Date(startsAt).getTime()
    if (Number.isNaN(start)) return '1'
    return Date.now() >= start ? '2' : '1'
}

// Page chrome, applied once. Without this the loading and error states rendered
// a bare sentence on a white page with no header — the app appeared to vanish
// for as long as the fetch took.
function Shell({ children }) {
    return (
        <div className="dbt-page">
            <Header />
            {children}
        </div>
    )
}

function AnyDebate() {
    const { debateId } = useParams()
    const [searchParams] = useSearchParams()
    // The `?invite=` token from a nomination link. Read once per URL — it is a
    // credential, so it is never put in state, logged, or sent anywhere except
    // the one lookup below.
    const inviteToken = searchParams.get('invite')
    const [invite, setInvite] = useState(null)
    const [showSignUpPop, setShowSignUpPop] = useState(false)
    // null | 'closed' | 'not-nominated' — which refusal to show, not a boolean,
    // because the two say different things and only one of them is actionable.
    const [mustBeNominated, setMustBeNominated] = useState(null)
    // Which action dialog is open: null | 'nominate' | 'join'. One field rather
    // than a boolean each, because the two are mutually exclusive and a pair of
    // booleans can represent a state ("both open") the page has no layout for.
    const [openFlow, setOpenFlow] = useState(null)
    const [message, setMessage] = useState('')
    const [payload, setPayload] = useState(null)
    const [error, setError] = useState(null)
    // Which half of the board is showing. Responses is the default because in a
    // typed debate it IS the debate; nominations is the standings beside it.
    const [boardTab, setBoardTab] = useState('responses')
    // Which conversation is being read, so the vote panel can mark the matching
    // ballot.
    //
    // THE BALLOTS ARE NOT HELD HERE any more. Which matches are open to you is a
    // fact about the debate and your account, so the panel reads them from the
    // server: signed in, the same set survives a reload and a new tab, with the
    // ones you have already scored marked. Accumulating them from clicks — the
    // earlier version — showed one ballot until you went hunting for the rest and
    // forgot every one of them on refresh.
    //
    // `ballotNudge` only says "something moved": opening a conversation can
    // create a vote row that did not exist a second ago.
    const [readingKey, setReadingKey] = useState(null)
    const [ballotNudge, setBallotNudge] = useState(0)
    const onConversationOpened = useCallback((key) => {
        setReadingKey(key)
        setBallotNudge((n) => n + 1)
    }, [])

    // The whole page is one read, so "something changed" is just that read
    // again. Hoisted out of the effect (and memoised on debateId) so the modals
    // can call it after a nomination or an entry lands.
    const loadData = useCallback(async () => {
        try {
            setError(null)
            const { data } = await api.get(`/api/debates/${debateId}/full`)
            return data
        } catch (err) {
            console.error(err)
            throw err
        }
    }, [debateId])


    // Resolve the nomination link, if this is one. Separate from the page read
    // on purpose: a bad or expired token must not stop the debate rendering —
    // the page is still perfectly useful to someone holding a dead link.
    //
    // The TOKEN IS STORED WITH ITS RESULT rather than cleared on the way in.
    // Clearing would mean a setState in the effect body on every render with no
    // token, and `activeInvite` below already discards a result whose token is
    // no longer the one in the URL — which is the case that actually matters.
    useEffect(() => {
        if (!inviteToken) return
        let cancelled = false
        ;(async () => {
            try {
                const { data } = await api.get(`/api/nomination-invites/${inviteToken}`)
                if (!cancelled) setInvite({ token: inviteToken, data })
            } catch (err) {
                // 404 is the expected answer for a forged or deleted token, and
                // the route answers unknown ones the same way so it cannot be
                // used to probe. Nothing to show; the debate renders regardless.
                if (err.response?.status !== 404) {
                    console.error('[AnyDebate] invite lookup failed', err)
                }
                if (!cancelled) setInvite({ token: inviteToken, data: null })
            }
        })()
        return () => { cancelled = true }
    }, [inviteToken])

    // refresh — a re-read triggered by a write, NOT by navigation. It must not
    // blank the page: `payload` stays put until the new one arrives, and a
    // failed refresh leaves the (still valid) data on screen rather than
    // replacing a working page with an error over a background update.
    const refresh = useCallback(() => {
        loadData()
            .then(setPayload)
            .catch(() => {})
    }, [loadData])

    useEffect(() => {
        let cancelled = false
        // No id, no request — `/api/debates/undefined/full` is a guaranteed 400.
        if (!debateId) return
        loadData()
            .then((data) => {
                if (!cancelled) setPayload(data)
            })
            .catch((err) => {
                if (cancelled) return
                setError(
                    err.response?.status === 404
                        ? 'That debate does not exist.'
                        : 'Could not load this debate.'
                )
            })
        return () => {
            cancelled = true
        }
        // Re-run when the route id changes; navigating between two debates
        // otherwise keeps showing the first one.
    }, [debateId, loadData])

    if (error)
        return (
            <Shell>
                <p className="dbt-status" role="alert">{error}</p>
            </Shell>
        )
    if (!payload)
        return (
            <Shell>
                <p className="dbt-status">Loading…</p>
            </Shell>
        )

    const {
        debate,
        contestants = [],
        nominations = [],
        criteria = [],
        rules = null,
    } = payload
    const screen = phaseOf(debate)
    const isTyped = debate?.format === 'typed'
    // A FOR-FUN DEBATE IS ONE QUESTION AND NOTHING ELSE. Nominating is allowed
    // but not required and decides nothing — likes do — so a Nominations tab
    // offers a second view of a board that is not scoring anything. There is one
    // thing to look at here, which means there is nothing to tab between.
    const isForFun = !!debate?.is_for_fun
    // One derivation, shared by the tab, the heading and the list's own sort.
    const voting = votingStarted(nominations)

    // Signed in? The token is what the API actually authenticates with; userId
    // alone can linger after a session is cleared.
    const signedIn = !!localStorage.getItem('token')

    // Only the result that belongs to the token currently in the URL. Guards the
    // gap between navigating to a new link and its lookup coming back, when
    // `invite` still holds the previous one.
    const activeInvite = invite && invite.token === inviteToken ? invite.data : null

    // Has anyone nominated ME? Compared against the tally the page already has,
    // so no extra request. String compare: both sides are uuid text.
    const meId = localStorage.getItem('userId')
    const iAmNominated =
        !!meId && nominations.some((n) => n.nominee_user_id === meId)

    const requireAuth = (label) => {
        setMessage(label)
        setShowSignUpPop(true)
    }

    // NOMINATE — signed out, ask them to sign up; signed in, open the form.
    const handleNominate = () => {
        if (!signedIn) return requireAuth('Nominate')
        setOpenFlow('nominate')
    }

    // JOIN — same auth gate, plus the one eligibility rule the client can know
    // ahead of the request: createContestant refuses any debate whose
    // participation_type isn't 'open', nomination or not. Showing the entry form
    // there would only produce a 403 at the end of it.
    const handleJoin = () => {
        if (!signedIn) return requireAuth('Join The Debate')
        // The debate itself is closed to open entry — nothing the viewer can do.
        if (debate.participation_type !== 'open') return setMustBeNominated('closed')
        // Entry is open, but you still need someone to have put you forward.
        // `nominations` is one row per NOMINEE keyed on nominee_user_id, so this
        // is just "am I on the board".
        if (!iAmNominated) return setMustBeNominated('not-nominated')
        setOpenFlow('join')
    }

    const screens = {
        '1': (
            <div className="dbt-main">
                <CriteriaAndPromptsCard debate={debate} criteria={criteria} />
                <NominateCard
                    debate={debate}
                    nominated={nominations}
                    onRequireAuth={requireAuth}
                    onNominate={handleNominate}
                    onJoin={handleJoin}
                />
            </div>
        ),
        // is_sponsor is what puts the host's own controls on the live screen —
        // the button that puts a bracket match to a vote. It comes from the
        // server (viewer_user_id vs the debate's sponsor_user_id), never from a
        // client-side comparison against debates.sponsor_id, which is a SPONSORS
        // id and would never match a user id.
        '2': (
            <Ongoing
                contestants={contestants}
                debate={debate}
                criteria={criteria}
                isHost={!!payload.is_sponsor}
                readingKey={readingKey}
                ballotNudge={ballotNudge}
                // Winning the final closes the debate server-side, which moves
                // this page from screen 2 to screen 3. Without this the page
                // would keep showing a live tournament that is over until
                // someone reloaded.
                onDebateChanged={refresh}
            />
        ),
        // Not a sentence any more: a finished debate has a WINNER on record
        // (debate_results, written when the final match closed) and the bracket
        // that produced them. Throwing that away the moment it became true was
        // the worst time to throw it away.
        '3': <Past debate={debate} contestants={contestants} criteria={criteria} />,
    }

    return (
        <Shell>
            {showSignUpPop && (
                <SignUpPopUp
                    message={message}
                    onClose={() => setShowSignUpPop(false)}
                />
            )}
            {mustBeNominated && (
                <MustBeNominatedPopUp
                    reason={mustBeNominated}
                    onClose={() => setMustBeNominated(null)}
                />
            )}
            {openFlow === 'nominate' && (
                <NominateModal
                    debate={debate}
                    onClose={() => setOpenFlow(null)}
                    onNominated={refresh}
                />
            )}
            {openFlow === 'join' && (
                <JoinDebateModal
                    debate={debate}
                    criteria={criteria}
                    rules={rules}
                    nominations={nominations}
                    onClose={() => setOpenFlow(null)}
                    onEntered={refresh}
                />
            )}
            {/* Above the debate, because it is the reason this person opened
                the link at all. */}
            <NominationBanner invite={activeInvite} signedIn={signedIn} />
            {screens[screen]}
            {/* ONE CONTAINER, TWO VIEWS, and for a typed debate the RESPONSES
                are the one it opens on — every match is a thread, and that is
                what a reader came for. Nominations is greyed until clicked.

                BOTH STAY MOUNTED. Switching hides one and shows the other rather
                than unmounting it, so the conversations keep their loaded data,
                their selected match and their scroll position — a tab that
                re-fetches every time you glance at the standings is a tab people
                stop pressing. A live debate has no written matches, so it shows
                the board it always had with no tabs at all. */}
            <div className="dbt-board">
                {isForFun ? (
                    <div className="dbt-board-head">
                        <h2>Responses</h2>
                        <span className="dbt-label">most-liked answer takes the arrow</span>
                    </div>
                ) : isTyped ? (
                    <div className="dbt-board-head dbt-board-tabs">
                        <button
                            type="button"
                            className={boardTab === 'responses' ? 'is-active' : ''}
                            onClick={() => setBoardTab('responses')}
                        >
                            Responses to prompts
                        </button>
                        {/* THE TAB IS NAMED FOR WHAT THE COLUMN HOLDS. Before a
                            single ballot it is a nomination tally; the moment
                            one lands the list re-ranks by points, and calling it
                            "Nominations" after that would label the board by the
                            number it has stopped sorting on. */}
                        <button
                            type="button"
                            className={boardTab === 'nominations' ? 'is-active' : ''}
                            onClick={() => setBoardTab('nominations')}
                        >
                            {voting ? 'Votes' : 'Nominations'}
                        </button>
                        <span className="dbt-label">
                            {boardTab === 'responses'
                                ? 'every match, as a conversation'
                                : voting
                                  ? 'how the room has scored them'
                                  : "who's been put forward"}
                        </span>
                    </div>
                ) : (
                    <div className="dbt-board-head">
                        <h2>{voting ? 'Votes' : 'Nominations'}</h2>
                        <span className="dbt-label">
                            {voting ? 'how the room has scored them' : "who's been put forward"}
                        </span>
                    </div>
                )}

                {isTyped && (
                    <div hidden={!isForFun && boardTab !== 'responses'}>
                        <MatchConversations
                            debate={debate}
                            onActive={onConversationOpened}
                        />
                    </div>
                )}
                {/* No nomination board on a for-fun debate — nothing is being
                    ranked by it. */}
                {!isForFun && (
                    <div hidden={isTyped && boardTab !== 'nominations'}>
                        <Nominated
                            nominated={nominations}
                            winnerUserId={
                                contestants.find((c) => c.status === 'winner')?.user_id || null
                            }
                        />
                    </div>
                )}
            </div>
        </Shell>
    )
}

export default AnyDebate
