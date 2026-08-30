// ============================================================================
// WHAT THIS SERVER NEEDS TO BE A REAL SERVER.
//
// Every one of these was already read somewhere in the codebase, and every one
// of them failed QUIETLY when unset — which is the problem this file exists to
// solve. The failures were not crashes; they were worse:
//
//   APP_PUBLIC_URL     unset -> every email links to http://localhost:5173.
//                      The mail sends, the link is dead, and nobody finds out
//                      until a contestant says they cannot open their prompt.
//   GEOCODIO_API_KEY   unset -> address resolution throws on first use, so
//                      "see what you qualify for" breaks for everyone while
//                      the rest of the site looks fine.
//   NODE_ENV           not 'production' -> /forgot-password RETURNS THE RESET
//                      TOKEN in its JSON body. That is a dev affordance and an
//                      account-takeover hole anywhere else.
//   EMAIL_API_KEY      unset -> notify.js sets EMAIL_ENABLED = false and every
//                      send becomes a no-op. Nothing logs. Nothing errors.
//
// A boot that refuses is recoverable in a minute. A boot that succeeds with a
// silently broken half is a bug report three days later from a stranger.
//
// PAIRS ARE CHECKED AS PAIRS. Twitch credentials and R2 credentials are each
// useless in halves — a client secret with no client id, or object-store keys
// with no bucket, is a configuration that looks present and cannot work. The
// pair rules below catch exactly the state a half-filled dashboard produces.
// ============================================================================

// Required whenever NODE_ENV is 'production'. In development an absent value is
// a legitimate "I am not working on that today".
const REQUIRED_IN_PRODUCTION = [
    ["DATABASE_URL", "the Postgres connection string"],
    ["JWT_SECRET", "signs access tokens — 32+ random chars"],
    ["JWT_REFRESH_SECRET", "signs refresh tokens — must differ from JWT_SECRET"],
    ["INTERNAL_API_SECRET", "the x-internal-secret header for cron/internal routes"],
    ["APP_PUBLIC_URL", "the site's own address — every emailed link is built from it"],
];

// Warned about, never fatal. These disable a FEATURE rather than break the
// server, and a deployment that deliberately runs without payments or without
// Twitch is a real thing somebody may want.
const RECOMMENDED = [
    ["EMAIL_API_KEY", "without it no email is sent at all — silently"],
    ["GEOCODIO_API_KEY", "address -> district resolution; the WouldBe office feed needs it"],
    ["STRIPE_SECRET_KEY", "payments are inert without it"],
];

// [name, ...siblings] — if ANY of the group is set, ALL must be.
const PAIRS = [
    ["Twitch", ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_OAUTH_REDIRECT_URI"]],
    ["Twitch EventSub", ["TWITCH_EVENTSUB_SECRET", "TWITCH_EVENTSUB_CALLBACK_URL"]],
    ["Cloudflare R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
    ["Stripe", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]],
];

const has = (k) => !!(process.env[k] && String(process.env[k]).trim());

const checkEnv = ({ exitOnFailure = true } = {}) => {
    const isProd = process.env.NODE_ENV === "production";
    const fatal = [];
    const warn = [];

    if (isProd) {
        for (const [key, why] of REQUIRED_IN_PRODUCTION) {
            if (!has(key)) fatal.push(`${key} — ${why}`);
        }
        // The two token secrets being EQUAL means a refresh token is accepted
        // as an access token, which quietly removes the point of having two.
        if (has("JWT_SECRET") && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
            fatal.push("JWT_REFRESH_SECRET is identical to JWT_SECRET — a refresh token would pass as an access token");
        }
        // A localhost public URL in production is the single most likely
        // misconfiguration here, and it is invisible until a link is clicked.
        if (has("APP_PUBLIC_URL") && /localhost|127\.0\.0\.1/.test(process.env.APP_PUBLIC_URL)) {
            fatal.push(`APP_PUBLIC_URL points at ${process.env.APP_PUBLIC_URL} — emailed links would go nowhere`);
        }
    } else {
        // Loud, because leaving this unset in a deployed environment is what
        // exposes the password-reset token.
        warn.push("NODE_ENV is not 'production' — /forgot-password will return the reset token in its response");
    }

    for (const [key, why] of RECOMMENDED) {
        if (!has(key)) warn.push(`${key} is unset — ${why}`);
    }

    for (const [label, group] of PAIRS) {
        const set = group.filter(has);
        if (set.length && set.length < group.length) {
            const missing = group.filter((k) => !has(k));
            warn.push(`${label} is half-configured — set ${missing.join(", ")} or unset the rest`);
        }
    }

    if (warn.length) {
        console.warn("\n⚠  configuration warnings:");
        for (const w of warn) console.warn(`   · ${w}`);
        console.warn("");
    }

    if (fatal.length) {
        console.error("\n✖ FATAL: this server cannot start in production without:");
        for (const f of fatal) console.error(`   · ${f}`);
        console.error("");
        // Returned rather than thrown when the caller wants to inspect it —
        // the boot path exits, a test does not.
        if (exitOnFailure) process.exit(1);
    }

    return { fatal, warn, ok: fatal.length === 0 };
};

module.exports = { checkEnv, REQUIRED_IN_PRODUCTION, RECOMMENDED, PAIRS };
