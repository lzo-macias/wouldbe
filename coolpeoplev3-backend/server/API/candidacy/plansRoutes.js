const crypto = require("crypto");
const express = require("express");

const { client } = require("../../DB/index");
const {
    createPlan,
    getPlanForWouldbe,
    addPlanComponent,
    updatePlanComponent,
    deletePlanComponent,
    listPlanCategories,
    createPlanCategory,
} = require("../../DB/candidacy/plans");
const {
    createPendingContentItem,
    markUploadComplete,
} = require("../../DB/platform/contentItems");
const { enqueueForReview } = require("../../DB/platform/moderationQueue");
const { requireAuth, requireAdmin } = require("../../middleware");
const r2 = require("../../services/r2");

const router = express.Router();

// ============================================================================
// Plan-component images — same shape as the avatar flow (avatarRoutes.js), same
// reason: an image we don't hold a copy of can't be moderated, because whoever
// owns the URL can swap the bytes after we approve it.
//
// Mirrors IMAGE_TYPES there. No SVG — it executes script when served inline and
// no nudity classifier will meaningfully read it.
// ============================================================================
const IMAGE_TYPES = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Confirm the caller owns the WouldBe (and thus its plan).
const ownsWouldbe = async (userId, wouldbeId) => {
    const { rows } = await client.query(`SELECT user_id FROM wouldbe WHERE id = $1`, [wouldbeId]);
    return rows[0] && rows[0].user_id === userId;
};

// Confirm the caller owns the plan a component belongs to.
const ownsComponent = async (userId, componentId) => {
    const { rows } = await client.query(
        `SELECT p.user_id FROM plan_components pc JOIN plan p ON p.id = pc.plan_id WHERE pc.id = $1`,
        [componentId]
    );
    return rows.length ? { exists: true, owned: rows[0].user_id === userId } : { exists: false };
};

// POST /api/wouldbes/:id/plan — create the plan for a WouldBe (owner only).
router.post("/wouldbes/:id/plan", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(`SELECT user_id, office_id FROM wouldbe WHERE id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "WouldBe not found" });
        if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: "Not your WouldBe" });
        const plan = await createPlan({ wouldbe_id: req.params.id, user_id: req.user.id, office_id: rows[0].office_id });
        return res.status(201).json(plan);
    } catch (err) {
        next(err);
    }
});

// GET /api/wouldbes/:id/plan — the plan + components (public).
router.get("/wouldbes/:id/plan", async (req, res, next) => {
    try {
        const plan = await getPlanForWouldbe({ wouldbeId: req.params.id });
        if (!plan) return res.status(404).json({ error: "no plan for this WouldBe" });
        return res.json(plan);
    } catch (err) {
        next(err);
    }
});

// POST /api/plan-components/image-upload-url — presigned PUT for a plan-position
// image. Body: { contentType }.
//
// Declared with no :planId because the candidate attaches images on the
// "plan of action" screen BEFORE the campaign (and therefore the plan, and
// therefore the component) exists. So the upload can only be scoped to the user
// here; the image is bound to its component at creation time below.
//
// The object key is derived server-side — a caller-supplied key is a
// path-traversal / overwrite-anyone's-image primitive.
router.post("/plan-components/image-upload-url", requireAuth, async (req, res, next) => {
    try {
        const contentType = String(req.body?.contentType || "").toLowerCase();
        const ext = IMAGE_TYPES[contentType];
        if (!ext) {
            return res.status(400).json({
                error: `contentType must be one of: ${Object.keys(IMAGE_TYPES).join(", ")}`,
            });
        }
        const objectKey = `plan-components/${req.user.id}/${crypto.randomUUID()}.${ext}`;
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

// attachComponentImage — register an already-uploaded object against a component
// and queue it. Returns the content_item, or null when no image was supplied.
//
// It does NOT set plan_components.image_url. That happens in
// contentItems.syncPlanComponentImage when a verdict lands, so a position can
// never render an image the scanner hasn't cleared.
const attachComponentImage = async ({ objectKey, mimeType, fileSize, componentId, userId }) => {
    if (!objectKey) return null;

    // Re-derived against the caller's own prefix rather than trusted: otherwise
    // any authenticated user could claim any object in the bucket — including one
    // already rejected for somebody else.
    if (!String(objectKey).startsWith(`plan-components/${userId}/`)) {
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
        parent_type: "plan_component",
        parent_id: componentId,
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
        console.error("plan-component image enqueue failed (item still pending_moderation)", queueErr);
    }
    return item;
};

// POST /api/plans/:id/components — add a position (owner of the plan only).
// Body may carry { image_object_key, image_mime_type, image_file_size_bytes }
// from a prior /plan-components/image-upload-url upload; the image is registered
// for moderation and surfaces on the response as `image` (pending_moderation).
router.post("/plans/:id/components", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(`SELECT user_id FROM plan WHERE id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "plan not found" });
        if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: "Not your plan" });

        const {
            image_object_key = null,
            image_mime_type = null,
            image_file_size_bytes = null,
            ...componentFields
        } = req.body ?? {};

        const comp = await addPlanComponent({ ...componentFields, plan_id: req.params.id });

        // The component has to exist first — content_items.parent_id references it.
        // A failure here must not undo the position itself: the text is the point,
        // the image is optional, and losing the whole entry over a bad upload would
        // be the worse outcome.
        let image = null;
        try {
            image = await attachComponentImage({
                objectKey: image_object_key,
                mimeType: image_mime_type,
                fileSize: image_file_size_bytes,
                componentId: comp.id,
                userId: req.user.id,
            });
        } catch (imgErr) {
            console.error("plan-component image attach failed", imgErr);
            return res.status(201).json({ ...comp, image: null, image_error: imgErr.message });
        }

        return res.status(201).json({ ...comp, image });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/plan-components/:id — edit a component (owner only).
router.patch("/plan-components/:id", requireAuth, async (req, res, next) => {
    try {
        const o = await ownsComponent(req.user.id, req.params.id);
        if (!o.exists) return res.status(404).json({ error: "plan component not found" });
        if (!o.owned) return res.status(403).json({ error: "Not your plan component" });
        return res.json(await updatePlanComponent({ ...req.body, id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// DELETE /api/plan-components/:id — remove a component (owner only).
router.delete("/plan-components/:id", requireAuth, async (req, res, next) => {
    try {
        const o = await ownsComponent(req.user.id, req.params.id);
        if (!o.exists) return res.status(404).json({ error: "plan component not found" });
        if (!o.owned) return res.status(403).json({ error: "Not your plan component" });
        return res.json(await deletePlanComponent({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/plan-categories — the controlled taxonomy (public).
router.get("/plan-categories", async (req, res, next) => {
    try {
        return res.json(await listPlanCategories({ includeInactive: !!req.query.includeInactive }));
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/plan-categories — admin extends the taxonomy.
router.post("/admin/plan-categories", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.status(201).json(await createPlanCategory(req.body));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
