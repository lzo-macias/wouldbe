const { client } = require("../index.js")

// ============================================================================
// contest_winners — the audit record of who won a debate, why, and the tax/payment
// lifecycle. PK is id. This is the IRS/dispute-defense artifact: it captures the
// selection_method, the rationale (mandatory for sponsor decisions), and the
// 1099 / W-9 / payment trail. It is distinct from debate_results (which freezes
// the math): one debate_results row can spawn multiple contest_winners rows (1st,
// 2nd, 3rd...), each with its own placement and prize amount.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const SELECTION_METHODS = ["public_vote", "sponsor_decision", "judge_panel"]
const PAYMENT_METHODS = ["stripe", "ach", "check", "in_kind"]

// IRS reporting threshold for 1099-MISC prizes/awards ($600/yr).
const IRS_1099_THRESHOLD_CENTS = 60000

// ----------------------------------------------------------------------------
// recordContestWinner — insert one winner row. selected_at defaults to now() when
// omitted. irs_1099_required is auto-set when prize >= $600 unless the caller
// passes it explicitly. sponsor_decision requires a rationale.
// ----------------------------------------------------------------------------
const recordContestWinner = async ({
    debate_id,
    contestant_id,
    user_id,
    placement,
    prize_amount_cents,
    selection_method,
    vote_count = null,
    selected_by_user_id = null,
    selection_rationale = null,
    irs_1099_required = null,
    prize_payment_method = null,
    prize_payment_reference = null,
}, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!contestant_id) throw httpError(400, "contestant_id is required")
    if (!user_id) throw httpError(400, "user_id is required")
    if (!Number.isInteger(placement) || placement < 1) {
        throw httpError(400, "placement must be a positive integer")
    }
    if (!Number.isInteger(prize_amount_cents) || prize_amount_cents <= 0) {
        throw httpError(400, "prize_amount_cents must be a positive integer")
    }
    if (!SELECTION_METHODS.includes(selection_method)) {
        throw httpError(400, `selection_method must be one of: ${SELECTION_METHODS.join(", ")}`)
    }
    if (selection_method === "sponsor_decision" && !selection_rationale) {
        throw httpError(400, "selection_rationale is required for a sponsor_decision")
    }
    if (prize_payment_method !== null && !PAYMENT_METHODS.includes(prize_payment_method)) {
        throw httpError(400, `prize_payment_method must be one of: ${PAYMENT_METHODS.join(", ")}`)
    }

    const needs1099 =
        irs_1099_required === null
            ? prize_amount_cents >= IRS_1099_THRESHOLD_CENTS
            : Boolean(irs_1099_required)

    try {
        const SQL = `
            INSERT INTO contest_winners
                (debate_id, contestant_id, user_id, placement, prize_amount_cents,
                 selection_method, vote_count, selected_at, selected_by_user_id,
                 selection_rationale, irs_1099_required, prize_payment_method,
                 prize_payment_reference)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12)
            RETURNING *;
        `
        const { rows } = await db.query(SQL, [
            debate_id,
            contestant_id,
            user_id,
            placement,
            prize_amount_cents,
            selection_method,
            vote_count,
            selected_by_user_id,
            selection_rationale,
            needs1099,
            prize_payment_method,
            prize_payment_reference,
        ])
        // TODO: emit 'contest_won' event
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "this winner row already exists")
        if (err.code === "23503") throw httpError(400, "debate_id, contestant_id, or user_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid selection_method, payment_method, or prize amount")
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// getContestWinners — all recorded winners for a debate, best placement first.
// ----------------------------------------------------------------------------
const getContestWinners = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const { rows } = await client.query(
            `SELECT * FROM contest_winners WHERE debate_id = $1 ORDER BY placement ASC`,
            [debate_id]
        )
        return rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// mark1099Filed — stamp that we filed the 1099 for this winner. (The schema holds
// 1099 *required* + w9_received_at + payment fields; there is no dedicated
// "filed_at" column, so we set irs_1099_required = true to assert it is on record.
// ASSUMPTION: callers use this to confirm the filing obligation is acknowledged;
// the actual IRS submission timestamp lives in prize_distributions.form_1099_filed_at.)
// ----------------------------------------------------------------------------
const mark1099Filed = async ({ id }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const { rows } = await client.query(
            `UPDATE contest_winners
             SET irs_1099_required = true
             WHERE id = $1
             RETURNING *`,
            [id]
        )
        if (rows.length === 0) throw httpError(404, "contest winner not found")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

module.exports = {
    SELECTION_METHODS,
    PAYMENT_METHODS,
    IRS_1099_THRESHOLD_CENTS,
    recordContestWinner,
    getContestWinners,
    mark1099Filed,
}
