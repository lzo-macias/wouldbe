import React, { useEffect, useMemo, useState } from 'react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { stripePromise, stripeConfigured } from '../../../lib/stripe'
import api from '../../../lib/api'
import './PledgeFlow.css'

// ============================================================================
// PledgeFlow — the three screens behind the Pledge button.
//
//   1  amount     $5 / $25 / $50 / max / custom  -> POST /wouldbes/:id/pledges
//   2  tip        one-off and/or monthly, both skippable
//   3  pay        Stripe PaymentElement, TIP ONLY
//
// WHAT IS AND IS NOT CHARGED. A pledge is a non-binding promise — no money moves
// for it, ever (DB/candidacy/pledges.js: when a goal is hit, pledgers are emailed
// the candidate's own ActBlue/WinRed link). The ONLY thing Stripe touches here is
// the platform tip. Step 1 therefore commits immediately and the card updates
// before any card form appears; steps 2-3 are a separate, optional transaction.
// ============================================================================

const usd = (cents) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100)

// The presets. Option 4 is not in this list: it is the live remaining cap, which
// is per-campaign (wouldbe.pledge_cap_cents) and shrinks as you pledge, so it can
// only come from the server.
const PLEDGE_TIERS = [
    { cents: 500, label: '$5' },
    { cents: 2500, label: '$25', popular: true },
    { cents: 5000, label: '$50' },
]

const TIP_ONCE = [
    { cents: 300, label: '$3' },
    { cents: 500, label: '$5', popular: true },
    { cents: 1000, label: '$10' },
    { cents: 2000, label: '$20' },
]

const TIP_MONTHLY = [
    { cents: 300, label: '$3' },
    { cents: 500, label: '$5', popular: true },
    { cents: 1000, label: '$10' },
    { cents: 2500, label: '$25' },
]

// ---------------------------------------------------------------------------
// Step 3 — the card form. Confirms the one-off tip, the monthly tip, or both.
// ---------------------------------------------------------------------------
function TipCheckout({ tipId, subscriptionId, onDone }) {
    const stripe = useStripe()
    const elements = useElements()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!stripe || !elements) return
        setSubmitting(true)
        setError(null)

        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
        })

        if (stripeError) {
            setError(stripeError.message)
            setSubmitting(false)
            return
        }

        if (paymentIntent?.status === 'succeeded' && tipId) {
            // Nudge the server, same as PayWall does. The webhook is the source of
            // truth but cannot reach localhost; both paths hit the same idempotent
            // confirmer. A failure here is NOT fatal — the money moved and the
            // webhook reconciles — so it must not block the success screen.
            try {
                await api.post(`/api/tips/${tipId}/confirm`)
            } catch (err) {
                console.error('[PledgeFlow] tip confirm failed; webhook will reconcile', err)
            }
        }
        setSubmitting(false)
        onDone()
    }

    return (
        <form onSubmit={handleSubmit} className='pfForm'>
            <PaymentElement />
            {error && <p className='pfError' role='alert'>{error}</p>}
            <button type='submit' className='pfPrimary' disabled={!stripe || submitting}>
                {submitting ? 'Processing…' : 'Confirm tip'}
            </button>
            {/* The pledge is already recorded, so leaving here costs nothing but
                the tip. Saying so removes the fear that backing out undoes it. */}
            <button type='button' className='pfGhost' onClick={onDone} disabled={submitting}>
                Not now — my pledge is already in
            </button>
            {subscriptionId && (
                <p className='pfNote'>
                    Your card is saved for the monthly tip and charged on the same
                    day each month. Cancel any time.
                </p>
            )}
        </form>
    )
}

