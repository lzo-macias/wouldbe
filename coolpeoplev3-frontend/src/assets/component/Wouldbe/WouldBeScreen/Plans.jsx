import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import api from '../../../lib/api'
import './Plans.css'

// ============================================================================
// Plans — a candidate's policy positions, as a timeline.
//
// Each position is a milestone on a record rather than a row in a list: a node
// on a rail, the category and title in the margin, the position itself in a
// card. That shape is the point — a voter reads this section first, and a
// stack of undifferentiated paragraphs gives them nothing to scan.
//
// EDIT IF MINE, READ IF NOT. Ownership is decided by comparing the viewer in
// localStorage to the campaign owner's id, which is true from the FIRST render.
// The alternative — a prop threaded down from the page's fetch — is null while
// that fetch is in flight, and `null === false` would have shown Edit buttons
// on somebody else's campaign for as long as the request took. Reviews settled
// this the same way for the same reason.
//
// THREE DESIGN DECISIONS worth keeping if this is refactored:
//   1. THE RAIL IS NEUTRAL, THE NODES ARE GOLD. A pale-gold rail is about 1.3:1
//      on white — invisible, and WCAG wants 3:1 for a graphic that carries
//      meaning. The gold is spent on the nodes, where it means "milestone", at a
//      value that can actually be seen.
//   2. A long position CLAMPS, fades into the card, and offers a real "Show
//      more". A hard cut mid-glyph reads as a rendering bug, not as truncation.
//   3. The toggle only appears when the text ACTUALLY overflows — measured, not
//      guessed from a character count — so the control is never a lie.
// ============================================================================

// useLayoutEffect warns when there is no DOM; this keeps SSR quiet.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Matches .pt-prose--clamped's max-height. The two have to agree or the toggle
// appears on text that isn't clipped.
const CLAMP_PX = 232

// The eyebrow. getPlanForWouldbe already joins the category table and returns
// `category_name` — the curated display label — so that is what shows. The key
// is only prettified as a fallback, because "civil_rights" is a database column
// and nobody should have to read one.
const prettyKind = (c) =>
    c.category_name ||
    c.category_display_name ||
    (c.category_key
        ? String(c.category_key).replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())
        : 'Policy')

// Two labels are "the same" if they are the same words — the eyebrow is
// uppercased by CSS, so a raw === would call "LGBTQ+ Rights" and "LGBTQ+ RIGHTS"
// different strings and print both.
const sameWords = (a, b) =>
    String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') ===
    String(b || '').trim().toLowerCase().replace(/\s+/g, ' ')

