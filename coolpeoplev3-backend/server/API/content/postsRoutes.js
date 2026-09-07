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
    getWrittenPosts,
    WRITTEN_TYPES,
} = require("../../DB/content/posts");
const {
    createPendingContentItem,
    markUploadComplete,
} = require("../../DB/platform/contentItems");
const { findUserByToken } = require("../../DB/platform/auth");
const { enqueueForReview } = require("../../DB/platform/moderationQueue");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireCriteriaAck,
    captureRequestContext,
} = require("../../middleware");

const router = express.Router();

// The image types a post may carry. Mirrors plansRoutes and the avatar flow —
// no SVG, which executes script when served inline and which no nudity
// classifier will meaningfully read.
const IMAGE_TYPES = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// viewer — who is asking, on a route that does not REQUIRE anyone to be asking.
// requireAuth would 401 the anonymous reader a public feed exists for, and no
// auth at all would hide a person's own pending post from them. A bad or expired
// token is treated as anonymous rather than as an error: on a public GET it means
// "you are logged out", not "your request is malformed".
const viewer = async (req) => {
    const header = req.headers.authorization;
    if (!header) return null;
    try {
        const user = await findUserByToken(header);
        return user?.id || null;
    } catch {
        return null;
    }
};

// attachPostImage — register an already-uploaded object against a post and queue
// it for moderation. Returns the content_item, or null when no image was supplied.
//
// It does NOT set posts.image_url. That happens in contentItems.syncPostImage when
// a verdict lands, so a card can never render an image the scanner hasn't cleared.
const attachPostImage = async ({ objectKey, mimeType, fileSize, postId, userId }) => {
    if (!objectKey) return null;

    // Re-derived against the caller's own prefix rather than trusted: otherwise
    // any authenticated user could claim any object in the bucket — including one
    // already rejected for somebody else.
    if (!String(objectKey).startsWith(`post-images/${userId}/`)) {
        const e = new Error("image_object_key does not belong to this user");
        e.status = 400;
        throw e;
    }
    if (!IMAGE_TYPES[mimeType]) {
        const e = new Error(`image_mime_type must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`);
        e.status = 400;
        throw e;
    }
    const storageUrl = r2.getPublicUrl({ key: objectKey });
    if (!storageUrl) {
        const e = new Error("R2_PUBLIC_BASE_URL is not configured — cannot resolve a public image URL");
        e.status = 503;
        throw e;
    }

    const pending = await createPendingContentItem({
        user_id: userId,
        parent_type: "written_post",
        parent_id: postId,
        content_type: "image",
        mime_type: mimeType,
        file_size_bytes: fileSize ?? null,
        visibility: "private",   // promoted on approval
    });
    const item = await markUploadComplete({
        id: pending.id,
        user_id: userId,
        storage_url: storageUrl,
        mime_type: mimeType,
        file_size_bytes: fileSize ?? null,
    });

    // Best-effort: a queue failure must not strand an uploaded file, and the
    // scanner's auto-decision can resolve it without a queue row anyway.
    try {
        await enqueueForReview({ content_item_id: item.id, queue_type: "auto_flagged", priority: 4 });
    } catch (queueErr) {
        console.error("post image enqueue failed (item still pending_moderation)", queueErr);
    }
    return item;
};

// GET /api/posts — the written feed: questions and artifacts, newest first.
//
// ?kind=question|artifact narrows it, ?author= scopes it to one person, and
// ?limit/?offset page it. The two video kinds are deliberately NOT here: they
// belong to a wouldbe or a debate and are read through those parents' routes,
// which is where the reader already has the context to make sense of them.
router.get("/posts", async (req, res, next) => {
    try {
        return res.json(
            await getWrittenPosts({
                post_type: req.query.kind || null,
                author_user_id: req.query.author || null,
                limit: req.query.limit,
                offset: req.query.offset,
            })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/posts — create a post. author_user_id comes from the token, NEVER the
// body. category_keys[] (optional) ride along in the body for atomic tag insert.
//
// A written post (question/artifact) may carry { image_object_key,
// image_mime_type, image_file_size_bytes } from a prior /posts/image-upload-url
// upload. The image is registered for moderation and comes back as `image`
// (pending_moderation) — it reaches the card only once a verdict clears it.
router.post("/posts", requireAuth, async (req, res, next) => {
    try {
        const {
            image_object_key = null,
            image_mime_type = null,
            image_file_size_bytes = null,
            ...postFields
        } = req.body ?? {};

        const post = await createPost({ ...postFields, author_user_id: req.user.id });

        if (!image_object_key || !WRITTEN_TYPES.includes(post.post_type)) {
            return res.status(201).json(post);
        }

        // The post has to exist first — content_items.parent_id references it. A
        // failure here must not undo the post: the words are the point, the image
        // is optional, and losing what somebody wrote over a bad upload would be
        // the worse outcome by a wide margin.
        try {
            const image = await attachPostImage({
                objectKey: image_object_key,
                mimeType: image_mime_type,
                fileSize: image_file_size_bytes,
                postId: post.id,
                userId: req.user.id,
            });
            return res.status(201).json({ ...post, image });
        } catch (imgErr) {
            console.error("post image attach failed", imgErr);
            return res.status(201).json({ ...post, image: null, image_error: imgErr.message });
        }
    } catch (err) {
        next(err);
    }
});

// POST /api/posts/image-upload-url — presigned PUT for a post image. Body:
// { contentType }. The object key is derived server-side; a caller-supplied key
// is a path-traversal / overwrite-anyone's-image primitive.
//
// Declared before /posts/:id so "image-upload-url" is never read as an id.
router.post("/posts/image-upload-url", requireAuth, async (req, res, next) => {
    try {
        const contentType = String(req.body?.contentType || "").toLowerCase();
        const ext = IMAGE_TYPES[contentType];
        if (!ext) {
            return res.status(400).json({
                error: `contentType must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`,
            });
        }
        const objectKey = `post-images/${req.user.id}/${crypto.randomUUID()}.${ext}`;
        const uploadUrl = await r2.getUploadUrl({ key: objectKey, contentType });
        return res.json({
            uploadUrl,
            objectKey,
            publicUrl: r2.getPublicUrl({ key: objectKey }),
            maxBytes: MAX_IMAGE_BYTES,
        });
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

// GET /api/posts/:id — a single post plus its tags. The viewer is resolved from
// the token when there is one: getPostById hides anything not publicly renderable
// from everyone EXCEPT its author, and without this the author's own pending post
// 404s to the author.
router.get("/posts/:id", async (req, res, next) => {
    try {
        const post = await getPostById({ id: req.params.id, viewer_user_id: await viewer(req) });
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
                title: req.body?.title,
                body: req.body?.body,
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
