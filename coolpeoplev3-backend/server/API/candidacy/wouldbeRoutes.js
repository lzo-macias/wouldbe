const express = require("express");

const {
    createWouldbeV2,
    listWouldbes,
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
} = require("../../DB/candidacy/wouldbe");

const { requireAuth, requireAttestation, requireInternal } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
// Creating a campaign asserts candidacy eligibility (ATT). Requires BOTH the
// adult age attestation ('age_18', recorded at signup for 18+ — minors only hold
// 'age_13', so this blocks them) AND the 'us_citizen' candidacy attestation.
const candidate = [requireAuth, requireAttestation("age_18"), requireAttestation("us_citizen")];

// 400 for validation throws, 404 for not-found throws, else pass to the handler.
const mapErr = (err, res, next) => {
    if (/required|must be between/i.test(err.message)) return res.status(400).json({ error: err.message });
    if (/no wouldbe with this id/i.test(err.message)) return res.status(404).json({ error: err.message });
    return next(err);
};

// POST /wouldbes — create a campaign (starts launch_status='draft'; $5K–$1M goal).
router.post("/wouldbes", candidate, async (req, res, next) => {
    try {
        const wouldbe = await createWouldbeV2({ ...req.body, user_id: req.user.id });
        return res.status(201).json(wouldbe);
    } catch (err) {
        mapErr(err, res, next);
    }
});

// GET /wouldbes — live campaigns (non-retired), newest first.
// GET /wouldbes?office_id=<uuid> — same, scoped to one office: only the WouldBes
// actively running for that office right now (retired ones are excluded).
router.get("/wouldbes", async (req, res, next) => {
    try {
        return res.json(await listWouldbes({ office_id: req.query.office_id }));
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
