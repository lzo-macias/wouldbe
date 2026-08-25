import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../../lib/api'
import Header from '../../../component/header/Header'
import NominateCard from './NominateCard'
import CriteriaAndPromptsCard from './CriteriaAndPromptsCard'
import Nominated from './Nominated'
import Ongoing from './Ongoing'
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

function MustBeNominatedPopUp({ onClose }) {
    return (
        <div className="dbt-scrim" onClick={onClose}>
            <div className="dbt-popup" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="dbt-popup-close" onClick={onClose}>
                    x
                </button>
                <p>
                    You must be nominated by another person to compete; pay-to-enter
                    is not active for this debate
                </p>
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
    const [showSignUpPop, setShowSignUpPop] = useState(false)
    const [mustBeNominated, setMustBeNominated] = useState(false)
    // Which action dialog is open: null | 'nominate' | 'join'. One field rather
    // than a boolean each, because the two are mutually exclusive and a pair of
    // booleans can represent a state ("both open") the page has no layout for.
    const [openFlow, setOpenFlow] = useState(null)
    const [message, setMessage] = useState('')
    const [payload, setPayload] = useState(null)
    const [error, setError] = useState(null)

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

    // Signed in? The token is what the API actually authenticates with; userId
    // alone can linger after a session is cleared.
    const signedIn = !!localStorage.getItem('token')

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
        if (debate.participation_type !== 'open') return setMustBeNominated(true)
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
        '2': <Ongoing contestants={contestants} debate={debate} />,
        '3': <p className="dbt-status">This debate has concluded.</p>,
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
                <MustBeNominatedPopUp onClose={() => setMustBeNominated(false)} />
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
            {screens[screen]}
            <div className="dbt-board">
                <div className="dbt-board-head">
                    <h2>Nominations</h2>
                    <span className="dbt-label">who's been put forward</span>
                </div>
                <Nominated nominated={nominations} />
            </div>
        </Shell>
    )
}

export default AnyDebate
