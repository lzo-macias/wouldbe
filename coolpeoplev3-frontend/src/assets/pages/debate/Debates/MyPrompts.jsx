import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../../lib/api'
import Header from '../../../component/header/Header'
// The --dbt-* tokens and the .dbt-page shell live here, and this is a lazily
// loaded route: without the import they are simply not in this chunk's CSS and
// every colour on the page resolves to nothing.
import './DebateCards.css'
import './MyPrompts.css'

// ============================================================================
// MY PROMPTS — everything a contestant in a typed debate has to write, on one
// page, in round order, answerable in any order and as far ahead as they like.
//
// WHY IT IS ONE PAGE. A bracket is a funnel and the route through it is
// arithmetic: the winner of a match plays at (side, round + 1, position / 2).
// So the whole set of questions a contestant might face is knowable the moment
// their first-round seat is — nobody has to win anything for the list to exist.
// Before this, a contestant had to find the match page for whichever round they
// happened to be in, and there was nowhere at all to see what was coming.
//
// WRITING AHEAD IS THE POINT. Each round is still published on its own
// deadline, and both answers in a match are still released together, so nobody
// ever writes having read their opponent. What is gone is the person with a
// free Sunday, nothing they were allowed to work on, and a Wednesday deadline
// they were at work for.
//
// A ROUND YOU MIGHT NOT REACH is worth writing anyway, and the page says so
// rather than pretending otherwise: answering round three does not claim you
// will be in round three, it means that if you are, it is already done.
// ============================================================================

const fmt = (iso, tz) => {
    if (!iso) return null
    try {
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            ...(tz ? { timeZone: tz } : {}),
        }).format(new Date(iso))
    } catch {
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        }).format(new Date(iso))
    }
}

