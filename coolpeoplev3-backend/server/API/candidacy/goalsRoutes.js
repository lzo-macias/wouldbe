const express = require("express");

const { client } = require("../../DB/index");
const {
    getRecommendedGoalForOffice,
    createGoalIncreaseRequest,
    listPendingGoalIncreases,
    decideGoalIncrease,
} = require("../../DB/candidacy/goals");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// GET /api/offices/:id/recommended-goal — recommended goal for an office (public).
router.get("/offices/:id/recommended-goal", async (req, res, next) => {
    try {
        const rec = await getRecommendedGoalForOffice({ officeId: req.params.id });
        if (!rec) return res.json({ recommended_goal_cents: null });
        return res.json(rec);
    } catch (err) {
        next(err);
    }
});

// POST /api/wouldbes/:id/goal-increase — candidate requests a raise (owner only).
router.post("/wouldbes/:id/goal-increase", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(`SELECT user_id FROM wouldbe WHERE id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "WouldBe not found" });
        if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: "Not your WouldBe" });
        const reqRow = await createGoalIncreaseRequest({
            wouldbe_id: req.params.id,
            requested_by_user_id: req.user.id,
            requested_goal_cents: req.body?.requested_goal_cents,
            reason: req.body?.reason,
        });
        return res.status(201).json(reqRow);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/goal-increases — pending review queue.
router.get("/admin/goal-increases", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await listPendingGoalIncreases({ limit: req.query.limit }));
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/goal-increases/:id/decide — approve/reject. Approve bumps the goal.
router.post(
    "/admin/goal-increases/:id/decide",
    requireAuth,
    requireAdmin(),
    recordAdminAction("decide_goal_increase", { resourceType: "goal_increase_request" }),
    async (req, res, next) => {
        try {
            const out = await decideGoalIncrease({
                id: req.params.id,
                decision: req.body?.decision,
                reviewed_by_user_id: req.user.id,
                review_notes: req.body?.review_notes,
            });
            return res.json(out);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
