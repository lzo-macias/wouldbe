const express = require("express");

const {
    createDebateEntryIntent,
    confirmDebatePayment,
    getUserDebatePayments,
    refundDebatePayment,
} = require("../../DB/payments/debatePayments");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// debate_payments routes — a user pays to ENTER a debate (one-off entry fee).
//   POST /debates/:id/entry-payment       — start the PaymentIntent (auth)
//   GET  /debates/:id/entry-payment       — this user's payments for the debate
//   GET  /me/debate-payments              — all this user's debate payments
//   POST /internal/debate-payments/confirm — webhook/internal confirmation
//   POST /debate-payments/:id/refund      — admin refund
// ============================================================================

// POST /api/debates/:id/entry-payment — create the entry PaymentIntent + pending row.
router.post("/debates/:id/entry-payment", requireAuth, async (req, res, next) => {
    try {
        const result = await createDebateEntryIntent({
            payer_user_id: req.user.id,
            debate_id: req.params.id,
            amount_cents: req.body?.amount_cents,
            currency: req.body?.currency,
            stripe_customer_id: req.body?.stripe_customer_id ?? null,
            metadata: req.body?.metadata ?? {},
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/entry-payment — this user's payment(s) for one debate.
router.get("/debates/:id/entry-payment", requireAuth, async (req, res, next) => {
    try {
        const rows = await getUserDebatePayments({
            user_id: req.user.id,
            debate_id: req.params.id,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/me/debate-payments — all of this user's debate payments.
router.get("/me/debate-payments", requireAuth, async (req, res, next) => {
    try {
        const rows = await getUserDebatePayments({ user_id: req.user.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/debate-payments/confirm — webhook/internal confirmation.
//   Body: { stripe_payment_intent_id | payment_id, status, stripe_charge_id, ... }
router.post("/internal/debate-payments/confirm", requireInternal, async (req, res, next) => {
    try {
        const row = await confirmDebatePayment(req.body || {});
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-payments/:id/refund — admin refund (financial mutation).
router.post(
    "/debate-payments/:id/refund",
    requireAuth,
    requireAdmin(),
    recordAdminAction("refund_debate_payment", { resourceType: "debate_payments" }),
    async (req, res, next) => {
        try {
            const row = await refundDebatePayment({
                payment_id: req.params.id,
                amount_cents: req.body?.amount_cents ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
