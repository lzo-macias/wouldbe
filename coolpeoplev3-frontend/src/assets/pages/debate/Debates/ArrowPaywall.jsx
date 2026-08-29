import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import './ArrowPaywall.css'

// ============================================================================
// THE DOOR, when you can't open it yet.
//
// THREE WAYS IN, and the panel shows all three because they are genuinely
// different offers rather than tiers of one:
//
//   EARNED       enough standing arrows for THIS debate's door. Free, and the
//                only one that says anything about you. Listed first, always.
//   THIS ONE     $5, this question, for good.
//   ANY OF THEM  $10 a month.
//
// THE ARROW CALCULATOR THAT USED TO BE HERE IS GONE. Arrows are not for sale
// any more — standing you can buy is not standing — so there is nothing left to
// calculate. Money buys a pass now, and a pass has one price.
//
// The earned route stays at the top and is never collapsed behind the paid
// ones. A door that only shows its price is a paywall; one that shows the price
// and the way around it is a choice.
// ============================================================================

const usd = (cents) => {
    const n = (Number(cents) || 0) / 100
    // Whole dollars read as "$5", not "$5.00" — this is a price tag, not a
    // receipt, and trailing zeroes are noise at a glance.
    return `$${n % 1 === 0 ? n : n.toFixed(2)}`
}

function ArrowPaywall({ debateId, promptId = null, gate: seeded = null, onClose }) {
    // The refusal already carried the numbers, so the panel renders before any
    // request — and shows literally the figures that refused, rather than a
    // second read that might come back different.
    const [gate, setGate] = useState(seeded)
    const [busy, setBusy] = useState(null)
    const [error, setError] = useState(null)
    const [pending, setPending] = useState(null)

    useEffect(() => {
        if (seeded) return
        let cancelled = false
        ;(async () => {
            try {
                const { data } = await api.get('/api/me/may-respond', {
                    params: { debate_id: debateId, prompt_id: promptId },
                })
                if (!cancelled) setGate(data)
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || 'Could not load the price.')
            }
        })()
        return () => { cancelled = true }
    }, [debateId, promptId, seeded])

    // One handler for both purchases — they differ only in the endpoint, so
    // branching the whole flow would be two copies of the same error handling.
    const start = async (what) => {
        setBusy(what)
        setError(null)
        try {
            const { data } =
                what === 'pass'
                    ? await api.post('/api/response-passes', { prompt_id: promptId })
                    : await api.post('/api/responder-subscription', {})
            if (data.payments_configured === false) {
                setError("Payments aren't switched on yet. Win a debate in the meantime — that's free.")
                return
            }
            setPending({ what, ...data })
        } catch (err) {
            setError(
                err.response?.status === 503
                    ? "Payments aren't switched on yet. Win a debate in the meantime — that's free."
                    : err.response?.data?.error || 'Could not start that.'
            )
        } finally {
            setBusy(null)
        }
    }

    if (!gate) {
        return (
            <div className="ap-scrim" role="dialog" aria-modal="true">
                <div className="ap-card"><p className="ap-note">Checking the door…</p></div>
            </div>
        )
    }

    const single = gate.single_pass_cents ?? 500
    const sub = gate.subscription_cents ?? 1000

    return (
        <div className="ap-scrim" role="dialog" aria-modal="true" aria-label="How to answer this prompt">
            <div className="ap-card">
                <button type="button" className="ap-x" onClick={onClose} aria-label="Close">×</button>

                <span className="ap-kicker">Answering this one</span>
                <h2 className="ap-title">
                    {gate.signed_out
                        ? 'You can add your own answer here'
                        : 'Three ways to answer this'}
                </h2>
                <p className="ap-dek">
                    Anyone can read and comment. Adding your own answer to a match you are
                    not in is the part that takes standing — or a pass.
                </p>

                {/* THE FREE ROUTE FIRST, and never collapsed. */}
                <div className="ap-option ap-option--earned">
                    <div className="ap-option__head">
                        <b>Earn it</b>
                        <span className="ap-free">Free</span>
                    </div>
                    <p>
                        Arrows are earned by <b>winning a debate</b>, even free ones. This
                        debate&apos;s door is <b>{gate.threshold}</b>
                        {!gate.signed_out && <> and you have <b>{gate.trophy_count}</b></>}.
                    </p>
                    {/* Where the number came from. A door whose price is a mystery
                        reads as arbitrary; itemised, it reads as a rule. */}
                    <ul className="ap-breakdown">
                        <li><span>To walk into any debate</span><b>{gate.base}</b></li>
                        {gate.from_prize > 0 && (
                            <li><span>Because there&apos;s a cash prize on it</span><b>+{gate.from_prize}</b></li>
                        )}
                        {gate.from_field > 0 && (
                            <li><span>Because {gate.nominee_count} people were nominated</span><b>+{gate.from_field}</b></li>
                        )}
                    </ul>
                </div>

                {gate.signed_out ? (
                    <>
                        <a className="wb-btn wb-btn--primary ap-cta" href="/login">
                            Sign in to answer
                        </a>
                        <button type="button" className="ap-later" onClick={onClose}>
                            Keep reading
                        </button>
                    </>
                ) : pending ? (
                    <p className="ap-note">
                        {pending.what === 'pass'
                            ? 'Pass started. Finish paying and this prompt opens as soon as the payment clears — we confirm that with the processor, not with this page.'
                            : 'Subscription started. Finish paying and every prompt opens as soon as it clears.'}
                    </p>
                ) : (
                    <>
                        <div className="ap-option">
                            <div className="ap-option__head">
                                <b>Just this one</b>
                                <span className="ap-price">{usd(single)}</span>
                            </div>
                            <p>Opens this prompt for good. Edit your answer as often as you like.</p>
                            <button
                                type="button"
                                className="wb-btn wb-btn--secondary"
                                disabled={!!busy || !promptId}
                                onClick={() => start('pass')}
                            >
                                {busy === 'pass' ? 'Starting…' : `Unlock this one — ${usd(single)}`}
                            </button>
                        </div>

                        <div className="ap-option ap-option--best">
                            <div className="ap-option__head">
                                <b>Any of them</b>
                                <span className="ap-price">{usd(sub)}<small>/month</small></span>
                            </div>
                            <p>
                                Answer any prompt in any debate, as often as you like. Cancel
                                whenever — it runs to the end of the month you paid for.
                            </p>
                            <button
                                type="button"
                                className="wb-btn wb-btn--primary"
                                disabled={!!busy}
                                onClick={() => start('subscription')}
                            >
                                {busy === 'subscription' ? 'Starting…' : `Subscribe — ${usd(sub)}/month`}
                            </button>
                        </div>
                    </>
                )}

                {error && <p className="ap-error" role="alert">{error}</p>}

                {!gate.signed_out && (
                    <button type="button" className="ap-later" onClick={onClose}>
                        Not now
                    </button>
                )}
            </div>
        </div>
    )
}

export default ArrowPaywall
