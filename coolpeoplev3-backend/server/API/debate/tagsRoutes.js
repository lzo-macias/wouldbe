const express = require("express");

const { client } = require("../../DB/index");
const { getPostTags, setPostTags, getPromptTags, setPromptTags } = require("../../DB/debate/tags");
const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

// ---- post tags -------------------------------------------------------------

// GET /api/posts/:postId/tags — public.
router.get("/posts/:postId/tags", async (req, res, next) => {
    try {
        return res.json(await getPostTags(req.params.postId));
    } catch (err) {
        next(err);
    }
});

// PUT /api/posts/:postId/tags — only the post's author may tag it. REPLACES set.
// Body: { category_keys: [...] }
router.put("/posts/:postId/tags", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(
            `SELECT author_user_id FROM posts WHERE id = $1`,
            [req.params.postId]
        );
        if (!rows.length) return res.status(404).json({ error: "post not found" });
        if (rows[0].author_user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only tag your own posts" });
        }
        return res.json(await setPostTags(req.params.postId, req.body?.category_keys));
    } catch (err) {
        next(err);
    }
});

// ---- debate-prompt tags ----------------------------------------------------

// GET /api/prompts/:promptId/tags — public.
router.get("/prompts/:promptId/tags", async (req, res, next) => {
    try {
        return res.json(await getPromptTags(req.params.promptId));
    } catch (err) {
        next(err);
    }
});

// PUT /api/prompts/:promptId/tags — admin only (prompts are debate content, not
// user-owned). REPLACES the set. Body: { category_keys: [...] }
router.put("/prompts/:promptId/tags", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await setPromptTags(req.params.promptId, req.body?.category_keys));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
