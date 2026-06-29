const express = require("express");

const { client } = require("../../DB/index");
const {
    buildStagedTimeline,
    getStagedTimeline,
    createPlanTimeline,
    syncTimelineFromRace,
    getPlanTimeline,
    addTimelineComponent,
    updateTimelineComponent,
    evaluateStageGate,
    getGateAuditTrail,
} = require("../../DB/candidacy/planTimeline");

const { requireAuth, requireInternal } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];

// --- ownership helpers ------------------------------------------------------
const planOwner = async (planId) => {
    const { rows } = await client.query(`SELECT user_id FROM plan WHERE id = $1`, [planId]);
    return rows[0]?.user_id || null;
};
const timelineOwner = async (timelineId) => {
    const { rows } = await client.query(
        `SELECT p.user_id FROM plan_timeline pt JOIN plan p ON p.id = pt.plan_id WHERE pt.id = $1`,
        [timelineId]
    );
    return rows[0]?.user_id || null;
};
const componentOwner = async (componentId) => {
    const { rows } = await client.query(
        `SELECT p.user_id FROM plan_timeline_components c
         JOIN plan_timeline pt ON pt.id = c.plan_timeline_id
         JOIN plan p ON p.id = pt.plan_id WHERE c.id = $1`,
        [componentId]
    );
    return rows[0]?.user_id || null;
};

// POST /plans/:id/timeline — create the timeline for a plan (owner only).
router.post("/plans/:id/timeline", authed, async (req, res, next) => {
    try {
        const owner = await planOwner(req.params.id);
        if (!owner) return res.status(404).json({ error: "plan not found" });
        if (owner !== req.user.id) return res.status(403).json({ error: "Not your plan" });
        const tl = await createPlanTimeline({ plan_id: req.params.id, office_id: req.body?.office_id, race_id: req.body?.race_id });
        return res.status(201).json(tl);
    } catch (err) {
        next(err);
    }
});

// GET /plans/:id/timeline — the timeline + components (public).
router.get("/plans/:id/timeline", async (req, res, next) => {
    try {
        const tl = await getPlanTimeline({ planId: req.params.id });
        if (!tl) return res.status(404).json({ error: "no timeline for this plan" });
        return res.json(tl);
    } catch (err) {
        next(err);
    }
});

// POST /plan-timelines/:id/sync-from-race — copy the race's key dates onto the timeline.
router.post("/plan-timelines/:id/sync-from-race", authed, async (req, res, next) => {
    try {
        const owner = await timelineOwner(req.params.id);
        if (!owner) return res.status(404).json({ error: "plan timeline not found" });
        if (owner !== req.user.id) return res.status(403).json({ error: "Not your timeline" });
        return res.status(201).json(await syncTimelineFromRace({ planTimelineId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /plan-timelines/:id/components — add a milestone (owner only).
router.post("/plan-timelines/:id/components", authed, async (req, res, next) => {
    try {
        const owner = await timelineOwner(req.params.id);
        if (!owner) return res.status(404).json({ error: "plan timeline not found" });
        if (owner !== req.user.id) return res.status(403).json({ error: "Not your timeline" });
        const comp = await addTimelineComponent({ ...req.body, plan_timeline_id: req.params.id });
        return res.status(201).json(comp);
    } catch (err) {
        next(err);
    }
});

// PATCH /timeline-components/:id — edit a milestone (owner only).
router.patch("/timeline-components/:id", authed, async (req, res, next) => {
    try {
        const owner = await componentOwner(req.params.id);
        if (!owner) return res.status(404).json({ error: "timeline component not found" });
        if (owner !== req.user.id) return res.status(403).json({ error: "Not your timeline component" });
        return res.json(await updateTimelineComponent({ ...req.body, id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /timeline-components/:id/gate-audit — append-only gate transition history.
router.get("/timeline-components/:id/gate-audit", authed, async (req, res, next) => {
    try {
        return res.json(await getGateAuditTrail({ componentId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /internal/timeline-components/:id/evaluate-gate — cron/internal: fail a
// stage whose deadline elapsed without proof and lock the next.
router.post("/internal/timeline-components/:id/evaluate-gate", requireInternal, async (req, res, next) => {
    try {
        return res.json(await evaluateStageGate({ componentId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /plan-timelines/:id/build-stages — split the campaign goal across the
// timeline's election deadlines into per-stage sub-goals (cumulative back-loaded).
router.post("/plan-timelines/:id/build-stages", authed, async (req, res, next) => {
    try {
        const stages = await buildStagedTimeline({ planTimelineId: req.params.id });
        return res.status(201).json(stages);
    } catch (err) {
        next(err);
    }
});

// GET /plan-timelines/:id/stages — the staged timeline (components + deadline join).
router.get("/plan-timelines/:id/stages", async (req, res, next) => {
    try {
        return res.json(await getStagedTimeline({ planTimelineId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
