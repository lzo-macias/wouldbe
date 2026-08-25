const { client, withTransaction } = require("../index.js");

// ============================================================================
// Financial audit log — our OWN ledger of money-movement events (§14).
//
// WHY THIS EXISTS:
//  - Tax, fraud, and dispute defense all require a complete, queryable record
//    of every financial event. Stripe keeps its records but we need ours so we
//    can reconcile against them and answer "what did this user pay / receive?"
//    without round-tripping to Stripe.
//  - This table is APPEND-ONLY in spirit: each row is one event (a charge, a
//    refund, a payout, a fee). amount_cents is SIGNED — negative for refunds
//    and payouts, positive for money received.
//
// SOURCES it reads to build/verify events:
//   tips, debate_payments, subscription_payments, prize_distributions
//   (post_payments is also FK-linked but out of this task's scope).
//
// STRIPE IS EXTERNAL. reconcileWithStripe() does the DB-side read/compare it
// can, but the actual Stripe API fetch is left as a TODO — we do NOT invent SDK
// calls here.
// ============================================================================

// Local httpError per house convention (no shared import for the throw helper).
const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// The 10 allowed event_category values, mirrored from the table CHECK so we can
// give a clean 400 instead of leaking a 23514.
const EVENT_CATEGORIES = [
    "platform_fee_received",
    "tip_charged",
    "tip_refunded",
    "membership_charged",
    "prize_paid",
    "dispute_filed",
    "post_payment",
    "debate_entry_charged",
    "prize_pool_contribution",
    "stripe_fee",
];

// Explicit projection — the table has no secrets, but keep it explicit so future
// sensitive columns aren't leaked by accident.
const AUDIT_COLS = `
    id, event_category, user_id, amount_cents, currency,
    related_tip_id, related_subscription_payment_id, related_prize_distribution_id,
    related_post_payment_id, related_debate_payment_id,
    stripe_charge_id, stripe_balance_transaction_id, description, occurred_at
`;

// Map common pg error codes to HTTP statuses (shared by the writers).
const mapDbError = (err) => {
    if (err.status) return err;
    if (err.code === "23505") return httpError(409, "duplicate financial event");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    if (err.code === "23514") return httpError(400, "invalid financial event (check constraint)");
    if (err.code === "22P02") return httpError(400, "invalid id/value format");
    return err;
};

// ---- writers ---------------------------------------------------------------

// recordFinancialEvent — append one event to the ledger. Composable: pass an
// optional db (a tx) so an emitting service can write the event INSIDE the same
// transaction as the underlying charge/payout. Defaults to the pool.
//
// One {…} arg. amount_cents is required and SIGNED (negative for refunds/payouts).
const recordFinancialEvent = async ({
    event_category,
    user_id = null,
    amount_cents,
    currency = "usd",
    related_tip_id = null,
    related_subscription_payment_id = null,
    related_prize_distribution_id = null,
    related_post_payment_id = null,
    related_debate_payment_id = null,
    stripe_charge_id = null,
    stripe_balance_transaction_id = null,
    description = null,
    occurred_at = null,
} = {}, db = client) => {
    if (!event_category || !EVENT_CATEGORIES.includes(event_category)) {
        throw httpError(400, `event_category must be one of: ${EVENT_CATEGORIES.join(", ")}`);
    }
    if (amount_cents === undefined || amount_cents === null || !Number.isFinite(Number(amount_cents))) {
        throw httpError(400, "amount_cents is required (signed integer)");
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO financial_audit_log
               (event_category, user_id, amount_cents, currency,
                related_tip_id, related_subscription_payment_id, related_prize_distribution_id,
                related_post_payment_id, related_debate_payment_id,
                stripe_charge_id, stripe_balance_transaction_id, description, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, now()))
             RETURNING ${AUDIT_COLS}`,
            [
                event_category,
                user_id,
                String(amount_cents),
                currency,
                related_tip_id,
                related_subscription_payment_id,
                related_prize_distribution_id,
                related_post_payment_id,
                related_debate_payment_id,
                stripe_charge_id,
                stripe_balance_transaction_id,
                description,
                occurred_at,
            ]
        );
        return rows[0];
    } catch (err) {
        throw mapDbError(err);
    }
};

// ---- reads -----------------------------------------------------------------

// listFinancialAuditEvents — the admin ledger view. All filters optional.
//   { event_category, user_id, currency, from, to (occurred_at window),
//     stripe_charge_id, limit (default 100, max 500), offset }
const listFinancialAuditEvents = async ({
    event_category = null,
    user_id = null,
    currency = null,
    from = null,
    to = null,
    stripe_charge_id = null,
    limit = 100,
    offset = 0,
} = {}) => {
    if (event_category && !EVENT_CATEGORIES.includes(event_category)) {
        throw httpError(400, `event_category must be one of: ${EVENT_CATEGORIES.join(", ")}`);
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    try {
        const { rows } = await client.query(
            `SELECT ${AUDIT_COLS}
               FROM financial_audit_log
              WHERE ($1::text IS NULL OR event_category = $1)
                AND ($2::uuid IS NULL OR user_id = $2)
                AND ($3::text IS NULL OR currency = $3)
                AND ($4::timestamptz IS NULL OR occurred_at >= $4)
                AND ($5::timestamptz IS NULL OR occurred_at <= $5)
                AND ($6::text IS NULL OR stripe_charge_id = $6)
              ORDER BY occurred_at DESC
              LIMIT $7 OFFSET $8`,
            [event_category, user_id, currency, from, to, stripe_charge_id, lim, off]
        );
        return rows;
    } catch (err) {
        throw mapDbError(err);
    }
};

// getFinancialEventsForUser — all ledger events touching one user, newest first.
const getFinancialEventsForUser = async ({ user_id } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${AUDIT_COLS}
               FROM financial_audit_log
              WHERE user_id = $1
              ORDER BY occurred_at DESC`,
            [user_id]
        );
        return rows;
    } catch (err) {
        throw mapDbError(err);
    }
};

