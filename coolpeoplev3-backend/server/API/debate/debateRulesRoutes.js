const express = require("express");

const {
    publishDebateRules,
    getCurrentDebateRules,
    getDebateRulesHistory,
    getRulesByVersion,
} = require("../../DB/debate/debateRules");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/admin/debates/:id/rules — publish a new version (closes the prior one).
router.post(
    "/admin/debates/:id/rules",
    requireAuth,
    requireAdmin(),
    recordAdminAction("publish_debate_rules", { resourceType: "debate_official_rules" }),
    async (req, res, next) => {
        try {
            const rules = await publishDebateRules({ ...req.body, debate_id: req.params.id });
            return res.status(201).json(rules);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/rules — the current (in-force) rules version (public).
router.get("/debates/:id/rules", async (req, res, next) => {
    try {
        const rules = await getCurrentDebateRules({ debate_id: req.params.id });
        if (!rules) return res.status(404).json({ error: "no rules published for this debate" });
        return res.json(rules);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/rules/history — every version, newest first.
// Declared before /rules/:version so "history" isn't matched as a version.
router.get("/debates/:id/rules/history", async (req, res, next) => {
    try {
        return res.json(await getDebateRulesHistory({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/rules/:version — a specific version.
router.get("/debates/:id/rules/:version", async (req, res, next) => {
    try {
        const rules = await getRulesByVersion({ debate_id: req.params.id, version: req.params.version });
        if (!rules) return res.status(404).json({ error: "no such rules version for this debate" });
        return res.json(rules);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
