import React, { useState } from 'react'
import api from '../../../lib/api'
import { handOffToMessages, normalizeUsPhone } from '../../../lib/smsHandoff'
import './DebateCards.css'

// ============================================================================
// NominateModal — the form behind the NOMINATE button, for a signed-in viewer.
//
// TWO FIELDS, on one popup, as before — but they do very different things now:
//
//   email or username (required) — goes to the SERVER. POST
//     /api/debates/:id/nominations/invite resolves it: a match becomes a real
//     nomination immediately, and anything else becomes a pending invite that
//     turns into a nomination when they sign up.
//
//   phone number (optional) — NEVER LEAVES THIS BROWSER. It is not in the
//     request body, it has no column behind it, and nothing logs it. Its only
//     use is as the recipient of an `sms:` URL, so the nominator's own Messages
//     app opens already addressed instead of making them find the contact. When
//     the dialog closes the value is dropped with the component state.
//
// That is the whole point of the redesign: we used to take this number and text
// the invite ourselves, which meant storing a THIRD PARTY's phone number —
// someone who never agreed to anything — somewhere it could be subpoenaed. We
// cannot be made to produce what we never receive.
//
// ONE CAVEAT worth knowing before anyone adds analytics to this screen: an
// <input> is keystroke-visible to session-replay tools (FullStory, LogRocket,
// Sentry Replay). If any of those are ever switched on, this field must be
// masked, or the number starts leaving the browser after all. Leaving the field
// blank falls back to the OS contact picker, which never has that problem.
//
// Texting is a SECOND, MANUAL STEP after the nomination is recorded, not a
// checkbox on the form: the message contains the invite token, which does not
// exist until the POST comes back. That ordering also means backing out of the
// share sheet costs nothing — the nomination is already saved.
//
// The server answers with what it actually did — `nomination` present or not,
// plus the email delivery status — and this form says exactly that rather than
// assuming. A 'queued' channel means the record exists but no provider is
// configured to send it yet, and claiming "sent" there would be a lie.
// ============================================================================

const CHANNEL_WORDING = {
    sent: 'sent',
    queued: 'queued to send',
    failed: 'could not be delivered',
}

// What actually happened when they pressed "Text it to them". Deliberately does
// NOT claim the message was delivered — we hand off to the OS and lose sight of
// it there, and only the OS knows whether they pressed send.
const HANDOFF_WORDING = {
    shared: 'Your messaging app is open with the invite ready to send.',
    sms: 'Messages is open with the invite ready — pick who it goes to and send.',
    copied: 'Invite copied. Paste it into a text and send it from your phone.',
    failed: 'Copy the message below and send it however you like.',
}

function NominateModal({ debate, onClose, onNominated }) {
    const [handle, setHandle] = useState('')
    // Client-only. Deliberately NOT sent anywhere — see the header note.
    const [phone, setPhone] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [result, setResult] = useState(null)
    const [handoff, setHandoff] = useState(null)

    const ready = handle.trim().length > 0
    // null when blank (fine — the OS picker handles it) and null when unusable,
    // which is worth SAYING rather than opening Messages with a mangled To:.
    const toNumber = normalizeUsPhone(phone)
    const phoneUnusable = phone.trim().length > 0 && !toNumber

    async function submit(e) {
        // The field is a real <form>, so Enter submits — but the default
        // navigation would reload the page and throw the modal away.
        e?.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        setError(null)
        try {
            // `handle` ONLY. The phone number is not in this body and must
            // never be added to it.
            const { data } = await api.post(
                `/api/debates/${debate.id}/nominations/invite`,
                { handle: handle.trim() }
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

    // Called STRAIGHT from the click, with no await in front of it. Both
    // navigator.share and the clipboard need transient user activation, and the
    // POST above would have spent it — which is exactly why this is its own
    // button rather than something submit() chains onto.
    async function textIt() {
        const message = result?.share?.text
        if (!message) return
        setHandoff(await handOffToMessages(message, toNumber || ''))
    }

    function reset() {
        setResult(null)
        setHandle('')
        setPhone('')
        setError(null)
        setHandoff(null)
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

                        {result.share?.text && (
                            <div className="dbt-handoff">
                                <p className="dbt-handoff-lede">
                                    {toNumber
                                        ? `Want to text them too? This opens Messages on your own
                                           device, already addressed, with the invite written out.
                                           Nothing is sent until you press send.`
                                        : `Want to text them too? This opens your own messaging app
                                           with the invite written out, and you pick who it goes to.`}
                                </p>

                                <button
                                    type="button"
                                    className="dbt-btn dbt-btn--outline dbt-handoff-btn"
                                    onClick={textIt}
                                >
                                    {toNumber ? 'Text it to them' : 'Text it to someone'}
                                </button>

                                {handoff && (
                                    <p className="dbt-hint" role="status">
                                        {HANDOFF_WORDING[handoff]}
                                    </p>
                                )}

                                {/* Shown once the handoff has run, so someone whose browser
                                    did nothing useful still has the message in front of them
                                    rather than a button that appeared to do nothing. */}
                                {(handoff === 'copied' || handoff === 'failed') && (
                                    <pre className="dbt-handoff-text">{result.share.text}</pre>
                                )}
                            </div>
                        )}

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
                            <span className="dbt-hint">
                                We'll email them, and this is what the nomination is
                                recorded against.
                            </span>
                        </label>

                        <label className="dbt-field">
                            <span className="dbt-label">phone number — optional</span>
                            <input
                                type="tel"
                                value={phone}
                                autoComplete="off"
                                placeholder="(555) 123-4567"
                                aria-invalid={phoneUnusable}
                                aria-describedby="nominate-phone-hint"
                                onChange={(e) => {
                                    setPhone(e.target.value)
                                    setError(null)
                                }}
                            />
                            <span id="nominate-phone-hint" className="dbt-hint">
                                {phoneUnusable
                                    ? "That doesn't look like a phone number — use 10 digits, or +country code."
                                    : 'Stays on your device. We never send it anywhere or store it — ' +
                                      'it only opens your own Messages app already addressed. Leave it ' +
                                      'blank and you pick the contact yourself.'}
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
