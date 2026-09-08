const { findUserByToken } = require("../DB/platform/auth");

// ============================================================================
// preLaunchGate — the closed-beta lock.
//
// WHY THIS EXISTS. The raise at /fund sends strangers to the domain, and the
// rest of the app is not ready to be read by them: GET /api/wouldbes,
// /api/debates, /api/posts and /api/politicians all answered 200 to anyone with
// the URL. A funder following a link could browse every campaign, every debate
// and every candidate before launch.
//
// WHY IT IS ONE MIDDLEWARE AND NOT 200 requireAuth CALLS. Those endpoints are
// SUPPOSED to be public — this is a platform for public campaigns, and on launch
// day a voter must be able to read a candidate's positions without an account.
// Sprinkling requireAuth across forty routers would encode "closed" as the
// permanent permission model and leave someone to unpick all of it later, almost
// certainly missing some. This is a temporary state, so it is expressed as a
// temporary, single-switch thing.
//
// HOW TO LIFT IT. Set PRELAUNCH_LOCK=off in .env. It is ON by default and by
// design: the failure mode of forgetting the flag should be "locked", never
// "the whole app was public and nobody noticed".
//
// WHAT IT IS NOT. It is not authorization. Every route keeps its own
// requireAuth / requireAdmin / requireAttestation — this runs BEFORE them and
// only answers "may this person see the app at all". Removing it must never
// make a privileged route reachable, which is why it is mounted as a gate in
// front, not as a replacement for anything.
// ============================================================================

const LOCKED = String(process.env.PRELAUNCH_LOCK || "").toLowerCase() !== "off";

// Paths that stay reachable with no session, because locking them would break
// the very thing the lock is protecting.
//
// Each entry is [method, exact path] or [method, prefix + '*'].
const ALLOW = [
    // --- the raise. The entire point of the gate is that these still work. ---
    ["POST", "/api/fund/pledges"],
    ["GET", "/api/fund/summary"],
    // The publishable key. Without this the payment step cannot mount for a
    // logged-out backer, which is every backer.
    ["GET", "/api/fund/config"],

    // --- getting IN. A login page that cannot call login is a locked door with
    //     no handle. ---
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/signup"],
    ["POST", "/api/auth/refresh"],
    ["POST", "/api/auth/forgot-password"],
    ["POST", "/api/auth/reset-password"],

    // --- WEBHOOKS. These authenticate by HMAC SIGNATURE, not by a bearer token,
    //     so a token check here would reject Stripe and Twitch outright and
    //     silently break payment settlement. They are not "public": each one
    //     verifies its own signature and rejects anything unsigned. ---
    ["POST", "/api/internal/stripe/webhook"],
    ["POST", "/api/internal/twitch/eventsub"],

    // --- Terms and Privacy are linked from the public /fund footer. ---
    ["GET", "/api/legal-docs*"],
];

function allowed(method, path) {
    return ALLOW.some(([m, p]) =>
        m === method &&
        (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p)
    );
}

const preLaunchGate = async (req, res, next) => {
    if (!LOCKED) return next();
    // Only /api is gated. Anything else on this origin is not ours to judge.
    if (!req.path.startsWith("/api")) return next();
    // CORS preflight carries no Authorization header by definition; rejecting it
    // makes every cross-origin call fail as a CORS error rather than a 401,
    // which is a genuinely miserable thing to debug.
    if (req.method === "OPTIONS") return next();
    if (allowed(req.method, req.path)) return next();

    try {
        const user = await findUserByToken(req.headers.authorization);
        if (!user) {
            return res.status(401).json({
                error: "WouldBe is in closed beta. Sign in to continue.",
                code: "prelaunch_locked",
            });
        }
        // Hand the resolved user downstream. requireAuth will look it up again
        // on routes that use it — that is deliberate duplication: this gate must
        // stay removable without quietly turning off authentication anywhere.
        req.preLaunchUser = user;
        return next();
    } catch {
        return res.status(401).json({
            error: "WouldBe is in closed beta. Sign in to continue.",
            code: "prelaunch_locked",
        });
    }
};

module.exports = { preLaunchGate, PRELAUNCH_LOCKED: LOCKED };
