const express = require("express");

const {
    startSubscription,
    getActiveSubscription,
    cancelSubscriptionAtPeriodEnd,
    resumeSubscription,
    getUserSubscriptionPayments,
} = require("../../DB/payments/subscriptions");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// All routes here are authenticated and scoped to the caller (req.user.id).
// The *FromWebhook writers are intentionally NOT exposed here — they are driven
// by the Stripe dispatcher (see stripeWebhookRoutes.js), not by end users.

// POST /subscriptions — start a recurring membership. Body:
//   { tier, monthly_amount_cents, currency?, stripe_customer_id?, stripe_price_id, metadata? }
router.post("/subscriptions", requireAuth, async (req, res, next) => {
    try {
        const sub = await startSubscription({
            user_id: req.user.id,
            tier: req.body.tier,
            monthly_amount_cents: req.body.monthly_amount_cents,
            currency: req.body.currency,
            stripe_customer_id: req.body.stripe_customer_id,
            stripe_price_id: req.body.stripe_price_id,
            metadata: req.body.metadata,
        });
        return res.status(201).json(sub);
    } catch (err) {
        next(err);
    }
});

// GET /subscriptions — the caller's current (active/trialing/past_due) membership.
router.get("/subscriptions", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getActiveSubscription({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /subscriptions/cancel — schedule cancellation at the end of the period.
// Optional body { id } to target a specific subscription; defaults to the
// caller's active one.
router.post("/subscriptions/cancel", requireAuth, async (req, res, next) => {
    try {
        const sub = await cancelSubscriptionAtPeriodEnd({
            id: req.body.id,
            user_id: req.user.id,
        });
        return res.json(sub);
    } catch (err) {
        next(err);
    }
});

// POST /subscriptions/resume — undo a pending at-period-end cancellation.
router.post("/subscriptions/resume", requireAuth, async (req, res, next) => {
    try {
        const sub = await resumeSubscription({
            id: req.body.id,
            user_id: req.user.id,
        });
        return res.json(sub);
    } catch (err) {
        next(err);
    }
});

// GET /subscriptions/payments — the caller's billing history.
router.get("/subscriptions/payments", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserSubscriptionPayments({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
