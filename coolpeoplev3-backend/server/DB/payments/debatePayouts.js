const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// debate_sponsor_payouts — the "entry fees pay out to the sponsor once the
// contest concludes" flow (distinct from winner prize_distributions).
//
// The owed amount is the sum of debate_payments.sponsor_amount_cents for the
// debate's successful entry payments (the per-entry portion routed to the
// sponsor; entry = $6 → ~$5 sponsor / Stripe fee / platform cut). Disbursement
// transfers that net to the sponsor's Stripe Connect account.
// ============================================================================

const PAYOUT_COLS = `
    id, debate_id, sponsor_id, recipient_user_id, gross_entries_cents,
    platform_fee_cents, amount_cents, currency, stripe_transfer_id,
    disbursement_method, status, disbursed_at, created_at, updated_at
`;

// ---- reads -----------------------------------------------------------------

// computeSponsorEntryPayout — what the sponsor is owed on conclusion: the sum
// of sponsor_amount_cents across the debate's succeeded entry payments. Also
// returns the resolved sponsor_id + recipient user (sponsors.user_id) so the
// disburse path doesn't re-query, plus already_paid_cents so callers can avoid
// double-paying.
const computeSponsorEntryPayout = async ({ debate_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required");

    const d = await db.query(
        `SELECT d.id AS debate_id, d.sponsor_id, s.user_id AS recipient_user_id
           FROM debates d
           JOIN sponsors s ON s.id = d.sponsor_id
          WHERE d.id = $1`,
        [debate_id]
    );
    if (!d.rows.length) throw httpError(404, "debate not found");
    const { sponsor_id, recipient_user_id } = d.rows[0];

    // sponsor_amount_cents is nullable (only set on entry payments); SUM ignores
    // NULLs and we coalesce the empty case to 0. Scope to succeeded payments.
    const g = await db.query(
        `SELECT COALESCE(SUM(sponsor_amount_cents), 0)::bigint AS gross_entries_cents
           FROM debate_payments
          WHERE debate_id = $1
            AND status = 'succeeded'
            AND sponsor_amount_cents IS NOT NULL`,
        [debate_id]
    );
    const gross_entries_cents = Number(g.rows[0].gross_entries_cents);

    // sum of what's already been paid out (not failed/reversed) for this debate
    const p = await db.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS already_paid_cents
           FROM debate_sponsor_payouts
          WHERE debate_id = $1
            AND status IN ('pending','disbursed')`,
        [debate_id]
    );
    const already_paid_cents = Number(p.rows[0].already_paid_cents);

    return {
        debate_id,
        sponsor_id,
        recipient_user_id,
        gross_entries_cents,
        already_paid_cents,
    };
};

// getSponsorPayouts — all payout rows for a debate (newest first).
const getSponsorPayouts = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows } = await client.query(
        `SELECT ${PAYOUT_COLS} FROM debate_sponsor_payouts
          WHERE debate_id = $1
          ORDER BY created_at DESC`,
        [debate_id]
    );
    return rows;
};

// ---- mutations -------------------------------------------------------------

// disburseSponsorPayout — admin-triggered on conclusion. Computes the owed
// amount, looks up the sponsor's verified Stripe Connect account, transfers the
// net, and records a debate_sponsor_payouts row marked 'disbursed'. All in one
// transaction so the row only commits if everything lines up.
//
// stripe.createTransfer throws 503 until Stripe is configured — that's fine; the
// transaction rolls back and nothing is recorded.
const disburseSponsorPayout = async ({
    debate_id,
    platform_fee_cents = 0,
    currency = "usd",
}) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    if (platform_fee_cents < 0) throw httpError(400, "platform_fee_cents must be >= 0");

    return withTransaction(async (tx) => {
        const owed = await computeSponsorEntryPayout({ debate_id }, tx);

        // net of what was already paid + the withheld platform fee
        const remainingGross = owed.gross_entries_cents - owed.already_paid_cents;
        const amount_cents = remainingGross - platform_fee_cents;
        if (remainingGross <= 0) {
            throw httpError(409, "nothing to disburse for this debate");
        }
        if (amount_cents <= 0) {
            throw httpError(400, "platform_fee_cents exceeds the remaining payout");
        }

        // sponsor's payout account must exist + be verified before we transfer
        const acct = await tx.query(
            `SELECT id, processor_account_id, onboarding_status
               FROM payout_accounts
              WHERE user_id = $1`,
            [owed.recipient_user_id]
        );
        const account = acct.rows[0];
        if (!account) throw httpError(409, "sponsor has no payout account; onboard first");
        if (account.onboarding_status !== "verified") {
            throw httpError(409, "sponsor payout account is not verified");
        }
        if (!account.processor_account_id) {
            throw httpError(409, "sponsor payout account has no connect account id");
        }

        // money move — throws 503 until Stripe is configured (rolls back the tx)
        const transfer = await stripe.createTransfer({
            amount_cents,
            destination_account: account.processor_account_id,
            currency,
            metadata: { debate_id, sponsor_id: owed.sponsor_id, kind: "debate_sponsor_payout" },
        });

        const ins = await tx.query(
            `INSERT INTO debate_sponsor_payouts
                 (debate_id, sponsor_id, recipient_user_id, gross_entries_cents,
                  platform_fee_cents, amount_cents, currency, stripe_transfer_id,
                  disbursement_method, status, disbursed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'stripe_connect_transfer','disbursed', now())
             RETURNING ${PAYOUT_COLS}`,
            [
                debate_id,
                owed.sponsor_id,
                owed.recipient_user_id,
                remainingGross,
                platform_fee_cents,
                amount_cents,
                currency,
                transfer.id,
            ]
        );
        return ins.rows[0];
    });
};

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    computeSponsorEntryPayout,
    disburseSponsorPayout,
    getSponsorPayouts,
};
