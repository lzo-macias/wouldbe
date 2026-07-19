const express = require("express");

const {
    enqueueForReview,
    listOpenQueue,
    assignQueueItem,
    resolveQueueItem,
    getQueueSLAMetrics,
} = require("../../DB/platform/moderationQueue");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/admin/moderation-queue — enqueue an item for human review.
// Two legitimate callers:
//   - an internal/system process (automated scanner, cron) → x-internal-secret
//   - an admin manually adding an item from the console      → requireAuth+admin
// We try the internal gate first; if it doesn't pass we fall through to the
// admin gate, so either credential is accepted but anonymous calls are not.
// Body: { content_item_id, queue_type, priority?, sla_deadline? }
const enqueueGate = (req, res, next) => {
    const secret = process.env.INTERNAL_API_SECRET;
    const provided = req.headers["x-internal-secret"];
    if (secret && provided && provided === secret) {
        req._internalEnqueue = true;
        return next();
    }
    // Not an internal call — require an authenticated admin instead.
    return requireAuth(req, res, (err) => {
        if (err) return next(err);
        return requireAdmin()(req, res, next);
    });
};

router.post("/admin/moderation-queue", enqueueGate, async (req, res, next) => {
    try {
        const row = await enqueueForReview({
            content_item_id: req.body?.content_item_id,
            queue_type: req.body?.queue_type,
            priority: req.body?.priority ?? null,
            sla_deadline: req.body?.sla_deadline ?? null,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/moderation-queue — the moderator work list (admin only).
// Filters: ?status=&queue_type=&assigned_to_user_id=&include_closed=&limit=
router.get("/admin/moderation-queue", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listOpenQueue({
            status: req.query.status || null,
            queue_type: req.query.queue_type || null,
            assigned_to_user_id: req.query.assigned_to_user_id || null,
            include_closed: req.query.include_closed === "true",
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/moderation-queue/metrics — SLA dashboard aggregate (admin only).
// Declared before the :id routes so the literal path matches first.
// Filter: ?queue_type=
router.get(
    "/admin/moderation-queue/metrics",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const metrics = await getQueueSLAMetrics({
                queue_type: req.query.queue_type || null,
            });
            return res.json(metrics);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/moderation-queue/:id/assign — admin claims an item.
// The assignee is ALWAYS the calling admin's USERS id (req.admin.user_id),
// never a body value — a moderator can only claim work for themselves.
router.post(
    "/admin/moderation-queue/:id/assign",
    requireAuth,
    requireAdmin(),
    recordAdminAction("assign_moderation_queue_item", { resourceType: "moderation_queue" }),
    async (req, res, next) => {
        try {
            const row = await assignQueueItem({
                id: req.params.id,
                assignee_user_id: req.admin.user_id,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/moderation-queue/:id/resolve — admin closes an item.
// The resolver is the calling admin's USERS id (req.admin.user_id).
// Body: { status?, resolution?, resolution_notes?, content_moderation_status? }
router.post(
    "/admin/moderation-queue/:id/resolve",
    requireAuth,
    requireAdmin(),
    recordAdminAction("resolve_moderation_queue_item", { resourceType: "moderation_queue" }),
    async (req, res, next) => {
        try {
            const row = await resolveQueueItem({
                id: req.params.id,
                resolver_user_id: req.admin.user_id,
                status: req.body?.status ?? "resolved",
                resolution: req.body?.resolution ?? null,
                resolution_notes: req.body?.resolution_notes ?? null,
                content_moderation_status: req.body?.content_moderation_status ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
