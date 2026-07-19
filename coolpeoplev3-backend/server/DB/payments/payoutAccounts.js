const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// payout_accounts — the cash-out onboarding record (Stripe Connect / KYC).
//
// We never custody funds and never store a full TIN: the processor holds KYC +
// tax identity. We keep the minimum the table allows — which processor, their
// account/recipient handle, the tax-id TYPE (drives 1099 vs 1042-S handling),
// and verification state. One row per user (DB unique on user_id).
//
// onboarding_status lifecycle: not_started → pending → verified | rejected.
// ============================================================================

const VALID_PROCESSORS = ["stripe_connect", "payout_partner"];
const VALID_TAX_ID_TYPES = ["ssn", "itin", "ein", "foreign_none"];

// Explicit projection — the row carries no secrets (the processor holds those),
// but we keep the SELECT list explicit so future sensitive columns don't leak.
const ACCOUNT_COLS = `
    id, user_id, processor, processor_account_id, tax_id_type,
    onboarding_status, identity_verified_at, created_at, updated_at
`;

// ---- reads -----------------------------------------------------------------

// getPayoutAccount — the caller's (or any user's) payout account, or null.
const getPayoutAccount = async ({ user_id }) => {
    if (!user_id) throw httpError(400, "user_id is required");
    const { rows } = await client.query(
        `SELECT ${ACCOUNT_COLS} FROM payout_accounts WHERE user_id = $1`,
        [user_id]
    );
    return rows[0] || null;
};

// ---- mutations -------------------------------------------------------------

// startPayoutOnboarding — begin (or resume) Stripe Connect onboarding for a
// user. Creates the Connect account + an onboarding account link, then
// upserts the payout_accounts row with the connect account id and status
// 'pending'. Idempotent on user_id: a second call reuses the existing
// processor_account_id and just mints a fresh account link.
//
// The Stripe calls throw 503 until STRIPE_SECRET_KEY is configured — expected.
const startPayoutOnboarding = async ({
    user_id,
    processor = "stripe_connect",
    email,
    country = "US",
    refresh_url,
    return_url,
    tax_id_type,
}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!VALID_PROCESSORS.includes(processor)) {
        throw httpError(400, `processor must be one of: ${VALID_PROCESSORS.join(", ")}`);
    }
    if (tax_id_type !== undefined && tax_id_type !== null && !VALID_TAX_ID_TYPES.includes(tax_id_type)) {
        throw httpError(400, `tax_id_type must be one of: ${VALID_TAX_ID_TYPES.join(", ")}`);
    }

    return withTransaction(async (tx) => {
        const existing = await tx.query(
            `SELECT ${ACCOUNT_COLS} FROM payout_accounts WHERE user_id = $1 FOR UPDATE`,
            [user_id]
        );
        const current = existing.rows[0];

        // already verified → don't re-onboard
        if (current && current.onboarding_status === "verified") {
            throw httpError(409, "payout account is already verified");
        }

        // Reuse the processor account across resume attempts; only create one once.
        let processorAccountId = current?.processor_account_id || null;
        if (!processorAccountId) {
            const account = await stripe.createConnectAccount({
                email,
                country,
                metadata: { user_id },
            });
            processorAccountId = account.id;
        }

        // Mint a fresh onboarding link every call (links are single-use/expiring).
        const accountLink = await stripe.createAccountLink({
            account_id: processorAccountId,
            refresh_url,
            return_url,
        });

        const upsert = await tx.query(
            `INSERT INTO payout_accounts
                 (user_id, processor, processor_account_id, tax_id_type, onboarding_status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (user_id) DO UPDATE SET
                 processor = EXCLUDED.processor,
                 processor_account_id = EXCLUDED.processor_account_id,
                 tax_id_type = COALESCE(EXCLUDED.tax_id_type, payout_accounts.tax_id_type),
                 onboarding_status = 'pending',
                 updated_at = now()
             RETURNING ${ACCOUNT_COLS}`,
            [user_id, processor, processorAccountId, tax_id_type ?? null]
        );

        return { account: upsert.rows[0], onboarding_url: accountLink.url };
    });
};

// markPayoutVerified — flip an account to 'verified' (or 'rejected'). Driven by
// the Stripe Connect webhook (account.updated → charges/payouts enabled) or by
// an admin override. Identify by id OR user_id. Stamps identity_verified_at on
// verification and records the tax-id TYPE (never the number) if provided.
const markPayoutVerified = async ({
    id,
    user_id,
    taxId, // accepted but never persisted — KYC/TIN lives with the processor
    tax_id_type,
    status = "verified",
    processor_account_id,
}) => {
    if (!id && !user_id) throw httpError(400, "id or user_id is required");
    if (!["verified", "rejected"].includes(status)) {
        throw httpError(400, "status must be 'verified' or 'rejected'");
    }
    if (tax_id_type !== undefined && tax_id_type !== null && !VALID_TAX_ID_TYPES.includes(tax_id_type)) {
        throw httpError(400, `tax_id_type must be one of: ${VALID_TAX_ID_TYPES.join(", ")}`);
    }

    const verifiedAtSql = status === "verified" ? "now()" : "NULL";
    const where = id ? "id = $4" : "user_id = $4";

    const { rows } = await client.query(
        `UPDATE payout_accounts
            SET onboarding_status = $1,
                tax_id_type = COALESCE($2, tax_id_type),
                processor_account_id = COALESCE($3, processor_account_id),
                identity_verified_at = ${verifiedAtSql},
                updated_at = now()
          WHERE ${where}
          RETURNING ${ACCOUNT_COLS}`,
        [status, tax_id_type ?? null, processor_account_id ?? null, id || user_id]
    );
    if (!rows.length) throw httpError(404, "payout account not found");
    return rows[0];
};

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    VALID_PROCESSORS,
    VALID_TAX_ID_TYPES,
    getPayoutAccount,
    startPayoutOnboarding,
    markPayoutVerified,
};
