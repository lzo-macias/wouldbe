const express = require("express");

const {
    runComplianceCheck,
    getChecksForUser,
    getChecksForWouldbe,
    getLatestCheckResult,
} = require("../../DB/platform/complianceChecks");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/compliance-checks/run — run + record a compliance check for the
// caller (auto-resolves jurisdiction from their links, stamps the rules version).
router.post("/compliance-checks/run", requireAuth, async (req, res, next) => {
    try {
        const check = await runComplianceCheck({
            ...req.body,
            userId: req.user.id,
            // a user-initiated run is self-attested unless the body says otherwise
            performed_by: req.body?.performed_by || "user_self_attestation",
            performed_by_user_id: req.body?.performed_by_user_id || req.user.id,
        });
        return res.status(201).json(check);
    } catch (err) {
        next(err);
    }
});

// GET /api/compliance-checks/me — the caller's check history.
router.get("/compliance-checks/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getChecksForUser({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/compliance — checks for a WouldBe. ?latest=1 (optionally
// &check_type=) returns just the most recent matching check.
router.get("/wouldbes/:id/compliance", requireAuth, async (req, res, next) => {
    try {
        if (req.query.latest) {
            const latest = await getLatestCheckResult({
                wouldbeId: req.params.id,
                check_type: req.query.check_type || null,
            });
            return res.json(latest);
        }
        return res.json(await getChecksForWouldbe({ wouldbeId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
