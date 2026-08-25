const express = require("express");

const {
    createTipIntent,
    confirmTipFromIntent,
    getUserTips,
    refundTip,
} = require("../../DB/payments/tips");
const { startSubscription } = require("../../DB/payments/subscriptions");
const { requireAuth } = require("../../middleware");
const { client } = require("../../DB/index.js");
const stripe = require("../../services/stripe");

const router = express.Router();

// POST /tips — (A) create a tip: makes the Stripe PaymentIntent and inserts a
// 'pending' tips row. Returns { tip, client_secret } the client uses to confirm
// the payment. The tipper is the authenticated user (NEVER from the body).
router.post("/tips", requireAuth, async (req, res, next) => {
    try {
        const result = await createTipIntent({
            tipper_user_id: req.user.id,
            recipient_user_id: req.body.recipient_user_id ?? null,
            tip_amount_cents: req.body.tip_amount_cents,
            pledge_id: req.body.pledge_id ?? null,
            currency: req.body.currency,
            stripe_customer_id: req.body.stripe_customer_id ?? null,
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /tips — (A) the authenticated user's tips, newest first.
router.get("/tips", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserTips({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /tips/:id/confirm — the CLIENT-SIDE confirmation, mirroring
// /wouldbes/:id/creation-payment/confirm.
//
// WHY IT EXISTS ALONGSIDE THE WEBHOOK: the webhook is the source of truth, but
// Stripe cannot deliver a server-to-server callback to localhost, so in
// development a tip would sit 'pending' forever. Both paths call the same
// idempotent confirmer, so whichever lands first wins.
//
// THE CLIENT'S CLAIM IS NOT TRUSTED: it sends only an id, and we retrieve that
// PaymentIntent from Stripe and check the status ourselves. Otherwise anyone
// could mark a tip paid by POSTing a made-up id.
router.post("/tips/:id/confirm", requireAuth, async (req, res, next) => {
    try {
        const owns = await client.query(
            `SELECT user_id, stripe_payment_intent_id FROM tips WHERE id = $1`,
            [req.params.id]
        );
        if (!owns.rows.length) return res.status(404).json({ error: "tip not found" });
        if (owns.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ error: "not your tip" });
        }

        const piId = owns.rows[0].stripe_payment_intent_id;
        if (!piId) return res.status(409).json({ error: "tip has no payment intent" });

        let pi;
        try {
            pi = await stripe.retrievePaymentIntent({ payment_intent_id: piId });
        } catch {
            return res.status(400).json({ error: "payment intent could not be retrieved" });
        }
        if (pi?.status !== "succeeded") {
            return res.status(409).json({ error: `payment is ${pi?.status || "unknown"}` });
        }

        return res.json(await confirmTipFromIntent({ intent: pi, paymentIntent: pi }));
    } catch (err) {
        next(err);
    }
});

// POST /tips/monthly — start a RECURRING platform tip. Body: { amount_cents }.
//
// Returns { subscription, client_secret }. The client secret belongs to the
// first invoice's PaymentIntent and is confirmed with the same PaymentElement
// as a one-off tip — see createSubscription in services/stripe.js for why the
// subscription has to be opened as 'default_incomplete'.
//
// The Stripe customer is REUSED, not recreated: the user's own prior
// subscriptions and tips already carry a customer id, and minting a fresh
// customer per signup would scatter one person's billing history across many
// records and break the saved card on month two.
router.post("/tips/monthly", requireAuth, async (req, res, next) => {
    try {
        const amount = Number(req.body?.amount_cents);
        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ error: "amount_cents must be a positive integer" });
        }

        const prior = await client.query(
            `SELECT stripe_customer_id FROM subscriptions
              WHERE user_id = $1 AND stripe_customer_id IS NOT NULL
              UNION ALL
             SELECT stripe_customer_id FROM tips
              WHERE user_id = $1 AND stripe_customer_id IS NOT NULL
              LIMIT 1`,
            [req.user.id]
        );
        let customerId = prior.rows[0]?.stripe_customer_id || null;
        if (!customerId) {
            const customer = await stripe.createCustomer({
                email: req.user.email,
                name: [req.user.first_name, req.user.last_name].filter(Boolean).join(" "),
                metadata: { user_id: req.user.id },
            });
            customerId = customer?.id || null;
        }

        const price = await stripe.findOrCreateMonthlyPrice({ amount_cents: amount });

        const sub = await startSubscription({
            user_id: req.user.id,
            tier: "platform_tip",
            monthly_amount_cents: amount,
            stripe_customer_id: customerId,
            stripe_price_id: price.id,
            metadata: { kind: "tip_monthly" },
        });

        return res.status(201).json({ subscription: sub, client_secret: sub.client_secret ?? null });
    } catch (err) {
        next(err);
    }
});

// POST /tips/:id/refund — (A or AD) refund a tip. The tip's owner may refund
// their own tip; any active admin may refund any tip. Ownership/admin is checked
// here (the DB layer is caller-agnostic). 403 otherwise.
router.post("/tips/:id/refund", requireAuth, async (req, res, next) => {
    try {
        const owns = await client.query(
            `SELECT user_id FROM tips WHERE id = $1`,
            [req.params.id]
        );
        if (!owns.rows.length) return res.status(404).json({ error: "tip not found" });

        const isOwner = owns.rows[0].user_id === req.user.id;
        if (!isOwner) {
            const admin = await client.query(
                `SELECT id FROM admin_users
                  WHERE user_id = $1 AND status = 'active' AND terminated_at IS NULL`,
                [req.user.id]
            );
            if (!admin.rows.length) {
                return res.status(403).json({ error: "not allowed to refund this tip" });
            }
        }

        const refunded = await refundTip({
            id: req.params.id,
            amount_cents: req.body.amount_cents ?? null,
        });
        return res.json(refunded);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