function PledgeFlow({ wouldbe, onClose, onPledged }) {
    const [step, setStep] = useState(1)
    const [cap, setCap] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const [amount, setAmount] = useState(null)      // chosen pledge, cents
    const [custom, setCustom] = useState('')
    const [pledge, setPledge] = useState(null)      // the created pledge row

    // The own-funds / citizen-or-LPR attestation is a LEGAL gate the pledge route
    // enforces (requireAttestation('us_citizen_or_lpr')). Without a way to give it
    // here, anyone who has never attested gets a 403 they cannot clear — the
    // button would look broken. We don't ask up front: most repeat users already
    // have one on file, so it appears only when the server says it's missing.
    const [needsAttestation, setNeedsAttestation] = useState(false)
    const [attested, setAttested] = useState(false)
    const [pendingCents, setPendingCents] = useState(null)

    const [onceCents, setOnceCents] = useState(null)
    const [monthlyCents, setMonthlyCents] = useState(null)
    const [clientSecret, setClientSecret] = useState(null)
    const [tipId, setTipId] = useState(null)
    const [subscriptionId, setSubscriptionId] = useState(null)

    // The remaining cap decides both the max button and the ceiling on the custom
    // field, so the flow can't open until it's known.
    useEffect(() => {
        let cancelled = false
        async function load() {
            try {
                const { data } = await api.get(`/api/wouldbes/${wouldbe.id}/pledge-cap`)
                if (!cancelled) setCap(data)
            } catch (err) {
                if (cancelled) return
                setError(
                    err.response?.status === 401
                        ? 'Log in to pledge.'
                        : 'Could not load your pledge limit.'
                )
            }
        }
        load()
        return () => { cancelled = true }
    }, [wouldbe.id])

    const remaining = Number(cap?.remaining_cents ?? 0)

    // Presets above the remaining cap are dropped rather than shown disabled: a
    // greyed row of amounts you cannot pick is noise, and the max button already
    // says what the ceiling is.
    const tiers = useMemo(
        () => PLEDGE_TIERS.filter((t) => t.cents <= remaining),
        [remaining]
    )

    const customCents = Math.round(Number(custom.replace(/[^0-9.]/g, '')) * 100)
    const customValid =
        Number.isFinite(customCents) && customCents > 0 && customCents <= remaining

    async function submitPledge(cents) {
        if (!cents || cents > remaining) return
        setBusy(true)
        setError(null)
        try {
            const { data } = await api.post(`/api/wouldbes/${wouldbe.id}/pledges`, {
                amount_cents: cents,
            })
            setPledge(data)
            setAmount(cents)
            setNeedsAttestation(false)
            // Hand the new total up so the card's bar and percentage move NOW,
            // rather than after the modal closes.
            onPledged?.(cents)
            setStep(2)
        } catch (err) {
            const status = err.response?.status
            // 403 from this route means the attestation is missing — show the
            // consent panel and remember the amount so it can be retried in one
            // click instead of making them pick again.
            if (status === 403) {
                setNeedsAttestation(true)
                setPendingCents(cents)
                setBusy(false)
                return
            }
            setError(
                status === 401 ? 'Log in to pledge.'
                : status === 422 ? (err.response?.data?.error || 'That pledge was refused.')
                : err.response?.data?.error || 'Could not record your pledge.'
            )
        } finally {
            setBusy(false)
        }
    }

    // Record the attestation, then retry the pledge that triggered it. The
    // server stamps user_id, ip and attested_at itself — they are legal evidence
    // and are never taken from the body.
    async function attestAndRetry() {
        if (!attested || !pendingCents) return
        setBusy(true)
        setError(null)
        try {
            await api.post('/api/attestations', {
                attestation_type: 'us_citizen_or_lpr',
                attested_value: 'true',
                attestation_version: '1',
                context: 'pledge_flow',
            })
        } catch (err) {
            setError(err.response?.data?.error || 'Could not record your confirmation.')
            setBusy(false)
            return
        }
        setBusy(false)
        await submitPledge(pendingCents)
    }

    // Opens whichever tip transactions were chosen, then moves to the card form.
    // Both are optional and independent: one-off only, monthly only, or both.
    async function submitTip() {
        if (!onceCents && !monthlyCents) return finish()
        setBusy(true)
        setError(null)
        try {
            let secret = null
            if (onceCents) {
                const { data } = await api.post('/api/tips', {
                    tip_amount_cents: onceCents,
                    pledge_id: pledge?.id ?? null,
                })
                setTipId(data.tip?.id ?? null)
                secret = data.client_secret
            }
            if (monthlyCents) {
                const { data } = await api.post('/api/tips/monthly', {
                    amount_cents: monthlyCents,
                })
                setSubscriptionId(data.subscription?.id ?? null)
                // If both were chosen the one-off secret is confirmed first; the
                // subscription's first invoice bills off the card saved here.
                secret = secret || data.client_secret
            }
            if (!secret) return finish()
            setClientSecret(secret)
            setStep(3)
        } catch (err) {
            setError(
                err.response?.status === 503
                    ? 'Card payments are not configured yet — your pledge is still recorded.'
                    : err.response?.data?.error || 'Could not start the tip.'
            )
        } finally {
            setBusy(false)
        }
    }

    function finish() {
        onClose()
    }

    return (
        <div className='pfScrim' onClick={onClose}>
            <div
                className='pfModal'
                role='dialog'
                aria-modal='true'
                aria-label='Pledge'
                onClick={(e) => e.stopPropagation()}
            >
                <button type='button' className='pfClose' onClick={onClose}>x</button>

                {/* ---------------- step 1: the amount ---------------- */}
                {step === 1 && (
                    <>
                        <h3 className='pfTitle'>Pledge to {wouldbe.title}</h3>
                        <p className='pfSub'>
                            A pledge is a promise, not a payment. Nothing is charged
                            now — if the goal is met you'll get a link to give
                            directly to the campaign.
                        </p>

                        {!cap && !error && <p className='pfMuted'>Loading…</p>}

                        {needsAttestation && (
                            <div className='pfAttest'>
                                <label className='pfCheck'>
                                    <input
                                        type='checkbox'
                                        checked={attested}
                                        onChange={(e) => setAttested(e.target.checked)}
                                    />
                                    <span>
                                        I am a U.S. citizen or lawful permanent
                                        resident, and this pledge is from my own
                                        funds — not from another person, a
                                        corporation, or a foreign national.
                                    </span>
                                </label>
                                <button
                                    type='button'
                                    className='pfPrimary'
                                    disabled={!attested || busy}
                                    onClick={attestAndRetry}
                                >
                                    {busy ? 'Working…' : `Confirm and pledge ${usd(pendingCents || 0)}`}
                                </button>
                            </div>
                        )}

                        {cap && remaining <= 0 && (
                            <p className='pfMuted'>
                                You've reached your {usd(Number(cap.cap_cents))} limit
                                for this campaign.
                            </p>
                        )}

                        {cap && remaining > 0 && (
                            <>
                                <div className='pfTiers'>
                                    {tiers.map((t) => (
                                        <button
                                            key={t.cents}
                                            type='button'
                                            className={`pfTier${t.popular ? ' pfTier--popular' : ''}`}
                                            disabled={busy}
                                            onClick={() => submitPledge(t.cents)}
                                        >
                                            <span className='pfTierAmt'>{t.label}</span>
                                            {t.popular && <span className='pfBadge'>most popular</span>}
                                        </button>
                                    ))}
                                    <button
                                        type='button'
                                        className='pfTier pfTier--max'
                                        disabled={busy}
                                        onClick={() => submitPledge(remaining)}
                                    >
                                        <span className='pfTierAmt'>{usd(remaining)}</span>
                                        <span className='pfBadge'>
                                            {Number(cap.used_cents) > 0 ? 'all you have left' : 'max this cycle'}
                                        </span>
                                    </button>
                                </div>

                                <div className='pfCustom'>
                                    <label htmlFor='pfCustomAmt'>Enter your own amount</label>
                                    <div className='pfCustomRow'>
                                        <input
                                            id='pfCustomAmt'
                                            className='pfInput'
                                            inputMode='decimal'
                                            placeholder='0.00'
                                            value={custom}
                                            onChange={(e) => setCustom(e.target.value)}
                                        />
                                        <button
                                            type='button'
                                            className='pfPrimary'
                                            disabled={busy || !customValid}
                                            onClick={() => submitPledge(customCents)}
                                        >
                                            Pledge
                                        </button>
                                    </div>
                                    {custom && !customValid && (
                                        <p className='pfError'>
                                            Enter an amount between $0.01 and {usd(remaining)}.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                        {error && <p className='pfError' role='alert'>{error}</p>}
                    </>
                )}

                {/* ---------------- step 2: the tip ---------------- */}
                {step === 2 && (
                    <>
                        <h3 className='pfTitle'>{usd(amount)} pledged. Thank you.</h3>
                        <p className='pfSub'>
                            WouldBe takes nothing from campaigns. If you want to keep
                            this running, you can tip the platform — entirely optional.
                        </p>

                        <span className='pfLabel'>One-time</span>
                        <div className='pfTiers pfTiers--tip'>
                            {TIP_ONCE.map((t) => (
                                <button
                                    key={t.cents}
                                    type='button'
                                    className={`pfTier${onceCents === t.cents ? ' is-on' : ''}${t.popular ? ' pfTier--popular' : ''}`}
                                    onClick={() => setOnceCents(onceCents === t.cents ? null : t.cents)}
                                >
                                    <span className='pfTierAmt'>{t.label}</span>
                                    {t.popular && <span className='pfBadge'>most popular</span>}
                                </button>
                            ))}
                        </div>

                        <span className='pfLabel'>Monthly</span>
                        <div className='pfTiers pfTiers--tip'>
                            {TIP_MONTHLY.map((t) => (
                                <button
                                    key={t.cents}
                                    type='button'
                                    className={`pfTier${monthlyCents === t.cents ? ' is-on' : ''}${t.popular ? ' pfTier--popular' : ''}`}
                                    onClick={() => setMonthlyCents(monthlyCents === t.cents ? null : t.cents)}
                                >
                                    <span className='pfTierAmt'>{t.label}<small>/mo</small></span>
                                    {t.popular && <span className='pfBadge'>most popular</span>}
                                </button>
                            ))}
                        </div>

                        {error && <p className='pfError' role='alert'>{error}</p>}

                        <div className='pfActions'>
                            <button
                                type='button'
                                className='pfPrimary'
                                disabled={busy || (!onceCents && !monthlyCents)}
                                onClick={submitTip}
                            >
                                {busy ? 'Working…'
                                    : onceCents && monthlyCents ? `Tip ${usd(onceCents)} + ${usd(monthlyCents)}/mo`
                                    : onceCents ? `Tip ${usd(onceCents)}`
                                    : monthlyCents ? `Tip ${usd(monthlyCents)}/mo`
                                    : 'Continue'}
                            </button>
                            <button type='button' className='pfGhost' onClick={finish} disabled={busy}>
                                Skip
                            </button>
                        </div>
                    </>
                )}

                {/* ---------------- step 3: the card ---------------- */}
                {step === 3 && (
                    <>
                        <h3 className='pfTitle'>Complete your tip</h3>
                        <p className='pfSub'>
                            {onceCents && monthlyCents
                                ? `${usd(onceCents)} now, then ${usd(monthlyCents)} monthly.`
                                : onceCents ? `${usd(onceCents)} — one time.`
                                : `${usd(monthlyCents)} monthly.`}
                            {' '}Your {usd(amount)} pledge is already recorded.
                        </p>
                        {!stripeConfigured ? (
                            <p className='pfError'>
                                Card payments are not configured. Your pledge is
                                recorded — the tip can wait.
                            </p>
                        ) : (
                            <Elements stripe={stripePromise} options={{ clientSecret }}>
                                <TipCheckout
                                    tipId={tipId}
                                    subscriptionId={subscriptionId}
                                    onDone={finish}
                                />
                            </Elements>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default PledgeFlow
