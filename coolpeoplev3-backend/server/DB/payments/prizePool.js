const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// Prize pool — two tables (migration 1779234282879):
//
//  prize_pool_contributions (PK contribution_id) — money INTO a debate's pool.
//    contribution_source CHECK: 'sponsor' | 'platform_top_up' | 'user_voluntary'
//    | 'sponsor_match'. locked_at is NOT NULL (point after which the money can't
//    be pulled back). A user-voluntary contribution defaults to 'user_voluntary'.
//
//  prize_distributions (PK distribution_id) — money OUT to a winner. This table
//    has NO status column; lifecycle is expressed by timestamps:
//      created (row exists)        → intended payout recorded
//      w9_received_at set          → W-9 on file (required for taxable amounts)
//      disbursed_at + transfer id  → funds sent
//      disputed_at / resolved_at   → dispute lifecycle
//    placement (>=1) and amount_cents (>0) are required.
//
//  Contributions create a Stripe PaymentIntent first, then insert. Distributions
//  are admin-recorded intents; markDisbursed performs the Stripe transfer here.
//  Stripe is INERT (503) until configured — expected for the scaffold.
// ============================================================================

const VALID_SOURCES = ["sponsor", "platform_top_up", "user_voluntary", "sponsor_match"];

// ---- contributions (money in) ----------------------------------------------

// addPrizePoolContribution — create the Stripe PaymentIntent, then insert the
// contribution row. locked_at is required by the table; default it to now()
// unless the caller supplies a later lock point.
const addPrizePoolContribution = async ({
    contributor_user_id = null,
    debate_id,
    amount_cents,
    contribution_source = "user_voluntary",
    contributor_display_name = null,
    locked_at = null,
    refundable_until = null,
    stripe_customer_id = null,
    metadata = {},
}) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required");
        if (!(Number(amount_cents) > 0)) throw httpError(400, "amount_cents must be > 0");
        if (!VALID_SOURCES.includes(contribution_source)) {
            throw httpError(400, `contribution_source must be one of: ${VALID_SOURCES.join(", ")}`);
        }

        const intent = await stripe.createPaymentIntent({
            amount_cents: Number(amount_cents),
            customer: stripe_customer_id,
            metadata: {
                ...metadata,
                kind: "prize_pool_contribution",
                debate_id,
                contributor_user_id,
                contribution_source,
            },
        });

        const SQL = `
            INSERT INTO prize_pool_contributions (
                debate_id, contributor_user_id, contribution_source,
                contributor_display_name, amount_cents, stripe_payment_intent_id,
                locked_at, refundable_until
            )
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            debate_id,
            contributor_user_id,
            contribution_source,
            contributor_display_name,
            amount_cents,
            intent?.id ?? null,
            locked_at,
            refundable_until,
        ]);
        return { contribution: result.rows[0], client_secret: intent?.client_secret ?? null };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "this contribution was already recorded");
        if (err.code === "23503") throw httpError(400, "debate_id or contributor_user_id does not exist");
        if (err.code === "23514") throw httpError(400, "a contribution field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getPrizePool — the pool for a debate: live total (refunded rows excluded) and
// the list of contributions newest-first.
const getPrizePool = async ({ debate_id }) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required");
        const totalSQL = `
            SELECT
                COALESCE(SUM(amount_cents) FILTER (WHERE refunded_at IS NULL), 0)::bigint AS total_cents,
                COUNT(*) FILTER (WHERE refunded_at IS NULL)::int AS contribution_count
            FROM prize_pool_contributions
            WHERE debate_id = $1
        `;
        const listSQL = `
            SELECT * FROM prize_pool_contributions
            WHERE debate_id = $1
            ORDER BY created_at DESC
        `;
        const [totals, list] = await Promise.all([
            client.query(totalSQL, [debate_id]),
            client.query(listSQL, [debate_id]),
        ]);
        return {
            debate_id,
            total_cents: Number(totals.rows[0].total_cents),
            contribution_count: totals.rows[0].contribution_count,
            contributions: list.rows,
        };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// refundContribution — Stripe refund + stamp refunded_at. Blocked once the
// contribution is locked (locked_at in the past) — locked money funds the pool
// and can't be pulled back.
const refundContribution = async ({ id, amount_cents = null }) => {
    try {
        if (!id) throw httpError(400, "contribution id is required");
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM prize_pool_contributions WHERE contribution_id = $1 FOR UPDATE`,
                [id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "contribution not found");
            if (row.refunded_at) throw httpError(409, "contribution is already refunded");
            if (row.locked_at && new Date(row.locked_at) <= new Date()) {
                throw httpError(409, "contribution is locked and can no longer be refunded");
            }
            if (!row.stripe_payment_intent_id) {
                throw httpError(409, "contribution has no Stripe PaymentIntent to refund");
            }

            await stripe.createRefund({
                payment_intent_id: row.stripe_payment_intent_id,
                amount_cents: amount_cents != null ? Number(amount_cents) : undefined,
            });

            const upd = await tx.query(
                `UPDATE prize_pool_contributions
                    SET refunded_at = now()
                  WHERE contribution_id = $1
                  RETURNING *`,
                [id]
            );
            return upd.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// ---- distributions (money out) ---------------------------------------------

