const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// subscriptions + subscription_payments — recurring monthly memberships.
//
//   `subscriptions` is the AGREEMENT (one Stripe Subscription per row). The
//   per-month charges live in `subscription_payments`. Stripe is the source of
//   truth for lifecycle state: start*/cancel*/resume* call the Stripe adapter
//   and then mirror the result into our row, and the *FromWebhook writers
//   reconcile our row to whatever Stripe later tells us via webhook events.
//
//   The Stripe adapter throws 503 until STRIPE_SECRET_KEY is set — that is
//   expected and surfaces as a clean "not configured" error.
//
// Error mapping (matches the house style): 23505→409, 23503→400, 23514→400,
//   22P02→400. Every catch starts with `if (err.status) throw err`.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// status sets mirror the table CHECK constraints (defense in depth + clean 400s).
const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled", "paused", "incomplete"];
const PAYMENT_STATUSES = ["paid", "failed", "pending", "refunded"];

// Columns we are happy to return to the owning user. No secrets here, but keep
// the projection explicit so future sensitive columns aren't leaked by default.
const SUBSCRIPTION_COLS = `
    id, user_id, tier, monthly_amount_cents, currency,
    stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
    current_period_start, current_period_end, cancel_at_period_end,
    trial_end, cancelled_at, ended_at, created_at, updated_at
`;

const PAYMENT_COLS = `
    id, subscription_id, user_id, amount_cents, currency,
    fee_amount_cents, net_amount_cents, stripe_invoice_id, stripe_charge_id,
    stripe_payment_intent_id, period_start, period_end, status,
    paid_at, failed_at, failure_reason, created_at
`;

// Translate a Postgres error into the right HTTP status. Shared by all writers.
const mapDbError = (err) => {
    if (err.status) return err;
    if (err.code === "23505") return httpError(409, "duplicate subscription record");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    if (err.code === "23514") return httpError(400, "value violates a check constraint");
    if (err.code === "22P02") return httpError(400, "invalid identifier format");
    return err;
};

// ---- reads -----------------------------------------------------------------

// getActiveSubscription — the caller's current non-ended membership. There is a
// partial unique index (status='active') so at most one truly-active row exists;
// we also surface trialing/past_due so the UI can show "needs attention" states.
const getActiveSubscription = async ({ user_id }) => {
    if (!user_id) throw httpError(401, "authentication required");
    try {
        const { rows } = await client.query(
            `SELECT ${SUBSCRIPTION_COLS}
               FROM subscriptions
              WHERE user_id = $1
                AND status IN ('active', 'trialing', 'past_due')
                AND ended_at IS NULL
              ORDER BY created_at DESC
              LIMIT 1`,
            [user_id]
        );
        return rows[0] || null;
    } catch (err) {
        throw mapDbError(err);
    }
};

// getUserSubscriptionPayments — full billing history for the caller, newest first.
const getUserSubscriptionPayments = async ({ user_id }) => {
    if (!user_id) throw httpError(401, "authentication required");
    try {
        const { rows } = await client.query(
            `SELECT ${PAYMENT_COLS}
               FROM subscription_payments
              WHERE user_id = $1
              ORDER BY created_at DESC`,
            [user_id]
        );
        return rows;
    } catch (err) {
        throw mapDbError(err);
    }
};

