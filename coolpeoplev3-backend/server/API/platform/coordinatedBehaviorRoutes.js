const express = require("express");

const {
    recordCoordinatedSignal,
    listCoordinatedSignals,
    decideCoordinatedSignal,
    invalidateVotesForCluster,
} = require("../../DB/platform/coordinatedBehavior");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/admin/coordinated-signals — record a detector signal.
// Body: { signal_type, confidence_score, related_user_ids,
//         related_content_item_ids?, related_debate_id?, detection_details? }
router.post(
    "/admin/coordinated-signals",
    requireAuth,
    requireAdmin(),
    recordAdminAction("record_coordinated_signal", { resourceType: "coordinated_behavior_signals" }),
    async (req, res, next) => {
        try {
            const row = await recordCoordinatedSignal({
                signal_type: req.body?.signal_type,
                confidence_score: req.body?.confidence_score,
                related_user_ids: req.body?.related_user_ids,
                related_content_item_ids: req.body?.related_content_item_ids,
                related_debate_id: req.body?.related_debate_id,
                detection_details: req.body?.detection_details,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/coordinated-signals?status=&signal_type=&related_debate_id=&limit=
router.get(
    "/admin/coordinated-signals",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await listCoordinatedSignals({
                status: req.query.status,
                signal_type: req.query.signal_type,
                related_debate_id: req.query.related_debate_id,
                limit: req.query.limit,
            });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/coordinated-signals/:id/decide — record an admin verdict.
// Body: { decision: confirmed_inauthentic|false_positive|action_taken, action_taken? }
router.post(
    "/admin/coordinated-signals/:id/decide",
    requireAuth,
    requireAdmin(),
    recordAdminAction("decide_coordinated_signal", { resourceType: "coordinated_behavior_signals" }),
    async (req, res, next) => {
        try {
            const row = await decideCoordinatedSignal({
                id: req.params.id,
                decision: req.body?.decision,
                action_taken: req.body?.action_taken,
                reviewed_by_user_id: req.admin.user_id,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/coordinated-signals/:id/invalidate-votes — enforcement: mark
// the clustered accounts' debate votes invalidated. Body: { reason }.
router.post(
    "/admin/coordinated-signals/:id/invalidate-votes",
    requireAuth,
    requireAdmin(),
    recordAdminAction("invalidate_cluster_votes", { resourceType: "coordinated_behavior_signals" }),
    async (req, res, next) => {
        try {
            const result = await invalidateVotesForCluster({
                signal_id: req.params.id,
                reason: req.body?.reason,
            });
            return res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
