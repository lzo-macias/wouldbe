const { client, withTransaction } = require("../index.js");

// ============================================================================
// Staged timeline — split a WouldBe's total goal across a race's deadlines.
//
// MODEL (see design notes): each deadline's sub_goal_cents is the CUMULATIVE
// amount that should be raised BY that deadline (a rising curve to 100%), NOT a
// separate slice — pledging continues across deadlines regardless. The curve is
// BACK-LOADED: ballot access ~5–15%, primary ~50%, general 100%. Election dates
// are anchors; reports / unmapped deadlines are interpolated by date and the
// curve is forced monotonic (never decreases).
//
// Money targets are SOFT (nothing blocks pledging). The real gate is proof —
// gate_state/proof_status + stage_proofs — stamped 'tbd' here until verified.
// ============================================================================

// Cumulative weight (fraction of total goal) anchored by deadline_type.
const CUMULATIVE_WEIGHTS = {
    // ballot access — cheap, front of the calendar
    petition_circulation_start: 0.05,
    filing_open: 0.05,
    petition_filing_deadline: 0.10,
    filing_close: 0.10,
    ballot_designation: 0.12,   // final declaration of candidacy
    challenge_deadline: 0.13,   // opponents challenge petitions
    ballot_certification: 0.15,
    // campaign-finance checkpoints (pre-primary)
    fec_quarterly_q1: 0.20,
    fec_quarterly_q2: 0.30,
    fec_quarterly_q3: 0.40,
    state_pre_primary_disclosure: 0.45,
    fec_pre_primary_report: 0.45,
    // primary ~ half the war chest
    primary_date: 0.50,
    fec_year_end: 0.60,
    // run-up to the general — heavy spend
    early_voting_open: 0.90,
    state_pre_general_disclosure: 0.88,
    fec_pre_general_report: 0.92,
    // the main event
    general_date: 1.00,
    runoff_date: 1.00,
    // post-election — no new money
    fec_post_general_report: 1.00,
    state_post_election_disclosure: 1.00,
};

// Voter-admin deadlines that are NOT candidate fundraising milestones — skipped.
const SKIP_TYPES = new Set([
    "voter_registration_close",
    "mail_in_ballot_request_close",
    "mail_in_ballot_return",
    "early_voting_close",
]);

// fine deadline_type -> coarse timeline_category (the CHECK allows only 5).
const categoryByType = (t) => {
    if (t === "primary_date") return "primary_election";
    if (t === "runoff_date") return "runoff_election";
    if (t === "general_date" || t === "early_voting_open") return "general_election";
    if (/report|disclosure|quarterly|year_end/.test(t)) return "post_election_report";
    return "filing_deadline"; // petitions, filing, certification (ballot access)
};

// preferred proof per type (how we'd corroborate the candidate cleared it).
const proofByType = (t) => {
    if (t === "primary_date") return { proof_tier: "authority_pull", verify_method: "ap_elections", milestone_type: "passed_primary" };
    if (t === "general_date" || t === "runoff_date") return { proof_tier: "authority_pull", verify_method: "ap_elections", milestone_type: "election_result" };
    if (t === "ballot_certification") return { proof_tier: "authority_pull", verify_method: "state_portal", milestone_type: "ballot_certification" };
    if (/report|disclosure/.test(t)) return { proof_tier: "document_upload", verify_method: "fec_api", milestone_type: "finance_report" };
    return { proof_tier: "document_upload", verify_method: "state_portal", milestone_type: "ballot_access" }; // petitions/filing
};

const ms = (d) => new Date(d).getTime();

// Assign a cumulative weight to each deadline: mapped types use their anchor;
// unmapped/report types are interpolated by date between nearest anchors; then
// clamp [0,1] and force monotonic non-decreasing.
function assignWeights(deadlines, hasRunoff) {
    const pts = deadlines.map((d) => {
        let w = CUMULATIVE_WEIGHTS[d.deadline_type];
        if (hasRunoff && d.deadline_type === "general_date") w = 0.85; // make room for the runoff tail
        return { id: d.id, t: ms(d.deadline_date), w: w === undefined ? null : w };
    });

    for (let k = 0; k < pts.length; k++) {
        if (pts[k].w !== null) continue;
        let prev = null, next = null;
        for (let a = k - 1; a >= 0; a--) if (pts[a].w !== null) { prev = pts[a]; break; }
        for (let b = k + 1; b < pts.length; b++) if (pts[b].w !== null) { next = pts[b]; break; }
        if (prev && next) {
            const span = next.t - prev.t || 1;
            pts[k].w = prev.w + ((pts[k].t - prev.t) / span) * (next.w - prev.w);
        } else if (prev) pts[k].w = prev.w;
        else if (next) pts[k].w = next.w;
        else pts[k].w = (k + 1) / pts.length; // no anchors at all → even ramp
    }

    const out = {};
    let run = 0;
    for (const p of pts) {
        let w = Math.min(1, Math.max(0, p.w));
        if (w < run) w = run; // never decrease (cumulative)
        run = w;
        out[p.id] = w;
    }
    return out;
}

