const express = require("express");

const {
    runFundraisingEligibilityCheck,
    getUserFundraisingChecks,
    getLatestEligibilityForJurisdiction,
} = require("../../DB/candidacy/fundraisingEligibility");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/fundraising-eligibility/run — evaluate + record whether the caller can
// fundraise (derives the verdict from the jurisdiction's current rules version).
router.post("/fundraising-eligibility/run", requireAuth, async (req, res, next) => {
    try {
        const check = await runFundraisingEligibilityCheck({ ...req.body, userId: req.user.id });
        return res.status(201).json(check);
    } catch (err) {
        next(err);
    }
});

// GET /api/fundraising-eligibility/me — the caller's eligibility-check history.
router.get("/fundraising-eligibility/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserFundraisingChecks({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/fundraising-eligibility/:jid/latest — the caller's latest check for a
// jurisdiction.
router.get("/fundraising-eligibility/:jid/latest", requireAuth, async (req, res, next) => {
    try {
        const latest = await getLatestEligibilityForJurisdiction({
            userId: req.user.id,
            jurisdictionId: req.params.jid,
        });
        if (!latest) return res.status(404).json({ error: "no eligibility check for this jurisdiction yet" });
        return res.json(latest);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
