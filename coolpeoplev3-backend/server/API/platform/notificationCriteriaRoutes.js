const express = require("express");

const {
    getCurrentCriteria,
    listCriteriaVersions,
    publishCriteriaVersion,
} = require("../../DB/platform/notificationCriteria");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// §17 notification criteria routes.
//
//  - GET /notification-criteria — the in-force frozen formula. Auth-gated (so we
//    don't publicly broadcast the targeting parameters), returns current +
//    full history for transparency to the signed-in user.
//  - POST /admin/notification-criteria — publish a new version (closes prior).
//    super_admin/compliance territory; recordAdminAction logs the publish.
// ============================================================================

// GET /api/notification-criteria?algorithm_key= — current version + history.
router.get("/notification-criteria", requireAuth, async (req, res, next) => {
    try {
        const algorithmKey = req.query.algorithm_key || "wouldbe_notification";
        const [current, history] = await Promise.all([
            getCurrentCriteria({ algorithmKey }),
            listCriteriaVersions({ algorithmKey }),
        ]);
        return res.json({ current, history });
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/notification-criteria — publish a new criteria version.
// Body: { algorithm_key?, description?, parameters, effective_from? }.
router.post(
    "/admin/notification-criteria",
    requireAuth,
    requireAdmin(),
    recordAdminAction("notification_criteria.publish", { resourceType: "notification_criteria_version" }),
    async (req, res, next) => {
        try {
            const row = await publishCriteriaVersion({
                algorithmKey: req.body.algorithm_key || "wouldbe_notification",
                description: req.body.description ?? null,
                parameters: req.body.parameters,
                effective_from: req.body.effective_from ?? null,
                created_by_user_id: req.user.id,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
