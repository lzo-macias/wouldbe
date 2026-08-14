const express = require("express");

const {
    submitDebateApplication,
    listDebateApplications,
    getDebateApplication,
    listMyDebateApplications,
} = require("../../DB/debate/debateApplications");
const {
    startSponsorSetup,
    recordSponsorMandate,
    getSponsorFundingStatus,
} = require("../../DB/debate/sponsorFunding");
const {
    listTiers,
    startTierPayment,
    confirmTierPayment,
    getTierStatus,
} = require("../../DB/debate/debateTiers");
const { approveDebate, rejectDebate } = require("../../DB/debate/debateReview");
const {
    getPrizeAgreementTerms,
    signPrizeAgreement,
    getPrizeAgreement,
} = require("../../DB/debate/prizeAgreements");
const { requireAuth, requireAdmin, rateLimit, recordAdminAction, captureRequestContext } = require("../../middleware");

const router = express.Router();

// ============================================================================
// Debate applications — the sponsor-facing submit path plus the admin inbox.
//
// POST is requireAuth ONLY (no admin gate): this is the route a sponsor uses to
// send their own draft. It cannot escalate anything — the debate lands as
// status='draft', which listCurrentDebates already excludes from the public feed,
// so nothing is visible to users until an admin runs POST /api/debates/:id/publish.
//
// The GET routes are the admin inbox and are requireAdmin(). A sponsor reads
// their own submissions back through /debate-applications/mine instead.
// ============================================================================

