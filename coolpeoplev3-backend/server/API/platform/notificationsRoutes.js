const express = require("express");

const {
    queueNotification,
    markNotificationSent,
    markNotificationDelivered,
    markNotificationFailed,
    suppressNotification,
    getUserNotifications,
    listNotifications,
} = require("../../DB/platform/notifications");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// §17 notification routes.
//
//  - GET /notifications — the signed-in user's own notification history.
//  - POST /notifications — INTERNAL queueing of a notification. (The decision
//    columns are neutrality evidence, so this is service-to-service, not a
//    public mutation; the engine / job runner is the real caller.)
//  - INTERNAL lifecycle marks (x-internal-secret): the sender service moves a
//    queued row through sent/delivered/failed/suppressed.
//  - GET /admin/notifications — admin audit view, filterable.
// ============================================================================

// GET /api/notifications — the caller's own notifications. user_id from req.user.
router.get("/notifications", requireAuth, async (req, res, next) => {
    try {
        const rows = await getUserNotifications({
            user_id: req.user.id,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/notifications — INTERNAL: queue a notification (write-once decision
// row). Body carries the full neutrality evidence the engine computed.
router.post("/notifications", requireInternal, async (req, res, next) => {
    try {
        const row = await queueNotification(req.body || {});
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// ---- INTERNAL delivery-lifecycle marks -------------------------------------

// POST /api/internal/notifications/:id/sent
router.post("/internal/notifications/:id/sent", requireInternal, async (req, res, next) => {
    try {
        return res.json(await markNotificationSent({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/notifications/:id/delivered
router.post("/internal/notifications/:id/delivered", requireInternal, async (req, res, next) => {
    try {
        return res.json(await markNotificationDelivered({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/notifications/:id/failed  (body: { error })
router.post("/internal/notifications/:id/failed", requireInternal, async (req, res, next) => {
    try {
        return res.json(await markNotificationFailed({ id: req.params.id, error: req.body?.error ?? null }));
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/notifications/:id/suppress  (body: { suppression_reason })
router.post("/internal/notifications/:id/suppress", requireInternal, async (req, res, next) => {
    try {
        return res.json(
            await suppressNotification({
                id: req.params.id,
                suppression_reason: req.body?.suppression_reason,
            })
        );
    } catch (err) {
        next(err);
    }
});

// ---- ADMIN audit view ------------------------------------------------------

// GET /api/admin/notifications — filterable audit list.
router.get(
    "/admin/notifications",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await listNotifications({
                recipient_user_id: req.query.recipient_user_id || null,
                wouldbe_id: req.query.wouldbe_id || null,
                notification_type: req.query.notification_type || null,
                channel: req.query.channel || null,
                status: req.query.status || null,
                limit: req.query.limit,
            });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
