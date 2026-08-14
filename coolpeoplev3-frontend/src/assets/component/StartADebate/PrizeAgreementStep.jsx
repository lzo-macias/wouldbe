import React, { useEffect, useState } from "react"
import api from "../../lib/api"
import "./PrizeAgreementStep.css"

// ============================================================================
// PrizeAgreementStep — the contract a cash-prize sponsor signs after submitting.
//
// WHY IT EXISTS: a cash prize is a promise to hand money to a stranger picked by
// a public vote. If the sponsor doesn't pay, the winner comes to the platform.
// This screen is where that promise is made, and the row it writes is the record
// of it: the typed name, the exact terms, the amount, the time, the IP.
//
// THE TERMS COME FROM THE SERVER. They are not written in this file. The server
// substitutes the real amount, hashes the exact bytes, and records that hash
// alongside the signature — so "which words did they agree to" has an answer
// later even if the wording is revised. A client-side copy of the contract could
// silently drift from what gets recorded, which is the one thing a contract
// cannot do.
//
// EVERY prize type signs this — cash, something else, or both. The prize itself
// is one substituted phrase inside clause 1, so the same contract covers all
// three without branching.
// ============================================================================

function PrizeAgreementStep({ debateId, onSigned }) {
    const [terms, setTerms] = useState(null)
    const [signature, setSignature] = useState("")
    const [accepted, setAccepted] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        api.get(`/api/debate-applications/${debateId}/prize-agreement`)
            .then(({ data }) => { if (!cancelled) setTerms(data) })
            .catch((err) => {
                if (cancelled) return
                setError(err.response?.data?.error || "Couldn't load the agreement.")
            })
        return () => { cancelled = true }
    }, [debateId])

    async function sign() {
        setError(null)
        if (!accepted) return setError("Tick the box to confirm you agree to these terms.")
        if (signature.trim().length < 2) return setError("Type your full name to sign.")

        setSaving(true)
        try {
            // Only the name goes up. The amount and the terms are the server's,
            // so nothing here can sign for a figure the sponsor never saw.
            const { data } = await api.post(`/api/debate-applications/${debateId}/prize-agreement`, {
                signature_name: signature.trim(),
            })
            onSigned?.(data)
        } catch (err) {
            console.error(err)
            setError(err.response?.data?.error || "Couldn't record the signature.")
        } finally {
            setSaving(false)
        }
    }

    if (error && !terms) return <p className="formError">{error}</p>
    if (!terms) return <p className="cardStepLoading">Loading the agreement…</p>

    return (
        <div className="prizeAgreement">
            <div className="prizeAgreementHead">
                <h3>Prize agreement</h3>
                <p>
                    You're offering <strong>{terms.prize_display}</strong> to the winner. Read this
                    and sign before your debate goes to review.
                </p>
            </div>

            {/* Clauses arrive as {heading, body} with the prize already
                substituted server-side — the contract is never assembled here,
                so what's on screen is exactly what gets hashed and signed. */}
            <ol className="prizeClauses">
                {terms.clauses.map((c) => (
                    <li key={c.heading}>
                        <strong>{c.heading}.</strong> {c.body}
                    </li>
                ))}
            </ol>

            <label className="prizeAccept">
                <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                />
                I have read and agree to these terms.
            </label>

            <label htmlFor="signature" className="prizeSignLabel">Signature — type your full name</label>
            <input
                id="signature"
                type="text"
                className="prizeSignInput"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Jane Q. Sponsor"
                autoComplete="name"
            />

            <p className="prizeVersion">
                Version {terms.version}. Your name, the time, and your IP address are recorded with
                this signature.
            </p>

            {error && <p className="formError">{error}</p>}

            {/* type="button": this renders inside the application's own <form>. */}
            <button type="button" className="prizeSignButton" onClick={sign} disabled={saving}>
                {saving ? "Signing…" : "Sign and continue"}
            </button>
        </div>
    )
}

export default PrizeAgreementStep
