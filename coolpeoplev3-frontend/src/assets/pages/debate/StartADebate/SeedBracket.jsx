import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../../lib/api'
import StartADebateHeader from '../../../component/header/StartADebateHeader/StartADebateHeader'
import './SeedBracket.css'

// ============================================================================
// SEEDING DAY — the one screen where a sponsor turns a field into a bracket.
//
// It exists because the moment entry closes, three decisions land at once and
// none of them has anywhere else to live:
//   WHO PLAYS WHOM     — seeded by nominations, or by hand for an invitational
//   WHAT EACH MATCH ASKS — written, or drawn from the published bank
//   WHEN ANSWERS ARE DUE — falls out of the two, and is shown before committing
//
// THE PAGE IS BUILT AROUND THE LOCK. Everything above it is a draft: reorder,
// rewrite, reshuffle, reload, come back tomorrow. Locking writes the matches,
// freezes the prompts, starts the clock and emails every contestant their
// opponent and their question. So the lock is the only destructive control on
// the page, it is at the bottom, and it is disabled with its reasons listed
// until the board is actually complete — a sponsor should never press it and
// find out afterwards that two people shared a seed.
//
// One read backs the whole thing: GET /debates/:id/seeding returns the field,
// the seeds, the pairing they imply, every slot with its prompt, the calendar
// and the blockers. Re-read after every write rather than patching state
// locally — the pairing is derived from seeds server-side, and a client that
// recomputed it would be a second implementation of the bracket geometry.
// ============================================================================

const fullName = (c) =>
    [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.username || 'Someone'

const when = (iso, tz) => {
    if (!iso) return null
    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            ...(tz ? { timeZone: tz } : {}),
        }).format(new Date(iso))
    } catch {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(new Date(iso))
    }
}

