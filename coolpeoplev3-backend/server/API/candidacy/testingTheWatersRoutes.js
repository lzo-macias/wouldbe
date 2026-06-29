const express = require("express");

const {
    startTestingTheWaters,
    getUserTTW,
    getTTWById,
    convertTTWToCommittee,
    terminateTTW,
} = require("../../DB/candidacy/testingTheWaters");
const { requireAuth, requireAttestation } = require("../../middleware");

const router = express.Router();

// Ownership guard for a TTW campaign.
const requireTTWOwner = async (req, res, next) => {
    try {
        const ttw = await getTTWById({ id: req.params.id });
        if (!ttw) return res.status(404).json({ error: "testing-the-waters campaign not found" });
        if (ttw.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only access your own campaign" });
        }
        req.ttw = ttw;
        next();
    } catch (err) {
        next(err);
    }
};

// POST /api/ttw — start exploring (non-public, capped). Candidate attestation.
router.post("/ttw", requireAuth, requireAttestation("us_citizen"), async (req, res, next) => {
    try {
        const ttw = await startTestingTheWaters({ ...req.body, user_id: req.user.id });
        return res.status(201).json(ttw);
    } catch (err) {
        next(err);
    }
});

// GET /api/ttw/me — the caller's exploration campaigns.
router.get("/ttw/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserTTW({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/ttw/:id — one campaign (owner only).
router.get("/ttw/:id", requireAuth, requireTTWOwner, (req, res) => res.json(req.ttw));

// POST /api/ttw/:id/convert — convert into a registered committee.
// Body: committee fields (committee_name, committee_type, cycle_year, receipt, …).
router.post("/ttw/:id/convert", requireAuth, requireTTWOwner, async (req, res, next) => {
    try {
        const out = await convertTTWToCommittee({ id: req.params.id, committeeFields: req.body || {} });
        return res.status(201).json(out);
    } catch (err) {
        next(err);
    }
});

// POST /api/ttw/:id/terminate — close out exploration.
router.post("/ttw/:id/terminate", requireAuth, requireTTWOwner, async (req, res, next) => {
    try {
        return res.json(await terminateTTW({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
