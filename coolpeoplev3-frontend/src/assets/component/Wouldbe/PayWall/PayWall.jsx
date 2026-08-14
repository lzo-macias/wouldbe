import React, { useEffect, useState } from 'react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { stripePromise } from '../../../lib/stripe'
import api from '../../../lib/api'

// The actual card form. Rendered INSIDE <Elements> so useStripe()/useElements()
// have the loaded Stripe instance + the client-secret-scoped element group.
function CheckoutForm({ wouldbeId, onPaid }) {
    const stripe = useStripe()
    const elements = useElements()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!stripe || !elements) return   // Stripe.js not loaded yet
        setSubmitting(true)
        setError(null)

        // redirect: 'if_required' keeps the user on-page for card payments and
        // only redirects for methods that demand it. On success we get the
        // PaymentIntent back directly.
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
        })

        if (stripeError) {
            setError(stripeError.message)
            setSubmitting(false)
            return
        }
        if (paymentIntent?.status === 'succeeded') {
            // Tell the server the charge landed. The WEBHOOK is the source of
            // truth, but it's a server-to-server callback Stripe cannot deliver
            // to localhost — so without this the fee never clears in development
            // and every campaign sits behind a disabled Approve button.
            //
            // We send only the id: the route retrieves the PaymentIntent from
            // Stripe and checks the status itself, so this is a nudge, not a
            // claim. Both paths call the same idempotent confirmer (it updates
            // WHERE status = 'pending'), so whichever lands first wins.
            //
            // Failure here is NOT fatal: the money moved and the webhook will
            // reconcile. Blocking the user on our own bookkeeping would be worse
            // than a short delay before the fee shows as paid.
            try {
                await api.post(`/api/wouldbes/${wouldbeId}/creation-payment/confirm`, {
                    payment_intent_id: paymentIntent.id,
                })
            } catch (recordErr) {
                console.error('[PayWall] confirm failed; webhook will reconcile', recordErr)
            }
            onPaid?.(paymentIntent)
        }
        setSubmitting(false)
    }

    return (
        <form onSubmit={handleSubmit} className="paywallForm">
            <PaymentElement />
            {error && <p className="paywallError">{error}</p>}
            <button type="submit" disabled={!stripe || submitting}>
                {submitting ? 'Processing…' : 'Pay $5'}
            </button>
        </form>
    )
}

// PayWall — creates the $5 creation-fee PaymentIntent for a draft WouldBe, then
// renders the embedded Stripe form. `wouldbeId` is the draft to charge for;
// `onPaid` fires once the charge succeeds so the parent can proceed to launch.
function PayWall({ wouldbeId, onPaid }) {
    const [clientSecret, setClientSecret] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        // No id means the caller never created the campaign. Say so — the old
        // code just skipped the fetch and left "Loading payment…" on screen
        // forever with nothing in the console to explain it.
        if (!wouldbeId) {
            setError("No campaign to pay for — the draft wasn't created.")
            return
        }
        async function createIntent() {
            try {
                const res = await api.post(`/api/wouldbes/${wouldbeId}/creation-payment-intent`)
                if (!cancelled) setClientSecret(res.data?.client_secret ?? null)
            } catch (err) {
                console.error(err)
                if (!cancelled) setError('Could not start payment. Please try again.')
            }
        }
        createIntent()
        return () => { cancelled = true }
    }, [wouldbeId])

    return (
        <div className="paywall">
            <h2>We charge a fee of $5 to post a WouldBe on our platform</h2>
            {error && <p className="paywallError">{error}</p>}
            {clientSecret ? (
                // The clientSecret scopes this Elements group to THIS PaymentIntent.
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <CheckoutForm wouldbeId={wouldbeId} onPaid={onPaid} />
                </Elements>
            ) : (
                !error && <p>Loading payment…</p>
            )}
        </div>
    )
}

export default PayWall