// createPrizeDistribution — admin records an intended payout to a winner. No
// money moves yet (no status column; existence == intended). markDisbursed
// performs the transfer.
const createPrizeDistribution = async ({
    debate_id,
    recipient_user_id,
    placement,
    amount_cents,
    disbursement_method = null,
}) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required");
        if (!recipient_user_id) throw httpError(400, "recipient_user_id is required");
        if (!(Number(placement) >= 1)) throw httpError(400, "placement must be >= 1");
        if (!(Number(amount_cents) > 0)) throw httpError(400, "amount_cents must be > 0");
        const SQL = `
            INSERT INTO prize_distributions (
                debate_id, recipient_user_id, placement, amount_cents, disbursement_method
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            debate_id,
            recipient_user_id,
            placement,
            amount_cents,
            disbursement_method,
        ]);
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23503") throw httpError(400, "debate_id or recipient_user_id does not exist");
        if (err.code === "23514") throw httpError(400, "a distribution field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getPrizeDistributions — all intended/actual payouts for a debate.
const getPrizeDistributions = async ({ debate_id }) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required");
        const result = await client.query(
            `SELECT * FROM prize_distributions
              WHERE debate_id = $1
              ORDER BY placement ASC, created_at ASC`,
            [debate_id]
        );
        return result.rows;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// attachW9 — record that the winner's W-9 is on file (gate for disbursing a
// taxable amount). Stamps w9_received_at + the doc url.
const attachW9 = async ({ distribution_id, w9_document_url = null }) => {
    try {
        if (!distribution_id) throw httpError(400, "distribution_id is required");
        const result = await client.query(
            `UPDATE prize_distributions
                SET w9_received_at = now(),
                    w9_document_url = COALESCE($2, w9_document_url)
              WHERE distribution_id = $1
              RETURNING *`,
            [distribution_id, w9_document_url]
        );
        if (!result.rows.length) throw httpError(404, "distribution not found");
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// markDisbursed — perform the Stripe transfer to the winner and stamp the payout.
// Guards: not already disbursed; the actual transfer (createTransfer) happens
// here, and the resulting tr_ id is stored (UNIQUE prevents a double-payout).
// destination_account is the winner's Stripe Connect account id.
const markDisbursed = async ({
    distribution_id,
    destination_account,
    disbursement_method = "stripe_transfer",
}) => {
    try {
        if (!distribution_id) throw httpError(400, "distribution_id is required");
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM prize_distributions WHERE distribution_id = $1 FOR UPDATE`,
                [distribution_id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "distribution not found");
            if (row.disbursed_at || row.stripe_transfer_id) {
                throw httpError(409, "distribution is already disbursed");
            }

            let transferId = null;
            if (disbursement_method === "stripe_transfer") {
                if (!destination_account) {
                    throw httpError(400, "destination_account is required for a Stripe transfer");
                }
                const transfer = await stripe.createTransfer({
                    amount_cents: Number(row.amount_cents),
                    destination_account,
                    metadata: {
                        kind: "prize_distribution",
                        distribution_id,
                        debate_id: row.debate_id,
                        recipient_user_id: row.recipient_user_id,
                    },
                });
                transferId = transfer?.id ?? null;
            }

            const upd = await tx.query(
                `UPDATE prize_distributions
                    SET disbursed_at = now(),
                        disbursement_method = $2,
                        stripe_transfer_id = COALESCE($3, stripe_transfer_id)
                  WHERE distribution_id = $1
                  RETURNING *`,
                [distribution_id, disbursement_method, transferId]
            );
            return upd.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "this transfer was already recorded");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// openDistributionDispute — record that the winner disputed the disbursement.
const openDistributionDispute = async ({ distribution_id, reason = null }) => {
    try {
        if (!distribution_id) throw httpError(400, "distribution_id is required");
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM prize_distributions WHERE distribution_id = $1 FOR UPDATE`,
                [distribution_id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "distribution not found");
            if (row.disputed_at && !row.dispute_resolved_at) {
                throw httpError(409, "distribution already has an open dispute");
            }
            const upd = await tx.query(
                `UPDATE prize_distributions
                    SET disputed_at = now(),
                        dispute_resolved_at = NULL,
                        dispute_resolution_notes = $2
                  WHERE distribution_id = $1
                  RETURNING *`,
                [distribution_id, reason]
            );
            return upd.rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// tiny helper so routes can map thrown errors to status codes
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    VALID_SOURCES,
    addPrizePoolContribution,
    getPrizePool,
    refundContribution,
    createPrizeDistribution,
    getPrizeDistributions,
    attachW9,
    markDisbursed,
    openDistributionDispute,
};
