const { client, withTransaction } = require("../index.js");

// ============================================================================
// MAY THIS PERSON ANSWER THIS PROMPT — the three ways in, in one place.
//
//   EARNED        enough standing arrows for THIS debate's door. Free, and the
//                 only one that means anything about you.
//   SUBSCRIBED    $10 a month, any prompt, as often as you like.
//   A PASS        $5, this one question.
//
// WHY MONEY BUYS ACCESS AND NOT ARROWS. Arrows used to be purchasable, which
// was wrong on its own terms: standing you can buy is not standing, and it made
// the number under somebody's name mean two different things depending on how
// they got it. A pass is honest about what it is — it opens a door, it does not
// say you belong on the other side of it — and the leaderboards that read
// arrows keep meaning what they meant.
//
// THE ORDER MATTERS. Earned is checked first, so somebody who qualifies is never
// shown a price, and a subscriber is never charged $5 for something their
// subscription already covers.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// One question, once. Priced against the thing it buys — a single argument in
// somebody else's match — rather than against a currency.
const SINGLE_PASS_CENTS = 500;

// Any question, for a month.
const SUBSCRIPTION_CENTS = 1000;

// The tier string written to subscriptions.tier. One constant, because the
// write, the lookup and the webhook all have to agree on the spelling.
const RESPONDER_TIER = "responder";

// hasResponderSubscription — is this person paid up right now?
//
// 'trialing' counts: a trial that cannot use the thing it is trialling is not a
// trial. 'past_due' does NOT — Stripe is still retrying, but the month it was
// meant to cover has lapsed, and letting it through is how a failed card
// becomes indefinite free access.
const hasResponderSubscription = async ({ user_id }, db = client) => {
    if (!user_id) return null;
    const { rows } = await db.query(
        `SELECT id, status, current_period_end, cancel_at_period_end
           FROM subscriptions
          WHERE user_id = $1
            AND tier = $2
            AND status IN ('active','trialing')
            -- A cancelled-at-period-end subscription is still paid for until
            -- the period actually ends, which is what this date is for.
            AND (current_period_end IS NULL OR current_period_end > NOW())
          ORDER BY current_period_end DESC NULLS LAST
          LIMIT 1`,
        [user_id, RESPONDER_TIER]
    );
    return rows[0] || null;
};

// hasPassFor — has this person already paid for this exact question?
const hasPassFor = async ({ user_id, prompt_id }, db = client) => {
    if (!user_id || !prompt_id) return null;
    const { rows } = await db.query(
        `SELECT id, paid_at FROM response_passes
          WHERE user_id = $1 AND prompt_id = $2 AND status = 'paid'
          LIMIT 1`,
        [user_id, prompt_id]
    );
    return rows[0] || null;
};

// mayRespond — the whole answer, with the reason.
//
// Returns WHY, not just whether, because every caller needs the reason: the
// write path puts it in the refusal, the paywall decides which options to show
// from it, and a receipt has to say what was bought.
const mayRespond = async ({ user_id, debate_id, prompt_id = null }, db = client) => {
    const { canRespondOpenly } = require("./trophies");
    const earned = await canRespondOpenly({ user_id, debate_id }, db);

    if (earned.allowed) {
        return { allowed: true, via: "earned", ...earned };
    }
    if (!user_id) {
        return {
            allowed: false,
            via: null,
            signed_out: true,
            ...earned,
            single_pass_cents: SINGLE_PASS_CENTS,
            subscription_cents: SUBSCRIPTION_CENTS,
        };
    }

    const subscription = await hasResponderSubscription({ user_id }, db);
    if (subscription) {
        return { allowed: true, via: "subscription", subscription, ...earned };
    }

    const pass = prompt_id ? await hasPassFor({ user_id, prompt_id }, db) : null;
    if (pass) {
        return { allowed: true, via: "pass", pass, ...earned };
    }

    return {
        allowed: false,
        via: null,
        ...earned,
        single_pass_cents: SINGLE_PASS_CENTS,
        subscription_cents: SUBSCRIPTION_CENTS,
    };
};

// ---------------------------------------------------------------------------
// buying
// ---------------------------------------------------------------------------