// Lookup helper used by cancel/resume: resolve the row by explicit id OR by the
// caller's most-recent live subscription. Ownership is enforced here — when a
// user_id is supplied it is ALWAYS part of the WHERE clause, so one user can
// never act on another user's subscription by passing its id. Runs on the
// supplied client/tx (so the FOR UPDATE lock is held for the mutation).
const findSubscription = async (db, { id, user_id }) => {
    if (id) {
        const { rows } = await db.query(
            `SELECT ${SUBSCRIPTION_COLS}
               FROM subscriptions
              WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)
              FOR UPDATE`,
            [id, user_id || null]
        );
        return rows[0] || null;
    }
    const { rows } = await db.query(
        `SELECT ${SUBSCRIPTION_COLS}
           FROM subscriptions
          WHERE user_id = $1 AND ended_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [user_id]
    );
    return rows[0] || null;
};

// ---- mutations -------------------------------------------------------------

// startSubscription — create the Stripe Subscription, then upsert our local row.
// We talk to Stripe FIRST (no local row if the charge agreement fails). The
// upsert is keyed on stripe_subscription_id so a retry of the same Stripe sub
// updates rather than duplicates.
const startSubscription = async ({
    user_id,
    tier,
    monthly_amount_cents,
    currency = "usd",
    stripe_customer_id,
    stripe_price_id,
    metadata = {},
}) => {
    if (!user_id) throw httpError(401, "authentication required");
    if (!tier) throw httpError(400, "tier is required");
    if (!monthly_amount_cents || monthly_amount_cents <= 0) {
        throw httpError(400, "monthly_amount_cents must be a positive integer");
    }
    if (!stripe_price_id) throw httpError(400, "stripe_price_id is required");

    // 1) Create the recurring agreement at Stripe (throws 503 until configured).
    const sub = await stripe.createSubscription({
        customer: stripe_customer_id,
        price_id: stripe_price_id,
        metadata: { user_id, tier, ...metadata },
    });

    // 2) Mirror it locally. Stripe returns period bounds + status; fall back to
    //    sensible defaults so this works even with the scaffold adapter shape.
    const status = sub?.status || "incomplete";
    const stripe_subscription_id = sub?.id || null;
    const customerId = sub?.customer || stripe_customer_id || null;
    const periodStart = sub?.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null;
    const periodEnd = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;
    const trialEnd = sub?.trial_end ? new Date(sub.trial_end * 1000) : null;

    if (!SUBSCRIPTION_STATUSES.includes(status)) {
        throw httpError(400, `unexpected subscription status from Stripe: ${status}`);
    }

    try {
        const { rows } = await client.query(
            `INSERT INTO subscriptions
                 (user_id, tier, monthly_amount_cents, currency, stripe_customer_id,
                  stripe_subscription_id, stripe_price_id, status,
                  current_period_start, current_period_end, trial_end)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET
                 tier                 = EXCLUDED.tier,
                 monthly_amount_cents = EXCLUDED.monthly_amount_cents,
                 currency             = EXCLUDED.currency,
                 stripe_customer_id   = EXCLUDED.stripe_customer_id,
                 stripe_price_id      = EXCLUDED.stripe_price_id,
                 status               = EXCLUDED.status,
                 current_period_start = EXCLUDED.current_period_start,
                 current_period_end   = EXCLUDED.current_period_end,
                 trial_end            = EXCLUDED.trial_end,
                 updated_at           = now()
             RETURNING ${SUBSCRIPTION_COLS}`,
            [
                user_id, tier, monthly_amount_cents, currency, customerId,
                stripe_subscription_id, stripe_price_id, status,
                periodStart, periodEnd, trialEnd,
            ]
        );
        // The client_secret rides back on the RETURNED OBJECT but is deliberately
        // NOT a column: it is a short-lived Stripe credential, not subscription
        // state, and persisting it would put a payable secret in the database for
        // no reason. A first-time subscriber has no card on file, so Stripe opens
        // the first invoice's PaymentIntent (see createSubscription's
        // 'default_incomplete') and this is the only handle the browser gets to
        // confirm it. Without it the row exists 'incomplete' and never charges.
        const clientSecret =
            sub?.latest_invoice?.payment_intent?.client_secret ?? null;
        return { ...rows[0], client_secret: clientSecret };
    } catch (err) {
        throw mapDbError(err);
    }
};

// cancelSubscriptionAtPeriodEnd — flag the Stripe sub to stop at period end, then
// mirror cancel_at_period_end onto our row. Lifecycle stays 'active' until the
// final webhook flips it to 'cancelled' (Stripe is the source of truth).
const cancelSubscriptionAtPeriodEnd = async ({ id, user_id }) => {
    if (!id && !user_id) throw httpError(400, "id or user_id is required");

    return withTransaction(async (tx) => {
        const sub = await findSubscription(tx, { id, user_id });
        if (!sub) throw httpError(404, "subscription not found");
        if (sub.ended_at) throw httpError(409, "subscription has already ended");
        if (!sub.stripe_subscription_id) {
            throw httpError(409, "subscription has no Stripe subscription id");
        }

        await stripe.cancelSubscription({
            subscription_id: sub.stripe_subscription_id,
            at_period_end: true,
        });

        try {
            const { rows } = await tx.query(
                `UPDATE subscriptions
                    SET cancel_at_period_end = true,
                        cancelled_at = COALESCE(cancelled_at, now()),
                        updated_at = now()
                  WHERE id = $1
                  RETURNING ${SUBSCRIPTION_COLS}`,
                [sub.id]
            );
            return rows[0];
        } catch (err) {
            throw mapDbError(err);
        }
    });
};

// resumeSubscription — undo a pending at-period-end cancellation. Re-instates the
// Stripe sub (cancel_at_period_end=false) and clears the local flag.
const resumeSubscription = async ({ id, user_id }) => {
    if (!id && !user_id) throw httpError(400, "id or user_id is required");

    return withTransaction(async (tx) => {
        const sub = await findSubscription(tx, { id, user_id });
        if (!sub) throw httpError(404, "subscription not found");
        if (sub.ended_at) throw httpError(409, "subscription has already ended");
        if (!sub.cancel_at_period_end) {
            throw httpError(409, "subscription is not scheduled for cancellation");
        }
        if (!sub.stripe_subscription_id) {
            throw httpError(409, "subscription has no Stripe subscription id");
        }

        await stripe.cancelSubscription({
            subscription_id: sub.stripe_subscription_id,
            at_period_end: false,
        });

        try {
            const { rows } = await tx.query(
                `UPDATE subscriptions
                    SET cancel_at_period_end = false,
                        cancelled_at = NULL,
                        updated_at = now()
                  WHERE id = $1
                  RETURNING ${SUBSCRIPTION_COLS}`,
                [sub.id]
            );
            return rows[0];
        } catch (err) {
            throw mapDbError(err);
        }
    });
};

// ---- webhook writers (internal — called by the Stripe dispatcher) ----------

// upsertSubscriptionFromWebhook — reconcile our row to a Stripe subscription
// object delivered by customer.subscription.* events. Idempotent: keyed on
// stripe_subscription_id, so redelivery is a harmless no-op-ish update.
//
// `subscription` is the Stripe Subscription object (event.data.object). We also
// accept an optional user_id (resolved from metadata by the dispatcher) so a row
// can be created if the original startSubscription never landed.
const upsertSubscriptionFromWebhook = async ({ subscription, user_id = null }, db = client) => {
    if (!subscription || !subscription.id) {
        throw httpError(400, "subscription object with an id is required");
    }
    const stripe_subscription_id = subscription.id;
    const status = subscription.status;
    if (status && !SUBSCRIPTION_STATUSES.includes(status)) {
        throw httpError(400, `unexpected subscription status: ${status}`);
    }
    const periodStart = subscription.current_period_start
        ? new Date(subscription.current_period_start * 1000)
        : null;
    const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const endedAt = subscription.ended_at ? new Date(subscription.ended_at * 1000) : null;
    const canceledAt = subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null;
    const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
    const customerId = subscription.customer || null;
    const priceId = subscription.items?.data?.[0]?.price?.id || null;
    const resolvedUser = user_id || subscription.metadata?.user_id || null;

    try {
        // Fast path: the row already exists — update lifecycle in place. This
        // does NOT require user_id, so events that lack metadata still reconcile.
        const upd = await db.query(
            `UPDATE subscriptions
                SET status = COALESCE($2, status),
                    current_period_start = COALESCE($3, current_period_start),
                    current_period_end = COALESCE($4, current_period_end),
                    cancel_at_period_end = $5,
                    trial_end = $6,
                    cancelled_at = COALESCE($7, cancelled_at),
                    ended_at = COALESCE($8, ended_at),
                    stripe_customer_id = COALESCE($9, stripe_customer_id),
                    stripe_price_id = COALESCE($10, stripe_price_id),
                    updated_at = now()
              WHERE stripe_subscription_id = $1
              RETURNING ${SUBSCRIPTION_COLS}`,
            [
                stripe_subscription_id, status || null, periodStart, periodEnd,
                cancelAtPeriodEnd, trialEnd, canceledAt, endedAt, customerId, priceId,
            ]
        );
        if (upd.rows.length) return upd.rows[0];

        // No local row yet. We can only insert if we can attribute it to a user
        // and have the required NOT NULL fields. Otherwise skip (the start flow
        // or a later event with metadata will create it).
        const amount = subscription.items?.data?.[0]?.price?.unit_amount ?? null;
        if (!resolvedUser || !amount) return null;
        const tier = subscription.metadata?.tier || priceId || "unknown";
        const currency = subscription.currency || subscription.items?.data?.[0]?.price?.currency || "usd";

        const ins = await db.query(
            `INSERT INTO subscriptions
                 (user_id, tier, monthly_amount_cents, currency, stripe_customer_id,
                  stripe_subscription_id, stripe_price_id, status,
                  current_period_start, current_period_end, cancel_at_period_end,
                  trial_end, cancelled_at, ended_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 current_period_start = EXCLUDED.current_period_start,
                 current_period_end = EXCLUDED.current_period_end,
                 cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                 trial_end = EXCLUDED.trial_end,
                 cancelled_at = EXCLUDED.cancelled_at,
                 ended_at = EXCLUDED.ended_at,
                 updated_at = now()
             RETURNING ${SUBSCRIPTION_COLS}`,
            [
                resolvedUser, tier, amount, currency, customerId,
                stripe_subscription_id, priceId, status || "incomplete",
                periodStart, periodEnd, cancelAtPeriodEnd, trialEnd, canceledAt, endedAt,
            ]
        );
        return ins.rows[0];
    } catch (err) {
        throw mapDbError(err);
    }
};

// recordSubscriptionPaymentFromWebhook — insert a subscription_payments row from
// an invoice.paid / invoice.payment_failed event. Idempotent on the unique
// stripe_invoice_id so Stripe retries don't double-insert.
//
// `invoice` is the Stripe Invoice object (event.data.object).
const recordSubscriptionPaymentFromWebhook = async ({ invoice }, db = client) => {
    if (!invoice || !invoice.id) throw httpError(400, "invoice object with an id is required");

    const stripe_invoice_id = invoice.id;
    const stripe_subscription_id = invoice.subscription || null;
    if (!stripe_subscription_id) {
        // Not a subscription invoice — nothing for this table.
        return null;
    }

    try {
        // Resolve our subscription (for FK + denormalized user_id).
        const subRes = await db.query(
            `SELECT id, user_id FROM subscriptions WHERE stripe_subscription_id = $1`,
            [stripe_subscription_id]
        );
        const sub = subRes.rows[0];
        if (!sub) {
            // We don't know this subscription yet — let the subscription.* event
            // create it first; this invoice will be retried by Stripe.
            return null;
        }

        const amount = invoice.amount_paid ?? invoice.amount_due ?? invoice.total ?? null;
        if (amount == null || amount <= 0) {
            throw httpError(400, "invoice has no positive amount");
        }
        const currency = invoice.currency || "usd";
        const paid = invoice.paid === true || invoice.status === "paid";
        const status = paid ? "paid" : "failed";
        const line = invoice.lines?.data?.[0];
        const periodStart = line?.period?.start ? new Date(line.period.start * 1000) : null;
        const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
        const paidAt = paid && invoice.status_transitions?.paid_at
            ? new Date(invoice.status_transitions.paid_at * 1000)
            : (paid ? new Date() : null);
        const failedAt = !paid ? new Date() : null;
        const failureReason = !paid
            ? (invoice.last_finalization_error?.message
                || invoice.last_payment_error?.message
                || null)
            : null;
        const charge = invoice.charge || null;
        const paymentIntent = invoice.payment_intent || null;

        const { rows } = await db.query(
            `INSERT INTO subscription_payments
                 (subscription_id, user_id, amount_cents, currency,
                  stripe_invoice_id, stripe_charge_id, stripe_payment_intent_id,
                  period_start, period_end, status, paid_at, failed_at, failure_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (stripe_invoice_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 paid_at = EXCLUDED.paid_at,
                 failed_at = EXCLUDED.failed_at,
                 failure_reason = EXCLUDED.failure_reason,
                 stripe_charge_id = EXCLUDED.stripe_charge_id,
                 stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id
             RETURNING ${PAYMENT_COLS}`,
            [
                sub.id, sub.user_id, amount, currency,
                stripe_invoice_id, charge, paymentIntent,
                periodStart, periodEnd, status, paidAt, failedAt, failureReason,
            ]
        );
        return rows[0];
    } catch (err) {
        throw mapDbError(err);
    }
};

// refundSubscriptionPayment — issue a Stripe refund for a recorded payment, then
// mark our row 'refunded'. Refunds by PaymentIntent (the canonical Stripe handle).
const refundSubscriptionPayment = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");

    return withTransaction(async (tx) => {
        const cur = await tx.query(
            `SELECT ${PAYMENT_COLS} FROM subscription_payments WHERE id = $1 FOR UPDATE`,
            [id]
        );
        const payment = cur.rows[0];
        if (!payment) throw httpError(404, "subscription payment not found");
        if (payment.status === "refunded") throw httpError(409, "payment already refunded");
        if (payment.status !== "paid") throw httpError(409, "only paid payments can be refunded");
        if (!payment.stripe_payment_intent_id) {
            throw httpError(409, "payment has no Stripe payment intent to refund");
        }

        await stripe.createRefund({
            payment_intent_id: payment.stripe_payment_intent_id,
            amount_cents: payment.amount_cents,
        });

        try {
            const { rows } = await tx.query(
                `UPDATE subscription_payments
                    SET status = 'refunded'
                  WHERE id = $1
                  RETURNING ${PAYMENT_COLS}`,
                [id]
            );
            return rows[0];
        } catch (err) {
            throw mapDbError(err);
        }
    });
};

module.exports = {
    SUBSCRIPTION_STATUSES,
    PAYMENT_STATUSES,
    startSubscription,
    getActiveSubscription,
    cancelSubscriptionAtPeriodEnd,
    resumeSubscription,
    upsertSubscriptionFromWebhook,
    recordSubscriptionPaymentFromWebhook,
    getUserSubscriptionPayments,
    refundSubscriptionPayment,
};
