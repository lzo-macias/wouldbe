import { useCallback, useEffect, useState } from "react"
import api from "../../lib/api"
import "./MatchPromptGrid.css"

// ============================================================================
// MatchPromptGrid — the prompt sheet for a TYPED debate.
//
// In a typed debate there is no stream: every MATCH in the bracket is a written
// question the two contestants answer against each other. So the number of
// prompts is not a choice, it is arithmetic on the field size — 16 contestants
// play 15 matches and need 15 prompts — and each one is bound to a specific
// slot (round, side, position), the same coordinate debate_matches uses.
//
// THE SLOTS COME FROM THE SERVER (GET /api/bracket-slots?field_size=N) rather
// than being computed here. The identical geometry exists in three places —
// this form, the bracket that draws the board, and the table that stores the
// matches — and the only way three copies stay in step is for two of them to
// ask the third. A prompt written against a slot the server does not agree
// exists is a prompt no match will ever show.
//
// THE SUGGEST BUTTON is not a model. It reads category_prompt_templates, a bank
// of reviewed questions an admin curates, and picks a spread by round depth
// (openers early, sharper questions in the final). That is why it is instant,
// free, works offline, and can be published under the sponsor's name without
// anyone having to check what it invented. Pressing it again reshuffles.
// ============================================================================

const MAX_BODY = 2000

function MatchPromptGrid({ fieldSize, category, prompts, setPrompts, disabled = false }) {
    const [slots, setSlots] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    // Bumped on every press so the bank returns a different spread rather than
    // the same set — the server is stateless about it, so the offset lives here.
    const [shuffle, setShuffle] = useState(0)
    const [busy, setBusy] = useState(false)

    // Re-asked whenever the contestant cap moves: 8 contestants is 7 prompts and
    // 16 is 15, so the sheet has to grow and shrink with the stepper.
    useEffect(() => {
        let cancelled = false
        // EVERY setState lives inside the async body, including the "no valid
        // field size, clear the sheet" branch: a setState called straight from
        // an effect body is a synchronous cascading render, which is what
        // react-hooks/set-state-in-effect flags.
        ;(async () => {
            const n = Number(fieldSize)
            if (!Number.isFinite(n) || n < 2) {
                if (!cancelled) setSlots([])
                return
            }
            if (cancelled) return
            setLoading(true)
            try {
                const { data } = await api.get(`/api/bracket-slots?field_size=${n}`)
                if (!cancelled) {
                    setSlots(data.slots || [])
                    setError(null)
                }
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || "Could not work out the bracket")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [fieldSize])

    // Written text is keyed by SLOT, not by array position. The stepper can
    // change the field size at any time, and keying by index would silently move
    // a final's question into a first-round match when the bracket resized.
    const bodyFor = useCallback((key) => prompts[key] ?? "", [prompts])

    const setBody = (key, value) =>
        setPrompts((prev) => ({ ...prev, [key]: value }))

    const filled = slots.filter((s) => (prompts[s.key] || "").trim()).length

    // onlyEmpty: the default, so pressing suggest never destroys something the
    // sponsor typed. "Replace all" is a separate, explicit press.
    const suggest = async ({ onlyEmpty = true } = {}) => {
        setBusy(true)
        setError(null)
        try {
            const { data } = await api.get(
                `/api/prompt-suggestions?field_size=${Number(fieldSize)}` +
                    `&category=${encodeURIComponent(category || "")}&offset=${shuffle}`
            )
            setPrompts((prev) => {
                const next = { ...prev }
                for (const p of data.prompts || []) {
                    if (!onlyEmpty || !(next[p.key] || "").trim()) next[p.key] = p.body
                }
                return next
            })
            setShuffle((n) => n + 1)
        } catch (err) {
            setError(err.response?.data?.error || "Could not fetch suggestions")
        } finally {
            setBusy(false)
        }
    }

    if (loading && !slots.length) return <p className="mpg-note">Working out the bracket…</p>
    if (!slots.length) {
        return (
            <p className="mpg-note">
                {error || "Set a contestant cap first — the number of prompts comes from it."}
            </p>
        )
    }

    return (
        <div className="mpg">
            <div className="mpg-head">
                <div>
                    <p className="mpg-count">
                        <strong>{filled}</strong> of <strong>{slots.length}</strong> written
                    </p>
                    <p className="mpg-note">
                        {fieldSize} contestants play {slots.length} matches. Every match needs its
                        own question — the two people in it answer yours, and nobody else's.
                    </p>
                </div>
                <div className="mpg-actions">
                    <button type="button" onClick={() => suggest()} disabled={busy || disabled}>
                        {busy ? "Drafting…" : filled ? "Fill the empty ones" : "Suggest prompts"}
                    </button>
                    {filled > 0 && (
                        <button
                            type="button"
                            className="mpg-secondary"
                            onClick={() => suggest({ onlyEmpty: false })}
                            disabled={busy || disabled}
                        >
                            Replace all
                        </button>
                    )}
                </div>
            </div>

            {/* Where the suggestions come from, said plainly. A sponsor is about
                to publish these under their own debate; "generated" would be a
                claim about a thing that did not happen. */}
            <p className="mpg-source">
                Suggestions come from our reviewed prompt bank
                {category ? <> for <strong>{category}</strong></> : null} — edit anything before
                you submit.
            </p>

            {error && <p className="formError">{error}</p>}

            <ol className="mpg-list">
                {slots.map((slot) => {
                    const value = bodyFor(slot.key)
                    return (
                        <li
                            key={slot.key}
                            className={`mpg-slot${value.trim() ? " is-filled" : ""}${
                                slot.side === "final" ? " is-final" : ""
                            }`}
                        >
                            <div className="mpg-slot-head">
                                <span className="mpg-label">{slot.label}</span>
                                <span className="mpg-chars">
                                    {value.length}/{MAX_BODY}
                                </span>
                            </div>
                            <textarea
                                value={value}
                                maxLength={MAX_BODY}
                                disabled={disabled}
                                onChange={(e) => setBody(slot.key, e.target.value)}
                                placeholder={
                                    slot.side === "final"
                                        ? "The last question of the debate. Make it the one worth winning on."
                                        : "What are these two arguing about?"
                                }
                            />
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}

export default MatchPromptGrid
