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
const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

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

// POST /api/plans/:id/components — add a position (owner of the plan only).
router.post("/plans/:id/components", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(`SELECT user_id FROM plan WHERE id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "plan not found" });
        if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: "Not your plan" });
        const comp = await addPlanComponent({ ...req.body, plan_id: req.params.id });
        return res.status(201).json(comp);
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
