import React, { useEffect, useState } from 'react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { stripePromise } from '../../../lib/stripe'
import api from '../../../lib/api'

// The actual card form. Rendered INSIDE <Elements> so useStripe()/useElements()
// have the loaded Stripe instance + the client-secret-scoped element group.
function CheckoutForm({ onPaid }) {
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
            onPaid?.(paymentIntent)   // parent advances the flow; webhook records it server-side
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
        async function createIntent() {
            try {
                const res = await api.post(`/api/wouldbes/${wouldbeId}/creation-payment-intent`)
                if (!cancelled) setClientSecret(res.data?.client_secret ?? null)
            } catch (err) {
                console.error(err)
                if (!cancelled) setError('Could not start payment. Please try again.')
            }
        }
        if (wouldbeId) createIntent()
        return () => { cancelled = true }
    }, [wouldbeId])

    return (
        <div className="paywall">
            <h2>We charge a fee of $5 to post a WouldBe on our platform</h2>
            {error && <p className="paywallError">{error}</p>}
            {clientSecret ? (
                // The clientSecret scopes this Elements group to THIS PaymentIntent.
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <CheckoutForm onPaid={onPaid} />
                </Elements>
            ) : (
                !error && <p>Loading payment…</p>
            )}
        </div>
    )
}

export default PayWall