// ---- reconciliation --------------------------------------------------------

// reconcileWithStripe — compare our ledger against Stripe for a window.
//
// Stripe is EXTERNAL. We do the part we CAN do internally: pull the candidate
// charge rows from our source tables (tips, debate_payments, subscription_
// payments) plus the ledger rows that carry a stripe_charge_id over the window,
// and surface what we have. The actual Stripe Balance Transaction fetch and the
// side-by-side diff are NOT wired — see TODO(Stripe). We return a CLEARLY-MARKED
// "reconciliation not wired" result rather than pretending it ran.
//
//   { from, to } — required occurred/charged window (timestamptz).
const reconcileWithStripe = async ({ from = null, to = null } = {}) => {
    if (!from || !to) throw httpError(400, "from and to are required for reconciliation");

    // Our side: every charge id we believe exists in the window, by source.
    const ledger = await client.query(
        `SELECT stripe_charge_id, event_category, amount_cents, currency, occurred_at
           FROM financial_audit_log
          WHERE stripe_charge_id IS NOT NULL
            AND occurred_at >= $1 AND occurred_at <= $2`,
        [from, to]
    );

    // Source tables — the authoritative charge rows the ledger should reflect.
    const tips = await client.query(
        `SELECT id, stripe_charge_id, tip_amount_cents AS amount_cents, status, charged_at
           FROM tips
          WHERE charged_at >= $1 AND charged_at <= $2`,
        [from, to]
    );
    const debatePayments = await client.query(
        `SELECT payment_id, stripe_charge_id, amount_cents, status, charged_at
           FROM debate_payments
          WHERE charged_at >= $1 AND charged_at <= $2`,
        [from, to]
    );
    const subPayments = await client.query(
        `SELECT id, stripe_charge_id, amount_cents, status, paid_at
           FROM subscription_payments
          WHERE paid_at >= $1 AND paid_at <= $2`,
        [from, to]
    );

    // TODO(Stripe): fetch Stripe Balance Transactions / Charges for [from,to]
    // via the Stripe SDK, then diff stripe_charge_id + amount + currency against
    // the `ledger` rows above to find: (a) charges Stripe has but we don't,
    // (b) charges we have but Stripe doesn't, (c) amount mismatches. Do NOT
    // invent SDK calls here — wiring the SDK + secret is a separate task.

    return {
        status: "reconciliation_not_wired",
        message:
            "Stripe-side fetch is not wired. The DB-side snapshot below is provided " +
            "for inspection only; no charge-by-charge diff against Stripe was performed.",
        window: { from, to },
        our_side: {
            ledger_rows_with_charge_id: ledger.rowCount,
            source_counts: {
                tips: tips.rowCount,
                debate_payments: debatePayments.rowCount,
                subscription_payments: subPayments.rowCount,
            },
        },
        stripe_side: null, // TODO(Stripe)
        discrepancies: null, // TODO(Stripe)
    };
};

module.exports = {
    EVENT_CATEGORIES,
    recordFinancialEvent,
    listFinancialAuditEvents,
    getFinancialEventsForUser,
    reconcileWithStripe,
};
