const express = require("express");

const {
    startPayoutOnboarding,
    getPayoutAccount,
    markPayoutVerified,
} = require("../../DB/payments/payoutAccounts");
const { requireAuth, requireInternal } = require("../../middleware");

const router = express.Router();

// POST /api/payout-accounts — start (or resume) Stripe Connect onboarding for
// the caller. user_id comes from the token, never the body. Returns the
// payout_accounts row (status pending) + the single-use onboarding URL.
// The underlying Stripe calls return 503 until Stripe is configured.
router.post("/payout-accounts", requireAuth, async (req, res, next) => {
    try {
        const result = await startPayoutOnboarding({
            user_id: req.user.id,
            processor: req.body.processor,
            email: req.body.email,
            country: req.body.country,
            refresh_url: req.body.refresh_url,
            return_url: req.body.return_url,
            tax_id_type: req.body.tax_id_type,
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /api/payout-accounts — the caller's own payout account (or null).
router.get("/payout-accounts", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getPayoutAccount({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/payout-accounts/verify — Stripe Connect webhook (or internal job)
// flips KYC status. requireInternal-gated (shared secret), not user/admin auth:
// the caller is the processor, not a person. Body: { id|user_id, status?,
// tax_id_type?, processor_account_id? }.
router.post("/payout-accounts/verify", requireInternal, async (req, res, next) => {
    try {
        const account = await markPayoutVerified({
            id: req.body.id,
            user_id: req.body.user_id,
            status: req.body.status,
            tax_id_type: req.body.tax_id_type,
            processor_account_id: req.body.processor_account_id,
        });
        return res.json(account);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
