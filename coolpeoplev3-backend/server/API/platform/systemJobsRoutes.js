const express = require("express");

const {
    enqueueJob,
    markJobRunning,
    markJobSucceeded,
    markJobFailed,
    listJobs,
    getDueJobs,
    retryJob,
    cancelJob,
} = require("../../DB/platform/systemJobs");

const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// Two audiences:
//  - /admin/jobs  → any active admin (AD): browse, enqueue, retry, cancel.
//  - /internal/jobs → internal workers only (x-internal-secret): claim due jobs
//                     and drive lifecycle transitions. NOT user-facing.
const anyAdmin = [requireAuth, requireAdmin()];

// =================== admin (operator) surface ===============================

// GET /api/admin/jobs?job_type=&status=&target_resource_type=&target_resource_id=&limit=
router.get("/admin/jobs", anyAdmin, async (req, res, next) => {
    try {
        const rows = await listJobs({
            job_type: req.query.job_type || null,
            status: req.query.status || null,
            target_resource_type: req.query.target_resource_type || null,
            target_resource_id: req.query.target_resource_id || null,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/jobs — enqueue a job manually.
// Body: { job_type, payload?, target_resource_type?, target_resource_id?, scheduled_for? }
router.post(
    "/admin/jobs",
    anyAdmin,
    recordAdminAction("system_job.enqueue", { resourceType: "system_job" }),
    async (req, res, next) => {
        try {
            const row = await enqueueJob({
                job_type: req.body?.job_type,
                payload: req.body?.payload ?? null,
                target_resource_type: req.body?.target_resource_type ?? null,
                target_resource_id: req.body?.target_resource_id ?? null,
                scheduled_for: req.body?.scheduled_for ?? null,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/jobs/:id/retry — re-queue a failed job.
router.post(
    "/admin/jobs/:id/retry",
    anyAdmin,
    recordAdminAction("system_job.retry", { resourceType: "system_job" }),
    async (req, res, next) => {
        try {
            const row = await retryJob({ id: req.params.id });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/jobs/:id/cancel — terminally fail a not-yet-running job.
router.post(
    "/admin/jobs/:id/cancel",
    anyAdmin,
    recordAdminAction("system_job.cancel", { resourceType: "system_job" }),
    async (req, res, next) => {
        try {
            const row = await cancelJob({
                id: req.params.id,
                reason: req.body?.reason || "cancelled by admin",
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// =================== internal worker surface ================================

// POST /api/internal/jobs/due — claim a batch of due jobs (flips them to
// running). Body/query: { job_type?, limit? }.
router.post("/internal/jobs/due", requireInternal, async (req, res, next) => {
    try {
        const rows = await getDueJobs({
            job_type: req.body?.job_type || req.query.job_type || null,
            limit: req.body?.limit || req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/jobs/:id/running — claim a single job (queued/retrying →
// running). Returns the row, or 404 if it could not be claimed.
router.post("/internal/jobs/:id/running", requireInternal, async (req, res, next) => {
    try {
        const row = await markJobRunning({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "job not claimable" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/jobs/:id/succeeded — terminal success. Body: { result? }.
router.post("/internal/jobs/:id/succeeded", requireInternal, async (req, res, next) => {
    try {
        const row = await markJobSucceeded({ id: req.params.id, result: req.body?.result ?? null });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/internal/jobs/:id/failed — record a failure. Body: { error?, retry? }.
router.post("/internal/jobs/:id/failed", requireInternal, async (req, res, next) => {
    try {
        const row = await markJobFailed({
            id: req.params.id,
            error: req.body?.error ?? null,
            retry: !!req.body?.retry,
        });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
