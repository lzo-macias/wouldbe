const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// debate_payments — Stripe-backed payments a USER makes to ENTER a debate.
//
//  Table shape (migration 1779234282879, payment_type CHECK extended in
//  1780700000000): PK is payment_id. An entry payment uses
//  payment_type = 'debate_entry_one_off' (the one-off entry fee; the other
//  values are 'subscription_credit' — a draw from an active subscription — and
//  'debate_sponsor_flat_fee', which is the SPONSOR's POST fee handled in
//  DB/debate/debates.js recordSponsorFlatFeePayment).
//
//  Money flow (each call): create the Stripe PaymentIntent FIRST, then write a
//  status='pending' row carrying the pi id. confirmDebatePayment flips it to
//  'succeeded' (webhook/internal). refundDebatePayment issues the Stripe refund
//  and flips it to 'refunded'. Stripe is INERT (503) until configured — that is
//  the expected behavior of the scaffold, and the row is only written after the
//  PaymentIntent call succeeds.
// ============================================================================

// createDebateEntryIntent — start a one-off debate entry payment. Creates the
// Stripe PaymentIntent, then inserts a pending debate_payments row. The caller
// later confirms (webhook/internal) once the charge clears.
const createDebateEntryIntent = async ({
    payer_user_id,
    debate_id,
    amount_cents,
    currency = "usd",
    stripe_customer_id = null,
    metadata = {},
}) => {
    try {
        if (!payer_user_id) throw httpError(400, "payer_user_id is required");
        if (!debate_id) throw httpError(400, "debate_id is required");
        if (!(Number(amount_cents) > 0)) throw httpError(400, "amount_cents must be > 0");

        const intent = await stripe.createPaymentIntent({
            amount_cents: Number(amount_cents),
            currency,
            customer: stripe_customer_id,
            metadata: {
                ...metadata,
                kind: "debate_entry_one_off",
                debate_id,
                payer_user_id,
            },
        });

        const SQL = `
            INSERT INTO debate_payments (
                user_id, debate_id, payment_type, amount_cents, currency,
                stripe_customer_id, stripe_payment_intent_id, status
            )
            VALUES ($1, $2, 'debate_entry_one_off', $3, $4, $5, $6, 'pending')
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            payer_user_id,
            debate_id,
            amount_cents,
            currency,
            stripe_customer_id,
            intent?.id ?? null,
        ]);
        return { payment: result.rows[0], client_secret: intent?.client_secret ?? null };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "this payment was already recorded");
        if (err.code === "23503") throw httpError(400, "user_id or debate_id does not exist");
        if (err.code === "23514") throw httpError(400, "a payment field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// confirmDebatePayment — flip a pending entry payment to succeeded (or failed)
// once Stripe confirms. Driven by the webhook or an internal caller; matches on
// the PaymentIntent id (the only thing the webhook knows). Stamps the Stripe
// charge/fee/card details the caller pulled off the event.
const confirmDebatePayment = async ({
    stripe_payment_intent_id,
    payment_id = null,
    status = "succeeded",
    stripe_charge_id = null,
    stripe_balance_txn_id = null,
    fee_amount_cents = null,
    net_amount_cents = null,
    sponsor_amount_cents = null,
    platform_amount_cents = null,
    card_brand = null,
    card_last4 = null,
    wallet_type = null,
    failure_reason = null,
    charged_at = null,
}) => {
    try {
        if (!stripe_payment_intent_id && !payment_id) {
            throw httpError(400, "stripe_payment_intent_id or payment_id is required");
        }
        if (!["succeeded", "failed"].includes(status)) {
            throw httpError(400, "status must be 'succeeded' or 'failed'");
        }
        const SQL = `
            UPDATE debate_payments
               SET status = $3,
                   stripe_charge_id = COALESCE($4, stripe_charge_id),
                   stripe_balance_txn_id = COALESCE($5, stripe_balance_txn_id),
                   fee_amount_cents = COALESCE($6, fee_amount_cents),
                   net_amount_cents = COALESCE($7, net_amount_cents),
                   sponsor_amount_cents = COALESCE($8, sponsor_amount_cents),
                   platform_amount_cents = COALESCE($9, platform_amount_cents),
                   card_brand = COALESCE($10, card_brand),
                   card_last4 = COALESCE($11, card_last4),
                   wallet_type = COALESCE($12, wallet_type),
                   failure_reason = COALESCE($13, failure_reason),
                   charged_at = CASE WHEN $3 = 'succeeded'
                                     THEN COALESCE($14, charged_at, now())
                                     ELSE charged_at END
             WHERE ($1::uuid IS NOT NULL AND payment_id = $1::uuid)
                OR ($1::uuid IS NULL AND stripe_payment_intent_id = $2)
             RETURNING *;
        `;
        const result = await client.query(SQL, [
            payment_id,
            stripe_payment_intent_id,
            status,
            stripe_charge_id,
            stripe_balance_txn_id,
            fee_amount_cents,
            net_amount_cents,
            sponsor_amount_cents,
            platform_amount_cents,
            card_brand,
            card_last4,
            wallet_type,
            failure_reason,
            charged_at,
        ]);
        if (!result.rows.length) throw httpError(404, "payment not found");
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "duplicate stripe identifier");
        if (err.code === "23514") throw httpError(400, "a payment field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getUserDebatePayments — the caller's debate payments, newest first. Optional
// debate_id filter (used by GET /debates/:id/entry-payment).
const getUserDebatePayments = async ({ user_id, debate_id = null }) => {
    try {
        if (!user_id) throw httpError(400, "user_id is required");
        const SQL = `
            SELECT * FROM debate_payments
             WHERE user_id = $1
               AND ($2::uuid IS NULL OR debate_id = $2::uuid)
             ORDER BY created_at DESC
        `;
        const result = await client.query(SQL, [user_id, debate_id]);
        return result.rows;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// refundDebatePayment — issue a Stripe refund for a succeeded entry payment and
// flip the row to 'refunded'. Single-statement read + Stripe call + write, but
// done in a transaction so the row can't change under us between the guard and
// the update.
const refundDebatePayment = async ({ payment_id, amount_cents = null }) => {
    try {
        if (!payment_id) throw httpError(400, "payment_id is required");
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM debate_payments WHERE payment_id = $1 FOR UPDATE`,
                [payment_id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "payment not found");
            if (row.status === "refunded") throw httpError(409, "payment is already refunded");
            if (row.status !== "succeeded") {
                throw httpError(409, "only a succeeded payment can be refunded");
            }
            if (!row.stripe_payment_intent_id) {
                throw httpError(409, "payment has no Stripe PaymentIntent to refund");
            }

            await stripe.createRefund({
                payment_intent_id: row.stripe_payment_intent_id,
                amount_cents: amount_cents != null ? Number(amount_cents) : undefined,
            });

            const upd = await tx.query(
                `UPDATE debate_payments
                    SET status = 'refunded', refunded_at = now()
                  WHERE payment_id = $1
                  RETURNING *`,
                [payment_id]
            );
            return upd.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// tiny helper so routes can map thrown errors to status codes
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    createDebateEntryIntent,
    confirmDebatePayment,
    getUserDebatePayments,
    refundDebatePayment,
};
