const crypto = require("crypto");
const express = require("express");

const {
    createPendingContentItem,
    markUploadComplete,
    getLatestProfileImage,
} = require("../../DB/platform/contentItems");
const { enqueueForReview } = require("../../DB/platform/moderationQueue");
const { requireAuth } = require("../../middleware");
const r2 = require("../../services/r2");

const router = express.Router();

// ============================================================================
// Profile photos — direct-to-R2 upload behind the moderation pipeline.
//
// WHY THIS EXISTS: signup previously took a pasted image URL. That cannot be
// moderated. You can scan someone else's URL, approve it, and the owner swaps
// the bytes an hour later — an unreviewed image now sits on the profile under
// our approval. The only defense is holding our own copy, which means an upload.
//
// The flow, three calls:
//   1. POST /api/users/me/avatar-upload-url  → presigned PUT + object key
//   2. browser PUTs the file straight to R2  (never through this server)
//   3. POST /api/users/me/avatar             → registers + queues for review
//
// users.profile_photo_url is NOT written by any of this. It is written by
// contentItems.syncProfilePhoto when — and only when — a verdict lands. Between
// upload and approval the user sees their own photo from a local object URL; no
// one else sees anything.
//
// Step 2 is a direct browser→R2 PUT on purpose: a 5MB body through Express would
// occupy a worker for the whole transfer, and R2 does it better.
// ============================================================================

// Content types we will hand out a presigned PUT for. Allowlist, not blocklist —
// the value is echoed into the presigned URL's ContentType, so an unbounded one
// lets a caller stage anything they like in our bucket.
//
// No SVG: it is a document, not an image. It executes script when served inline
// and no nudity classifier will look at it. HEIC is absent because the browser
// re-encodes to WebP before upload (see the frontend prepareImage).
const IMAGE_TYPES = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
};

// 5MB. The client downsizes to ~512px/WebP first, which lands well under this —
// so a request near the ceiling means the client path was skipped, which is
// exactly when a limit earns its keep.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// POST /api/users/me/avatar-upload-url — presigned PUT for a direct browser→R2
// upload. Body: { contentType }. The object key is derived here, never accepted
// from the caller: a client-supplied key is a path-traversal / overwrite-anyone's
// -avatar primitive. 503 until the R2_* env vars are set (same adapter pattern
// as Stripe).
router.post("/users/me/avatar-upload-url", requireAuth, async (req, res, next) => {
    try {
        const contentType = String(req.body?.contentType || "").toLowerCase();
        const ext = IMAGE_TYPES[contentType];
        if (!ext) {
            return res.status(400).json({
                error: `contentType must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`,
            });
        }

        const objectKey = `avatars/${req.user.id}/${crypto.randomUUID()}.${ext}`;
        const uploadUrl = await r2.getUploadUrl({ key: objectKey, contentType });

        return res.json({
            uploadUrl,
            objectKey,
            publicUrl: r2.getPublicUrl({ key: objectKey }),
            maxBytes: MAX_AVATAR_BYTES,
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/users/me/avatar — the file has landed in R2; register it and queue it.
// Body: { objectKey, mime_type, file_size_bytes? }
//
// objectKey is re-derived against the caller's own prefix rather than trusted:
// without that check any authenticated user could claim any object in the bucket
// as their avatar, including one already rejected for someone else.
//
// Creates the content_item, flips it to 'pending_moderation', and enqueues it.
// Response carries moderation_status so the client can show "pending review"
// immediately instead of guessing.
router.post("/users/me/avatar", requireAuth, async (req, res, next) => {
    try {
        const objectKey = String(req.body?.objectKey || "");
        const mimeType = String(req.body?.mime_type || "").toLowerCase();
        const fileSize = req.body?.file_size_bytes == null ? null : Number(req.body.file_size_bytes);

        if (!objectKey.startsWith(`avatars/${req.user.id}/`)) {
            return res.status(400).json({ error: "objectKey does not belong to this user" });
        }
        if (!IMAGE_TYPES[mimeType]) {
            return res.status(400).json({
                error: `mime_type must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`,
            });
        }
        if (fileSize != null && (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_AVATAR_BYTES)) {
            return res.status(400).json({ error: `file_size_bytes must be between 1 and ${MAX_AVATAR_BYTES}` });
        }

        const storageUrl = r2.getPublicUrl({ key: objectKey });
        if (!storageUrl) {
            return res.status(503).json({
                error: "R2_PUBLIC_BASE_URL is not configured — cannot resolve a public avatar URL",
            });
        }

        // parent_type 'profile' + parent_id = the user's own id. The vocabulary
        // already had 'profile'; no migration needed.
        const pending = await createPendingContentItem({
            user_id: req.user.id,
            parent_type: "profile",
            parent_id: req.user.id,
            content_type: "image",
            mime_type: mimeType,
            file_size_bytes: fileSize,
            visibility: "private",   // promoted to public by syncProfilePhoto on approval
        });

        const item = await markUploadComplete({
            id: pending.id,
            user_id: req.user.id,
            storage_url: storageUrl,
            mime_type: mimeType,
            file_size_bytes: fileSize,
        });

        // Queue for human review. The automated scanner also writes a verdict via
        // POST /api/content-items/:id/auto-decision; whichever resolves first wins,
        // and a clean auto-scan closes this out. Enqueueing is best-effort: a queue
        // failure must not strand an already-uploaded file in 'pending_upload'.
        try {
            await enqueueForReview({
                content_item_id: item.id,
                queue_type: "auto_flagged",
                priority: 4,
            });
        } catch (queueErr) {
            console.error("avatar enqueue failed (item still pending_moderation)", queueErr);
        }

        return res.status(201).json(item);
    } catch (err) {
        next(err);
    }
});

// GET /api/users/me/avatar — the caller's latest avatar upload and its state.
// Returns null when they've never uploaded one. This is what the client polls
// while the badge says "pending review", and how it learns about a rejection.
router.get("/users/me/avatar", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getLatestProfileImage({ user_id: req.user.id }) ?? null);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
