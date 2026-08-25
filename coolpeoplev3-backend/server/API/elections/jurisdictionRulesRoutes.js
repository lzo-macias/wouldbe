const express = require("express");

const {
    getCurrentRulesForJurisdiction,
    getRulesHistory,
    getRulesAtPointInTime,
    publishRulesVersion,
} = require("../../DB/elections/jurisdictionRules");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// GET /api/jurisdiction-rules/:jid/current — the in-force rules version (public).
router.get("/jurisdiction-rules/:jid/current", async (req, res, next) => {
    try {
        const rules = await getCurrentRulesForJurisdiction({ jurisdictionId: req.params.jid });
        if (!rules) return res.status(404).json({ error: "no current rules for this jurisdiction" });
        return res.json(rules);
    } catch (err) {
        next(err);
    }
});

// GET /api/jurisdiction-rules/:jid/history — every version, newest first.
router.get("/jurisdiction-rules/:jid/history", async (req, res, next) => {
    try {
        return res.json(await getRulesHistory({ jurisdictionId: req.params.jid }));
    } catch (err) {
        next(err);
    }
});

// GET /api/jurisdiction-rules/:jid/at?date=YYYY-MM-DD — the version in force on a date.
router.get("/jurisdiction-rules/:jid/at", async (req, res, next) => {
    try {
        if (!req.query.date) return res.status(400).json({ error: "date query param is required" });
        const rules = await getRulesAtPointInTime({ jurisdictionId: req.params.jid, date: req.query.date });
        if (!rules) return res.status(404).json({ error: "no rules in force on that date" });
        return res.json(rules);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/jurisdiction-rules — publish a new version (closes the prior one).
router.post(
    "/admin/jurisdiction-rules",
    requireAuth,
    requireAdmin(),
    recordAdminAction("publish_rules_version", { resourceType: "jurisdiction_rules_version" }),
    async (req, res, next) => {
        try {
            const version = await publishRulesVersion({ ...req.body, created_by_user_id: req.user.id });
            return res.status(201).json(version);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