function SeedBracket() {
    const { debateId } = useParams()
    const navigate = useNavigate()

    const [board, setBoard] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(null)     // which action is in flight
    const [dirty, setDirty] = useState(false)
    // Prompt edits live here while they are being typed, keyed by slot. Writing
    // straight through to the server on every keystroke would be a request per
    // character; writing into `board` would fight the re-read after each save.
    const [draftPrompts, setDraftPrompts] = useState({})
    // The seed currently picked up, for the two-tap swap. A drag-and-drop
    // reorder with no keyboard path would put the one irreversible decision on
    // this page out of reach of anyone not using a mouse.
    const [picked, setPicked] = useState(null)

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(`/api/debates/${debateId}/seeding`)
            setBoard(data)
            setDraftPrompts({})
            setDirty(false)
            setError(null)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load this bracket.')
        }
    }, [debateId])

    useEffect(() => {
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [load])

    const promptFor = useCallback(
        (key) => (key in draftPrompts ? draftPrompts[key] : board?.slots.find((s) => s.key === key)?.prompt ?? ''),
        [draftPrompts, board]
    )

    const run = async (name, fn) => {
        setBusy(name)
        setError(null)
        try {
            await fn()
            await load()
        } catch (err) {
            setError(err.response?.data?.error || `Could not ${name}.`)
        } finally {
            setBusy(null)
        }
    }

    const save = () =>
        run('save', () =>
            api.patch(`/api/debates/${debateId}/seeding`, {
                prompts: Object.keys(draftPrompts).length ? draftPrompts : null,
            })
        )

    // SWAP, not insert. Two contestants trade seeds, which keeps the set of
    // seeds 1..N intact by construction — an insert-and-shift would have to
    // renumber everyone and can leave a gap if any write fails.
    const swapSeeds = (contestant) => {
        if (board?.locked) return
        if (!picked) return setPicked(contestant.id)
        if (picked === contestant.id) return setPicked(null)

        const a = board.field.find((c) => c.id === picked)
        const b = contestant
        setPicked(null)
        if (!a || a.seed == null || b.seed == null) return
        run('reorder', () =>
            api.patch(`/api/debates/${debateId}/seeding`, {
                seeds: board.field.map((c) => ({
                    contestant_id: c.id,
                    seed: c.id === a.id ? b.seed : c.id === b.id ? a.seed : c.seed,
                })),
            })
        )
    }

    // Unsaved prompt text is a blocker the server cannot see: it is still in
    // this browser. Folded in here so the lock button's reasons are the whole
    // truth rather than the server's half of it.
    const blockers = useMemo(() => {
        const list = [...(board?.blockers ?? [])]
        if (dirty) list.push('You have prompt edits that are not saved yet.')
        return list
    }, [board, dirty])

    if (error && !board) {
        return (
            <div className="debategradientV2" data-surface="dark">
                <StartADebateHeader />
                <p className="sb-status" role="alert">{error}</p>
            </div>
        )
    }
    if (!board) {
        return (
            <div className="debategradientV2" data-surface="dark">
                <StartADebateHeader />
                <p className="sb-status">Loading the bracket…</p>
            </div>
        )
    }

    const { debate, field, pairs, slots, windows, locked } = board
    const byNominations = debate.participation_type === 'open'

    return (
        <div className="debategradientV2" data-surface="dark">
            <StartADebateHeader />

            <div className="sb-wrap">
                <div className="sb-main">
                    <header className="sb-head">
                        <span className="sb-kicker">{locked ? 'Bracket locked' : 'Set the bracket'}</span>
                        <h1 className="sb-title">{debate.title}</h1>
                        <p className="sb-dek">
                            {locked
                                ? 'The pairings and prompts below are final. Every contestant has been told who they are facing, what they are answering and when it is due.'
                                : byNominations
                                ? 'Entry is closed and your field is final. We have seeded it by nominations — the most-nominated contestant faces the least-nominated — and drawn a question for each match from the published bank. Change what you want, leave the rest.'
                                : 'Entry is closed and your field is final. Order the invitees below and pick a question for each match — we have drawn one for each from the published bank to start from.'}
                        </p>
                    </header>

                    {/* THE FIELD. Seed order is the whole input: the pairing
                        below is arithmetic on it, so this is the only list on
                        the page that is edited directly. */}
                    <section className="sb-sec">
                        <h2 className="sb-sec__h">
                            The field
                            <span>{field.length} contestant{field.length === 1 ? '' : 's'}</span>
                        </h2>

                        {!locked && (
                            <div className="sb-actions">
                                <button type="button" className="wb-btn wb-btn--secondary"
                                        disabled={!!busy}
                                        onClick={() => run('re-seed', () =>
                                            api.post(`/api/debates/${debateId}/seeding/auto`))}>
                                    {byNominations ? 'Re-seed by nominations' : 'Re-seed by entry order'}
                                </button>
                                <span className="sb-note">
                                    {picked
                                        ? 'Now pick who they should swap with.'
                                        : 'Tap two contestants to swap their seeds.'}
                                </span>
                            </div>
                        )}

                        <ol className="sb-field">
                            {field.map((c) => (
                                <li key={c.id}>
                                    <button type="button"
                                            className="sb-player"
                                            aria-pressed={picked === c.id}
                                            disabled={locked || !!busy}
                                            onClick={() => swapSeeds(c)}>
                                        <span className="sb-seed">{c.seed ?? '—'}</span>
                                        {c.profile_photo_url
                                            ? <img src={c.profile_photo_url} alt="" />
                                            : <span className="sb-blank" aria-hidden="true">{fullName(c).charAt(0)}</span>}
                                        <span className="sb-who">
                                            <b>{fullName(c)}</b>
                                            <small>
                                                {byNominations
                                                    ? `${c.nomination_count} nomination${c.nomination_count === 1 ? '' : 's'}`
                                                    : c.invited ? 'Invited' : 'Entered'}
                                            </small>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    </section>

                    {/* THE PAIRING, derived. Read-only on purpose: editing a
                        match directly would let the board disagree with the
                        seeds that produced it. */}
                    <section className="sb-sec">
                        <h2 className="sb-sec__h">First round<span>{pairs.length} match{pairs.length === 1 ? '' : 'es'}</span></h2>
                        <div className="sb-pairs">
                            {pairs.map((p) => (
                                <div className={`sb-pair${p.bye ? ' sb-pair--bye' : ''}`} key={p.slot_key}>
                                    <span className="sb-pair__l">{p.label}</span>
                                    {p.bye ? (
                                        <p className="sb-pair__bye">
                                            <b>{fullName(p.a || p.b)}</b> advances — the field does not fill
                                            this half of the bracket, so there is nobody to argue against.
                                        </p>
                                    ) : (
                                        <p className="sb-pair__vs">
                                            <b>{fullName(p.a)}</b> <i>vs</i> <b>{fullName(p.b)}</b>
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* THE PROMPTS, one per match in the whole bracket — later
                        rounds included, because a question has to exist before
                        anyone reaches the match that asks it. */}
                    <section className="sb-sec">
                        <h2 className="sb-sec__h">Prompts<span>{slots.length} match{slots.length === 1 ? '' : 'es'}</span></h2>

                        {!locked && (
                            <div className="sb-actions">
                                <button type="button" className="wb-btn wb-btn--secondary" disabled={!!busy}
                                        onClick={() => run('fill the empty prompts', () =>
                                            api.post(`/api/debates/${debateId}/seeding/shuffle-prompts`))}>
                                    Fill empty ones
                                </button>
                                <button type="button" className="wb-btn wb-btn--secondary" disabled={!!busy}
                                        onClick={() => run('redraw the prompts', () =>
                                            api.post(`/api/debates/${debateId}/seeding/shuffle-prompts`,
                                                     { overwrite: true }))}>
                                    Redraw all
                                </button>
                                <span className="sb-note">Drawn from the published bank — never the same question twice.</span>
                            </div>
                        )}

                        <div className="sb-slots">
                            {slots.map((s) => (
                                <div className="sb-slot" key={s.key}>
                                    <span className="sb-slot__l">{s.label}</span>
                                    {locked ? (
                                        <p className="sb-slot__frozen">{s.prompt}</p>
                                    ) : (
                                        <textarea
                                            className="wb-textarea"
                                            value={promptFor(s.key)}
                                            aria-label={`Prompt for ${s.label}`}
                                            placeholder="What are these two answering?"
                                            onChange={(e) => {
                                                setDraftPrompts((d) => ({ ...d, [s.key]: e.target.value }))
                                                setDirty(true)
                                            }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        {!locked && (
                            <button type="button" className="wb-btn wb-btn--secondary sb-save"
                                    disabled={!dirty || !!busy} onClick={save}>
                                {busy === 'save' ? 'Saving…' : dirty ? 'Save prompts' : 'Prompts saved'}
                            </button>
                        )}
                    </section>
                </div>

                {/* THE RAIL — the calendar this produces, and the lock. */}
                <aside className="sb-rail">
                    <div className="sb-card">
                        <span className="sb-card__h">The schedule</span>
                        {windows.length ? (
                            <ol className="sb-rounds">
                                {windows.map((w) => (
                                    <li key={w.round}>
                                        <b>Round {w.round + 1}</b>
                                        <span>answers due {when(w.response_deadline, debate.start_timezone)}</span>
                                        <span>voting closes {when(w.vote_closes_at, debate.start_timezone)}</span>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p className="sb-note">This debate has no start time yet.</p>
                        )}
                        <p className="sb-note">
                            {debate.round_grace_hours}h to write, {debate.vote_window_hours}h to read and vote.
                            Contestants can edit their answer as often as they like until the deadline —
                            nothing is public until it passes, and then both answers go up together.
                        </p>
                    </div>

                    <div className="sb-card">
                        <span className="sb-card__h">{locked ? 'Locked' : 'Lock it in'}</span>
                        {locked ? (
                            <>
                                <p className="sb-note">
                                    Locked {when(debate.seeding_locked_at, debate.start_timezone)}. Pairings
                                    and prompts are final and every contestant has been notified.
                                </p>
                                <button type="button" className="wb-btn wb-btn--primary"
                                        onClick={() => navigate(`/debate/${debateId}`)}>
                                    Go to the debate →
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="sb-note">
                                    This writes the matches, freezes the prompts, starts the clock and emails
                                    every contestant their opponent, their question and their deadline. It
                                    cannot be undone.
                                </p>
                                {blockers.length > 0 && (
                                    <ul className="sb-blockers">
                                        {blockers.map((b) => <li key={b}>{b}</li>)}
                                    </ul>
                                )}
                                <button type="button" className="wb-btn wb-btn--primary"
                                        disabled={blockers.length > 0 || !!busy}
                                        onClick={() => run('lock the bracket', () =>
                                            api.post(`/api/debates/${debateId}/seeding/lock`))}>
                                    {busy === 'lock the bracket' ? 'Locking…' : 'Lock the bracket'}
                                </button>
                            </>
                        )}
                    </div>

                    {error && <p className="formError" role="alert">{error}</p>}
                </aside>
            </div>
        </div>
    )
}

export default SeedBracket
