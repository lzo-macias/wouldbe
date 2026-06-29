const express = require("express");

const {
    enterDebate,
    getDebateEntries,
    getUserEntries,
    getEntryById,
} = require("../../DB/debate/debateEntries");
const {
    requireAuth,
    requireAdmin,
    requireAttestation,
    requireCriteriaAck,
} = require("../../middleware");

const router = express.Router();

// POST /api/debates/:debateId/enter — enter a debate. requireAttestation gates on
// the signed age_18 + us_citizen attestations; requireCriteriaAck('landing_page')
// confirms they saw the criteria for THIS debate. user_id comes from the token;
// eligibility + the legal debate_entries record are written in the DB layer.
router.post(
    "/debates/:debateId/enter",
    requireAuth,
    requireAttestation("age_18"),
    requireAttestation("us_citizen"),
    requireCriteriaAck("landing_page"),
    async (req, res, next) => {
        try {
            const result = await enterDebate({
                ...req.body,
                debate_id: req.params.debateId,
                user_id: req.user.id,
            });
            return res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:debateId/entries — the legal entry roster (attestations +
// minor data), so admin-gated.
router.get("/debates/:debateId/entries", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await getDebateEntries({ debate_id: req.params.debateId }));
    } catch (err) {
        next(err);
    }
});

// GET /api/entries/me — the caller's own entries.
router.get("/entries/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserEntries({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/entries/:id — one entry, scoped to its owner.
router.get("/entries/:id", requireAuth, async (req, res, next) => {
    try {
        const entry = await getEntryById({ entry_id: req.params.id, user_id: req.user.id });
        if (!entry) return res.status(404).json({ error: "entry not found" });
        return res.json(entry);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
