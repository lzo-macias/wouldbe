import React, { useState } from 'react'
import api from '../../../lib/api'
import './DebateCards.css'

// ============================================================================
// JoinDebateModal — the entry flow behind JOIN THE DEBATE, for a signed-in
// viewer of a debate whose participation_type is 'open'.
//
// POST /api/debates/:debateId/enter is gated by THREE separate middlewares, and
// every one of them 403s on its own:
//     requireAttestation('age_18')      → a current age_18 attestation
//     requireAttestation('us_citizen')  → a current us_citizen attestation
//     requireCriteriaAck('landing_page')→ an ack row for THIS debate
// None of them can be satisfied by the entry request itself, so the three
// records are written first and the entry second. They are legal evidence: the
// server stamps user_id, ip and the timestamps — this form only supplies what
// the person actually agreed to.
//
// Everything the user is agreeing to is on screen above the checkboxes. That is
// the point of the ack: it records that the criteria were SHOWN.
// ============================================================================

// The version of the attestation text below. Bump both this and the copy
// together — an attestation is only evidence of the words it was signed under.
const ATTESTATION_VERSION = '1'

function JoinDebateModal({
    debate,
    criteria = [],
    rules = null,
    nominations = [],
    onClose,
    onEntered,
}) {
    const [readCriteria, setReadCriteria] = useState(false)
    const [isAdult, setIsAdult] = useState(false)
    const [isCitizen, setIsCitizen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [entered, setEntered] = useState(false)

    const myUserId = localStorage.getItem('userId')

    // entry_method is part of the immutable legal record, so it should say how
    // this person actually got in. The nomination tally already tells us: a
    // nominee entering is 'nominated', anyone else on an open debate is
    // 'free_self_entry'. (Both are free — the difference is provenance, not price.)
    const wasNominated = nominations.some((n) => n.nominee_user_id === myUserId)

    const ready = readCriteria && isAdult && isCitizen

    async function submit() {
        if (!ready || busy) return
        setBusy(true)
        setError(null)
        try {
            // 1) Which attestations this person is actually missing.
            //    user_attestations is append-only and recordAttestation does no
            //    upsert, so posting both unconditionally would file a fresh legal
            //    row on every entry — and on every retry after a failed one.
            //    Someone who already attested 18+ for a previous debate is
            //    already covered; the checkboxes above are still required, they
            //    just don't need a duplicate record behind them.
            const { data: missing = [] } = await api.get(
                '/api/attestations/me/required/debate_entry'
            )

            // 2) The gates. Independent writes against the caller's own token, so
            //    they go together — but they MUST land before the entry call, or
            //    the middleware rejects it (race → 403).
            await Promise.all([
                api.post('/api/criteria-acks', {
                    debate_id: debate.id,
                    ack_type: 'landing_page',
                    // debates.criteria_version names the catalog version this
                    // debate's criteria were drawn from; 'v1' is the column default.
                    criteria_version: debate.criteria_version || 'v1',
                    rules_version_seen: rules?.version || null,
                }),
                ...missing.map((type) =>
                    api.post('/api/attestations', {
                        attestation_type: type,
                        attested_value: 'true',
                        attestation_version: ATTESTATION_VERSION,
                        context: 'debate_entry',
                    })
                ),
            ])

            // 3) The entry itself. The server derives state/city/age from the
            //    profile and writes the contestant + debate_entries rows in one
            //    transaction, so there is no half-entry to clean up on failure.
            await api.post(`/api/debates/${debate.id}/enter`, {
                entry_method: wasNominated ? 'nominated' : 'free_self_entry',
                attestation_age_18: true,
                rules_version_seen: rules?.version || null,
                acknowledged_rules_at: new Date().toISOString(),
            })

            setEntered(true)
            onEntered?.()
        } catch (err) {
            const status = err.response?.status
            const message = err.response?.data?.error
            console.error(err)
            setError(
                // 409 covers both "already entered" and "entry cap reached"; the
                // server's own wording distinguishes them, so prefer it.
                message ||
                    (status === 403
                        ? 'You are not eligible to enter this debate.'
                        : 'Could not enter this debate. Try again.')
            )
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="dbt-scrim" onClick={onClose}>
            <div
                className="dbt-popup dbt-popup--wide"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Join this debate"
            >
                <button type="button" className="dbt-popup-close" onClick={onClose}>
                    x
                </button>

                {entered ? (
                    <>
                        <h3 className="dbt-modal-title">You're in</h3>
                        <p>
                            You have entered {debate.title}. You'll appear on the
                            contestant roster, and your entry record is signed and saved.
                        </p>
                        <div className="dbt-modal-foot">
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
                    <>
                        <h3 className="dbt-modal-title">Join the debate</h3>
                        <p>
                            Entering {debate.title}
                            {wasNominated
                                ? ' — you were nominated, so entry is free.'
                                : ' is free. Read what you are agreeing to first.'}
                        </p>

                        <div className="dbt-terms">
                            <span className="dbt-label">judged on</span>
                            {criteria.length ? (
                                <ol className="dbt-list">
                                    {criteria.map((c, i) => (
                                        <li key={c.criterion_id || i}>
                                            <strong>{c.display_name}</strong>
                                            {c.description}
                                        </li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="dbt-empty">
                                    The judging criteria for this debate haven't been
                                    published yet.
                                </p>
                            )}

                            {rules?.rules_text && (
                                <>
                                    <span className="dbt-label">
                                        official rules v{rules.version}
                                    </span>
                                    <p className="dbt-rules-text">{rules.rules_text}</p>
                                </>
                            )}
                        </div>

                        <div className="dbt-checks">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={readCriteria}
                                    onChange={(e) => setReadCriteria(e.target.checked)}
                                />
                                <span>
                                    I have read the judging criteria and the official
                                    rules for this debate.
                                </span>
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={isAdult}
                                    onChange={(e) => setIsAdult(e.target.checked)}
                                />
                                <span>I am 18 years of age or older.</span>
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={isCitizen}
                                    onChange={(e) => setIsCitizen(e.target.checked)}
                                />
                                <span>I am a citizen of the United States.</span>
                            </label>
                        </div>

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
                                type="button"
                                className="dbt-btn dbt-btn--gold"
                                onClick={submit}
                                disabled={!ready || busy}
                            >
                                {busy ? 'Entering…' : 'Enter this debate'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default JoinDebateModal
