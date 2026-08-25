import React, { useEffect, useState } from "react"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { stripePromise, stripeConfigured } from "../../lib/stripe"
import api from "../../lib/api"
import "./SponsorCardStep.css"

// ============================================================================
// SponsorCardStep — the card step that runs AFTER the application is submitted
// and BEFORE an admin approves it.
//
// This is a SetupIntent, not a PaymentIntent: it saves the card and records the
// sponsor's agreement, but moves no money and places no authorization hold. The
// charge happens server-side when an admin approves, with the sponsor doing
// nothing. If the application is denied, they are never charged and the card is
// detached.
//
// Two things make it a SetupIntent rather than a manual-capture hold:
//   - a card authorization expires in ~7 days, so a slow review would void it
//   - a hold ties up the sponsor's credit for money you may never take
//
// The disclosure block is not decoration. Stripe requires the amount and timing
// be shown before a card is saved for off-session use, and the server freezes
// those same figures onto the debate as the mandate — so what's rendered here is
// exactly what gets charged, and neither side can drift.
// ============================================================================

const usd = (cents) =>
    (Number(cents || 0) / 100).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
    })

// The inner form. Must be rendered inside <Elements> so the Stripe hooks see the
// loaded instance and the client-secret-scoped element group.
function CardForm({ debateId, amounts, onAuthorized }) {
    const stripe = useStripe()
    const elements = useElements()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    async function handleSubmit(e) {
        e.preventDefault()   // kept: the button is type="button", but this also
                             // stops a stray Enter keypress bubbling to the
                             // application form that wraps this step
        if (!stripe || !elements) return // Stripe.js still loading
        setSubmitting(true)
        setError(null)

        // confirmSetup, NOT confirmPayment — saves the card without charging.
        // redirect: 'if_required' keeps the user here for cards and only leaves
        // the page for methods that genuinely demand a redirect.
        const { error: stripeError, setupIntent } = await stripe.confirmSetup({
            elements,
            redirect: "if_required",
        })

        if (stripeError) {
            setError(stripeError.message)
            setSubmitting(false)
            return
        }

        try {
            // Tell our server which payment method to charge on approval. The
            // AMOUNTS are not sent — the server recomputes them from the debate,
            // so a tampered request can't set its own price.
            const { data } = await api.post(`/api/debate-applications/${debateId}/mandate`, {
                payment_method_id: setupIntent.payment_method,
            })
            onAuthorized?.(data)
        } catch (err) {
            console.error(err)
            setError(err.response?.data?.error || "Card saved, but we couldn't record it. Please retry.")
        } finally {
            setSubmitting(false)
        }
    }

    // A DIV, not a <form>. This step renders inside the application's own
    // <form>, and HTML forbids nested forms — the browser drops the inner one,
    // which silently turns this step's submit button into a submit for the
    // OUTER form (re-submitting the whole application instead of saving a card).
    // A plain onClick has no such ambiguity.
    return (
        <div className="cardStepForm">
            <PaymentElement />

            <div className="cardStepDisclosure">
                <div className="cardStepLine">
                    <span>Prize</span>
                    <strong>{usd(amounts.prize_cents)}</strong>
                </div>
                <div className="cardStepLine">
                    <span>Platform fee ({amounts.platform_fee_pct}%)</span>
                    <strong>{usd(amounts.platform_fee_cents)}</strong>
                </div>
                <div className="cardStepLine cardStepTotal">
                    <span>Charged on approval</span>
                    <strong>{usd(amounts.total_cents)}</strong>
                </div>
                <p className="cardStepNote">
                    You are not being charged now. We'll charge{" "}
                    <strong>{usd(amounts.total_cents)}</strong> to this card only if an admin
                    approves your debate — usually within a day. If it's declined, you won't be
                    charged and the card will be removed.
                </p>
            </div>

            {error && <p className="formError">{error}</p>}

            <button type="button" onClick={handleSubmit} disabled={!stripe || submitting}>
                {submitting ? "Authorizing…" : "Authorize payment"}
            </button>
        </div>
    )
}

// Outer: fetches the SetupIntent client secret (and the amounts to disclose),
// then mounts <Elements>. Elements needs the clientSecret at mount time, so it
// can't render until the request resolves.
function SponsorCardStep({ debateId, onAuthorized }) {
    const [clientSecret, setClientSecret] = useState(null)
    const [amounts, setAmounts] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        // Nothing to fetch if Stripe can't mount anyway — say so instead of
        // leaving the step on "Loading payment step…" forever.
        if (!stripeConfigured) return
        let cancelled = false
        async function start() {
            try {
                const { data } = await api.post(`/api/debate-applications/${debateId}/setup-intent`)
                if (cancelled) return
                setClientSecret(data.client_secret)
                setAmounts({
                    prize_cents: data.prize_cents,
                    platform_fee_cents: data.platform_fee_cents,
                    platform_fee_pct: data.platform_fee_pct,
                    total_cents: data.total_cents,
                })
            } catch (err) {
                console.error(err)
                if (!cancelled) setError(err.response?.data?.error || "Couldn't start the payment step.")
            }
        }
        if (debateId) start()
        return () => { cancelled = true }
    }, [debateId])

    if (!stripeConfigured) {
        return (
            <p className="formError">
                Payments aren't configured: VITE_STRIPE_PUBLISHABLE_KEY is empty in the
                frontend .env. Set it to your pk_test_… key and restart the dev server.
            </p>
        )
    }
    if (error) return <p className="formError">{error}</p>
    if (!clientSecret || !amounts) return <p className="cardStepLoading">Loading payment step…</p>

    return (
        <div className="cardStep">
            <h3 className="cardStepHead">Payment details</h3>
            <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CardForm debateId={debateId} amounts={amounts} onAuthorized={onAuthorized} />
            </Elements>
        </div>
    )
}

export default SponsorCardStep
