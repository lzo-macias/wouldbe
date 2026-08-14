const { client } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// Debate host tiers — the flat SaaS fee a sponsor pays for video-entry capacity.
//
// THE FLOW, and why each step is where it is:
//   1. submit    the application is free. Nothing is collected, so a sponsor is
//                never out of pocket for a draft they abandon.
//   2. startTierPayment(tier)  creates a PaymentIntent for the tier price and
//                hands back a client_secret. Priced from the CATALOG, never from
//                the request body — a client that sends its own amount is
//                choosing what to pay.
//   3. confirmTierPayment()   the browser confirms with Stripe, then tells us.
//                We RE-READ the PaymentIntent from Stripe rather than believing
//                the browser, and only then stamp tier_paid_at.
//   4. approve   requires tier_paid_at. No fee, no review.
//
// WHY ON-SESSION, NOT A SAVED CARD: the sponsor is at the keyboard when they pick
// a tier, so 3DS resolves right there. The old model saved a card and charged it
// days later at approval, which is where `authentication_required` came from.
//
// THE COST OF CHARGING FIRST: a rejected debate has already paid. That is a
// refund, and tier_refunded_at records it — see markTierRefunded.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// listTiers — the price list for the pricing cards. Public: a sponsor has to see
// what they'd pay before submitting anything.
const listTiers = async ({ include_inactive = false } = {}) => {
    const { rows } = await client.query(
        `SELECT * FROM debate_host_tiers
         WHERE ($1::boolean IS TRUE OR is_active = true)
         ORDER BY sort_order, price_cents`,
        [include_inactive]
    );
    return rows;
};

const getTier = async ({ tier_key }, db = client) => {
    if (!tier_key) throw httpError(400, "tier_key is required");
    const { rows } = await db.query(
        `SELECT * FROM debate_host_tiers WHERE tier_key = $1 AND is_active = true`,
        [tier_key]
    );
    if (!rows.length) throw httpError(400, `unknown tier: ${tier_key}`);
    return rows[0];
};

// loadOwnedDebate — the debate plus proof the caller is its sponsor. user_id
// comes from the token, so one sponsor can never pay for (or read) another's
// application. Mirrors loadOwnedDraft in sponsorFunding.js.
const loadOwnedDebate = async ({ debate_id, user_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows } = await db.query(
        `SELECT d.*, s.user_id AS sponsor_user_id
         FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id]
    );
    const debate = rows[0];
    if (!debate) throw httpError(404, "debate not found");
    if (user_id && debate.sponsor_user_id !== user_id) {
        throw httpError(403, "you are not the sponsor of this debate");
    }
    return debate;
};

// startTierPayment — create the PaymentIntent for a chosen tier.
//
// Idempotent on re-entry: a sponsor who reloads the page or switches tiers gets
// the SAME PaymentIntent updated to the new amount rather than a trail of
// abandoned ones. Stripe only allows amount updates while the intent is still
// unconfirmed, which is exactly the window this covers.
const startTierPayment = async ({ debate_id, user_id, tier_key }) => {
    const debate = await loadOwnedDebate({ debate_id, user_id });
    if (debate.tier_paid_at) throw httpError(409, "this debate's host fee is already paid");
    if (debate.status !== "draft") throw httpError(409, "this debate is no longer awaiting approval");

    const tier = await getTier({ tier_key });

    let intent;
    if (debate.tier_payment_intent_id) {
        const existing = await stripe.retrievePaymentIntent({
            payment_intent_id: debate.tier_payment_intent_id,
        });
        // 'succeeded' shouldn't be reachable (tier_paid_at would be set), but if
        // confirm never landed, recover instead of charging a second time.
        if (existing.status === "succeeded") {
            return finalizeTierPayment({ debate, tier, intent: existing });
        }
        intent = await stripe.updatePaymentIntent({
            payment_intent_id: existing.id,
            amount_cents: Number(tier.price_cents),
            metadata: { kind: "debate_host_fee", debate_id, tier_key: tier.tier_key },
        });
    } else {
        intent = await stripe.createPaymentIntent({
            amount_cents: Number(tier.price_cents),
            metadata: { kind: "debate_host_fee", debate_id, tier_key: tier.tier_key },
        });
    }

    // The chosen tier is recorded now so the admin inbox can show "picked Pro,
    // hasn't paid" — an abandoned checkout is information, not nothing.
    await client.query(
        `UPDATE debates SET tier_key = $2, tier_price_cents = $3, entry_cap = $4,
                            tier_payment_intent_id = $5, updated_at = NOW()
         WHERE id = $1`,
        [debate_id, tier.tier_key, tier.price_cents, tier.entry_cap, intent.id]
    );

    return {
        debate_id,
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        tier: {
            tier_key: tier.tier_key,
            display_name: tier.display_name,
            price_cents: Number(tier.price_cents),
            entry_cap: tier.entry_cap,
            features: tier.features,
        },
    };
};

// finalizeTierPayment — record a PaymentIntent we have CONFIRMED with Stripe.
// Split out so both the normal confirm path and the recovery path above write
// the same rows. Idempotent: re-running for an already-paid debate is a no-op.
const finalizeTierPayment = async ({ debate, tier, intent }) => {
    const { rows: already } = await client.query(
        `SELECT tier_paid_at FROM debates WHERE id = $1`, [debate.id]
    );
    if (already[0]?.tier_paid_at) {
        return { debate_id: debate.id, tier_key: debate.tier_key, already_paid: true };
    }

    await client.query(
        `INSERT INTO debate_payments (
            user_id, debate_id, payment_type, amount_cents, currency,
            platform_amount_cents, status, stripe_payment_intent_id
         )
         VALUES ($1, $2, 'debate_host_fee', $3, 'usd', $3, 'succeeded', $4)`,
        [debate.sponsor_user_id, debate.id, intent.amount, intent.id]
    );

    const { rows } = await client.query(
        `UPDATE debates
         SET tier_key = $2, tier_price_cents = $3, entry_cap = $4,
             tier_payment_intent_id = $5, tier_paid_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [debate.id, tier.tier_key, intent.amount, tier.entry_cap, intent.id]
    );

    return {
        debate_id: debate.id,
        tier_key: tier.tier_key,
        entry_cap: tier.entry_cap,
        paid_cents: intent.amount,
        tier_paid_at: rows[0].tier_paid_at,
        debate: rows[0],
    };
};