// How long is left, in the units a person actually thinks in. Under a day it
// becomes hours, because "1 day left" and "3 hours left" are the same number to
// a rounding function and very different facts to someone writing.
const countdown = (iso) => {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    if (ms <= 0) return 'closed'
    const hours = ms / 3600000
    if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))} min left`
    if (hours < 24) return `${Math.round(hours)}h left`
    return `${Math.round(hours / 24)} days left`
}

function MyPrompts() {
    const { debateId } = useParams()
    const [board, setBoard] = useState(null)
    const [error, setError] = useState(null)
    const [drafts, setDrafts] = useState({})   // prompt_id -> text being typed
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(null)

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(`/api/debates/${debateId}/my-prompts`)
            setBoard(data)
            setDrafts({})
            setError(null)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load your prompts.')
        }
    }, [debateId])

    useEffect(() => {
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [load])

    // What is on screen for a round: the unsaved draft if there is one, the
    // saved answer otherwise. One expression, so the two can never disagree.
    const textFor = (r) => (r.prompt_id in drafts ? drafts[r.prompt_id] : r.my_answer || '')

    const dirty = useMemo(
        () =>
            (board?.rounds ?? []).filter(
                (r) => r.prompt_id in drafts && drafts[r.prompt_id] !== (r.my_answer || '')
            ),
        [board, drafts]
    )

    const save = async () => {
        if (!dirty.length) return
        setSaving(true)
        setError(null)
        setSaved(null)
        try {
            const { data } = await api.put(`/api/debates/${debateId}/my-prompts`, {
                answers: dirty.map((r) => ({ prompt_id: r.prompt_id, body: textFor(r) })),
            })
            // Partial success is a real outcome here — a round can close while
            // someone is typing — so it is reported rather than smoothed over.
            setSaved(data)
            if (data.failed) {
                setError(
                    data.results.filter((x) => !x.saved).map((x) => x.error).join(' · ')
                )
            }
            await load()
        } catch (err) {
            setError(err.response?.data?.error || 'Could not save.')
        } finally {
            setSaving(false)
        }
    }

    if (error && !board) {
        return (
            <div className="dbt-page">
                <Header />
                <p className="mp-status" role="alert">{error}</p>
            </div>
        )
    }
    if (!board) {
        return (
            <div className="dbt-page">
                <Header />
                <p className="mp-status">Loading…</p>
            </div>
        )
    }

    // Seeded but not locked: the sponsor has not built the bracket yet, so there
    // is no path and no honest list to show. Said plainly rather than rendered
    // as an empty page that reads like a fault.
    if (!board.locked || !board.rounds.length) {
        return (
            <div className="dbt-page">
                <Header />
                <div className="mp-wrap">
                    <div className="mp-empty">
                        <span className="mp-empty__t">Your prompts aren&apos;t set yet</span>
                        The host is still building the bracket. As soon as they lock it in you&apos;ll
                        get an email, and every question you might face will be on this page.
                        <Link className="wb-btn wb-btn--secondary" to={`/debate/${debateId}`}>
                            Back to the debate
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    const open = board.rounds.filter((r) => r.state !== 'released')
    const answered = open.filter((r) => r.answered).length

    return (
        <div className="dbt-page">
            <Header />
            <div className="mp-wrap">
                <header className="mp-head">
                    <span className="mp-kicker">You&apos;re seed {board.seed}</span>
                    <h1 className="mp-title">Your prompts</h1>
                    <p className="mp-dek">
                        One question per round, in the order you&apos;d meet them. Write them in any
                        order and as far ahead as you like — each round is only published on its own
                        deadline, and both answers in a match go up together, so nobody reads yours
                        before writing theirs.
                    </p>
                    <p className="mp-dek mp-dek--quiet">
                        Later rounds are there in case you get to them. Answering one doesn&apos;t
                        claim you will — it means that if you do, it&apos;s already written.
                    </p>
                </header>

                <div className="mp-bar">
                    <span><b>{answered}</b> of {open.length} written</span>
                    <span className="mp-bar__spacer" />
                    {saved && !saved.failed && !dirty.length && <span className="mp-ok">Saved</span>}
                    <button type="button" className="wb-btn wb-btn--primary"
                            disabled={!dirty.length || saving} onClick={save}>
                        {saving ? 'Saving…' : dirty.length ? `Save ${dirty.length}` : 'Saved'}
                    </button>
                </div>

                {error && <p className="mp-error" role="alert">{error}</p>}

                <ol className="mp-rounds">
                    {board.rounds.map((r) => {
                        const closed = r.state === 'released'
                        const due = fmt(r.response_deadline, board.start_timezone)
                        const left = countdown(r.response_deadline)
                        return (
                            <li className={`mp-round${closed ? ' mp-round--closed' : ''}`} key={r.slot_key}>
                                <div className="mp-round__head">
                                    <span className="mp-round__n">Round {r.round + 1}</span>
                                    <span className="mp-round__l">{r.label}</span>
                                    <span className="mp-round__spacer" />
                                    {r.answered && !closed && <span className="mp-tick">Written</span>}
                                    <span className={`mp-due${left === 'closed' ? ' mp-due--past' : ''}`}>
                                        {closed ? 'Closed' : left}
                                    </span>
                                </div>

                                <p className="mp-prompt">{r.prompt || 'Your host hasn’t set this one yet.'}</p>

                                {closed ? (
                                    <>
                                        <p className="mp-frozen">{r.my_answer || 'You didn’t answer this round.'}</p>
                                        <span className="mp-note">
                                            This round closed {due}. Published answers can&apos;t be edited —
                                            a late rewrite would be answering after reading.
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <textarea
                                            className="mp-textarea"
                                            value={textFor(r)}
                                            aria-label={`Your answer for round ${r.round + 1}`}
                                            placeholder="Make your case…"
                                            disabled={!r.prompt_id}
                                            onChange={(e) =>
                                                setDrafts((d) => ({ ...d, [r.prompt_id]: e.target.value }))
                                            }
                                        />
                                        <span className="mp-note">
                                            Due {due}. Edit as often as you like until then — nothing is
                                            public before the deadline.
                                        </span>
                                    </>
                                )}
                            </li>
                        )
                    })}
                </ol>
            </div>
        </div>
    )
}

export default MyPrompts
