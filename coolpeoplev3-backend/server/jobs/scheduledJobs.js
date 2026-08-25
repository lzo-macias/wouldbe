const cron = require("node-cron");
const { withTransaction } = require("../DB/index.js");
const { refreshAgeBands } = require("../DB/platform/childSafety.js");
const { countExpiredStrikes } = require("../DB/platform/userStrikes.js");
const { expireDueTTWs } = require("../DB/candidacy/testingTheWaters.js");
const {
    getDueJobs,
    markJobSucceeded,
    markJobFailed,
} = require("../DB/platform/systemJobs.js");
const { queueRetentionPurgeJob } = require("../DB/platform/dataRetentions.js");
const { computeDeadlinesForOffice } = require("../DB/elections/electionCalendar.js");
const { listFilingAuthorities, recordLinkHealth } = require("../DB/elections/filingAuthorities.js");
const { getUpcomingRaces } = require("../DB/elections/races.js");
const {
    evaluateStageGate,
    getOpenStageGatesPastDeadline,
} = require("../DB/candidacy/planTimeline.js");

// ============================================================================
// SINGLE-LEADER scheduled jobs.
// Every app instance starts the same cron schedule, so when a tick fires on a
// multi-instance deploy the job would otherwise run N times at once (triple
// emails, wasted work). We gate each run behind a Postgres ADVISORY LOCK — a
// cluster-wide mutex keyed by an arbitrary bigint. Only the instance that wins
// the lock runs the job; the rest skip. We use the TRANSACTION-scoped variant
// (pg_try_advisory_xact_lock), so the lock auto-releases when the wrapping
// transaction ends — nothing leaks if a worker dies mid-run. No Redis needed.
// ============================================================================

// Arbitrary unique key per job (any bigint; just don't collide with other locks).
const LOCK = {
    AGE_BAND_REFRESH: 770114001,
    EXPIRE_STRIKES: 770114002,
    EXPIRE_TTWS: 770114003,
    DISPATCH_JOBS: 770114004,
    RETENTION_PURGE: 770114005,
    SYNC_ELECTION_CALENDAR: 770114006,
    CHECK_AUTHORITY_LINKS: 770114007,
    EVALUATE_STAGE_GATES: 770114008,
};

// runExclusively — run `work` only if this instance wins the advisory lock for
// `lockKey`. The lock is held for the whole duration of work() (the wrapping
// transaction stays open until it returns), so no two instances run it at once.
const runExclusively = async (lockKey, label, work) => {
    return withTransaction(async (tx) => {
        const { rows } = await tx.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [lockKey]);
        if (!rows[0].locked) {
            console.log(`[${label}] another instance holds the job lock; skipping this run`);
            return;
        }
        await work();
    });
};