// confirmTierPayment — the browser says it confirmed; verify that with Stripe.
//
// Everything here is checked against the PaymentIntent Stripe returns, not
// against the request: status must be 'succeeded', the intent must be the one we
// created for THIS debate, and the amount must match the catalog price. Skipping
// any of those turns "I paid" into a claim anyone can make.
const confirmTierPayment = async ({ debate_id, user_id }) => {
    const debate = await loadOwnedDebate({ debate_id, user_id });
    if (debate.tier_paid_at) {
        return { debate_id, tier_key: debate.tier_key, already_paid: true };
    }
    if (!debate.tier_payment_intent_id) {
        throw httpError(409, "no payment has been started for this debate");
    }

    const intent = await stripe.retrievePaymentIntent({
        payment_intent_id: debate.tier_payment_intent_id,
    });

    if (intent.status !== "succeeded") {
        throw httpError(402, `the host fee has not been paid (payment is ${intent.status})`);
    }
    if (intent.metadata?.debate_id && intent.metadata.debate_id !== debate_id) {
        throw httpError(400, "that payment belongs to a different debate");
    }

    const tier = await getTier({ tier_key: debate.tier_key });
    if (Number(intent.amount) !== Number(tier.price_cents)) {
        throw httpError(400, "the amount paid does not match the tier price");
    }

    return finalizeTierPayment({ debate, tier, intent });
};

// getTierStatus — what the sponsor's own screen and the admin inbox both read.
const getTierStatus = async ({ debate_id, user_id = null }) => {
    const debate = await loadOwnedDebate({ debate_id, user_id });
    return {
        debate_id,
        status: debate.status,
        tier_key: debate.tier_key,
        tier_price_cents: debate.tier_price_cents,
        entry_cap: debate.entry_cap,
        paid: !!debate.tier_paid_at,
        tier_paid_at: debate.tier_paid_at,
        refunded_at: debate.tier_refunded_at,
        rejection_reason: debate.rejection_reason,
    };
};

// markTierRefunded — bookkeeping for a refunded host fee.
//
// It does NOT call Stripe. Issuing the refund is a deliberate, human decision and
// there is no route that does it yet; this records that it happened so the admin
// view stops showing a rejected debate as "paid, no refund". Wire it to
// stripe.createRefund when the refund route is built.
const markTierRefunded = async ({ debate_id }) => {
    const { rows } = await client.query(
        `UPDATE debates SET tier_refunded_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING id, tier_refunded_at`,
        [debate_id]
    );
    if (!rows.length) throw httpError(404, "debate not found");
    await client.query(
        `UPDATE debate_payments SET status = 'refunded'
         WHERE debate_id = $1 AND payment_type = 'debate_host_fee' AND status = 'succeeded'`,
        [debate_id]
    );
    return rows[0];
};

module.exports = {
    listTiers,
    getTier,
    startTierPayment,
    confirmTierPayment,
    getTierStatus,
    markTierRefunded,
};
