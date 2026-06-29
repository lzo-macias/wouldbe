const { client, withTransaction } = require("../index.js");

// ============================================================================
// pledges — non-binding promises ("I'll give $X if this WouldBe hits its goal").
// NO money moves on-platform; when a goal is hit pledgers are emailed the
// candidate's external processor link (ActBlue/WinRed). This module enforces the
// per-user pledge cap and attributes each pledge to the currently-open stage.
//
// Cap model (sitewide default $3,300 = pledge_cap_cents): each "cap window" gets
// its own pledge_cap_cents of room. A confirmed primary-advance opens a new window
// (cap_reset_count += 1) WITHOUT erasing prior pledges. A pledge counts against the
// window equal to the WouldBe's current cap_reset_count.
// ============================================================================

const ACTIVE_PLEDGE_STATUSES = ["pending", "goal_reached", "converted"]; // count toward the cap

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// getRemainingPledgeCap({ userId, wouldbeId }) — how much more this user may pledge
// in the WouldBe's CURRENT cap window. Returns { cap_window, cap_cents, used_cents,
// remaining_cents }.
const getRemainingPledgeCap = async ({ userId, wouldbeId }) => {
    const wb = await client.query(
        `SELECT pledge_cap_cents, cap_reset_count FROM wouldbe WHERE id = $1`,
        [wouldbeId]
    );
    if (!wb.rows.length) throw httpError(404, "WouldBe not found");
    const capCents = Number(wb.rows[0].pledge_cap_cents);
    const window = wb.rows[0].cap_reset_count;
    const used = await client.query(
        `SELECT COALESCE(SUM(amount_cents),0) AS used
         FROM pledges
         WHERE pledger_user_id = $1 AND wouldbe_id = $2 AND cap_window = $3
           AND status = ANY($4)`,
        [userId, wouldbeId, window, ACTIVE_PLEDGE_STATUSES]
    );
    const usedCents = Number(used.rows[0].used);
    return { cap_window: window, cap_cents: capCents, used_cents: usedCents, remaining_cents: Math.max(0, capCents - usedCents) };
};

// isPledgeEligible({ userId, wouldbeId, amount_cents }) — the gate. Checks the
// WouldBe is live and the amount fits the remaining cap. Returns { eligible,
// reason?, remaining_cents, cap_window }. (Citizen/own-funds attestation is gated
// at the route layer.)
const isPledgeEligible = async ({ userId, wouldbeId, amount_cents }) => {
    if (!amount_cents || amount_cents <= 0) return { eligible: false, reason: "amount_cents must be positive" };
    const wb = await client.query(`SELECT launch_status, retired FROM wouldbe WHERE id = $1`, [wouldbeId]);
    if (!wb.rows.length) throw httpError(404, "WouldBe not found");
    if (wb.rows[0].retired) return { eligible: false, reason: "this WouldBe is retired" };
    if (wb.rows[0].launch_status !== "active") {
        return { eligible: false, reason: `WouldBe is not active (launch_status=${wb.rows[0].launch_status})` };
    }
    const cap = await getRemainingPledgeCap({ userId, wouldbeId });
    if (amount_cents > cap.remaining_cents) {
        return { eligible: false, reason: "amount exceeds your remaining pledge cap", ...cap };
    }
    return { eligible: true, ...cap };
};

// Resolve the WouldBe's currently-open stage (for attribution). May be null.
const openStageFor = async (wouldbeId) => {
    const { rows } = await client.query(
        `SELECT c.id FROM plan_timeline_components c
         JOIN plan_timeline pt ON pt.id = c.plan_timeline_id
         JOIN plan p ON p.id = pt.plan_id
         WHERE p.wouldbe_id = $1 AND c.gate_state = 'open'
         ORDER BY c.stage_number
         LIMIT 1`,
        [wouldbeId]
    );
    return rows[0]?.id || null;
};

