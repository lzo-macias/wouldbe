// ============================================================================
// Twitch service adapter — OAuth + EventSub for the debate livestream layer.
// Inert until TWITCH_CLIENT_ID/SECRET are set — every network call throws 503
// ("not configured") so routes return a clear signal instead of half-working.
//
// Network I/O uses the global `fetch` (Node 18+). App-level EventSub calls use an
// APP access token (client_credentials), cached until just before expiry; the
// OAuth user flow uses the per-user code exchange.
//
// SECURITY: OAuth tokens returned by exchangeOAuthCode/refreshToken must be
// ENCRYPTED AT REST before they hit twitch_connections (the DB layer flags the
// single write site with a TODO — wire a crypto helper + KMS/secret key there).
// ============================================================================
require("dotenv").config();
const crypto = require("crypto");

const ENABLED = !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);

const TWITCH_OAUTH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX = "https://api.twitch.tv/helix";

const notConfigured = (what = "Twitch") => {
    const e = new Error(`${what} is not configured — set TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET`);
    e.status = 503;
    return e;
};

// Map a non-2xx Twitch response to an httpError. Prefers Twitch's own message,
// clamps the status into the 4xx/5xx range (defaulting to 502 Bad Gateway since
// the failure originates upstream, not from our caller).
const upstreamError = (message, status, detail) => {
    const extra = detail && (detail.message || detail.error);
    const e = new Error(extra ? `${message}: ${extra}` : message);
    e.status = status >= 400 && status < 600 ? status : 502;
    return e;
};

// Parse a fetch Response as JSON, tolerating an empty/non-JSON body (204s, error
// pages) by returning {}.
const readJson = async (res) => {
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    } catch (_e) {
        return {};
    }
};

// ---------------------------------------------------------------------------
// App access token (client_credentials) — needed to create/delete EventSub subs.
// Cached in-process until 60s before expiry to avoid re-minting on every call.
// ---------------------------------------------------------------------------
let appTokenCache = { token: null, expiresAt: 0 };

const getAppAccessToken = async () => {
    if (!ENABLED) throw notConfigured();
    if (appTokenCache.token && Date.now() < appTokenCache.expiresAt) {
        return appTokenCache.token;
    }
    const body = new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
    });
    const res = await fetch(TWITCH_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = await readJson(res);
    if (!res.ok || !json.access_token) {
        throw upstreamError("Twitch app-token request failed", res.status, json);
    }
    appTokenCache = {
        token: json.access_token,
        // Refresh a minute early so an in-flight request never races expiry.
        expiresAt: Date.now() + Math.max(0, (Number(json.expires_in) || 3600) - 60) * 1000,
    };
    return appTokenCache.token;
};

