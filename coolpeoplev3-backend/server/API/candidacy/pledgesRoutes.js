const express = require("express");

const {
    createPledge,
    getUserPledges,
    withdrawPledge,
    getWouldbePledgeStats,
    getRemainingPledgeCap,
} = require("../../DB/candidacy/pledges");
const { requireAuth, requireAttestation } = require("../../middleware");

const router = express.Router();

// POST /api/wouldbes/:id/pledges — make a pledge. Requires the own-funds /
// citizen-or-LPR attestation (a contribution-side legal gate).
router.post(
    "/wouldbes/:id/pledges",
    requireAuth,
    requireAttestation("us_citizen_or_lpr"),
    async (req, res, next) => {
        try {
            const pledge = await createPledge({
                pledger_user_id: req.user.id,
                wouldbe_id: req.params.id,
                amount_cents: req.body?.amount_cents,
            });
            return res.status(201).json(pledge);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/wouldbes/:id/pledge-cap — the caller's remaining cap for a WouldBe.
router.get("/wouldbes/:id/pledge-cap", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getRemainingPledgeCap({ userId: req.user.id, wouldbeId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/pledge-stats — aggregate pledge stats (public).
router.get("/wouldbes/:id/pledge-stats", async (req, res, next) => {
    try {
        return res.json(await getWouldbePledgeStats({ wouldbeId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/pledges/me — the caller's pledges.
router.get("/pledges/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserPledges({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/pledges/:id/withdraw — withdraw a pledge (owner only).
router.post("/pledges/:id/withdraw", requireAuth, async (req, res, next) => {
    try {
        return res.json(await withdrawPledge({ id: req.params.id, userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
