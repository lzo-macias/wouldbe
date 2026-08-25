const { client } = require("../index.js");
const stripe = require("../../services/stripe");
const { hasActivePanel } = require("./debateJudges.js");
const { hasSignedCurrentTerms } = require("./prizeAgreements.js");

// ============================================================================
// Admin review — the two buttons on a submitted debate: approve or reject.
//
// This replaces chargeAndFundDebate / releaseSponsorMandate as the review path.
// Hosting is FREE: approval collects nothing and refunds nothing. It checks that
// the panel exists and the prize was signed for, then opens the debate for entry.
//
// The old functions in sponsorFunding.js are left in place — debates charged
// under the prize + 10% model still carry those columns, and deleting the code
// that explains them would make those rows unreadable.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

const loadForReview = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows } = await client.query(
        `SELECT d.*, s.user_id AS sponsor_user_id, s.display_name AS sponsor_display_name
         FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id]
    );
    if (!rows.length) throw httpError(404, "debate not found");
    return rows[0];
};

// approveDebate — the green button. Three gates, in the order an admin would
// want them reported:
//   1. still a draft            (not already approved or rejected)
//   2. hybrid → a live panel    (nobody to pick a winner otherwise)
//   3. prize agreement signed   (the sponsor's promise to deliver the prize)
// Then the debate opens for entry. Hosting is free, so no money is involved.
const approveDebate = async ({ debate_id, admin_note = null }) => {
    const debate = await loadForReview({ debate_id });

    if (debate.status !== "draft") {
        throw httpError(409, `this debate is ${debate.status} — only a draft can be approved`);
    }
    // NO PAYMENT GATE. Hosting is free — nothing is collected at any point, so
    // there is no fee to check for. The tier columns and the debateTiers module
    // stay in place for the debates that were charged while the host fee existed;
    // deleting them would make those payment rows unreadable.
    if (debate.win_type === "hybrid" && !(await hasActivePanel({ debate_id }))) {
        throw httpError(409, "this hybrid debate has no active judges — the panel must be in place before approval");
    }
    // Every prize — cash, non-cash or both — is a promise to a stranger picked by
    // a public vote. Approving one the sponsor has not signed for leaves the
    // platform holding that promise. The check compares the TERMS HASH, so
    // editing any part of the prize after signing invalidates the signature.
    if (!(await hasSignedCurrentTerms({ debate_id }))) {
        throw httpError(409, "the sponsor has not signed the prize agreement for the current prize");
    }

    const { rows } = await client.query(
        `UPDATE debates
         SET status = 'open_entry',
             rejection_reason = NULL,
             scoring_methodology = COALESCE($2, scoring_methodology),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [debate_id, admin_note]
    );

    return { approved: true, debate: rows[0] };
};

// rejectDebate — the red button.
//
// REFUNDS BY DEFAULT. The fee is collected up front, so rejecting a debate the
// sponsor already paid for and keeping the money is not a defensible outcome.
// Pass refund:false to reject without refunding (e.g. an abuse case where the
// charge is being disputed separately).
//
// A failed refund does NOT block the rejection: the decision is recorded either
// way and `refund_error` comes back so an admin can finish it in Stripe. Leaving
// a debate approvable because a refund API call timed out is the worse failure.
const rejectDebate = async ({ debate_id, reason = null, refund = true }) => {
    const debate = await loadForReview({ debate_id });

    if (debate.status === "cancelled") {
        throw httpError(409, "this debate was already rejected");
    }
    if (debate.status !== "draft") {
        throw httpError(409, `this debate is ${debate.status} — only a draft can be rejected`);
    }

    let refunded = false;
    let refund_error = null;
    const owesRefund = !!debate.tier_paid_at && !debate.tier_refunded_at && !!debate.tier_payment_intent_id;

    if (refund && owesRefund) {
        try {
            await stripe.createRefund({ payment_intent_id: debate.tier_payment_intent_id });
            refunded = true;
        } catch (err) {
            refund_error = err?.message || "refund failed";
            console.warn(`[rejectDebate] refund failed for ${debate_id}: ${refund_error}`);
        }
    }

    const { rows } = await client.query(
        `UPDATE debates
         SET status = 'cancelled',
             rejection_reason = $2,
             tier_refunded_at = CASE WHEN $3::boolean THEN NOW() ELSE tier_refunded_at END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [debate_id, reason, refunded]
    );

    if (refunded) {
        await client.query(
            `UPDATE debate_payments SET status = 'refunded'
             WHERE debate_id = $1 AND payment_type = 'debate_host_fee' AND status = 'succeeded'`,
            [debate_id]
        );
    }

    return {
        rejected: true,
        debate: rows[0],
        // refund_due tells the admin UI to show "still owes a refund" when the
        // automatic one didn't go through.
        refund_due: owesRefund && !refunded,
        refunded,
        refund_error,
    };
};

module.exports = { approveDebate, rejectDebate };