// getUserIdentity(accessToken) — Twitch's token response carries NO identity, so
// we call Helix /users with the freshly-minted user token to get the channel's
// id/login/display_name (what twitch_connections needs).
const getUserIdentity = async (accessToken) => {
    const res = await fetch(`${TWITCH_HELIX}/users`, {
        headers: {
            "Client-Id": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${accessToken}`,
        },
    });
    const json = await readJson(res);
    if (!res.ok) throw upstreamError("Twitch user lookup failed", res.status, json);
    const user = json?.data?.[0];
    if (!user?.id) throw upstreamError("Twitch returned no user identity", 502, json);
    return user;
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// exchangeOAuthCode — trade the authorization `code` for tokens, then look up the
// channel identity. Returns the shape upsertTwitchConnection expects:
//   { twitch_user_id, login, display_name, access_token, refresh_token,
//     scope: string[], expires_in }
const exchangeOAuthCode = async ({ code, redirect_uri } = {}) => {
    if (!ENABLED) throw notConfigured();
    if (!code) {
        const e = new Error("code is required");
        e.status = 400;
        throw e;
    }
    const redirect = redirect_uri || process.env.TWITCH_OAUTH_REDIRECT_URI;
    const body = new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirect,
    });
    const res = await fetch(TWITCH_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = await readJson(res);
    if (!res.ok || !json.access_token) {
        throw upstreamError("Twitch OAuth code exchange failed", res.status, json);
    }
    const identity = await getUserIdentity(json.access_token);
    return {
        twitch_user_id: identity.id,
        login: identity.login ?? null,
        display_name: identity.display_name ?? null,
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? null,
        scope: Array.isArray(json.scope) ? json.scope : [],
        expires_in: json.expires_in ?? null,
    };
};

// refreshToken — mint a new user access/refresh token pair from a refresh token.
// Returns { access_token, refresh_token, scope: string[], expires_in }.
const refreshToken = async ({ refresh_token } = {}) => {
    if (!ENABLED) throw notConfigured();
    if (!refresh_token) {
        const e = new Error("refresh_token is required");
        e.status = 400;
        throw e;
    }
    const body = new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token,
    });
    const res = await fetch(TWITCH_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = await readJson(res);
    if (!res.ok || !json.access_token) {
        throw upstreamError("Twitch token refresh failed", res.status, json);
    }
    return {
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? refresh_token,
        scope: Array.isArray(json.scope) ? json.scope : [],
        expires_in: json.expires_in ?? null,
    };
};

// ---------------------------------------------------------------------------
// EventSub
// ---------------------------------------------------------------------------

// createEventSubSubscription — register a webhook-transport subscription (e.g.
// stream.online / stream.offline). Uses the app token; the webhook `secret` is
// TWITCH_EVENTSUB_SECRET (the same secret verifyEventSubSignature checks inbound
// deliveries against). Returns { id, status }.
const createEventSubSubscription = async ({ type, condition, callback } = {}) => {
    if (!ENABLED) throw notConfigured();
    if (!process.env.TWITCH_EVENTSUB_SECRET) throw notConfigured("Twitch EventSub");
    const cb = callback || process.env.TWITCH_EVENTSUB_CALLBACK_URL;
    if (!cb) {
        const e = new Error("EventSub callback URL is required — set TWITCH_EVENTSUB_CALLBACK_URL or pass callback");
        e.status = 400;
        throw e;
    }
    const appToken = await getAppAccessToken();
    const res = await fetch(`${TWITCH_HELIX}/eventsub/subscriptions`, {
        method: "POST",
        headers: {
            "Client-Id": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${appToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            type,
            version: "1",
            condition,
            transport: {
                method: "webhook",
                callback: cb,
                secret: process.env.TWITCH_EVENTSUB_SECRET,
            },
        }),
    });
    const json = await readJson(res);
    if (!res.ok) throw upstreamError("Twitch EventSub create failed", res.status, json);
    const sub = json?.data?.[0];
    if (!sub?.id) throw upstreamError("Twitch returned no subscription", 502, json);
    return { id: sub.id, status: sub.status };
};

// deleteEventSubSubscription — remove a subscription by its Twitch id. Twitch
// answers 204 on success; anything else is surfaced as an upstream error.
const deleteEventSubSubscription = async ({ id } = {}) => {
    if (!ENABLED) throw notConfigured();
    if (!id) {
        const e = new Error("id is required");
        e.status = 400;
        throw e;
    }
    const appToken = await getAppAccessToken();
    const res = await fetch(
        `${TWITCH_HELIX}/eventsub/subscriptions?id=${encodeURIComponent(id)}`,
        {
            method: "DELETE",
            headers: {
                "Client-Id": process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${appToken}`,
            },
        }
    );
    if (res.status !== 204) {
        const json = await readJson(res);
        throw upstreamError("Twitch EventSub delete failed", res.status, json);
    }
    return { id, deleted: true };
};

// verifyEventSubSignature — validate the HMAC Twitch signs each delivery with:
//   sig = 'sha256=' + HMAC_SHA256(secret, messageId + timestamp + rawBody)
// compared timing-safely to the Twitch-Eventsub-Message-Signature header. Returns
// a boolean (the DB layer turns a false into a 403). Needs the RAW request bytes.
const verifyEventSubSignature = ({ headers = {}, rawBody } = {}) => {
    if (!ENABLED || !process.env.TWITCH_EVENTSUB_SECRET) throw notConfigured("Twitch EventSub");
    const h = (name) => headers[name] ?? headers[name.toLowerCase()] ?? null;
    const messageId = h("Twitch-Eventsub-Message-Id");
    const timestamp = h("Twitch-Eventsub-Message-Timestamp");
    const theirSig = h("Twitch-Eventsub-Message-Signature");
    if (!messageId || !timestamp || !theirSig) return false;

    const body = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(String(rawBody ?? ""), "utf8");
    const message = Buffer.concat([Buffer.from(messageId + timestamp, "utf8"), body]);
    const expected =
        "sha256=" +
        crypto.createHmac("sha256", process.env.TWITCH_EVENTSUB_SECRET).update(message).digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(theirSig, "utf8");
    // timingSafeEqual throws on length mismatch — guard first so a wrong-length
    // forgery returns false instead of raising.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

module.exports = {
    ENABLED,
    getAppAccessToken,
    exchangeOAuthCode,
    refreshToken,
    createEventSubSubscription,
    deleteEventSubSubscription,
    verifyEventSubSignature,
};
