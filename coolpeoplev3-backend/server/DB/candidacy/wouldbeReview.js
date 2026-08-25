const { client } = require("../index.js");
const { hasCommitteeForWouldbe } = require("./candidateCommittees.js");

// ============================================================================
// Admin review for WouldBe campaigns — the queue, the readiness check, and the
// two buttons.
//
// WHY A CAMPAIGN CANNOT JUST GO LIVE: a WouldBe collects public pledges toward
// a candidacy. In the US that is regulated fundraising, and the thing that makes
// it lawful is a registered committee with a treasurer. candidate_committees
// already models this, and candidateCommittees.js already exposes the check —
// `hasActiveVerifiedCommittee`, described in its own header as "THE launch gate
// §5 consults". Nothing was consulting it. This module is that caller.
//
// THREE GATES, in the order an admin wants to hear about them:
//   1. the $5 creation fee is paid       (creation_fee_paid_at)
//   2. a committee is on file            (verified_active OR provisional_on_receipt)
//   3. the race hasn't already happened  (races.general_date >= today)
//
// A PLAN IS NOT A GATE. The apply flow lets a candidate skip it, and a campaign
// with no policy positions is thin, not unlawful. It's surfaced in the queue so
// an admin can judge, and that's all.
//
// launch_status values and what they mean here:
//   draft             — created, never reviewed
//   pending_committee — reviewed, blocked ONLY on the committee
//   pending_review    — everything's in place, waiting on a human
//   active            — approved; pledges are now accepted
//   suspended         — was active, pulled back
//   failed            — rejected
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Statuses that still want a decision. 'active' and 'failed' are terminal-ish;
// 'suspended' is deliberately included, because a suspended campaign is exactly
// the thing an admin needs to find again.
const REVIEWABLE = ["draft", "pending_committee", "pending_review", "suspended"];

// loadForReview — the campaign plus everything the decision depends on.
const loadForReview = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");
    const { rows } = await client.query(
        `SELECT w.*,
                r.general_date, r.election_cycle, r.office_id AS race_office_id,
                o.office_name, j.state_code,
                u.username, u.first_name, u.last_name
         FROM wouldbe w
         LEFT JOIN races r ON r.id = w.race_id
         LEFT JOIN office o ON o.id = w.office_id
         LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
         JOIN users u ON u.id = w.user_id
         WHERE w.id = $1`,
        [id]
    );
    if (!rows.length) throw httpError(404, "WouldBe not found");
    return rows[0];
};

// getReadiness — the checklist, evaluated live rather than stored.
//
// Live because every input can change without anyone touching this row: a fee
// clears through a webhook, a committee is filed on another screen, an election
// date passes on its own. A cached "ready" flag would be wrong within a day.
const getReadiness = async ({ id }) => {
    const wb = await loadForReview({ id });

    const fee_paid = !!wb.creation_fee_paid_at;

    // Asked PER CAMPAIGN, not per user: the campaign resolves its own race and
    // office and looks for the committee filed for THAT candidacy. "Does this
    // person have a committee somewhere" is the question that let a filing for
    // one seat unlock a campaign for another.
    // NOTE: returns the committee ROW (or null), not a boolean.
    const committee = await hasCommitteeForWouldbe({ wouldbe_id: id });
    const committee_ok = !!committee;

    const today = new Date().toISOString().slice(0, 10);
    const generalDay = wb.general_date ? String(wb.general_date).slice(0, 10) : null;
    const race_open = !generalDay || generalDay >= today;

    // Informational only — see the header.
    const { rows: planRows } = await client.query(
        `SELECT p.id, COUNT(pc.id)::int AS component_count
         FROM plan p LEFT JOIN plan_components pc ON pc.plan_id = p.id
         WHERE p.wouldbe_id = $1
         GROUP BY p.id`,
        [id]
    );
    const has_plan = planRows.length > 0;
    const plan_components = planRows[0]?.component_count ?? 0;

    const blockers = [];
    if (!fee_paid) blockers.push("the $5 creation fee has not been paid");
    if (!committee_ok) blockers.push("no registered committee is on file for this candidate");
    if (!race_open) blockers.push("this race's general election has already passed");

    return {
        wouldbe_id: id,
        launch_status: wb.launch_status,
        fee_paid,
        committee_ok,
        // what actually satisfied the gate, so an admin can see WHICH filing
        committee: committee
            ? {
                  id: committee.id,
                  committee_name: committee.committee_name,
                  registration_status: committee.registration_status,
                  external_committee_id: committee.external_committee_id,
                  filed_at: committee.filed_at,
              }
            : null,
        race_open,
        has_plan,
        plan_components,
        blockers,
        approvable: blockers.length === 0,
    };
};

