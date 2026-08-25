const express = require("express");

const { handleStripeWebhook } = require("../../DB/payments/stripeWebhook");

const router = express.Router();

// ============================================================================
// POST /internal/stripe/webhook — Stripe's webhook delivery endpoint.
//
// SECURITY: this is intentionally NOT behind requireAuth — Stripe (not a logged
// in user) calls it. Authenticity is established by the Stripe SIGNATURE, which
// constructWebhookEvent verifies against the RAW request body using
// STRIPE_WEBHOOK_SECRET. A failed verification returns 400.
//
// RAW BODY: signature verification needs the exact bytes Stripe sent — a parsed
// + re-serialized JSON body will not verify. We attach `express.raw()` as a
// route-level middleware so req.body is the original Buffer. If the orchestrator
// captures the raw body globally onto req.rawBody (e.g. via a verify hook on the
// global json parser), we prefer that. Either way we hand a Buffer/string to the
// verifier.
//
// NOTE: the global app.use(express.json()) parser will consume the stream first.
// For this route to receive the true raw bytes in production, the app must
// either (a) skip express.json() for this path, or (b) configure express.json
// with a `verify` callback that stashes the raw buffer on req.rawBody. This
// route reads req.rawBody first for exactly that reason, then falls back to the
// route-level express.raw() Buffer.
// ============================================================================
router.post(
    "/internal/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        try {
            // Prefer a globally-captured raw buffer; otherwise the express.raw
            // Buffer on req.body. Coerce to a Buffer/string the verifier accepts.
            let rawBody = req.rawBody;
            if (!rawBody) {
                rawBody = Buffer.isBuffer(req.body) ? req.body : null;
            }
            const signature = req.headers["stripe-signature"];

            const result = await handleStripeWebhook({ rawBody, signature });

            // Respond 200 quickly so Stripe stops retrying a verified event
            // (duplicates and handler-level failures are reconciled from the
            // stripe_webhook_events ledger, not via Stripe retries).
            return res.status(200).json({ received: true, ...result });
        } catch (err) {
            // Signature/verification failures (and missing-body 4xx) → 400 so
            // Stripe knows the delivery was rejected. A 503 (not configured)
            // surfaces its own status. We do NOT call next(err): the central
            // JSON error handler would otherwise translate this, but Stripe
            // expects a terminal status from this endpoint directly.
            const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
            return res.status(status === 503 ? 503 : 400).json({ error: err.message || "webhook error" });
        }
    }
);

module.exports = { router };