// checkUrl(url) — lightweight link-health probe for the filing-authority cron.
// HEAD first (cheap), fall back to GET if the server rejects HEAD. Maps the
// outcome to recordLinkHealth's status vocab: healthy | broken | redirected |
// unknown. A timeout or network error is 'broken'; a missing URL is 'unknown'.
const checkUrl = async (url) => {
    if (!url || !/^https?:\/\//i.test(url)) return "unknown";
    const probe = async (method) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        try {
            return await fetch(url, { method, redirect: "manual", signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        let res = await probe("HEAD");
        // some servers don't implement HEAD — retry with GET on a 4xx/5xx
        if (res.status >= 400) res = await probe("GET");
        if (res.status >= 300 && res.status < 400) return "redirected";
        if (res.status >= 200 && res.status < 300) return "healthy";
        return "broken";
    } catch (err) {
        return "broken";
    }
};

// dispatchSystemJob(job) — run one due system_job by its job_type, using the
// already-built handlers. getDueJobs has ALREADY flipped the row to 'running'
// (attempt_count++), so here we only call the handler then mark succeeded/failed.
// Job params come off the polymorphic target + result_payload:
//   election_calendar_sync → target_resource_id = office id, payload.cycle
//   authority_link_health  → target_resource_id = filing_authority id
//   stage_gate_evaluate    → target_resource_id = plan_timeline_component id
// Any other job_type has no cron-side handler (it's owned by another worker), so
// we mark it failed-with-retry so its real owner can still pick it up, rather
// than terminally failing work this cron doesn't own.
const dispatchSystemJob = async (job) => {
    try {
        if (job.job_type === "election_calendar_sync") {
            const cycle =
                (job.result_payload && job.result_payload.cycle) ?? null;
            if (!job.target_resource_id || cycle == null) {
                await markJobFailed({
                    id: job.id,
                    error: "election_calendar_sync needs target_resource_id (office id) and result_payload.cycle",
                });
                return;
            }
            const result = await computeDeadlinesForOffice({
                officeId: job.target_resource_id,
                cycle,
            });
            await markJobSucceeded({ id: job.id, result: { computed: result.length } });
        } else if (job.job_type === "authority_link_health") {
            if (!job.target_resource_id) {
                await markJobFailed({ id: job.id, error: "authority_link_health needs target_resource_id (filing authority id)" });
                return;
            }
            // The job itself doesn't carry the URL; the link-health cron checks
            // URLs directly. A queued authority_link_health job marks the row as
            // 'unknown' (its URL isn't available here) — the dedicated cron is
            // the source of truth for real checks.
            // TODO: if jobs start carrying the URL in result_payload, probe it here.
            const result = await recordLinkHealth({ id: job.target_resource_id, status: "unknown" });
            await markJobSucceeded({ id: job.id, result });
        } else if (job.job_type === "stage_gate_evaluate") {
            if (!job.target_resource_id) {
                await markJobFailed({ id: job.id, error: "stage_gate_evaluate needs target_resource_id (plan_timeline_component id)" });
                return;
            }
            const result = await evaluateStageGate({ componentId: job.target_resource_id });
            await markJobSucceeded({ id: job.id, result });
        } else {
            // Not this cron's responsibility — hand it back for its real worker.
            await markJobFailed({
                id: job.id,
                error: `no cron handler for job_type '${job.job_type}'`,
                retry: true,
            });
        }
    } catch (err) {
        // Handler threw — record the failure (retry so a transient error gets another go).
        try {
            await markJobFailed({ id: job.id, error: err.message || String(err), retry: true });
        } catch (markErr) {
            console.error(`[dispatch jobs] could not mark job ${job.id} failed:`, markErr);
        }
        throw err;
    }
};

// Daily age-band reconciliation. refreshAgeBands() recomputes every user's
// age_band from date_of_birth (the source of truth) and resets the
// consent-required flags, so cached bands stay accurate as users cross
// birthdays. Idempotent and self-healing — a missed run is caught the next night.
const startScheduledJobs = () => {
    cron.schedule(
        "0 3 * * *",
        async () => {
            try {
                await runExclusively(LOCK.AGE_BAND_REFRESH, "age-band refresh", async () => {
                    const changed = await refreshAgeBands();
                    console.log(`[age-band refresh] ${changed.length} user(s) crossed a band`);
                    // TODO: fire side effects for `changed` users
                    // (re-consent flow on 13th birthday, "you're 18" unlock email, etc.)
                });
            } catch (err) {
                console.error("[age-band refresh] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronExpireStrikes — daily @ 03:10 -----------------------------
    // Strike expiry is purely time-based via user_strikes.expires_at and there is
    // no status column to flip, so this is an observability pass: it logs how many
    // strikes are now past their expires_at. Active-strike reads already exclude
    // them at query time (see countExpiredStrikes for the full rationale).
    cron.schedule(
        "10 3 * * *",
        async () => {
            try {
                await runExclusively(LOCK.EXPIRE_STRIKES, "expire strikes", async () => {
                    const count = await countExpiredStrikes();
                    console.log(`[expire strikes] ${count} strike(s) past expires_at (implicit expiry; nothing to flip)`);
                });
            } catch (err) {
                console.error("[expire strikes] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronExpireTTWs — daily @ 03:20 --------------------------------
    // Flip still-'active' testing-the-waters campaigns whose FEC window elapsed to
    // 'expired' (stamps expired_at). Idempotent bulk UPDATE.
    cron.schedule(
        "20 3 * * *",
        async () => {
            try {
                await runExclusively(LOCK.EXPIRE_TTWS, "expire TTWs", async () => {
                    const expired = await expireDueTTWs();
                    console.log(`[expire TTWs] ${expired.length} testing-the-waters campaign(s) expired`);
                });
            } catch (err) {
                console.error("[expire TTWs] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronDispatchJobs — every 3 minutes ---------------------------
    // Pull a batch of due system_jobs (getDueJobs atomically claims + flips them to
    // 'running') and run each via its built handler, marking succeeded/failed.
    cron.schedule(
        "*/3 * * * *",
        async () => {
            try {
                await runExclusively(LOCK.DISPATCH_JOBS, "dispatch jobs", async () => {
                    const jobs = await getDueJobs({ limit: 50 });
                    if (!jobs.length) return;
                    let ok = 0;
                    let failed = 0;
                    for (const job of jobs) {
                        try {
                            await dispatchSystemJob(job);
                            ok++;
                        } catch (err) {
                            failed++;
                            console.error(`[dispatch jobs] job ${job.id} (${job.job_type}) failed:`, err);
                        }
                    }
                    console.log(`[dispatch jobs] ran ${jobs.length} due job(s): ${ok} ok, ${failed} failed`);
                });
            } catch (err) {
                console.error("[dispatch jobs] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronRunRetentionPurge — daily @ 02:30 ------------------------
    // Enqueue a global retention-purge system_job; the dedicated retention worker
    // applies the active per-category policies. (queueRetentionPurgeJob with no
    // policy_id = global sweep.)
    cron.schedule(
        "30 2 * * *",
        async () => {
            try {
                await runExclusively(LOCK.RETENTION_PURGE, "retention purge", async () => {
                    const job = await queueRetentionPurgeJob();
                    console.log(`[retention purge] queued retention_purge job ${job.id}`);
                });
            } catch (err) {
                console.error("[retention purge] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronSyncElectionCalendar — daily @ 04:00 ---------------------
    // Recompute election_deadlines for every UPCOMING race (general_date >= now()),
    // scoped to that race's office + cycle. We compute directly (not via enqueue)
    // because the active set is bounded (upcoming races only), making a per-race
    // computeDeadlinesForOffice cheap and idempotent.
    cron.schedule(
        "0 4 * * *",
        async () => {
            try {
                await runExclusively(LOCK.SYNC_ELECTION_CALENDAR, "sync election calendar", async () => {
                    const races = await getUpcomingRaces();
                    let offices = 0;
                    let errors = 0;
                    for (const race of races) {
                        if (!race.office_id || race.election_cycle == null) continue;
                        try {
                            await computeDeadlinesForOffice({
                                officeId: race.office_id,
                                cycle: race.election_cycle,
                            });
                            offices++;
                        } catch (err) {
                            errors++;
                            console.error(`[sync election calendar] office ${race.office_id} cycle ${race.election_cycle} failed:`, err);
                        }
                    }
                    console.log(`[sync election calendar] recomputed ${offices} office/cycle deadline set(s) across ${races.length} upcoming race(s), ${errors} error(s)`);
                });
            } catch (err) {
                console.error("[sync election calendar] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronCheckAuthorityLinks — daily @ 04:30 ----------------------
    // Probe each active filing authority's registration portal and record the
    // result via recordLinkHealth (healthy|broken|redirected|unknown).
    cron.schedule(
        "30 4 * * *",
        async () => {
            try {
                await runExclusively(LOCK.CHECK_AUTHORITY_LINKS, "check authority links", async () => {
                    const authorities = await listFilingAuthorities({ is_active: true, limit: 500 });
                    let checked = 0;
                    let errors = 0;
                    for (const fa of authorities) {
                        try {
                            const status = await checkUrl(fa.registration_portal_url);
                            await recordLinkHealth({ id: fa.id, status });
                            checked++;
                        } catch (err) {
                            errors++;
                            console.error(`[check authority links] authority ${fa.id} failed:`, err);
                        }
                    }
                    console.log(`[check authority links] checked ${checked}/${authorities.length} active authority link(s), ${errors} error(s)`);
                });
            } catch (err) {
                console.error("[check authority links] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    // ---- §16 cronEvaluateStageGates — hourly @ :15 ------------------------
    // For each OPEN stage whose deadline has passed without a verified proof, run
    // evaluateStageGate (fails the gate + locks the next stage, append-only audit).
    cron.schedule(
        "15 * * * *",
        async () => {
            try {
                await runExclusively(LOCK.EVALUATE_STAGE_GATES, "evaluate stage gates", async () => {
                    const gates = await getOpenStageGatesPastDeadline({ limit: 1000 });
                    let changed = 0;
                    let errors = 0;
                    for (const g of gates) {
                        try {
                            const res = await evaluateStageGate({ componentId: g.id });
                            if (res.changed) changed++;
                        } catch (err) {
                            errors++;
                            console.error(`[evaluate stage gates] component ${g.id} failed:`, err);
                        }
                    }
                    console.log(`[evaluate stage gates] evaluated ${gates.length} overdue open gate(s): ${changed} changed, ${errors} error(s)`);
                });
            } catch (err) {
                console.error("[evaluate stage gates] failed:", err);
            }
        },
        { timezone: "America/New_York" }
    );

    console.log("scheduled jobs started: age-band refresh @ 03:00; expire-strikes @ 03:10; expire-TTWs @ 03:20; dispatch-jobs every 3m; retention-purge @ 02:30; sync-election-calendar @ 04:00; check-authority-links @ 04:30; evaluate-stage-gates hourly @ :15 (all America/New_York, single-leader via advisory lock)");
};

module.exports = { startScheduledJobs };
