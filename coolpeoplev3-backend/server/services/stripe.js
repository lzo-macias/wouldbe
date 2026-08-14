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

// retrievePaymentIntent — read a PaymentIntent back from Stripe. Used to confirm
// a payment SERVER-SIDE: the browser reports "it succeeded", and we go ask Stripe
// whether that's true before recording anything. Trusting the client here would
// let anyone mark their own debate as paid with a crafted request.
const retrievePaymentIntent = async ({ payment_intent_id } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.paymentIntents.retrieve(payment_intent_id);
};

// updatePaymentIntent — change an UNCONFIRMED intent's amount/metadata. Lets a
// sponsor switch tiers without stranding a PaymentIntent per click. Stripe
// rejects this once the intent has succeeded, which is the correct guard.
const updatePaymentIntent = async ({ payment_intent_id, amount_cents, metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.paymentIntents.update(payment_intent_id, { amount: amount_cents, metadata });
};

const createRefund = async ({ payment_intent_id, amount_cents } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.refunds.create({ payment_intent: payment_intent_id, amount: amount_cents });
};

// ---- save-now / charge-later (sponsor payment mandate) ----------------------
// The pair behind "collect the card at submission, charge it when an admin
// approves". A SetupIntent moves NO money and places NO authorization hold, so
// it has no expiry — unlike a manual-capture PaymentIntent, whose card
// authorization dies in ~7 days and would void itself if review ran long.

const createCustomer = async ({ email = null, name = null, metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.customers.create({ email, name, metadata });
};

// usage: 'off_session' is what lets the saved card be charged later with no
// cardholder present. Stripe requires the amount + timing be disclosed to the
// customer at this point; we record that disclosure as the mandate.
const createSetupIntent = async ({ customer, metadata = {} } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.setupIntents.create({ customer, usage: "off_session", metadata });
};

// chargeSavedPaymentMethod — the approval-time charge. confirm:true executes
// immediately; off_session:true tells Stripe no one is at the keyboard, which
// also makes it surface `authentication_required` instead of silently hanging
// when the issuer wants 3DS. Callers must handle that by asking the sponsor to
// re-confirm on-session.
const chargeSavedPaymentMethod = async ({
    amount_cents,
    currency = "usd",
    customer,
    payment_method,
    metadata = {},
} = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.paymentIntents.create({
        amount: amount_cents,
        currency,
        customer,
        payment_method,
        off_session: true,
        confirm: true,
        metadata,
    });
};

// detachPaymentMethod — on denial we never charge, so drop the saved card
// rather than keeping a chargeable method on file for a debate that won't run.
const detachPaymentMethod = async ({ payment_method_id } = {}) => {
    if (!ENABLED) throw notConfigured();
    return stripe.paymentMethods.detach(payment_method_id);
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
    retrievePaymentIntent,
    updatePaymentIntent,
    createRefund,
    createCustomer,
    createSetupIntent,
    chargeSavedPaymentMethod,
    detachPaymentMethod,
    createSubscription,
    cancelSubscription,
    createConnectAccount,
    createAccountLink,
    createTransfer,
    constructWebhookEvent,
};
