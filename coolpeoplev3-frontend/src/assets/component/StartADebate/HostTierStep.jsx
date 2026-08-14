import React, { useEffect, useState } from "react"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { stripePromise, stripeConfigured } from "../../lib/stripe"
import api from "../../lib/api"
import "./HostTierStep.css"

// ============================================================================
// HostTierStep — the screen after an application is submitted.
//
// Submitting is free. This is where the sponsor buys the video-entry capacity
// their debate will consume, as a flat SaaS host fee. It is a PaymentIntent the
// sponsor confirms on-session, NOT a saved card charged later: they are at the
// keyboard, so 3DS resolves now rather than failing days later at approval.
//
// Two steps, deliberately separated:
//   1. pick a tier   → POST /tier gives back a PaymentIntent client_secret
//   2. pay           → <Elements> mounts against that secret, then
//                      POST /tier/confirm has the SERVER re-read the intent from
//                      Stripe before recording anything. The browser saying
//                      "it worked" is not evidence.
//
// Switching tiers before paying re-POSTs and updates the same PaymentIntent, so
// changing your mind doesn't strand one per click.
// ============================================================================

const usd = (cents) =>
    (Number(cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })

// Whole numbers read better than "1,000.00" for a capacity count.
const count = (n) => Number(n || 0).toLocaleString()

function PayForm({ debateId, tier, onPaid }) {
    const stripe = useStripe()
    const elements = useElements()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    // A DIV, not a <form>: this renders inside the application's own form and
    // HTML forbids nested forms — the browser drops the inner one and the button
    // silently becomes a submit for the OUTER form.
    async function handlePay(e) {
        e.preventDefault()
        if (!stripe || !elements) return
        setSubmitting(true)
        setError(null)

        const { error: stripeError } = await stripe.confirmPayment({
            elements,
            redirect: "if_required",
        })
        if (stripeError) {
            setError(stripeError.message)
            setSubmitting(false)
            return
        }

        try {
            // The server verifies with Stripe before believing this.
            const { data } = await api.post(`/api/debate-applications/${debateId}/tier/confirm`)
            onPaid?.(data)
        } catch (err) {
            console.error(err)
            setError(
                err.response?.data?.error ||
                    "Your card went through but we couldn't record it. Refresh and we'll pick it up."
            )
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="tierPayForm">
            <PaymentElement />
            {error && <p className="formError">{error}</p>}
            <button type="button" onClick={handlePay} disabled={!stripe || submitting}>
                {submitting ? "Paying…" : `Pay ${usd(tier.price_cents)}`}
            </button>
            <p className="tierPayNote">
                One-time host fee for {count(tier.entry_cap)} video entries. Charged now; refunded in
                full if an admin rejects your debate.
            </p>
        </div>
    )
}

function HostTierStep({ debateId, onPaid }) {
    const [tiers, setTiers] = useState([])
    const [chosen, setChosen] = useState(null)        // tier_key being purchased
    const [clientSecret, setClientSecret] = useState(null)
    const [starting, setStarting] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        api.get("/api/debate-tiers")
            .then(({ data }) => { if (!cancelled) setTiers(data || []) })
            .catch((err) => { if (!cancelled) setError(err.response?.data?.error || "Couldn't load pricing.") })
        return () => { cancelled = true }
    }, [])

    // Picking a tier creates (or re-prices) the PaymentIntent. clientSecret is
    // cleared first so <Elements> unmounts — it reads the secret at mount and
    // ignores later changes, so reusing the node would keep the old amount.
    async function choose(tier) {
        setError(null)
        setStarting(true)
        setClientSecret(null)
        setChosen(tier.tier_key)
        try {
            const { data } = await api.post(`/api/debate-applications/${debateId}/tier`, {
                tier_key: tier.tier_key,
            })
            setClientSecret(data.client_secret)
        } catch (err) {
            console.error(err)
            setChosen(null)
            setError(err.response?.data?.error || "Couldn't start the payment.")
        } finally {
            setStarting(false)
        }
    }

    if (!stripeConfigured) {
        return (
            <p className="formError">
                Payments aren't configured: VITE_STRIPE_PUBLISHABLE_KEY is empty in the frontend
                .env. Set it to your pk_test_… key and restart the dev server.
            </p>
        )
    }

    const chosenTier = tiers.find((t) => t.tier_key === chosen)

    return (
        <div className="tierStep">
            <div className="tierStepHead">
                <h3>Choose your host plan</h3>
                <p>
                    A one-time fee for the video-entry capacity your debate uses. Your draft is
                    already saved — an admin reviews it once the fee is paid.
                </p>
            </div>

            {error && <p className="formError">{error}</p>}

            <div className="tierCards">
                {tiers.map((t) => (
                    <div
                        key={t.tier_key}
                        className={`tierCard${chosen === t.tier_key ? " tierCardChosen" : ""}`}
                    >
                        <div className="tierCardHead">
                            <h4>{t.display_name}</h4>
                            <span className="tierPrice">{usd(t.price_cents)}</span>
                        </div>
                        <p className="tierEntries">{count(t.entry_cap)} video entries</p>
                        <ul className="tierFeatures">
                            {(t.features || []).map((f) => <li key={f}>{f}</li>)}
                        </ul>
                        <button
                            type="button"
                            className="tierChoose"
                            onClick={() => choose(t)}
                            disabled={starting}
                        >
                            {chosen === t.tier_key ? "Selected" : `Choose ${t.display_name}`}
                        </button>
                    </div>
                ))}
            </div>

            {starting && <p className="cardStepLoading">Starting payment…</p>}

            {clientSecret && chosenTier && (
                // key={clientSecret} forces a fresh <Elements> when the sponsor
                // switches tiers — options.clientSecret is mount-time only.
                <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
                    <PayForm debateId={debateId} tier={chosenTier} onPaid={onPaid} />
                </Elements>
            )}
        </div>
    )
}

export default HostTierStep
