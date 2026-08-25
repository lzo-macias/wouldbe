const { client, withTransaction } = require("../index.js");

// ============================================================================
// office_recommended_goals + goal_increase_requests — the goal layer. Every
// WouldBe goal is bounded $5K–$1M (the floor/ceiling). Each office can carry a
// recommended goal; once a goal is reached a candidate may request a raise (with
// a required reason), reviewed manually now / automated later. Approving a raise
// updates wouldbe.goal_cents.
// ============================================================================

const GOAL_FLOOR_CENTS = 500000; // $5,000
const GOAL_CEILING_CENTS = 100000000; // $1,000,000

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// getRecommendedGoalForOffice — the recommended goal (cents) for an office, or
// null when none is set. A row with a null amount means "explicitly none".
const getRecommendedGoalForOffice = async ({ officeId }) => {
    const { rows } = await client.query(
        `SELECT recommended_goal_cents, rationale, source_url
         FROM office_recommended_goals WHERE office_id = $1`,
        [officeId]
    );
    if (!rows.length) return null;
    return rows[0];
};

// createGoalIncreaseRequest — candidate asks to raise their goal. Reason required,
// new goal bounded by the lifetime ceiling. Snapshots the current goal.
const createGoalIncreaseRequest = async ({ wouldbe_id, requested_by_user_id, requested_goal_cents, reason }) => {
    if (!wouldbe_id || !requested_by_user_id || !requested_goal_cents || !reason) {
        throw httpError(400, "wouldbe_id, requested_by_user_id, requested_goal_cents and reason are required");
    }
    if (requested_goal_cents < GOAL_FLOOR_CENTS || requested_goal_cents > GOAL_CEILING_CENTS) {
        throw httpError(400, `requested_goal_cents must be between ${GOAL_FLOOR_CENTS} and ${GOAL_CEILING_CENTS}`);
    }
    const wb = await client.query(`SELECT goal_cents FROM wouldbe WHERE id = $1`, [wouldbe_id]);
    if (!wb.rows.length) throw httpError(404, "WouldBe not found");
    const current = wb.rows[0].goal_cents;
    if (requested_goal_cents <= Number(current)) {
        throw httpError(400, "requested_goal_cents must be greater than the current goal");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO goal_increase_requests
               (wouldbe_id, requested_by_user_id, current_goal_cents, requested_goal_cents, reason, status, review_method)
             VALUES ($1,$2,$3,$4,$5,'pending','manual') RETURNING *`,
            [wouldbe_id, requested_by_user_id, current, requested_goal_cents, reason]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "requested_goal_cents is out of the allowed range");
        if (err.code === "23503") throw httpError(400, "wouldbe_id or requested_by_user_id does not exist");
        console.error(err);
        throw err;
    }
};

// listPendingGoalIncreases — admin review queue.
const listPendingGoalIncreases = async ({ limit = 100 } = {}) => {
    const { rows } = await client.query(
        `SELECT gir.*, w.title AS wouldbe_title
         FROM goal_increase_requests gir
         JOIN wouldbe w ON w.id = gir.wouldbe_id
         WHERE gir.status = 'pending'
         ORDER BY gir.created_at ASC
         LIMIT $1`,
        [Math.min(Number(limit) || 100, 500)]
    );
    return rows;
};

// decideGoalIncrease — admin approves/rejects. On approve: bump wouldbe.goal_cents
// atomically with the decision. (Timeline re-scope is the §8 splitter's job — the
// caller re-runs buildStagedTimeline after a goal change; see note below.)
const decideGoalIncrease = async ({ id, decision, reviewed_by_user_id, review_notes = null }) => {
    if (!["approved", "rejected"].includes(decision)) {
        throw httpError(400, "decision must be 'approved' or 'rejected'");
    }
    try {
        return await withTransaction(async (tx) => {
            const reqRes = await tx.query(`SELECT * FROM goal_increase_requests WHERE id = $1 FOR UPDATE`, [id]);
            const gir = reqRes.rows[0];
            if (!gir) throw httpError(404, "goal increase request not found");
            if (gir.status !== "pending") throw httpError(409, "this request was already decided");

            await tx.query(
                `UPDATE goal_increase_requests
                 SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_notes = $4
                 WHERE id = $1`,
                [id, decision, reviewed_by_user_id, review_notes]
            );

            let wouldbe = null;
            if (decision === "approved") {
                const upd = await tx.query(
                    `UPDATE wouldbe SET goal_cents = $2, updated_at = now() WHERE id = $1 RETURNING *`,
                    [gir.wouldbe_id, gir.requested_goal_cents]
                );
                wouldbe = upd.rows[0];
            }
            // NOTE: re-scope the staged timeline after an approved raise by re-running
            // buildStagedTimeline(planTimelineId) — the sub-goals are derived from goal_cents.
            return { request_id: id, status: decision, wouldbe, needs_timeline_rescope: decision === "approved" };
        });
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    getRecommendedGoalForOffice,
    createGoalIncreaseRequest,
    listPendingGoalIncreases,
    decideGoalIncrease,
};
