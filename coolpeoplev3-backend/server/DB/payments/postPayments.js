const { client } = require("../index.js");
const stripe = require("../../services/stripe");

// ===========================================================================
// Payments §13 — post_payments. The $5 flat fee to post videos on a WouldBe.
// Lifecycle: createPostPaymentIntent creates the Stripe PaymentIntent and
// inserts a 'pending' row carrying the pi_... id (stripe_payment_intent_id,
// UNIQUE in the schema); the webhook flips it to 'succeeded' (idempotent) or
// 'failed' via confirmPostPayment.
//
// SCHEMA NOTE: the `post_payments` table keys the charge to `wouldbe_id` (which
// WouldBe this unlocks video posting for) and `user_id` (the payer). There is
// no post_id column; a caller-supplied post_id is carried only in PI metadata.
// status enum: 'pending' | 'succeeded' | 'failed' | 'refunded'
// ===========================================================================

const httpError = (s, m) => { const e = new Error(m); e.status = s; return e; };

const STATUSES = ["pending", "succeeded", "failed", "refunded"];

const POST_PAYMENT_COLS = `
    id, user_id, wouldbe_id, amount_cents, currency,
    stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
    fee_amount_cents, net_amount_cents, status,
    charged_at, refunded_at, created_at
`;

// createPostPaymentIntent — create the Stripe PaymentIntent, then INSERT a
// 'pending' post_payments row carrying the returned pi_... id. The stripe
// adapter THROWS a 503 until keys exist; let that propagate (do NOT swallow it).
const createPostPaymentIntent = async ({
    payer_user_id,
    user_id,
    wouldbe_id,
    post_id = null,
    amount_cents = 500,
    currency = "usd",
    stripe_customer_id = null,
} = {}) => {
    const payerId = payer_user_id ?? user_id;
    if (!payerId) throw httpError(400, "payer_user_id is required");
    if (!wouldbe_id) throw httpError(400, "wouldbe_id is required");
    if (!amount_cents || amount_cents <= 0) {
        throw httpError(400, "amount_cents must be a positive integer");
    }

    const intent = await stripe.createPaymentIntent({
        amount_cents,
        currency,
        customer: stripe_customer_id || undefined,
        metadata: {
            kind: "post_payment",
            payer_user_id: payerId,
            wouldbe_id,
            post_id: post_id ?? "",
        },
    });

    try {
        const { rows } = await client.query(
            `INSERT INTO post_payments (
                id, user_id, wouldbe_id, amount_cents, currency,
                stripe_customer_id, stripe_payment_intent_id, status
             ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 'pending'
             )
             RETURNING ${POST_PAYMENT_COLS}`,
            [payerId, wouldbe_id, amount_cents, currency,
                stripe_customer_id ?? null, intent?.id ?? null]
        );
        return { post_payment: rows[0], client_secret: intent?.client_secret ?? null };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "payment already recorded for this payment intent");
        if (err.code === "23503") throw httpError(400, "referenced user or wouldbe does not exist");
        if (err.code === "23514") throw httpError(400, "payment violates a table check constraint");
        if (err.code === "22P02") throw httpError(400, "invalid id format");
        throw err;
    }
};

// confirmPostPayment — flip a post_payment to 'succeeded' (or a terminal
// failure) from a Stripe webhook event. IDEMPOTENT: matched by the unique
// stripe_payment_intent_id; only advances from 'pending', so a re-delivered
// webhook is a no-op that returns the existing row. Webhook/internal only.
const confirmPostPayment = async ({
    stripe_payment_intent_id,
    status = "succeeded",
    stripe_charge_id = null,
    fee_amount_cents = null,
    net_amount_cents = null,
} = {}) => {
    if (!stripe_payment_intent_id) throw httpError(400, "stripe_payment_intent_id is required");
    if (!STATUSES.includes(status)) throw httpError(400, `status must be one of: ${STATUSES.join(", ")}`);

    try {
        const upd = await client.query(
            `UPDATE post_payments
                SET status = $2,
                    stripe_charge_id = COALESCE($3, stripe_charge_id),
                    fee_amount_cents = COALESCE($4, fee_amount_cents),
                    net_amount_cents = COALESCE($5, net_amount_cents),
                    charged_at = CASE WHEN $2 = 'succeeded' THEN NOW() ELSE charged_at END
              WHERE stripe_payment_intent_id = $1
                AND status = 'pending'
              RETURNING ${POST_PAYMENT_COLS}`,
            [stripe_payment_intent_id, status, stripe_charge_id, fee_amount_cents, net_amount_cents]
        );
        if (upd.rows.length) return upd.rows[0];

        const { rows } = await client.query(
            `SELECT ${POST_PAYMENT_COLS} FROM post_payments WHERE stripe_payment_intent_id = $1`,
            [stripe_payment_intent_id]
        );
        if (!rows.length) throw httpError(404, "no post payment for this payment intent");
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "duplicate stripe id");
        if (err.code === "23514") throw httpError(400, "payment violates a table check constraint");
        if (err.code === "22P02") throw httpError(400, "invalid id format");
        throw err;
    }
};

// getPostPaymentStatus — look up a post payment by its id, or by the
// (wouldbe_id, user_id) pair (newest first). Returns the row or null.
const getPostPaymentStatus = async ({ id = null, wouldbe_id = null, user_id = null } = {}) => {
    if (id) {
        const { rows } = await client.query(
            `SELECT ${POST_PAYMENT_COLS} FROM post_payments WHERE id = $1`,
            [id]
        );
        return rows[0] || null;
    }
    if (wouldbe_id && user_id) {
        const { rows } = await client.query(
            `SELECT ${POST_PAYMENT_COLS}
               FROM post_payments
              WHERE wouldbe_id = $1 AND user_id = $2
              ORDER BY created_at DESC
              LIMIT 1`,
            [wouldbe_id, user_id]
        );
        return rows[0] || null;
    }
    throw httpError(400, "provide id, or wouldbe_id + user_id");
};

module.exports = {
    STATUSES,
    createPostPaymentIntent,
    confirmPostPayment,
    getPostPaymentStatus,
};
