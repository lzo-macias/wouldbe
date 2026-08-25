import React, { useState } from 'react'
import api from '../../../lib/api'
import './DebateCards.css'

// ============================================================================
// NominateModal — the form behind the NOMINATE button, for a signed-in viewer.
//
// TWO FIELDS, because the person you want to put forward may not be here yet:
//
//   email or username (required) — a username names someone who already has an
//     account; an email address works either way. POST
//     /api/debates/:id/nominations/invite resolves it: a match becomes a real
//     nomination immediately, and anything else becomes a pending invite that
//     turns into a nomination when they sign up.
//
//   phone number (optional) — when given, the invite is TEXTED as well as
//     emailed. Email always goes out; SMS is the extra channel, never the only
//     one, so an invite is never lost to a mistyped number.
//
// The server answers with what it actually did — `nomination` present or not,
// plus a per-channel delivery status — and this form says exactly that rather
// than assuming. A 'queued' channel means the record exists but no provider is
// configured to send it yet, and claiming "sent" there would be a lie.
// ============================================================================

const CHANNEL_WORDING = {
    sent: 'sent',
    queued: 'queued to send',
    failed: 'could not be delivered',
}

function NominateModal({ debate, onClose, onNominated }) {
    const [handle, setHandle] = useState('')
    const [phone, setPhone] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [result, setResult] = useState(null)

    const ready = handle.trim().length > 0

    async function submit(e) {
        // The fields are a real <form>, so Enter submits — but the default
        // navigation would reload the page and throw the modal away.
        e?.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        setError(null)
        try {
            const { data } = await api.post(
                `/api/debates/${debate.id}/nominations/invite`,
                { handle: handle.trim(), phone: phone.trim() || null }
            )
            setResult(data)
            // A resolved handle changed the tally; let the page re-read so the
            // nomination board behind this dialog is current. A pending invite
            // changed nothing public, so there is nothing to refresh.
            if (data.nomination) onNominated?.()
        } catch (err) {
            const status = err.response?.status
            console.error(err)
            setError(
                err.response?.data?.error ||
                    (status === 429
                        ? 'Too many invites for now — try again later.'
                        : 'Could not send that nomination.')
            )
        } finally {
            setBusy(false)
        }
    }

    function reset() {
        setResult(null)
        setHandle('')
        setPhone('')
        setError(null)
    }

    // What actually happened, in the server's own terms.
    const summary = (() => {
        if (!result) return null
        const who = result.nominee?.name || result.invite?.invitee_email || 'them'
        const lines = []
        lines.push(
            result.nomination
                ? `${who} is on the ${debate.title} nomination board — a nomination lets them enter free.`
                : `Nobody has an account at that address yet, so ${who} has been invited. It becomes a nomination the moment they sign up.`
        )
        const email = CHANNEL_WORDING[result.delivery?.email]
        if (email) lines.push(`Email ${email}.`)
        const sms = CHANNEL_WORDING[result.delivery?.sms]
        if (sms) lines.push(`Text message ${sms}.`)
        return lines
    })()

    return (
        <div className="dbt-scrim" onClick={onClose}>
            <div
                className="dbt-popup dbt-popup--wide"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Nominate someone for this debate"
            >
                <button type="button" className="dbt-popup-close" onClick={onClose}>
                    x
                </button>

                {result ? (
                    <>
                        <h3 className="dbt-modal-title">
                            {result.nomination ? 'Nomination recorded' : 'Invite sent'}
                        </h3>
                        {summary.map((line, i) => (
                            <p key={i}>{line}</p>
                        ))}
                        <div className="dbt-modal-foot">
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--outline"
                                onClick={reset}
                            >
                                Nominate someone else
                            </button>
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--gold"
                                onClick={onClose}
                            >
                                Done
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={submit}>
                        <h3 className="dbt-modal-title">Nominate</h3>
                        <p>
                            Put someone forward for {debate.title}. They don't need an
                            account — we'll invite them.
                        </p>

                        <label className="dbt-field">
                            <span className="dbt-label">email or username</span>
                            <input
                                type="text"
                                value={handle}
                                autoFocus
                                // NOT type="email": this field takes a username too,
                                // and the browser's built-in validation would block
                                // submitting one.
                                autoComplete="off"
                                placeholder="sam@example.com or @samreed"
                                onChange={(e) => {
                                    setHandle(e.target.value)
                                    setError(null)
                                }}
                            />
                        </label>

                        <label className="dbt-field">
                            <span className="dbt-label">phone number — optional</span>
                            <input
                                type="tel"
                                value={phone}
                                autoComplete="off"
                                placeholder="(555) 123-4567"
                                onChange={(e) => {
                                    setPhone(e.target.value)
                                    setError(null)
                                }}
                            />
                            <span className="dbt-hint">
                                Add a number and we'll text the invite as well as
                                emailing it.
                            </span>
                        </label>

                        {error && (
                            <p className="dbt-error" role="alert">
                                {error}
                            </p>
                        )}

                        <div className="dbt-modal-foot">
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--outline"
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="dbt-btn dbt-btn--gold"
                                disabled={!ready || busy}
                            >
                                {busy ? 'Sending…' : 'Nominate'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}

export default NominateModal
