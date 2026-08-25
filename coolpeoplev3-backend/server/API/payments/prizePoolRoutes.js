const express = require("express");

const {
    addPrizePoolContribution,
    getPrizePool,
    refundContribution,
    createPrizeDistribution,
    getPrizeDistributions,
    attachW9,
    markDisbursed,
    openDistributionDispute,
} = require("../../DB/payments/prizePool");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// Prize pool routes.
//
//  Contributions (money in):
//    POST /debates/:id/prize-pool                — contribute (auth)
//    GET  /debates/:id/prize-pool               — pool total + list (public)
//    POST /prize-pool/contributions/:id/refund  — admin refund
//
//  Distributions (money out, winner payouts) — all admin + audited:
//    POST /debates/:id/distributions            — record intended payout
//    GET  /debates/:id/distributions            — list payouts
//    POST /distributions/:id/w9                  — attach W-9
//    POST /distributions/:id/disburse           — perform Stripe transfer
//    POST /distributions/:id/dispute            — open a dispute
// ============================================================================

// POST /api/debates/:id/prize-pool — add a contribution to the pool.
router.post("/debates/:id/prize-pool", requireAuth, async (req, res, next) => {
    try {
        const result = await addPrizePoolContribution({
            contributor_user_id: req.user.id,
            debate_id: req.params.id,
            amount_cents: req.body?.amount_cents,
            contribution_source: req.body?.contribution_source,
            contributor_display_name: req.body?.contributor_display_name ?? null,
            locked_at: req.body?.locked_at ?? null,
            refundable_until: req.body?.refundable_until ?? null,
            stripe_customer_id: req.body?.stripe_customer_id ?? null,
            metadata: req.body?.metadata ?? {},
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/prize-pool — public pool view (total + contributions).
router.get("/debates/:id/prize-pool", async (req, res, next) => {
    try {
        const pool = await getPrizePool({ debate_id: req.params.id });
        return res.json(pool);
    } catch (err) {
        next(err);
    }
});

// POST /api/prize-pool/contributions/:id/refund — admin refund (financial).
router.post(
    "/prize-pool/contributions/:id/refund",
    requireAuth,
    requireAdmin(),
    recordAdminAction("refund_prize_contribution", { resourceType: "prize_pool_contributions" }),
    async (req, res, next) => {
        try {
            const row = await refundContribution({
                id: req.params.id,
                amount_cents: req.body?.amount_cents ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// ---- distributions (admin only) --------------------------------------------

// POST /api/debates/:id/distributions — record an intended winner payout.
router.post(
    "/debates/:id/distributions",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_prize_distribution", { resourceType: "prize_distributions" }),
    async (req, res, next) => {
        try {
            const row = await createPrizeDistribution({
                debate_id: req.params.id,
                recipient_user_id: req.body?.recipient_user_id,
                placement: req.body?.placement,
                amount_cents: req.body?.amount_cents,
                disbursement_method: req.body?.disbursement_method ?? null,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/distributions — list payouts for a debate (admin).
router.get(
    "/debates/:id/distributions",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await getPrizeDistributions({ debate_id: req.params.id });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/distributions/:id/w9 — attach the winner's W-9.
router.post(
    "/distributions/:id/w9",
    requireAuth,
    requireAdmin(),
    recordAdminAction("attach_prize_w9", { resourceType: "prize_distributions" }),
    async (req, res, next) => {
        try {
            const row = await attachW9({
                distribution_id: req.params.id,
                w9_document_url: req.body?.w9_document_url ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/distributions/:id/disburse — perform the Stripe transfer.
router.post(
    "/distributions/:id/disburse",
    requireAuth,
    requireAdmin(),
    recordAdminAction("disburse_prize_distribution", { resourceType: "prize_distributions" }),
    async (req, res, next) => {
        try {
            const row = await markDisbursed({
                distribution_id: req.params.id,
                destination_account: req.body?.destination_account,
                disbursement_method: req.body?.disbursement_method ?? "stripe_transfer",
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/distributions/:id/dispute — open a dispute on a payout.
router.post(
    "/distributions/:id/dispute",
    requireAuth,
    requireAdmin(),
    recordAdminAction("open_prize_distribution_dispute", { resourceType: "prize_distributions" }),
    async (req, res, next) => {
        try {
            const row = await openDistributionDispute({
                distribution_id: req.params.id,
                reason: req.body?.reason ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
