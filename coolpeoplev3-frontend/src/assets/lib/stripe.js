import { loadStripe } from "@stripe/stripe-js";

// One Stripe.js instance for the whole app (loadStripe is memoized upstream, but
// keeping a single promise avoids re-initializing on every render). The
// publishable key is client-safe and comes from VITE_STRIPE_PUBLISHABLE_KEY.
//
// The key is checked here rather than passed straight through: loadStripe("")
// throws an IntegrationError inside a promise nobody awaits, so <Elements> just
// never resolves a Stripe instance and every card button sits disabled forever —
// a spinner with no error. Exporting null instead lets a caller say so out loud.
const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const stripeConfigured = Boolean(publishableKey);

export const stripePromise = stripeConfigured ? loadStripe(publishableKey) : null;
