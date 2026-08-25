const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ===========================================================================
// Payments §13 — tips. A tip is a real Stripe charge (platform-fee at the
// pledge moment). Lifecycle: createTipIntent inserts a 'pending' row carrying
// the Stripe PaymentIntent id (stripe_payment_intent_id, the pi_... that is
// UNIQUE in the schema). The webhook later flips it to 'succeeded' (idempotent)
// or 'failed'; refundTip issues a Stripe refund then stamps 'refunded'.
//
// SCHEMA NOTE: the `tips` table column is `user_id` (the tipper). There is no
// recipient_user_id column, so a caller-supplied recipient_user_id is not
// persisted on this table — it is only forwarded into the PaymentIntent metadata
// (where Stripe + downstream payout logic can read it). status enum:
//   'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed'
// ===========================================================================

const httpError = (s, m) => { const e = new Error(m); e.status = s; return e; };

const STATUSES = ["pending", "succeeded", "failed", "refunded", "disputed"];

// Columns safe to project back to a caller (tips holds no secret, but explicit
// projection keeps a future sensitive column from leaking by accident).
const TIP_COLS = `
    id, user_id, pledge_id, tip_amount_cents, currency,
    stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
    stripe_balance_txn_id, fee_amount_cents, net_amount_cents,
    card_brand, card_last4, wallet_type, status, failure_reason,
    charged_at, refunded_at, created_at
`;

// createTipIntent — create the Stripe PaymentIntent, then INSERT a 'pending'
// tips row that carries the returned pi_... id. The stripe adapter THROWS a 503
// until keys are configured; we let that propagate (do NOT swallow it).
// recipient_user_id is not a column on `tips`; it rides along in PI metadata.
const createTipIntent = async ({
    tipper_user_id,
    user_id,
    recipient_user_id = null,
    tip_amount_cents,
    pledge_id = null,
    currency = "usd",
    stripe_customer_id = null,
} = {}) => {
    const tipperId = tipper_user_id ?? user_id;
    if (!tipperId) throw httpError(400, "tipper_user_id is required");
    if (!tip_amount_cents || tip_amount_cents <= 0) {
        throw httpError(400, "tip_amount_cents must be a positive integer");
    }

    const intent = await stripe.createPaymentIntent({
        amount_cents: tip_amount_cents,
        currency,
        customer: stripe_customer_id || undefined,
        metadata: {
            kind: "tip",
            tipper_user_id: tipperId,
            recipient_user_id: recipient_user_id ?? "",
            pledge_id: pledge_id ?? "",
        },
    });

    try {
        const { rows } = await client.query(
            `INSERT INTO tips (
                id, user_id, pledge_id, tip_amount_cents, currency,
                stripe_customer_id, stripe_payment_intent_id, status
             ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 'pending'
             )
             RETURNING ${TIP_COLS}`,
            [tipperId, pledge_id ?? null, tip_amount_cents, currency,
                stripe_customer_id ?? null, intent?.id ?? null]
        );
        return { tip: rows[0], client_secret: intent?.client_secret ?? null };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "tip already recorded for this payment intent");
        if (err.code === "23503") throw httpError(400, "referenced user or pledge does not exist");
        if (err.code === "23514") throw httpError(400, "tip violates a table check constraint");
        if (err.code === "22P02") throw httpError(400, "invalid id format");
        throw err;
    }
};

