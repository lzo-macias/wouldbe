import { loadStripe } from "@stripe/stripe-js";

// One Stripe.js instance for the whole app (loadStripe is memoized upstream, but
// keeping a single promise avoids re-initializing on every render). The
// publishable key is client-safe and comes from VITE_STRIPE_PUBLISHABLE_KEY.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
