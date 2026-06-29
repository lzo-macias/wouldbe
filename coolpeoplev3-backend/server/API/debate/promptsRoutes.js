const express = require("express");

const {
    createPrompt,
    getDebatePrompts,
    updatePrompt,
    deletePrompt,
} = require("../../DB/debate/prompts");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// Debate prompts are admin-managed (AD). No user_id is passed to the DB layer, so
// the sponsor-ownership check is skipped — the admin gate authorizes the action,
// and recordAdminAction writes the audit trail.

// POST /api/debates/:id/prompts — add a prompt.
router.post(
    "/debates/:id/prompts",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_prompt", { resourceType: "prompts" }),
    async (req, res, next) => {
        try {
            return res.status(201).json(await createPrompt({ ...req.body, debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/prompts — all prompts incl. unreleased (admin view).
router.get("/debates/:id/prompts", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await getDebatePrompts({ debate_id: req.params.id, includeUnreleased: true }));
    } catch (err) {
        next(err);
    }
});

// PATCH /api/prompts/:id — edit a prompt.
router.patch(
    "/prompts/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("update_prompt", { resourceType: "prompts" }),
    async (req, res, next) => {
        try {
            return res.json(await updatePrompt({ ...req.body, id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// DELETE /api/prompts/:id — remove a prompt.
router.delete(
    "/prompts/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("delete_prompt", { resourceType: "prompts" }),
    async (req, res, next) => {
        try {
            return res.json(await deletePrompt({ id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