// buildStagedTimeline({ planTimelineId }) — idempotent: rebuilds the stages for
// a plan_timeline from the race's election_deadlines + the wouldbe's goal_cents.
const buildStagedTimeline = async ({ planTimelineId }) => {
    try {
        // plan_timeline → office/race/plan → wouldbe goal
        const pt = await client.query(
            `SELECT pt.office_id, pt.race_id, p.wouldbe_id
             FROM plan_timeline pt JOIN plan p ON p.id = pt.plan_id
             WHERE pt.id = $1`, [planTimelineId]);
        if (!pt.rows.length) throw new Error("plan_timeline not found");
        const { office_id, race_id, wouldbe_id } = pt.rows[0];

        const wb = await client.query(`SELECT goal_cents FROM wouldbe WHERE id = $1`, [wouldbe_id]);
        if (!wb.rows.length) throw new Error("wouldbe not found");
        const goal = Number(wb.rows[0].goal_cents);

        const rc = await client.query(`SELECT election_cycle FROM races WHERE id = $1`, [race_id]);
        if (!rc.rows.length) throw new Error("race not found");
        const cycle = rc.rows[0].election_cycle;

        const of = await client.query(`SELECT jurisdiction_id, office_type, office_name FROM office WHERE id = $1`, [office_id]);
        if (!of.rows.length) throw new Error("office not found");
        const { jurisdiction_id, office_type, office_name } = of.rows[0];
        const jt = await client.query(`SELECT type FROM jurisdiction WHERE id = $1`, [jurisdiction_id]);
        const jType = jt.rows[0]?.type;

        // the race's deadlines (recurring rows carry NULL cycle)
        const dl = await client.query(
            `SELECT id, deadline_type, deadline_date
             FROM election_deadlines
             WHERE jurisdiction_id = $1
               AND (election_cycle = $2 OR election_cycle IS NULL)
               AND deadline_date IS NOT NULL
               AND (applies_to_office_type IS NULL OR applies_to_office_type = $3)
             ORDER BY deadline_date ASC`,
            [jurisdiction_id, cycle, office_type]);

        const deadlines = dl.rows.filter((d) => !SKIP_TYPES.has(d.deadline_type));
        if (!deadlines.length) {
            throw new Error("no election_deadlines for this race — run computeDeadlinesForOffice / seed the calendar first");
        }

        const hasRunoff = deadlines.some((d) => d.deadline_type === "runoff_date");
        const weights = assignWeights(deadlines, hasRunoff);

        // idempotent rebuild
        await client.query(`DELETE FROM plan_timeline_components WHERE plan_timeline_id = $1`, [planTimelineId]);

        const inserted = [];

        // STAGE 1 — committee acceptance (certify the WouldBe). Not a calendar
        // deadline: the candidate registers a campaign committee with the filing
        // authority and uploads proof of acceptance. This is the FIRST gate; the
        // deadline-derived stages stay locked until it clears. Committee authority
        // by layer: federal → FEC, local → city BOE, else state agency.
        const fedOffice = /^US |President/.test(office_name || "");
        const localOffice = ["municipal", "city_council_district"].includes(jType);
        const committeeVerify = fedOffice ? "fec_api" : localOffice ? "city_boe" : "state_portal";
        const filingDate = (deadlines.find((d) => d.deadline_type === "filing_close") || deadlines[0]).deadline_date;
        const cg = await client.query(
            `INSERT INTO plan_timeline_components
                (plan_timeline_id, event_date, timeline_category, stage_number, sub_goal_cents,
                 gate_state, proof_tier, verify_method, milestone_type, proof_status, election_deadline_id)
             VALUES ($1, $2, 'filing_deadline', 1, 0, 'open', 'document_upload', $3, 'committee_acceptance', 'pending', NULL)
             RETURNING *`,
            [planTimelineId, filingDate, committeeVerify]);
        inserted.push(cg.rows[0]);

        // STAGES 2..N — the calendar deadlines, all locked (open as gates clear).
        let stage = 1;
        for (const d of deadlines) {
            stage++;
            const sub_goal_cents = Math.round(weights[d.id] * goal);
            const cat = categoryByType(d.deadline_type);
            const pf = proofByType(d.deadline_type);
            const r = await client.query(
                `INSERT INTO plan_timeline_components
                    (plan_timeline_id, event_date, timeline_category, stage_number, sub_goal_cents,
                     gate_state, proof_tier, verify_method, milestone_type, proof_status, election_deadline_id)
                 VALUES ($1, $2, $3, $4, $5, 'locked', $6, $7, $8, 'tbd', $9)
                 RETURNING *`,
                [planTimelineId, d.deadline_date, cat, stage, sub_goal_cents,
                 pf.proof_tier, pf.verify_method, pf.milestone_type, d.id]);
            inserted.push(r.rows[0]);
        }
        return inserted;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// getStagedTimeline({ planTimelineId }) — read the stages back, in order, with
// the underlying deadline_type joined in.
const getStagedTimeline = async ({ planTimelineId }) => {
    try {
        const r = await client.query(
            `SELECT c.*, ed.deadline_type
             FROM plan_timeline_components c
             LEFT JOIN election_deadlines ed ON ed.id = c.election_deadline_id
             WHERE c.plan_timeline_id = $1
             ORDER BY c.stage_number ASC`, [planTimelineId]);
        return r.rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// ============================================================================
// §8 timeline CRUD + gate evaluation (the manual/cron complements to the splitter)
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createPlanTimeline — one timeline per plan. office_id/race_id are denormalized
// off the plan/WouldBe so the timeline can be queried standalone.
const createPlanTimeline = async ({ plan_id, office_id = null, race_id = null }) => {
    if (!plan_id) throw httpError(400, "plan_id is required");
    const existing = await client.query(`SELECT id FROM plan_timeline WHERE plan_id = $1`, [plan_id]);
    if (existing.rows.length) throw httpError(409, "this plan already has a timeline");
    try {
        const { rows } = await client.query(
            `INSERT INTO plan_timeline (plan_id, office_id, race_id) VALUES ($1,$2,$3) RETURNING *`,
            [plan_id, office_id, race_id]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "plan_id, office_id or race_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// syncTimelineFromRace — copy a race's key dates (primary/general/filing) onto the
// timeline as components, so a timeline lines up with the real election calendar.
// Idempotent per (timeline, timeline_category): skips categories already present.
const syncTimelineFromRace = async ({ planTimelineId }) => {
    const tl = await client.query(
        `SELECT pt.id, pt.race_id, r.primary_date, r.general_date, r.filing_deadline
         FROM plan_timeline pt JOIN races r ON r.id = pt.race_id
         WHERE pt.id = $1`,
        [planTimelineId]
    );
    if (!tl.rows.length) throw httpError(404, "plan timeline (with a linked race) not found");
    const { primary_date, general_date, filing_deadline } = tl.rows[0];
    const wanted = [
        { date: filing_deadline, category: "filing_deadline" },
        { date: primary_date, category: "primary_election" },
        { date: general_date, category: "general_election" },
    ].filter((w) => w.date);

    const created = [];
    for (const w of wanted) {
        const exists = await client.query(
            `SELECT 1 FROM plan_timeline_components WHERE plan_timeline_id = $1 AND timeline_category = $2`,
            [planTimelineId, w.category]
        );
        if (exists.rows.length) continue;
        const { rows } = await client.query(
            `INSERT INTO plan_timeline_components (plan_timeline_id, event_date, timeline_category)
             VALUES ($1,$2,$3) RETURNING *`,
            [planTimelineId, w.date, w.category]
        );
        created.push(rows[0]);
    }
    return { synced: created.length, components: created };
};

// getPlanTimeline — the timeline + its components in date order.
const getPlanTimeline = async ({ planId }) => {
    const tlRes = await client.query(`SELECT * FROM plan_timeline WHERE plan_id = $1`, [planId]);
    const timeline = tlRes.rows[0];
    if (!timeline) return null;
    const comps = await client.query(
        `SELECT * FROM plan_timeline_components WHERE plan_timeline_id = $1
         ORDER BY COALESCE(stage_number, 9999), event_date`,
        [timeline.id]
    );
    return { ...timeline, components: comps.rows };
};

// addTimelineComponent — add a milestone to a timeline.
const addTimelineComponent = async ({ plan_timeline_id, event_date, timeline_category }) => {
    if (!plan_timeline_id || !event_date || !timeline_category) {
        throw httpError(400, "plan_timeline_id, event_date and timeline_category are required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO plan_timeline_components (plan_timeline_id, event_date, timeline_category)
             VALUES ($1,$2,$3) RETURNING *`,
            [plan_timeline_id, event_date, timeline_category]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "timeline_category is not a valid value");
        if (err.code === "23503") throw httpError(400, "plan_timeline_id does not exist");
        console.error(err);
        throw err;
    }
};

// updateTimelineComponent — edit a milestone (date/category/completed flag).
const updateTimelineComponent = async ({ id, event_date = null, timeline_category = null, completed = null }) => {
    try {
        const { rows } = await client.query(
            `UPDATE plan_timeline_components SET
                event_date        = COALESCE($2, event_date),
                timeline_category = COALESCE($3, timeline_category),
                completed         = COALESCE($4, completed),
                completed_at      = CASE WHEN $4 = true THEN now()
                                        WHEN $4 = false THEN NULL
                                        ELSE completed_at END
             WHERE id = $1 RETURNING *`,
            [id, event_date, timeline_category, completed]
        );
        if (!rows.length) throw httpError(404, "timeline component not found");
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23514") throw httpError(400, "timeline_category is not a valid value");
        console.error(err);
        throw err;
    }
};

// evaluateStageGate(componentId) — the time-based half of the gate machine (the
// proof-based half lives in stageProofs.verifyStageProof). If an OPEN stage's
// deadline has passed without a verified proof, fail it and lock the next stage.
// Append-only audit via stage_gate_transitions. Returns the resulting state.
const evaluateStageGate = async ({ componentId }) => {
    try {
        return await withTransaction(async (tx) => {
            const cr = await tx.query(
                `SELECT c.*, p.wouldbe_id
                 FROM plan_timeline_components c
                 JOIN plan_timeline pt ON pt.id = c.plan_timeline_id
                 JOIN plan p ON p.id = pt.plan_id
                 WHERE c.id = $1 FOR UPDATE`,
                [componentId]
            );
            const comp = cr.rows[0];
            if (!comp) throw httpError(404, "timeline component not found");

            // Only act on an open stage whose deadline elapsed without a verified proof.
            const deadlinePassed = new Date(comp.event_date) < new Date();
            if (comp.gate_state !== "open" || !deadlinePassed || comp.proof_status === "verified") {
                return { component_id: comp.id, gate_state: comp.gate_state, changed: false };
            }

            await tx.query(
                `UPDATE plan_timeline_components SET gate_state = 'failed' WHERE id = $1`,
                [comp.id]
            );
            await tx.query(
                `INSERT INTO stage_gate_transitions
                   (plan_timeline_component_id, wouldbe_id, from_state, to_state, triggered_by, source, notes)
                 VALUES ($1,$2,'open','failed','deadline_passed','deadline_elapsed',$3)`,
                [comp.id, comp.wouldbe_id, `deadline ${comp.event_date} passed without verified proof`]
            );
            // lock the next stage (it cannot open if this one failed)
            const next = await tx.query(
                `SELECT id, gate_state FROM plan_timeline_components
                 WHERE plan_timeline_id = $1 AND stage_number = $2`,
                [comp.plan_timeline_id, comp.stage_number + 1]
            );
            if (next.rows[0] && next.rows[0].gate_state !== "cleared") {
                await tx.query(`UPDATE plan_timeline_components SET gate_state = 'locked' WHERE id = $1`, [next.rows[0].id]);
                await tx.query(
                    `INSERT INTO stage_gate_transitions
                       (plan_timeline_component_id, wouldbe_id, from_state, to_state, triggered_by, source, notes)
                     VALUES ($1,$2,$3,'locked','system','gate_advance',$4)`,
                    [next.rows[0].id, comp.wouldbe_id, next.rows[0].gate_state, `locked after stage ${comp.stage_number} failed`]
                );
            }
            return { component_id: comp.id, gate_state: "failed", changed: true };
        });
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getOpenStageGatesPastDeadline({ limit }) — the work-list for the §16 stage-gate
// cron. Returns OPEN stages whose event_date (deadline) has elapsed and that have
// NOT yet been proven (proof_status <> 'verified') — i.e. exactly the rows
// evaluateStageGate() would act on. Oldest deadline first so the most overdue
// gates are handled first. Ids only; the cron evaluates each via evaluateStageGate.
const getOpenStageGatesPastDeadline = async ({ limit = 500 } = {}) => {
    const { rows } = await client.query(
        `SELECT id
           FROM plan_timeline_components
          WHERE gate_state = 'open'
            AND event_date < now()
            AND (proof_status IS DISTINCT FROM 'verified')
          ORDER BY event_date ASC
          LIMIT $1`,
        [Math.min(Number(limit) || 500, 2000)]
    );
    return rows;
};

// getGateAuditTrail({ componentId }) — append-only transition history for a stage.
const getGateAuditTrail = async ({ componentId }) => {
    const { rows } = await client.query(
        `SELECT * FROM stage_gate_transitions
         WHERE plan_timeline_component_id = $1
         ORDER BY transitioned_at ASC`,
        [componentId]
    );
    return rows;
};

module.exports = {
    buildStagedTimeline,
    getStagedTimeline,
    CUMULATIVE_WEIGHTS,
    createPlanTimeline,
    syncTimelineFromRace,
    getPlanTimeline,
    addTimelineComponent,
    updateTimelineComponent,
    evaluateStageGate,
    getOpenStageGatesPastDeadline,
    getGateAuditTrail,
};