// confirmTipFromIntent / createTipFromWebhook — flip a tip to 'succeeded' (or a
// terminal failure) from a Stripe webhook event. IDEMPOTENT: matched by the
// unique stripe_payment_intent_id; a row already in a terminal state is returned
// unchanged. No public route — called by the webhook dispatcher / requireInternal.
const createTipFromWebhook = async ({
    stripe_payment_intent_id,
    status = "succeeded",
    stripe_charge_id = null,
    stripe_balance_txn_id = null,
    fee_amount_cents = null,
    net_amount_cents = null,
    card_brand = null,
    card_last4 = null,
    wallet_type = null,
    failure_reason = null,
} = {}) => {
    if (!stripe_payment_intent_id) throw httpError(400, "stripe_payment_intent_id is required");
    if (!STATUSES.includes(status)) throw httpError(400, `status must be one of: ${STATUSES.join(", ")}`);

    try {
        // Only advance from 'pending' (idempotent: a re-delivered webhook for an
        // already-finalized tip is a no-op and returns the existing row).
        const upd = await client.query(
            `UPDATE tips
                SET status = $2,
                    stripe_charge_id = COALESCE($3, stripe_charge_id),
                    stripe_balance_txn_id = COALESCE($4, stripe_balance_txn_id),
                    fee_amount_cents = COALESCE($5, fee_amount_cents),
                    net_amount_cents = COALESCE($6, net_amount_cents),
                    card_brand = COALESCE($7, card_brand),
                    card_last4 = COALESCE($8, card_last4),
                    wallet_type = COALESCE($9, wallet_type),
                    failure_reason = COALESCE($10, failure_reason),
                    charged_at = CASE WHEN $2 = 'succeeded' THEN NOW() ELSE charged_at END
              WHERE stripe_payment_intent_id = $1
                AND status = 'pending'
              RETURNING ${TIP_COLS}`,
            [stripe_payment_intent_id, status, stripe_charge_id, stripe_balance_txn_id,
                fee_amount_cents, net_amount_cents, card_brand, card_last4,
                wallet_type, failure_reason]
        );
        if (upd.rows.length) return upd.rows[0];

        // Nothing updated: either already finalized (idempotent replay) or unknown.
        const { rows } = await client.query(
            `SELECT ${TIP_COLS} FROM tips WHERE stripe_payment_intent_id = $1`,
            [stripe_payment_intent_id]
        );
        if (!rows.length) throw httpError(404, "no tip for this payment intent");
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "duplicate stripe id");
        if (err.code === "23514") throw httpError(400, "tip violates a table check constraint");
        if (err.code === "22P02") throw httpError(400, "invalid id format");
        throw err;
    }
};

// getUserTips — the caller's tips, newest first.
const getUserTips = async ({ user_id } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    const { rows } = await client.query(
        `SELECT ${TIP_COLS} FROM tips WHERE user_id = $1 ORDER BY created_at DESC`,
        [user_id]
    );
    return rows;
};

// refundTip — issue a Stripe refund against the tip's PaymentIntent, then stamp
// the row 'refunded'. Done in a transaction so the refund stamp commits atomically.
// The Stripe call THROWS 503 until configured; let it propagate.
const refundTip = async ({ id, amount_cents = null } = {}) => {
    if (!id) throw httpError(400, "tip id is required");

    return withTransaction(async (tx) => {
        const cur = await tx.query(
            `SELECT ${TIP_COLS} FROM tips WHERE id = $1 FOR UPDATE`,
            [id]
        );
        const tip = cur.rows[0];
        if (!tip) throw httpError(404, "tip not found");
        if (tip.status === "refunded") throw httpError(409, "tip already refunded");
        if (tip.status !== "succeeded") {
            throw httpError(409, "only a succeeded tip can be refunded");
        }
        if (!tip.stripe_payment_intent_id) {
            throw httpError(409, "tip has no payment intent to refund");
        }

        await stripe.createRefund({
            payment_intent_id: tip.stripe_payment_intent_id,
            amount_cents: amount_cents ?? undefined,
        });

        const upd = await tx.query(
            `UPDATE tips
                SET status = 'refunded', refunded_at = NOW()
              WHERE id = $1
              RETURNING ${TIP_COLS}`,
            [id]
        );
        return upd.rows[0];
    });
};

module.exports = {
    STATUSES,
    createTipIntent,
    confirmTipFromIntent: createTipFromWebhook,
    createTipFromWebhook,
    getUserTips,
    refundTip,
};
