const express = require("express");

const {
    createPendingContentItem,
    markUploadComplete,
    getContentItemById,
    updateVisibility,
    removeContentItem,
    setModerationStatus,
} = require("../../DB/platform/contentItems");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/content-items — a user registers an upload-INTENT row.
// uploader (user_id) is taken from the token, NEVER the body. The row is born
// 'pending_upload'; moderation_status is NOT accepted from the caller.
// Body: { parent_type, parent_id, content_type, storage_url?, text_content?,
//         thumbnail_url?, duration_seconds?, file_size_bytes?, mime_type?,
//         visibility?, age_restriction? }
router.post("/content-items", requireAuth, async (req, res, next) => {
    try {
        const row = await createPendingContentItem({
            user_id: req.user.id,
            parent_type: req.body?.parent_type,
            parent_id: req.body?.parent_id,
            content_type: req.body?.content_type,
            storage_url: req.body?.storage_url ?? null,
            text_content: req.body?.text_content ?? null,
            thumbnail_url: req.body?.thumbnail_url ?? null,
            duration_seconds: req.body?.duration_seconds ?? null,
            file_size_bytes: req.body?.file_size_bytes ?? null,
            mime_type: req.body?.mime_type ?? null,
            visibility: req.body?.visibility ?? "private",
            age_restriction: req.body?.age_restriction ?? null,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /api/content-items/:id — fetch one item.
router.get("/content-items/:id", requireAuth, async (req, res, next) => {
    try {
        const row = await getContentItemById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "content item not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/content-items/:id/upload-complete — OWNER-scoped. The uploader flips
// the item out of 'pending_upload' once the file has landed and stamps storage
// metadata. Body: { storage_url?, thumbnail_url?, duration_seconds?,
//                   file_size_bytes?, mime_type? }
router.patch("/content-items/:id/upload-complete", requireAuth, async (req, res, next) => {
    try {
        const row = await markUploadComplete({
            id: req.params.id,
            user_id: req.user.id,
            storage_url: req.body?.storage_url,
            thumbnail_url: req.body?.thumbnail_url,
            duration_seconds: req.body?.duration_seconds,
            file_size_bytes: req.body?.file_size_bytes,
            mime_type: req.body?.mime_type,
        });
        if (!row) {
            return res
                .status(404)
                .json({ error: "content item not found, not yours, or not pending upload" });
        }
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/content-items/:id/visibility — OWNER-scoped. Body: { visibility }.
router.patch("/content-items/:id/visibility", requireAuth, async (req, res, next) => {
    try {
        const row = await updateVisibility({
            id: req.params.id,
            user_id: req.user.id,
            visibility: req.body?.visibility,
        });
        if (!row) return res.status(404).json({ error: "content item not found or not yours" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/content-items/:id — admin/moderator soft-remove (takedown).
// Body: { removed_reason, reason? }. requireAdmin + audited.
router.delete(
    "/content-items/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("content_item.remove", { resourceType: "content_item" }),
    async (req, res, next) => {
        try {
            const row = await removeContentItem({
                id: req.params.id,
                removed_reason: req.body?.removed_reason,
            });
            if (!row) return res.status(404).json({ error: "content item not found" });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// PATCH /api/content-items/:id/moderation — INTERNAL (pipeline) or admin. Sets the
// moderation_status. Users can NEVER reach this (no self-approve).
// Body: { moderation_status, removed_reason? }.
//
// Dual-gated: if the request carries a valid x-internal-secret, requireInternal
// lets it through (the scan pipeline). Otherwise it must be an authenticated
// admin. We branch on the header so a single route serves both callers.
const moderationGate = (req, res, next) => {
    if (req.headers["x-internal-secret"]) return requireInternal(req, res, next);
    return requireAuth(req, res, (err) => {
        if (err) return next(err);
        return requireAdmin()(req, res, next);
    });
};

router.patch("/content-items/:id/moderation", moderationGate, async (req, res, next) => {
    try {
        const row = await setModerationStatus({
            id: req.params.id,
            moderation_status: req.body?.moderation_status,
            removed_reason: req.body?.removed_reason ?? null,
        });
        if (!row) return res.status(404).json({ error: "content item not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
