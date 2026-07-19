const { client } = require("../index.js");
const stripe = require("../../services/stripe");

// ============================================================================
// stripe_webhook_events — the idempotency + audit ledger for inbound Stripe
// webhooks. Stripe retries deliveries during outages, so EVERY event is first
// recorded with ON CONFLICT DO NOTHING keyed on the unique `stripe_event_id`
// (the evt_... id). If the INSERT actually created a row, this is the first time
// we've seen the event and we dispatch it; on a redelivery the INSERT is a
// no-op and we skip processing — that is what makes the pipeline safe.
//
//   handleStripeWebhook  → verify signature, persist, dispatch-once.
//   dispatchStripeEvent  → switch on event.type → the right *FromWebhook writer.
//   markStripeEventProcessed → close the ledger row out (succeeded).
//
// The Stripe adapter (constructWebhookEvent) throws 503 until configured; we let
// signature/verification failures bubble as a 4xx so the route returns 400.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

const mapDbError = (err) => {
    if (err.status) return err;
    if (err.code === "23505") return httpError(409, "duplicate webhook event");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    if (err.code === "23514") return httpError(400, "value violates a check constraint");
    if (err.code === "22P02") return httpError(400, "invalid identifier format");
    return err;
};

// handleStripeWebhook — the entry point the route calls. Verifies the signature
// against the raw body, records the event idempotently, and dispatches it once.
// Returns a small summary the route can log/return; it always responds 200 on a
// verified event (even a duplicate) so Stripe stops retrying.
const handleStripeWebhook = async ({ rawBody, signature }) => {
    if (!rawBody) throw httpError(400, "missing raw request body");
    if (!signature) throw httpError(400, "missing stripe-signature header");

    // 1) Verify + parse. A bad signature throws here → route maps to 400.
    //    (Throws 503 until STRIPE_WEBHOOK_SECRET is configured — expected.)
    const event = stripe.constructWebhookEvent({ rawBody, signature });
    if (!event || !event.id) throw httpError(400, "invalid Stripe event");

    // 2) Persist idempotently. ON CONFLICT DO NOTHING means a second delivery of
    //    the same evt_... id inserts nothing and `inserted` is false.
    let inserted = false;
    let rowId = null;
    try {
        const { rows } = await client.query(
            `INSERT INTO stripe_webhook_events
                 (stripe_event_id, event_type, payload, livemode, processing_status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (stripe_event_id) DO NOTHING
             RETURNING id`,
            [event.id, event.type, JSON.stringify(event), !!event.livemode]
        );
        inserted = rows.length > 0;
        rowId = rows[0]?.id || null;
    } catch (err) {
        throw mapDbError(err);
    }

    // 3) Already seen → no-op (do NOT re-run side effects).
    if (!inserted) {
        return { event_id: event.id, type: event.type, duplicate: true, dispatched: false };
    }

    // 4) First time → dispatch. We mark processing, then succeeded/failed so the
    //    ledger reflects the outcome and ops can replay failures.
    await markStripeEventStatus({ id: rowId, status: "processing" });
    try {
        const result = await dispatchStripeEvent(event);
        await markStripeEventProcessed({ id: rowId, status: result?.handled ? "succeeded" : "ignored" });
        return { event_id: event.id, type: event.type, duplicate: false, dispatched: true, ...result };
    } catch (err) {
        // Record the failure but do NOT rethrow — we still want a 200 to Stripe
        // for a verified event (retrying won't fix a code bug); ops replays from
        // the ledger. Verification/4xx errors never reach here (they throw above).
        await markStripeEventStatus({
            id: rowId,
            status: "failed",
            error_message: err.message || String(err),
        });
        return { event_id: event.id, type: event.type, duplicate: false, dispatched: true, handled: false, error: err.message };
    }
};

// dispatchStripeEvent — route a verified event to the right *FromWebhook writer.
// Required lazily to avoid a require cycle (subscriptions.js → index.js → routes
// → this file). Returns { handled } so the ledger can record ignored vs handled.
const dispatchStripeEvent = async (event) => {
    // Lazy require: keeps module load order clean and avoids circular deps.
    const {
        upsertSubscriptionFromWebhook,
        recordSubscriptionPaymentFromWebhook,
    } = require("./subscriptions");

    const obj = event.data?.object || {};

    switch (event.type) {
        // ---- subscription lifecycle ------------------------------------------
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
        case "customer.subscription.paused":
        case "customer.subscription.resumed": {
            // `obj` is the Stripe Subscription object.
            await upsertSubscriptionFromWebhook({ subscription: obj });
            return { handled: true };
        }

        // ---- recurring invoice billing ---------------------------------------
        case "invoice.paid":
        case "invoice.payment_succeeded":
        case "invoice.payment_failed": {
            // `obj` is the Stripe Invoice object. Records a subscription_payments
            // row (idempotent on stripe_invoice_id).
            await recordSubscriptionPaymentFromWebhook({ invoice: obj });
            return { handled: true };
        }

        // ---- one-off charges (tips / post / debate payments) -----------------
        case "payment_intent.succeeded":
        case "payment_intent.payment_failed": {
            // `obj` is the PaymentIntent. metadata.kind (set in each createXIntent)
            // says which product it is; route to that confirmer (idempotent on the
            // pi id). Extra fields are ignored by confirmers that don't take them.
            const status = event.type === "payment_intent.succeeded" ? "succeeded" : "failed";
            const common = {
                stripe_payment_intent_id: obj.id,
                status,
                stripe_charge_id: obj.latest_charge ?? null,
                failure_reason: obj.last_payment_error?.message ?? null,
            };
            switch (obj.metadata?.kind) {
                case "tip":
                    await require("./tips").createTipFromWebhook(common);
                    return { handled: true };
                case "post_payment":
                    await require("./postPayments").confirmPostPayment(common);
                    return { handled: true };
                case "debate_entry_one_off":
                    await require("./debatePayments").confirmDebatePayment(common);
                    return { handled: true };
                default:
                    // Unknown/absent kind — record but don't guess.
                    return { handled: false };
            }
        }

        case "charge.refunded": {
            // Refunds are initiated app-side (the refund routes already flip state),
            // so this is a documented no-op; revisit if out-of-band refunds happen.
            return { handled: false };
        }

        default:
            // Unhandled event types are recorded in the ledger but ignored.
            return { handled: false };
    }
};

// markStripeEventStatus — internal helper to move a ledger row through states
// and bump the attempt counter on each (re)processing.
const markStripeEventStatus = async ({ id, status, error_message = null }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `UPDATE stripe_webhook_events
                SET processing_status = $2,
                    processing_attempts = processing_attempts + 1,
                    error_message = $3
              WHERE id = $1
              RETURNING id, stripe_event_id, processing_status, processing_attempts`,
            [id, status, error_message]
        );
        return rows[0] || null;
    } catch (err) {
        throw mapDbError(err);
    }
};

// markStripeEventProcessed — close out a ledger row: stamp processed_at and the
// terminal status (defaults to 'succeeded'). Clears any prior error on success.
const markStripeEventProcessed = async ({ id, status = "succeeded" }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `UPDATE stripe_webhook_events
                SET processing_status = $2,
                    processed_at = now(),
                    error_message = CASE WHEN $2 = 'succeeded' THEN NULL ELSE error_message END
              WHERE id = $1
              RETURNING id, stripe_event_id, processing_status, processed_at`,
            [id, status]
        );
        return rows[0] || null;
    } catch (err) {
        throw mapDbError(err);
    }
};

module.exports = {
    handleStripeWebhook,
    dispatchStripeEvent,
    markStripeEventProcessed,
    markStripeEventStatus,
};