// startSinglePass — $5 for one question.
//
// Refuses when the person already has access, by any route. Taking five dollars
// for a door somebody can already walk through is the kind of thing that is
// technically a sale and actually a complaint.
const startSinglePass = async ({ user_id, prompt_id }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    if (!prompt_id) throw httpError(400, "prompt_id is required");

    const { rows: p } = await db.query(
        `SELECT id, debate_id FROM prompts WHERE id = $1`,
        [prompt_id]
    );
    if (!p.length) throw httpError(404, "prompt not found");
    const debate_id = p[0].debate_id;

    const access = await mayRespond({ user_id, debate_id, prompt_id }, db);
    if (access.allowed) {
        throw httpError(409, `you can already answer this one (${access.via})`);
    }

    const { rows } = await db.query(
        `INSERT INTO response_passes (user_id, prompt_id, debate_id, amount_cents, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [user_id, prompt_id, debate_id, SINGLE_PASS_CENTS]
    );
    const pass = rows[0];

    try {
        const stripe = require("../../services/stripe");
        const intent = await stripe.createPaymentIntent({
            amount_cents: SINGLE_PASS_CENTS,
            metadata: { kind: "response_pass", pass_id: pass.id, user_id, prompt_id },
        });
        await db.query(
            `UPDATE response_passes SET payment_intent_id = $2, updated_at = NOW() WHERE id = $1`,
            [pass.id, intent.id]
        );
        return { pass, client_secret: intent.client_secret, payments_configured: true };
    } catch (err) {
        if (err.status !== 503) throw err;
        // Stripe is not configured yet. The pending row is kept deliberately —
        // an operator switching payments on wants to see what people tried to
        // buy while it was off.
        return { pass, client_secret: null, payments_configured: false };
    }
};

// finishSinglePass — the money landed, so the door opens.
//
// Confirms with STRIPE, never with the browser: the client saying "it worked"
// is a claim. Idempotent on status, so a webhook delivered twice opens one door
// and charges nobody twice.
const finishSinglePass = async ({ pass_id, payment_intent_id = null }) => {
    return withTransaction(async (tx) => {
        const { rows } = await tx.query(
            `SELECT * FROM response_passes WHERE id = $1 FOR UPDATE`,
            [pass_id]
        );
        const pass = rows[0];
        if (!pass) throw httpError(404, "pass not found");
        if (pass.status === "paid") return { pass, already: true };

        const intentId = payment_intent_id || pass.payment_intent_id;
        if (!intentId) throw httpError(409, "this pass has no payment to confirm");

        const stripe = require("../../services/stripe");
        const intent = await stripe.retrievePaymentIntent({ payment_intent_id: intentId });
        if (intent.status !== "succeeded") {
            throw httpError(402, `payment has not succeeded (${intent.status})`);
        }
        if (Number(intent.amount) !== Number(pass.amount_cents)) {
            throw httpError(409, "the payment does not match this pass");
        }

        const { rows: done } = await tx.query(
            `UPDATE response_passes
                SET status = 'paid', paid_at = NOW(), payment_intent_id = $2, updated_at = NOW()
              WHERE id = $1 RETURNING *`,
            [pass.id, intentId]
        );
        return { pass: done[0], already: false };
    });
};

// startResponderSubscription — $10 a month, any prompt.
//
// Delegates to the subscriptions module rather than writing the row here: that
// table already owns the status vocabulary, the period dates and the Stripe
// ids, and a second writer is a second opinion about whether somebody is paid.
const startResponderSubscription = async ({ user_id }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    const existing = await hasResponderSubscription({ user_id }, db);
    if (existing) throw httpError(409, "you already have a responder subscription");

    const { startSubscription } = require("../payments/subscriptions");
    return startSubscription({
        user_id,
        tier: RESPONDER_TIER,
        monthly_amount_cents: SUBSCRIPTION_CENTS,
        metadata: { product: "responder" },
    });
};

module.exports = {
    SINGLE_PASS_CENTS,
    SUBSCRIPTION_CENTS,
    RESPONDER_TIER,
    hasResponderSubscription,
    hasPassFor,
    mayRespond,
    startSinglePass,
    finishSinglePass,
    startResponderSubscription,
};