// createPledge — record a pledge after the eligibility gate passes. Stamps the
// open stage + current cap window, and bumps the WouldBe's pledged_total_cents,
// all in one transaction.
const createPledge = async ({ pledger_user_id, wouldbe_id, amount_cents }) => {
    const gate = await isPledgeEligible({ userId: pledger_user_id, wouldbeId: wouldbe_id, amount_cents });
    if (!gate.eligible) throw httpError(422, gate.reason);

    const stageId = await openStageFor(wouldbe_id);
    try {
        return await withTransaction(async (tx) => {
            const { rows } = await tx.query(
                `INSERT INTO pledges
                   (pledger_user_id, wouldbe_id, amount_cents, status, cap_window, plan_timeline_component_id)
                 VALUES ($1,$2,$3,'pending',$4,$5) RETURNING *`,
                [pledger_user_id, wouldbe_id, amount_cents, gate.cap_window, stageId]
            );
            await tx.query(
                `UPDATE wouldbe SET pledged_total_cents = pledged_total_cents + $2, updated_at = now() WHERE id = $1`,
                [wouldbe_id, amount_cents]
            );
            return rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23514") throw httpError(400, "amount_cents must be positive");
        if (err.code === "23503") throw httpError(400, "pledger_user_id or wouldbe_id does not exist");
        console.error(err);
        throw err;
    }
};

// getUserPledges({ userId }) — the caller's pledges with WouldBe titles.
const getUserPledges = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT pl.*, w.title AS wouldbe_title
         FROM pledges pl JOIN wouldbe w ON w.id = pl.wouldbe_id
         WHERE pl.pledger_user_id = $1
         ORDER BY pl.created_at DESC`,
        [userId]
    );
    return rows;
};

// withdrawPledge — pledger pulls a pledge; decrement the running total if it was
// still counting. Idempotent: a second withdraw is a no-op on the total.
const withdrawPledge = async ({ id, userId }) => {
    try {
        return await withTransaction(async (tx) => {
            const pr = await tx.query(`SELECT * FROM pledges WHERE id = $1 FOR UPDATE`, [id]);
            const pledge = pr.rows[0];
            if (!pledge) throw httpError(404, "pledge not found");
            if (pledge.pledger_user_id !== userId) throw httpError(403, "Not your pledge");
            if (pledge.status === "withdrawn") {
                return pledge;
            }
            const wasCounting = ACTIVE_PLEDGE_STATUSES.includes(pledge.status);
            const upd = await tx.query(
                `UPDATE pledges SET status = 'withdrawn' WHERE id = $1 RETURNING *`,
                [id]
            );
            if (wasCounting) {
                await tx.query(
                    `UPDATE wouldbe SET pledged_total_cents = GREATEST(0, pledged_total_cents - $2), updated_at = now()
                     WHERE id = $1`,
                    [pledge.wouldbe_id, pledge.amount_cents]
                );
            }
            return upd.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// getWouldbePledgeStats({ wouldbeId }) — totals for a WouldBe.
const getWouldbePledgeStats = async ({ wouldbeId }) => {
    const { rows } = await client.query(
        `SELECT
            COALESCE(SUM(amount_cents) FILTER (WHERE status = ANY($2)),0) AS active_pledged_cents,
            COUNT(*) FILTER (WHERE status = ANY($2))                      AS active_pledge_count,
            COUNT(DISTINCT pledger_user_id) FILTER (WHERE status = ANY($2)) AS unique_pledgers,
            COUNT(*)                                                       AS total_pledge_rows
         FROM pledges WHERE wouldbe_id = $1`,
        [wouldbeId, ACTIVE_PLEDGE_STATUSES]
    );
    return rows[0];
};

// markPledgeConverted — pledger was redirected to the external processor.
const markPledgeConverted = async ({ id }) => {
    const { rows } = await client.query(
        `UPDATE pledges SET status = 'converted', converted_at = now() WHERE id = $1 RETURNING *`,
        [id]
    );
    if (!rows.length) throw httpError(404, "pledge not found");
    return rows[0];
};

// markPledgesGoalReached — a goal/micro-goal was met: flip the still-pending
// pledges to 'goal_reached' (emit pledge_goal_reached; pairs with recordGoalReached
// which fans the processor link). Returns how many were flipped.
const markPledgesGoalReached = async ({ wouldbeId }) => {
    const { rows } = await client.query(
        `UPDATE pledges SET status = 'goal_reached'
         WHERE wouldbe_id = $1 AND status = 'pending' RETURNING id`,
        [wouldbeId]
    );
    return { wouldbe_id: wouldbeId, marked: rows.length, event: "pledge_goal_reached" };
};

// resetPledgeCapForPrimaryAdvance — confirmed past the primary: open a new cap
// window (cap_reset_count += 1) and append the audit row. Prior pledges untouched.
const resetPledgeCapForPrimaryAdvance = async ({ wouldbeId, confirmed_by = "admin_review", proof_reference = null }) => {
    if (!["system", "admin_review", "authority_pull"].includes(confirmed_by)) {
        throw httpError(400, "confirmed_by must be system|admin_review|authority_pull");
    }
    try {
        return await withTransaction(async (tx) => {
            const upd = await tx.query(
                `UPDATE wouldbe
                 SET cap_reset_count = cap_reset_count + 1, primary_advanced_at = now(), updated_at = now()
                 WHERE id = $1 RETURNING cap_reset_count, pledge_cap_cents`,
                [wouldbeId]
            );
            if (!upd.rows.length) throw httpError(404, "WouldBe not found");
            const resetNumber = upd.rows[0].cap_reset_count;
            const reset = await tx.query(
                `INSERT INTO wouldbe_cap_resets
                   (wouldbe_id, reset_number, reason, additional_cap_cents, confirmed_by, proof_reference)
                 VALUES ($1,$2,'primary_advanced',$3,$4,$5) RETURNING *`,
                [wouldbeId, resetNumber, upd.rows[0].pledge_cap_cents, confirmed_by, proof_reference]
            );
            return reset.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "a cap reset with this reset_number already exists");
        console.error(err);
        throw err;
    }
};

module.exports = {
    isPledgeEligible,
    createPledge,
    getUserPledges,
    withdrawPledge,
    getWouldbePledgeStats,
    getRemainingPledgeCap,
    markPledgeConverted,
    markPledgesGoalReached,
    resetPledgeCapForPrimaryAdvance,
};
