const express = require("express");

const {
    createWouldbeV2,
    listWouldbes,
    listMyWouldbes,
    getWouldbeById,
    updateWouldbe,
    retireWouldbe,
    getWouldbePledgers,
    getWouldbePosts,
    getWouldbeRankings,
    recordWouldbeCreationPayment,
    getWouldbeCreationPayment,
    createWouldbeCreationPaymentIntent,
    setContributionProcessor,
    recordGoalReached,
    getRecommendedWouldbes,
    confirmWouldbeCreationPayment,
} = require("../../DB/candidacy/wouldbe");
const stripeSvc = require("../../services/stripe");

const {
    getReadiness,
    listWouldbeApplications,
    approveWouldbe,
    rejectWouldbe,
    requestCommittee,
} = require("../../DB/candidacy/wouldbeReview");
const {
    requireAuth,
    requireAttestation,
    requireInternal,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
// Creating a campaign asserts candidacy eligibility (ATT). Requires BOTH the
// adult age attestation ('age_18', recorded at signup for 18+ — minors only hold
// 'age_13', so this blocks them) AND the 'us_citizen' candidacy attestation.
const candidate = [requireAuth, requireAttestation("age_18"), requireAttestation("us_citizen")];

// 400 for validation throws, 404 for not-found throws, else pass to the handler.
const mapErr = (err, res, next) => {
    if (/required|must be between|on file for this office/i.test(err.message)) {
        return res.status(400).json({ error: err.message });
    }
    if (/no wouldbe with this id/i.test(err.message)) return res.status(404).json({ error: err.message });
    return next(err);
};

// POST /wouldbes — create a campaign (starts launch_status='draft'; $5K–$1M goal).
// race_id is optional: send office_id instead and the race is resolved from the
// office's seeded election dates (found, or derived and created).
router.post("/wouldbes", candidate, async (req, res, next) => {
    try {
        const wouldbe = await createWouldbeV2({ ...req.body, user_id: req.user.id });
        return res.status(201).json(wouldbe);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// GET /wouldbes — live campaigns (non-retired, election not yet passed).
// ?sort=pledged orders by money pledged; the default is newest first.
// GET /wouldbes?office_id=<uuid> — same, scoped to one office: only the WouldBes
// actively running for that office right now (retired ones are excluded).
router.get("/wouldbes", async (req, res, next) => {
    try {
        return res.json(
            await listWouldbes({ office_id: req.query.office_id, sort: req.query.sort })
        );
    } catch (err) {
        next(err);
    }
});

// ============================================================================
// Admin review. Campaigns start at launch_status='draft' and NOTHING moved them
// before these routes existed — which meant no campaign could ever reach
// 'active', and pledges.js rejects a pledge on any other status.
//
// Declared before /wouldbes/:id so none of these paths is parsed as an id.
// ============================================================================

// GET /api/wouldbe-applications?launch_status=draft|pending_committee|
//     pending_review|suspended|all — the review queue (admin).
router.get("/wouldbe-applications", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(
            await listWouldbeApplications({
                launch_status: req.query.launch_status ?? req.query.status,
                limit: req.query.limit,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/checklist — the same gates, asked by the campaign's
// OWNER. /readiness is requireAdmin(), so a candidate had no way to find out
// what their own campaign was missing.
//
// Booleans and blocker text only — no admin notes, no committee row.
router.get("/wouldbes/:id/checklist", requireAuth, async (req, res, next) => {
    try {
        const wb = await getWouldbeById({ id: req.params.id });
        if (!wb) return res.status(404).json({ error: "WouldBe not found" });
        if (wb.user_id !== req.user.id) return res.status(403).json({ error: "Not your WouldBe" });

        const r = await getReadiness({ id: req.params.id });
        return res.json({
            wouldbe_id: r.wouldbe_id,
            launch_status: r.launch_status,
            fee_paid: r.fee_paid,
            committee_ok: r.committee_ok,
            // committee_ok is TRUE the moment a receipt is on file, because
            // 'provisional_on_receipt' satisfies the launch gate — so it can't
            // distinguish "waiting on the authority" from "confirmed". This does.
            //
            //   null                    no committee filed yet
            //   'pending_verification'  filed, but no receipt/number supplied
            //   'provisional_on_receipt' receipt on file, not yet confirmed
            //   'verified_active'       confirmed against the authority
            //
            // Owner-only route, and it's the caller's own committee, so exposing
            // the status here leaks nothing. The committee ROW still isn't
            // returned — that stays on the admin /readiness endpoint.
            committee_status: r.committee?.registration_status ?? null,
            race_open: r.race_open,
            has_plan: r.has_plan,
            blockers: r.blockers,
            ready: r.approvable,
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/readiness — the checklist for one campaign, evaluated
// live: fee paid, committee on file (WHICH filing), race still open, plan.
router.get("/wouldbes/:id/readiness", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await getReadiness({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/wouldbes/:id/approve — go live. Re-checks every gate here rather
// than trusting the queue, which may be minutes stale.
router.post(
    "/wouldbes/:id/approve",
    requireAuth,
    requireAdmin(),
    recordAdminAction("approve_wouldbe", { resourceType: "wouldbe" }),
    async (req, res, next) => {
        try {
            return res.json(
                await approveWouldbe({
                    id: req.params.id,
                    admin_user_id: req.user.id,
                    note: req.body?.note,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/wouldbes/:id/reject — launch_status='failed'. A reason is required;
// it is shown back to the candidate.
router.post(
    "/wouldbes/:id/reject",
    requireAuth,
    requireAdmin(),
    recordAdminAction("reject_wouldbe", { resourceType: "wouldbe" }),
    async (req, res, next) => {
        try {
            return res.json(
                await rejectWouldbe({
                    id: req.params.id,
                    admin_user_id: req.user.id,
                    reason: req.body?.reason,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/wouldbes/:id/request-committee — not a rejection. The campaign is
// fine; the candidate just hasn't filed yet.
router.post(
    "/wouldbes/:id/request-committee",
    requireAuth,
    requireAdmin(),
    recordAdminAction("request_wouldbe_committee", { resourceType: "wouldbe" }),
    async (req, res, next) => {
        try {
            return res.json(
                await requestCommittee({
                    id: req.params.id,
                    admin_user_id: req.user.id,
                    note: req.body?.note,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

// GET /wouldbes/mine — the caller's own campaigns, every state including drafts.
// Declared BEFORE /wouldbes/:id so "mine" isn't captured as an id.
//
// This is how a user gets back to a draft they left unpaid: the id otherwise
// only ever existed in the tab they closed.
router.get("/wouldbes/mine", authed, async (req, res, next) => {
    try {
        return res.json(await listMyWouldbes({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/recommended — active WouldBes in the caller's jurisdictions they
// don't own and haven't pledged to. Declared before any /wouldbes/:id route so
// "recommended" isn't captured as an :id.
router.get("/wouldbes/recommended", authed, async (req, res, next) => {
    try {
        return res.json(await getRecommendedWouldbes({ userId: req.user.id, limit: req.query.limit }));
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/:id/pledgers — pledges for a campaign + pledger identity.
router.get("/wouldbes/:id/pledgers", authed, async (req, res, next) => {
    try {
        return res.json(await getWouldbePledgers({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/:id/posts — a campaign's non-removed posts.
router.get("/wouldbes/:id/posts", async (req, res, next) => {
    try {
        return res.json(await getWouldbePosts({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/:id/rankings — standing among campaigns for the same seat.
router.get("/wouldbes/:id/rankings", async (req, res, next) => {
    try {
        return res.json(await getWouldbeRankings({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/:id/creation-payment — the latest $5 creation-fee charge.
router.get("/wouldbes/:id/creation-payment", authed, async (req, res, next) => {
    try {
        return res.json(await getWouldbeCreationPayment({ wouldbe_id: req.params.id }) ?? null);
    } catch (err) {
        next(err);
    }
});

// GET /wouldbes/:id — single campaign.
router.get("/wouldbes/:id", async (req, res, next) => {
    try {
        const wouldbe = await getWouldbeById({ id: req.params.id });
        if (!wouldbe) return res.status(404).json({ error: "wouldbe not found" });
        return res.json(wouldbe);
    } catch (err) {
        next(err);
    }
});

// POST /wouldbes/:id/creation-payment-intent — create the $5 Stripe PaymentIntent
// for the creation fee and return its client_secret (owner only). Inserts a
// 'pending' row; the webhook (metadata.kind "wouldbe_creation") confirms it and
// stamps creation_fee_paid_at. INERT (503) until STRIPE_SECRET_KEY is set.
router.post("/wouldbes/:id/creation-payment-intent", authed, async (req, res, next) => {
    try {
        const wb = await getWouldbeById({ id: req.params.id });
        if (!wb) return res.status(404).json({ error: "WouldBe not found" });
        if (wb.user_id !== req.user.id) return res.status(403).json({ error: "Not your WouldBe" });
        const result = await createWouldbeCreationPaymentIntent({
            wouldbe_id: req.params.id,
            user_id: req.user.id,
            stripe_customer_id: req.body?.stripe_customer_id ?? null,
        });
        return res.status(201).json(result);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// POST /wouldbes/:id/creation-payment/confirm — the CLIENT-SIDE confirmation.
// Body: { payment_intent_id }.
//
// WHY IT EXISTS ALONGSIDE THE WEBHOOK: the webhook is the source of truth, but it
// is a server-to-server callback Stripe cannot deliver to localhost. Without this
// route the fee never clears in development, which is exactly what left every
// campaign stuck behind a disabled Approve button. In production both fire; the
// confirmer is idempotent (it updates WHERE status = 'pending'), so whichever
// lands first wins and the second is a no-op.
//
// THE CLIENT'S CLAIM IS NOT TRUSTED. It supplies only an id; we retrieve that
// PaymentIntent from Stripe and check the status ourselves. Taking the browser's
// word for "it succeeded" would let anyone mark their own fee paid by POSTing a
// made-up id — the gate this fee exists to enforce would be free to bypass.
router.post("/wouldbes/:id/creation-payment/confirm", authed, async (req, res, next) => {
    try {
        const wb = await getWouldbeById({ id: req.params.id });
        if (!wb) return res.status(404).json({ error: "WouldBe not found" });
        if (wb.user_id !== req.user.id) return res.status(403).json({ error: "Not your WouldBe" });

        const paymentIntentId = String(req.body?.payment_intent_id || "");
        if (!paymentIntentId) return res.status(400).json({ error: "payment_intent_id is required" });

        // Stripe throws on an unknown id. Left uncaught that surfaces as a 500,
        // which reads as our fault for what is a bad request — and echoes Stripe's
        // internal message back to the caller.
        let pi;
        try {
            pi = await stripeSvc.retrievePaymentIntent({ payment_intent_id: paymentIntentId });
        } catch {
            return res.status(400).json({ error: "unknown payment_intent_id" });
        }
        if (pi?.metadata?.kind !== "wouldbe_creation" || pi?.metadata?.wouldbe_id !== wb.id) {
            return res.status(400).json({ error: "that payment is not for this campaign" });
        }
        if (pi.status !== "succeeded") {
            return res.status(409).json({ error: `payment is ${pi.status}, not succeeded` });
        }

        const result = await confirmWouldbeCreationPayment({
            stripe_payment_intent_id: pi.id,
            status: "succeeded",
            stripe_charge_id: pi.latest_charge ?? null,
        });
        return res.json(result ?? { already_confirmed: true });
    } catch (err) {
        next(err);
    }
});

// POST /wouldbes/:id/creation-payment — record the $5 creation-fee charge.
router.post("/wouldbes/:id/creation-payment", authed, async (req, res, next) => {
    try {
        const payment = await recordWouldbeCreationPayment({
            ...req.body,
            wouldbe_id: req.params.id,
            user_id: req.user.id,
        });
        return res.status(201).json(payment);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// PATCH /wouldbes/:id — edit a campaign ($5K–$1M goal enforced).
router.patch("/wouldbes/:id", authed, async (req, res, next) => {
    try {
        const wouldbe = await updateWouldbe({ ...req.body, id: req.params.id });
        return res.json(wouldbe);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// PATCH /wouldbes/:id/processor — set the ActBlue/WinRed contribution link.
router.patch("/wouldbes/:id/processor", authed, async (req, res, next) => {
    try {
        const { processor, url } = req.body;
        const wouldbe = await setContributionProcessor({ wouldbe_id: req.params.id, processor, url });
        return res.json(wouldbe);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// POST /wouldbes/:id/retire — soft-archive a campaign.
router.post("/wouldbes/:id/retire", authed, async (req, res, next) => {
    try {
        const wouldbe = await retireWouldbe({ id: req.params.id });
        return res.json(wouldbe);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// POST /internal/wouldbes/:id/goal-reached — record a goal/micro-goal hit and the
// processor link sent to pledgers (idempotent). Driven by the pledge lifecycle.
router.post("/internal/wouldbes/:id/goal-reached", requireInternal, async (req, res, next) => {
    try {
        const row = await recordGoalReached({ ...req.body, wouldbe_id: req.params.id });
        return res.json(row); // null = already fired for this goal
    } catch (err) {
        mapErr(err, res, next);
    }
});

module.exports = { router };
