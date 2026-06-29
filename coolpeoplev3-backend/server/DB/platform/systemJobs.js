const { client, withTransaction } = require("../index.js");

// ============================================================================
// system_jobs — async work tracking (BullMQ-style) for the recurring pollers
// and multi-step jobs (DSR deletion, payouts, election-calendar sync, …).
//
// system_jobs columns (no FKs — target is polymorphic via type+id):
//   id, job_type, target_resource_type, target_resource_id, status,
//   attempt_count, scheduled_for, started_at, completed_at, error_message,
//   result_payload, created_at
//
// job_type CHECK (post 1780100000000):
//   moderation_scan, csam_check, dsr_deletion, retention_purge,
//   fec_committee_verify, winner_payout, tax_form_generate, email_send,
//   election_calendar_sync, authority_link_health, stage_gate_evaluate
//
// status CHECK: queued, running, succeeded, failed, retrying
//
// SECURITY: the lifecycle transitions (markJob*) and getDueJobs are driven by
// internal workers, never by an end user. The routes gate them with
// requireInternal; the admin routes are read/enqueue/retry/cancel only.
// ============================================================================

const JOB_TYPES = [
    "moderation_scan", "csam_check", "dsr_deletion", "retention_purge",
    "fec_committee_verify", "winner_payout", "tax_form_generate", "email_send",
    "election_calendar_sync", "authority_link_health", "stage_gate_evaluate",
];

const STATUSES = ["queued", "running", "succeeded", "failed", "retrying"];

