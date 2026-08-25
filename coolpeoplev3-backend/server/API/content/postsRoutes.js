const express = require("express");
const crypto = require("crypto");

const r2 = require("../../services/r2");
const {
    createPost,
    getPostById,
    updatePost,
    softDeletePost,
    getPostsForWouldbe,
    getPostsForDebate,
    getUserPosts,
} = require("../../DB/content/posts");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireCriteriaAck,
    captureRequestContext,
} = require("../../middleware");

const router = express.Router();

// POST /api/posts — create a post. author_user_id comes from the token, NEVER the
// body. category_keys[] (optional) ride along in the body for atomic tag insert.
router.post("/posts", requireAuth, async (req, res, next) => {
    try {
        const post = await createPost({ ...req.body, author_user_id: req.user.id });
        return res.status(201).json(post);
    } catch (err) {
        next(err);
    }
});

// POST /api/posts/upload-url — presigned URL for a direct browser->R2 upload.
// Object key is namespaced per uploader (from the token). r2.getUploadUrl throws
// 503 "not configured" until the R2_* env vars are set — same adapter pattern as
// Stripe; no more hardcoded 501.
router.post("/posts/upload-url", requireAuth, async (req, res, next) => {
    try {
        const ext = String(req.body?.ext || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp4";
        const contentType = req.body?.contentType || "video/mp4";
        const objectKey = `posts/${req.user.id}/${crypto.randomUUID()}.${ext}`;
        const uploadUrl = await r2.getUploadUrl({ key: objectKey, contentType });
        return res.json({ uploadUrl, objectKey });
    } catch (err) {
        next(err);
    }
});

// GET /api/posts/:id — a single post plus its tags.
router.get("/posts/:id", async (req, res, next) => {
    try {
        const post = await getPostById({ id: req.params.id });
        if (!post) return res.status(404).json({ error: "post not found" });
        return res.json(post);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/posts/:id — the author edits their own caption/visibility. id from
// the URL and author_user_id from the token (after the spread) so the body can't
// reassign ownership or set moderation_status.
router.patch("/posts/:id", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await updatePost({
                caption: req.body?.caption,
                visibility: req.body?.visibility,
                id: req.params.id,
                author_user_id: req.user.id,
            })
        );
    } catch (err) {
        next(err);
    }
});

// DELETE /api/posts/:id — soft-delete (preserve row, stamp removed_at).
router.delete("/posts/:id", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await softDeletePost({
                id: req.params.id,
                author_user_id: req.user.id,
                removed_reason: req.body?.removed_reason ?? null,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/posts — public campaign posts for a WouldBe.
router.get("/wouldbes/:id/posts", async (req, res, next) => {
    try {
        return res.json(await getPostsForWouldbe({ wouldbe_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/posts — public response posts across a debate.
router.get("/debates/:id/posts", async (req, res, next) => {
    try {
        return res.json(await getPostsForDebate({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/posts — a user's public posts (profile view).
router.get("/users/:id/posts", async (req, res, next) => {
    try {
        return res.json(await getUserPosts({ author_user_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
