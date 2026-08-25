const express = require("express");

const {
    getCategoryRubric,
    listCategoryRubrics,
    applyCategoryCriteriaToDebate,
    upsertCategoryCriterion,
    validateRubricWeights,
} = require("../../DB/debate/categoryCriteria");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// ============================================================================
// Pre-disclosed judging criteria, by category.
//
// The GETs are PUBLIC on purpose: this is the rubric a sponsor is shown before
// submitting and an entrant is shown before entering. Criteria that require a
// login to read are not pre-disclosed.
//
// The writes are admin-only. Editing the catalog affects FUTURE debates only —
// existing debates hold their own snapshot in debate_judging_criteria, which is
// read through GET /api/debates/:id/criteria.
// ============================================================================

// GET /api/category-criteria — the whole catalog, grouped by category.
// ?include_inactive=1 (admin-facing) also returns retired criteria.
router.get("/category-criteria", async (req, res, next) => {
    try {
        return res.json(await listCategoryRubrics({ include_inactive: !!req.query.include_inactive }));
    } catch (err) {
        next(err);
    }
});

// GET /api/category-criteria/:category — one category's rubric, in display
// order. ?validate=1 also returns the weight-sum check.
router.get("/category-criteria/:category", async (req, res, next) => {
    try {
        const criteria = await getCategoryRubric({
            category: req.params.category,
            criteria_version: req.query.version || null,
        });
        if (req.query.validate) {
            const weights = await validateRubricWeights({
                category: req.params.category,
                criteria_version: req.query.version || null,
            });
            return res.json({ criteria, weights });
        }
        return res.json(criteria);
    } catch (err) {
        next(err);
    }
});

// POST /api/category-criteria — add or edit a catalog criterion (admin).
// Upserts on (category, criteria_version, criterion_key). weight is a FRACTION.
router.post(
    "/category-criteria",
    requireAuth,
    requireAdmin(),
    recordAdminAction("upsert_category_criterion", { resourceType: "category_judging_criteria" }),
    async (req, res, next) => {
        try {
            const criterion = await upsertCategoryCriterion(req.body);
            const weights = await validateRubricWeights({
                category: criterion.category,
                criteria_version: criterion.criteria_version,
            });
            return res.status(201).json({ criterion, weights });
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/criteria/apply-category — backfill. Copies the category
// rubric onto a debate that has none, for debates created before the catalog
// existed or whose category was set after the fact. Idempotent: criteria the
// debate already has are left exactly as they are.
router.post(
    "/debates/:id/criteria/apply-category",
    requireAuth,
    requireAdmin(),
    recordAdminAction("apply_category_criteria", { resourceType: "debate_judging_criteria" }),
    async (req, res, next) => {
        try {
            return res.json(await applyCategoryCriteriaToDebate({
                debate_id: req.params.id,
                category: req.body.category || null,
                criteria_version: req.body.criteria_version || null,
            }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
