// ============================================================================
// Stripe service adapter (SCAFFOLD).
// Every call is INERT until STRIPE_SECRET_KEY is set — it throws a 503
// "not configured" so routes return a clear error instead of silently pretending
// to move money. To go live: `npm i stripe`, set STRIPE_SECRET_KEY (+
// STRIPE_WEBHOOK_SECRET for the webhook), uncomment the `require`/client, and
// replace each `throw notConfigured()` with the real SDK call already written in
// the TODO above it. The DB + route layers that call these are fully built.
// ============================================================================
require("dotenv").config();

const ENABLED = !!process.env.STRIPE_SECRET_KEY;
const Stripe = require("stripe");
const stripe = ENABLED ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const notConfigured = (what = "Stripe") => {
    const e = new Error(`${what} is not configured — set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks)`);
    e.status = 503;
    return e;
};

const createPaymentIntent = async ({ amount_cents, currency = "usd", metadata = {}, customer } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.paymentIntents.create({ amount: amount_cents, currency, metadata, customer });
};

const createRefund = async ({ payment_intent_id, amount_cents } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.refunds.create({ payment_intent: payment_intent_id, amount: amount_cents });
};

const createSubscription = async ({ customer, price_id, metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.subscriptions.create({ customer, items: [{ price: price_id }], metadata });
};

const cancelSubscription = async ({ subscription_id, at_period_end = true } = {}) => {
    if (!ENABLED) throw notConfigured();
    return at_period_end
        ? stripe.subscriptions.update(subscription_id, { cancel_at_period_end: true })
        : stripe.subscriptions.cancel(subscription_id);
};

// Stripe Connect (payout accounts / KYC) + transfers (prize + sponsor payouts)
const createConnectAccount = async ({ email, country = "US", metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.accounts.create({ type: "express", email, country, metadata });
};

const createAccountLink = async ({ account_id, refresh_url, return_url } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.accountLinks.create({ account: account_id, refresh_url, return_url, type: "account_onboarding" });
};

const createTransfer = async ({ amount_cents, destination_account, currency = "usd", metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.transfers.create({ amount: amount_cents, currency, destination: destination_account, metadata });
};

// Webhook signature verification — needs the RAW request body (Buffer), so the
// webhook route must use express.raw(), NOT express.json().
const constructWebhookEvent = ({ rawBody, signature } = {}) => {
    if (!ENABLED || !process.env.STRIPE_WEBHOOK_SECRET) throw notConfigured("Stripe webhook");
    return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
};

module.exports = {
    ENABLED,
    createPaymentIntent,
    createRefund,
    createSubscription,
    cancelSubscription,
    createConnectAccount,
    createAccountLink,
    createTransfer,
    constructWebhookEvent,
};
