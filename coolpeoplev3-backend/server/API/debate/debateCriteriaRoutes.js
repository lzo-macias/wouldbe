const express = require("express");

const {
    addCriterion,
    getDebateCriteria,
    updateCriterion,
    deleteCriterion,
    validateCriteriaWeightsSum,
} = require("../../DB/debate/debateCriteria");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:id/criteria — add a criterion, then report the weight sum
// so the admin knows if the debate's criteria still total ~1.0.
router.post(
    "/debates/:id/criteria",
    requireAuth,
    requireAdmin(),
    recordAdminAction("add_debate_criterion", { resourceType: "debate_judging_criteria" }),
    async (req, res, next) => {
        try {
            const criterion = await addCriterion({ ...req.body, debate_id: req.params.id });
            const weights = await validateCriteriaWeightsSum({ debate_id: req.params.id });
            return res.status(201).json({ criterion, weights });
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/criteria — the debate's criteria (public; shown to
// voters/judges). ?validate=1 also returns the weight-sum check.
router.get("/debates/:id/criteria", async (req, res, next) => {
    try {
        const criteria = await getDebateCriteria({ debate_id: req.params.id });
        if (req.query.validate) {
            const weights = await validateCriteriaWeightsSum({ debate_id: req.params.id });
            return res.json({ criteria, weights });
        }
        return res.json(criteria);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/criteria/:id — edit a criterion (admin).
router.patch(
    "/criteria/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("update_debate_criterion", { resourceType: "debate_judging_criteria" }),
    async (req, res, next) => {
        try {
            return res.json(await updateCriterion({ ...req.body, criterion_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// DELETE /api/criteria/:id — remove a criterion (admin).
router.delete(
    "/criteria/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("delete_debate_criterion", { resourceType: "debate_judging_criteria" }),
    async (req, res, next) => {
        try {
            return res.json(await deleteCriterion({ criterion_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
