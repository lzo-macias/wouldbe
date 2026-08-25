const express = require("express");

const {
    fileAppeal,
    getUserAppeals,
    listPendingAppeals,
    decideAppeal,
} = require("../../DB/platform/moderationAppeals");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/moderation-appeals — the affected USER files an appeal on their own
// content. appellant_user_id is taken from the token, NEVER the body.
// Body: { content_item_id, appeal_reason }
router.post("/moderation-appeals", requireAuth, async (req, res, next) => {
    try {
        const row = await fileAppeal({
            appellant_user_id: req.user.id,
            content_item_id: req.body?.content_item_id,
            appeal_reason: req.body?.appeal_reason,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /api/moderation-appeals — the caller's OWN appeals (user_id from token).
router.get("/moderation-appeals", requireAuth, async (req, res, next) => {
    try {
        const rows = await getUserAppeals({ user_id: req.user.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/moderation-appeals — the admin review queue (pending by
// default). Filter: ?status=&limit=
router.get("/admin/moderation-appeals", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listPendingAppeals({
            status: req.query.status || null,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/moderation-appeals/:id/decide — admin grants/denies an appeal.
// The reviewer is the calling admin's USERS id (req.admin.user_id), never body.
// Body: { decision: granted|denied, decision_notes?, reverse_to_status? }
router.post(
    "/admin/moderation-appeals/:id/decide",
    requireAuth,
    requireAdmin(),
    recordAdminAction("decide_moderation_appeal", { resourceType: "moderation_appeal" }),
    async (req, res, next) => {
        try {
            const row = await decideAppeal({
                id: req.params.id,
                reviewer_user_id: req.admin.user_id,
                decision: req.body?.decision,
                decision_notes: req.body?.decision_notes ?? null,
                reverse_to_status: req.body?.reverse_to_status ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