// statuses a job can be picked up from
const RUNNABLE = ["queued", "retrying"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Map common pg constraint codes to clean HTTP errors.
const mapPgError = (err) => {
    if (err.status) return err;
    if (err.code === "23514") return httpError(400, "value violates a constraint (bad job_type/status)");
    if (err.code === "22P02") return httpError(400, "a uuid/value is malformed");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    console.error(err);
    return err;
};

// ---- writes (enqueue) ------------------------------------------------------

// enqueueJob(...) — create a new job. scheduled_for defaults to now() in the
// table, so omit it to run ASAP, or pass a future timestamp to defer.
const enqueueJob = async ({
    job_type,
    payload = null,
    target_resource_type = null,
    target_resource_id = null,
    scheduled_for = null,
}) => {
    if (!JOB_TYPES.includes(job_type)) {
        throw httpError(400, `job_type must be one of: ${JOB_TYPES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO system_jobs
               (job_type, target_resource_type, target_resource_id,
                result_payload, scheduled_for)
             VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()))
             RETURNING *`,
            [
                job_type,
                target_resource_type,
                target_resource_id,
                payload ? JSON.stringify(payload) : null,
                scheduled_for,
            ]
        );
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// ---- lifecycle transitions (internal workers) ------------------------------

// markJobRunning({id}) — atomically claim a job: only a queued/retrying job may
// transition to running, and attempt_count is incremented. The status guard in
// the WHERE makes the claim race-safe (two workers can't both win). Returns null
// if the job was not in a runnable state (already claimed / done).
const markJobRunning = async ({ id }) => {
    try {
        const { rows } = await client.query(
            `UPDATE system_jobs
                SET status = 'running',
                    started_at = now(),
                    attempt_count = attempt_count + 1
              WHERE id = $1
                AND status IN ('queued','retrying')
              RETURNING *`,
            [id]
        );
        return rows[0] || null;
    } catch (err) {
        throw mapPgError(err);
    }
};

// markJobSucceeded({id, result}) — terminal success. Stamps completed_at and
// stores the optional result payload. Only a running job may succeed.
const markJobSucceeded = async ({ id, result = null }) => {
    try {
        const { rows } = await client.query(
            `UPDATE system_jobs
                SET status = 'succeeded',
                    completed_at = now(),
                    error_message = NULL,
                    result_payload = COALESCE($2, result_payload)
              WHERE id = $1
                AND status = 'running'
              RETURNING *`,
            [id, result ? JSON.stringify(result) : null]
        );
        if (!rows.length) throw httpError(409, "job is not in 'running' state");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// markJobFailed({id, error, retry}) — record a failure. When retry is true the
// job goes back to 'retrying' so getDueJobs will hand it out again; otherwise it
// is terminally 'failed'. Only a running job may fail.
const markJobFailed = async ({ id, error = null, retry = false }) => {
    const nextStatus = retry ? "retrying" : "failed";
    try {
        const { rows } = await client.query(
            `UPDATE system_jobs
                SET status = $2,
                    error_message = $3,
                    completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
              WHERE id = $1
                AND status = 'running'
              RETURNING *`,
            [id, nextStatus, error ? String(error) : null]
        );
        if (!rows.length) throw httpError(409, "job is not in 'running' state");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// ---- reads -----------------------------------------------------------------

// listJobs(filters) — the admin job browser. Newest first.
const listJobs = async ({
    job_type = null,
    status = null,
    target_resource_type = null,
    target_resource_id = null,
    limit = 100,
} = {}) => {
    if (job_type && !JOB_TYPES.includes(job_type)) {
        throw httpError(400, `job_type must be one of: ${JOB_TYPES.join(", ")}`);
    }
    if (status && !STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${STATUSES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `SELECT * FROM system_jobs
             WHERE ($1::text IS NULL OR job_type = $1)
               AND ($2::text IS NULL OR status = $2)
               AND ($3::text IS NULL OR target_resource_type = $3)
               AND ($4::uuid IS NULL OR target_resource_id = $4)
             ORDER BY created_at DESC
             LIMIT $5`,
            [job_type, status, target_resource_type, target_resource_id,
             Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        throw mapPgError(err);
    }
};

// getDueJobs({job_type?, limit?}) — claim a batch of jobs whose time has come,
// for an internal worker. Atomically flips each to 'running' (attempt_count++)
// and returns the claimed rows. FOR UPDATE SKIP LOCKED lets multiple workers
// pull disjoint batches without blocking. Runs in one transaction so the
// select-and-claim is a single unit.
const getDueJobs = async ({ job_type = null, limit = 10 } = {}) => {
    if (job_type && !JOB_TYPES.includes(job_type)) {
        throw httpError(400, `job_type must be one of: ${JOB_TYPES.join(", ")}`);
    }
    const batch = Math.min(Number(limit) || 10, 100);
    try {
        return await withTransaction(async (tx) => {
            const due = await tx.query(
                `SELECT id FROM system_jobs
                 WHERE status IN ('queued','retrying')
                   AND scheduled_for <= now()
                   AND ($1::text IS NULL OR job_type = $1)
                 ORDER BY scheduled_for ASC
                 LIMIT $2
                 FOR UPDATE SKIP LOCKED`,
                [job_type, batch]
            );
            if (!due.rows.length) return [];
            const ids = due.rows.map((r) => r.id);
            const { rows } = await tx.query(
                `UPDATE system_jobs
                    SET status = 'running',
                        started_at = now(),
                        attempt_count = attempt_count + 1
                  WHERE id = ANY($1::uuid[])
                  RETURNING *`,
                [ids]
            );
            return rows;
        });
    } catch (err) {
        throw mapPgError(err);
    }
};

// ---- admin operations ------------------------------------------------------

// retryJob({id}) — re-queue a failed job so it gets picked up again. Resets the
// timing/error fields; only a failed job may be retried.
const retryJob = async ({ id }) => {
    try {
        const { rows } = await client.query(
            `UPDATE system_jobs
                SET status = 'retrying',
                    started_at = NULL,
                    completed_at = NULL,
                    error_message = NULL,
                    scheduled_for = now()
              WHERE id = $1
                AND status = 'failed'
              RETURNING *`,
            [id]
        );
        if (!rows.length) throw httpError(409, "only a 'failed' job can be retried");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// cancelJob({id}) — terminally mark a not-yet-finished job as failed (with a
// cancellation note). A running/succeeded job is left alone — succeeded is done,
// and a running job should be stopped by the worker, not yanked here.
const cancelJob = async ({ id, reason = "cancelled by admin" }) => {
    try {
        const { rows } = await client.query(
            `UPDATE system_jobs
                SET status = 'failed',
                    completed_at = now(),
                    error_message = $2
              WHERE id = $1
                AND status IN ('queued','retrying')
              RETURNING *`,
            [id, reason]
        );
        if (!rows.length) throw httpError(409, "only a 'queued'/'retrying' job can be cancelled");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

module.exports = {
    JOB_TYPES,
    STATUSES,
    RUNNABLE,
    enqueueJob,
    markJobRunning,
    markJobSucceeded,
    markJobFailed,
    listJobs,
    getDueJobs,
    retryJob,
    cancelJob,
};