// POST /api/debate-applications — sponsor submits a debate draft + its prompts.
// Rate-limited because each call writes a debate, N prompts and possibly a
// sponsor row; user_id comes from the token, never the body.
router.post(
    "/debate-applications",
    requireAuth,
    rateLimit({ type: "debate_application", windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res, next) => {
        try {
            const result = await submitDebateApplication({
                ...req.body,
                user_id: req.user.id,
            });
            return res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debate-applications/mine — the caller's own submissions.
// Declared before /:id so "mine" isn't parsed as a debate id.
router.get("/debate-applications/mine", requireAuth, async (req, res, next) => {
    try {
        return res.json(await listMyDebateApplications({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debate-applications — admin review queue. ?status=draft (default),
// any debates.status value, or 'all'. ?limit caps at 500.
router.get("/debate-applications", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(
            await listDebateApplications({ status: req.query.status, limit: req.query.limit })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/debate-applications/:id — one submission in full (debate + sponsor +
// every prompt in order, unreleased included).
router.get("/debate-applications/:id", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await getDebateApplication({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// ============================================================================
// Payment mandate — the sponsor completes the card step BEFORE approval, and is
// charged only if an admin approves.
//
// Route order note: these are all /debate-applications/:id/<verb>, so they never
// collide with the bare /:id read above.
// ============================================================================

// ---- the prize agreement (cash prizes only) --------------------------------
// A cash prize is a promise to pay a stranger chosen by a public vote. These two
// routes render that promise and record the signature; approval is gated on it.

// GET /api/debate-applications/:id/prize-agreement — the exact terms to render,
// with the real prize amount substituted in and the hash the server will record.
// The client never assembles the contract itself.
router.get("/debate-applications/:id/prize-agreement", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getPrizeAgreementTerms({ debate_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/prize-agreement — sign it.
//
// The BODY carries only the typed name. The amount and the terms come from the
// server, so a client cannot sign for a figure it made up. captureRequestContext
// supplies ip/user_agent, which is what makes the row evidence rather than a
// checkbox.
router.post(
    "/debate-applications/:id/prize-agreement",
    requireAuth,
    captureRequestContext,
    async (req, res, next) => {
        try {
            const agreement = await signPrizeAgreement({
                debate_id: req.params.id,
                user_id: req.user.id,
                signature_name: req.body?.signature_name,
                ip_address: req.context?.ip_address ?? null,
                user_agent: req.context?.user_agent ?? null,
            });
            return res.status(201).json(agreement);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/prize-agreement/signed — the recorded signature (or null).
// Auth'd rather than public: it carries a legal name and an IP.
router.get("/debates/:id/prize-agreement/signed", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await getPrizeAgreement({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// ---- host tiers: submit free, then pay for entry capacity ------------------
// This is the live payment path. The setup-intent/mandate pair below belongs to
// the retired prize + 10% model and is kept only for debates already carrying
// those columns.

// GET /api/debate-tiers — the price list. PUBLIC: a sponsor has to be able to see
// what a debate costs before they've submitted (or logged in).
router.get("/debate-tiers", async (_req, res, next) => {
    try {
        return res.json(await listTiers());
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/tier — pick a tier, get a PaymentIntent.
// The amount comes from the catalog, never from the body. Re-callable: switching
// tiers updates the same intent instead of stranding one per click.
router.post("/debate-applications/:id/tier", requireAuth, async (req, res, next) => {
    try {
        return res.status(201).json(
            await startTierPayment({
                debate_id: req.params.id,
                user_id: req.user.id,
                tier_key: req.body?.tier_key,
            })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/tier/confirm — the browser says the card
// cleared. The DB layer re-reads the PaymentIntent from Stripe before recording
// anything, so this cannot be used to mark a debate paid without paying.
router.post("/debate-applications/:id/tier/confirm", requireAuth, async (req, res, next) => {
    try {
        return res.json(await confirmTierPayment({ debate_id: req.params.id, user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debate-applications/:id/tier — tier + payment state for the sponsor's
// own screen. Ownership is enforced in the DB layer.
router.get("/debate-applications/:id/tier", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getTierStatus({ debate_id: req.params.id, user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/setup-intent — sponsor starts the card step.
// Returns a SetupIntent client_secret plus the exact amounts to disclose beside
// the form. No money moves and no authorization hold is placed.
router.post("/debate-applications/:id/setup-intent", requireAuth, async (req, res, next) => {
    try {
        return res.status(201).json(
            await startSponsorSetup({ debate_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/mandate — sponsor's card form succeeded.
// Stores the saved payment method and freezes the disclosed amounts. The amounts
// are derived server-side from the debate, never read from the body.
router.post("/debate-applications/:id/mandate", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await recordSponsorMandate({
                debate_id: req.params.id,
                user_id: req.user.id,
                payment_method_id: req.body?.payment_method_id,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/debate-applications/:id/funding — has the card step been done, and
// has it been charged. Sponsor-scoped (ownership enforced in the DB layer).
router.get("/debate-applications/:id/funding", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getSponsorFundingStatus({ debate_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-applications/:id/approve — the admin's green button. Moves no
// money: the host fee was collected when the sponsor picked a tier. Refuses with
// 409 if the fee is unpaid, or if a hybrid debate has no active panel.
router.post(
    "/debate-applications/:id/approve",
    requireAuth,
    requireAdmin(),
    recordAdminAction("approve_debate_application", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            return res.json(
                await approveDebate({ debate_id: req.params.id, admin_note: req.body?.note })
            );
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debate-applications/:id/reject — the admin's red button. Cancels the
// debate and REFUNDS the host fee by default (the money was taken before review).
// Body: { reason, refund } — refund:false rejects without refunding.
//
// /deny is kept as an alias so anything already calling it keeps working.
const rejectHandler = async (req, res, next) => {
    try {
        return res.json(
            await rejectDebate({
                debate_id: req.params.id,
                reason: req.body?.reason,
                refund: req.body?.refund !== false,
            })
        );
    } catch (err) {
        next(err);
    }
};

router.post(
    "/debate-applications/:id/reject",
    requireAuth,
    requireAdmin(),
    recordAdminAction("reject_debate_application", { resourceType: "debates" }),
    rejectHandler
);
router.post(
    "/debate-applications/:id/deny",
    requireAuth,
    requireAdmin(),
    recordAdminAction("reject_debate_application", { resourceType: "debates" }),
    rejectHandler
);

module.exports = { router };
