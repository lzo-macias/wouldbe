const express = require("express");

const {
    computeSponsorEntryPayout,
    disburseSponsorPayout,
    getSponsorPayouts,
} = require("../../DB/payments/debatePayouts");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:id/sponsor-payout — admin compute + disburse the sponsor's
// entry-fee payout on conclusion. recordAdminAction audits the disbursement
// after a 2xx. The Stripe transfer returns 503 until Stripe is configured.
router.post(
    "/debates/:id/sponsor-payout",
    requireAuth,
    requireAdmin(),
    recordAdminAction("debate.sponsor_payout.disburse", { resourceType: "debate" }),
    async (req, res, next) => {
        try {
            const payout = await disburseSponsorPayout({
                debate_id: req.params.id,
                platform_fee_cents: req.body.platform_fee_cents,
                currency: req.body.currency,
            });
            return res.status(201).json(payout);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/sponsor-payouts — admin view of the debate's payout rows,
// with the currently-owed computation alongside.
router.get(
    "/debates/:id/sponsor-payouts",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const [owed, payouts] = await Promise.all([
                computeSponsorEntryPayout({ debate_id: req.params.id }),
                getSponsorPayouts({ debate_id: req.params.id }),
            ]);
            return res.json({ owed, payouts });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
