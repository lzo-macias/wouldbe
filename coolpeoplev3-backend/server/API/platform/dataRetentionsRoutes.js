const express = require("express");

const {
    listRetentionPoliciesV2,
    upsertRetentionPolicyV2,
    queueRetentionPurgeJob,
} = require("../../DB/platform/dataRetentions");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminOnly = [requireAuth, requireAdmin()];
const adminAct = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "data_retention_policy" })];

// GET /admin/retention-policies?category= — list policies (optional category filter).
router.get("/admin/retention-policies", adminOnly, async (req, res, next) => {
    try {
        return res.json(await listRetentionPoliciesV2({ category: req.query.category ?? null }));
    } catch (err) {
        next(err);
    }
});

// POST /admin/retention-policies — upsert a retention policy for a category.
router.post("/admin/retention-policies", adminAct("upsert_retention_policy"), async (req, res, next) => {
    try {
        const { category, retention_basis, retention_period_days, legal_basis, deletion_method, active_from } = req.body;
        const policy = await upsertRetentionPolicyV2({
            category,
            retention_basis,
            retention_period_days,
            legal_basis,
            deletion_method,
            active_from,
        });
        return res.status(201).json(policy);
    } catch (err) {
        next(err);
    }
});

// POST /admin/retention-policies/run — enqueue a purge job (optional policy_id).
router.post("/admin/retention-policies/run", adminAct("run_retention_purge"), async (req, res, next) => {
    try {
        return res.json(await queueRetentionPurgeJob({ policy_id: req.body?.policy_id ?? null }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
