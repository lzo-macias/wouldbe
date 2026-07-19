const express = require("express");

const {
    createTipIntent,
    getUserTips,
    refundTip,
} = require("../../DB/payments/tips");
const { requireAuth } = require("../../middleware");
const { client } = require("../../DB/index.js");

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
