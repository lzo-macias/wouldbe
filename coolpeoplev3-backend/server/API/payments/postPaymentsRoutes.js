const express = require("express");

const {
    createPostPaymentIntent,
    getPostPaymentStatus,
} = require("../../DB/payments/postPayments");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /posts/:id/payment — (A) create the $5 post-fee charge for a WouldBe.
// The :id is the wouldbe_id whose video posting this unlocks. Makes the Stripe
// PaymentIntent + inserts a 'pending' post_payments row. Returns
// { post_payment, client_secret }. Payer is the authenticated user (not body).
router.post("/posts/:id/payment", requireAuth, async (req, res, next) => {
    try {
        const result = await createPostPaymentIntent({
            payer_user_id: req.user.id,
            wouldbe_id: req.params.id,
            post_id: req.body.post_id ?? null,
            amount_cents: req.body.amount_cents,
            currency: req.body.currency,
            stripe_customer_id: req.body.stripe_customer_id ?? null,
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /posts/:id/payment — (A) the caller's most recent post-payment status for
// this WouldBe (:id = wouldbe_id). Returns the row or 404 if none exists.
router.get("/posts/:id/payment", requireAuth, async (req, res, next) => {
    try {
        const row = await getPostPaymentStatus({
            wouldbe_id: req.params.id,
            user_id: req.user.id,
        });
        if (!row) return res.status(404).json({ error: "no post payment found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