const CheckIcon = () => (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="pt-check">
        <path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

function PolicyEntry({ component, isMine, onSaved }) {
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    // Seeded from length so the first paint already clamps rather than flashing
    // the whole position and then collapsing it.
    const [overflows, setOverflows] = useState(
        () => (component.description || '').length > 520
    )
    const proseRef = useRef(null)

    useIsoLayoutEffect(() => {
        const el = proseRef.current
        if (!el) return
        const measure = () => setOverflows(el.scrollHeight > CLAMP_PX + 4)
        measure()
        if (typeof ResizeObserver === 'undefined') return
        // Re-measure on resize: the same text overflows at 320px and doesn't at
        // 1200px, so a one-shot measurement is only right at one width.
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [component.description, editing])

    // SEED the field from the component rather than using the text as a
    // placeholder. A placeholder only LOOKS pre-filled: the field is empty, so
    // editing one word replaces the whole position, and saving without typing
    // submits "" — which the API rejects with a confusing 400.
    function startEdit() {
        setDraft(component.description ?? '')
        setError(null)
        setEditing(true)
    }

    async function handleSubmit(e) {
        e.preventDefault()
        // PATCH uses COALESCE, and '' is a value rather than null — an empty box
        // would blank the position instead of leaving it alone.
        if (!draft.trim()) return setError('Write something, or cancel')
        setSaving(true)
        setError(null)
        try {
            const { data } = await api.patch(`/api/plan-components/${component.id}`, {
                description: draft.trim(),
            })
            onSaved?.(data)      // lifted, so the new text shows without a refetch
            setEditing(false)
        } catch (err) {
            console.error('[Plans] save failed', err)
            setError(err.response?.data?.error || 'Could not save that change')
        } finally {
            setSaving(false)
        }
    }

    const kind = prettyKind(component)
    const written = !!component.description
    const clamped = overflows && !open && !editing
    // Written positions are milestones reached; an empty one is still pending.
    // There is no status column — this IS the status, and deriving it beats
    // inventing a field the API does not send.
    const paragraphs = written ? String(component.description).split(/\n{2,}/) : []

    return (
        <li className="pt-item">
            <span
                className={`pt-node ${written ? 'pt-node--done' : 'pt-node--pending'}`}
                aria-hidden="true"
            >
                {written && <CheckIcon />}
            </span>

            <div className="pt-label">
                {/* The eyebrow is the CATEGORY. When a component's title is the
                    category — "Civil Rights Equity" filed under Civil Rights
                    Equity, which is most of them — printing both stacks the same
                    words twice and the eyebrow stops meaning anything. Compared
                    case- and space-insensitively so "LGBTQ+ Rights" matches
                    "LGBTQ+ RIGHTS". */}
                {!sameWords(kind, component.title) && (
                    <span className="pt-eyebrow">{kind}</span>
                )}
                <h3 className="pt-title">{component.title}</h3>
                {component.created_at && (
                    /* "Added", not "Updated" — plan_components has no updated_at,
                       and labelling a creation date as an update is a claim the
                       data cannot support. */
                    <span className="pt-meta">
                        Added{' '}
                        {new Date(component.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                        })}
                    </span>
                )}
            </div>

            <div className="pt-body">
                {editing ? (
                    /* <form> so Enter-with-modifier submits and the button needs
                       no handler of its own. A textarea, never <input type=text>:
                       a single-line input cannot wrap, and takes its width from
                       the `size` attribute — which is why the old edit box
                       collapsed into a square beside a full-width paragraph. */
                    <form className="pt-form" onSubmit={handleSubmit}>
                        <textarea
                            className="pt-textarea"
                            id={`desc-${component.id}`}
                            placeholder="Write your position. Two or three paragraphs is plenty."
                            value={draft}
                            autoFocus
                            onChange={(e) => setDraft(e.target.value)}
                        />
                        <div className="pt-form-foot">
                            {error && <span className="pt-error" role="alert">{error}</span>}
                            <button
                                type="button"
                                className="pt-btn"
                                onClick={() => setEditing(false)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button type="submit" className="pt-btn pt-btn--save" disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </form>
                ) : written ? (
                    <>
                        <div
                            ref={proseRef}
                            className={`pt-prose${clamped ? ' pt-prose--clamped' : ''}`}
                        >
                            {paragraphs.map((p, i) => (
                                <p key={i}>{p}</p>
                            ))}
                            {clamped && (
                                <button
                                    type="button"
                                    className="pt-more"
                                    onClick={() => setOpen(true)}
                                    aria-expanded="false"
                                >
                                    Show more
                                </button>
                            )}
                        </div>
                        {open && (
                            <button
                                type="button"
                                className="pt-more pt-more--static"
                                onClick={() => setOpen(false)}
                                aria-expanded="true"
                            >
                                Show less
                            </button>
                        )}
                    </>
                ) : (
                    /* An empty position is a real state, and a bordered void
                       reads as broken. What it says depends on who is looking:
                       the owner has something to do, a visitor just has less to
                       read and should not be shown a to-do that is not theirs. */
                    <div className="pt-empty">
                        <span className="pt-empty__t">
                            {isMine ? 'No position written yet' : 'No position published yet'}
                        </span>
                        {isMine
                            ? 'Voters read this section first. Two or three paragraphs is plenty.'
                            : 'This candidate has not published their position on this yet.'}
                    </div>
                )}

                {/* EDIT IF MINE. Not disabled, not hidden-then-403 — absent. */}
                {isMine && !editing && (
                    <div className="pt-actions">
                        <button type="button" className="pt-btn" onClick={startEdit}>
                            {written ? 'Edit' : 'Write position'}
                        </button>
                    </div>
                )}
            </div>
        </li>
    )
}

/**
 * @param {array}  plans          the campaign's plan(s); components are flattened
 * @param {string} profileUserId  the campaign OWNER's user id — the one thing
 *                                that decides whether this is editable
 */
function Plans({ plans, profileUserId = null }) {
    // DERIVED FROM PROPS, with saves layered on top — not copied into state by an
    // effect. Copying meant every prop change overwrote the list (losing an edit
    // that had just been saved but not yet refetched), and a setState in an
    // effect body is a second render for something that was never state.
    const [saved, setSaved] = useState({})   // id -> the row the API returned
    const components = (plans?.flatMap((p) => p.components ?? []) ?? []).map((c) =>
        saved[c.id] ? { ...c, ...saved[c.id] } : c
    )

    // Straight from localStorage, like Reviews: available synchronously, so the
    // first render is already correct. A viewer with no session is definitively
    // not the owner, and a campaign with no owner id is nobody's to edit.
    const viewerId = localStorage.getItem('userId')
    const isMine = !!viewerId && !!profileUserId && viewerId === profileUserId

    // Merge the saved row in so edited text renders immediately rather than only
    // after a refetch. Keyed by id, so a later refetch that brings the same text
    // simply agrees with it.
    function handleSaved(updated) {
        setSaved((prev) => ({ ...prev, [updated.id]: updated }))
    }

    if (!components.length) {
        return (
            <div className="pt-empty pt-empty--center">
                <span className="pt-empty__t">No policy positions yet</span>
                {isMine
                    ? "Add your first position and it'll appear here as a milestone on your record."
                    : 'This campaign has not published any policy positions yet.'}
            </div>
        )
    }

    return (
        <ol className="pt-timeline">
            {components.map((component) => (
                <PolicyEntry
                    key={component.id}
                    component={component}
                    isMine={isMine}
                    onSaved={handleSaved}
                />
            ))}
        </ol>
    )
}

export default Plans