// listWouldbeApplications — the admin queue.
//
// The committee check is a per-row subquery rather than a call to
// hasActiveVerifiedCommittee: doing it in JS would be one round trip per
// campaign, and the queue is the one place that reads every row at once.
const listWouldbeApplications = async ({ launch_status = "draft", limit = 100 } = {}) => {
    // 'all' means every reviewable state; a specific value filters to it.
    const statusFilter = launch_status === "all" ? null : launch_status;

    const { rows } = await client.query(
        `SELECT w.*,
                o.office_name,
                j.state_code,
                r.election_cycle,
                r.general_date,
                u.username,
                (w.creation_fee_paid_at IS NOT NULL) AS fee_paid,
                -- Mirrors hasActiveVerifiedCommittee's precedence: the committee
                -- must be bound to THIS candidacy (race, or office+cycle). The
                -- jurisdiction fallback applies only to legacy rows that carry
                -- no office binding at all — without that restriction, two
                -- offices in one jurisdiction share a committee, which is the
                -- bug this replaced.
                EXISTS (
                    SELECT 1 FROM candidate_committees cc
                    WHERE cc.user_id = w.user_id
                      AND cc.registration_status IN ('verified_active', 'provisional_on_receipt')
                      AND (
                            (w.race_id IS NOT NULL AND cc.race_id = w.race_id)
                         OR (w.office_id IS NOT NULL AND cc.office_id = w.office_id
                               AND (r.election_cycle IS NULL OR cc.cycle_year = r.election_cycle))
                         OR (cc.office_id IS NULL AND cc.race_id IS NULL
                               AND cc.jurisdiction_id = o.jurisdiction_id
                               AND (r.election_cycle IS NULL OR cc.cycle_year = r.election_cycle))
                          )
                ) AS committee_ok,
                (SELECT COUNT(*)::int FROM plan p WHERE p.wouldbe_id = w.id) > 0 AS has_plan,
                (SELECT COUNT(DISTINCT p.pledger_user_id)::int
                   FROM pledges p WHERE p.wouldbe_id = w.id) AS pledger_count
         FROM wouldbe w
         LEFT JOIN office o ON o.id = w.office_id
         LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
         LEFT JOIN races r ON r.id = w.race_id
         JOIN users u ON u.id = w.user_id
         WHERE w.retired IS NOT TRUE
           AND ($1::text IS NULL OR w.launch_status = $1)
           AND ($1::text IS NOT NULL OR w.launch_status = ANY($3))
         ORDER BY w.created_at ASC
         LIMIT $2`,
        [statusFilter, Math.min(Number(limit) || 100, 500), REVIEWABLE]
    );
    return rows;
};

// approveWouldbe — the green button. Sets launch_status='active', which is what
// pledges.js checks before accepting money.
//
// The gates are re-evaluated HERE, not trusted from whatever the queue showed —
// the list may be minutes stale, and a committee can lapse in between.
const approveWouldbe = async ({ id, admin_user_id = null, note = null }) => {
    const wb = await loadForReview({ id });

    if (wb.launch_status === "active") {
        throw httpError(409, "this campaign is already active");
    }
    if (wb.retired) {
        throw httpError(409, "this campaign was retired by its owner");
    }

    const readiness = await getReadiness({ id });
    if (!readiness.approvable) {
        // The blockers go back verbatim so the admin sees WHY, not just "no".
        throw httpError(409, `cannot approve: ${readiness.blockers.join("; ")}`);
    }

    const { rows } = await client.query(
        `UPDATE wouldbe
         SET launch_status = 'active',
             review_note = $2,
             reviewed_at = NOW(),
             reviewed_by_user_id = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, note, admin_user_id]
    );
    return { approved: true, wouldbe: rows[0], readiness };
};

// rejectWouldbe — the red button. 'failed' is the terminal rejected state.
//
// A reason is REQUIRED. A campaign that fails with no explanation is a support
// ticket, and the candidate has no way to fix and resubmit.
const rejectWouldbe = async ({ id, admin_user_id = null, reason }) => {
    const wb = await loadForReview({ id });

    const cleanReason = reason != null ? String(reason).trim() : "";
    if (!cleanReason) throw httpError(400, "a reason is required to reject a campaign");
    if (wb.launch_status === "failed") throw httpError(409, "this campaign was already rejected");

    const { rows } = await client.query(
        `UPDATE wouldbe
         SET launch_status = 'failed',
             review_note = $2,
             reviewed_at = NOW(),
             reviewed_by_user_id = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, cleanReason, admin_user_id]
    );
    return { rejected: true, wouldbe: rows[0] };
};

// requestCommittee — the middle button. Not a rejection: the campaign is fine,
// the candidate just hasn't filed yet. Moves it to 'pending_committee' so the
// queue can separate "needs a human" from "waiting on the candidate".
const requestCommittee = async ({ id, admin_user_id = null, note = null }) => {
    const wb = await loadForReview({ id });
    if (wb.launch_status === "active") throw httpError(409, "this campaign is already active");

    const { rows } = await client.query(
        `UPDATE wouldbe
         SET launch_status = 'pending_committee',
             review_note = COALESCE($2, review_note),
             reviewed_at = NOW(),
             reviewed_by_user_id = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, note, admin_user_id]
    );
    return { pending_committee: true, wouldbe: rows[0] };
};

module.exports = {
    REVIEWABLE,
    getReadiness,
    listWouldbeApplications,
    approveWouldbe,
    rejectWouldbe,
    requestCommittee,
};
