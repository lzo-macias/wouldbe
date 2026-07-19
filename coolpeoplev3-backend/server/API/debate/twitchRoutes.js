const express = require("express");

const {
    upsertTwitchConnection,
    verifyVodStorage,
    createEventSubSubscription,
    deleteEventSubSubscription,
    handleEventSubWebhook,
} = require("../../DB/debate/twitch");
const twitch = require("../../services/twitch");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireInternal,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// Twitch livestream routes — Debate Update [DB §4].
//   GET    /api/twitch/oauth/start           (auth)     → Twitch authorize URL
//   GET    /api/twitch/oauth/callback        (auth)     → upsertTwitchConnection
//   POST   /api/twitch/connection/verify-vod (auth)     → verifyVodStorage
//   POST   /api/admin/twitch/eventsub        (admin)    → create subscription
//   DELETE /api/admin/twitch/eventsub/:id    (admin)    → delete subscription
//   POST   /api/internal/twitch/eventsub     (Twitch)   → signed webhook
//
// All Twitch network I/O lives behind the service adapter, which throws 503 until
// TWITCH_CLIENT_ID/SECRET (+ EventSub secret) are configured — that 503 flows out
// to the caller unchanged. Per-handler try/catch forwards everything to next(err).
// ============================================================================

// GET /api/twitch/oauth/start — the URL the client should redirect the user to in
// order to grant our app channel access. Built from env config; 503 (mirroring the
// adapter) when Twitch isn't configured so the client gets a consistent signal.
router.get("/twitch/oauth/start", requireAuth, async (req, res, next) => {
    try {
        const clientId = process.env.TWITCH_CLIENT_ID;
        const redirectUri = process.env.TWITCH_OAUTH_REDIRECT_URI || req.query.redirect_uri;
        if (!twitch.ENABLED || !clientId || !redirectUri) {
            return res.status(503).json({
                error: "Twitch is not configured — set TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET",
            });
        }
        // Scopes needed to read the channel's streams/VODs for EventSub + storage.
        const scope = ["user:read:email", "channel:read:stream_key"].join(" ");
        const url =
            "https://id.twitch.tv/oauth2/authorize?" +
            new URLSearchParams({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: "code",
                scope,
            }).toString();
        return res.json({ url });
    } catch (err) {
        next(err);
    }
});

// GET /api/twitch/oauth/callback — Twitch redirects back here with ?code=. We hand
// the code to the DB layer, which exchanges it for tokens and upserts the row.
// Accepts ?developer_tos_accepted=true to stamp the ToS gate at link time.
router.get("/twitch/oauth/callback", requireAuth, async (req, res, next) => {
    try {
        const connection = await upsertTwitchConnection({
            user_id: req.user.id,
            code: req.query.code,
            redirect_uri: process.env.TWITCH_OAUTH_REDIRECT_URI || req.query.redirect_uri || null,
            developer_tos_accepted:
                req.query.developer_tos_accepted === "true" ||
                req.query.developer_tos_accepted === true,
        });
        return res.status(201).json(connection);
    } catch (err) {
        next(err);
    }
});

// POST /api/twitch/connection/verify-vod — flip vod_storage_verified_at for the
// caller's connection after their first stream/VOD is confirmed.
router.post("/twitch/connection/verify-vod", requireAuth, async (req, res, next) => {
    try {
        const connection = await verifyVodStorage({ user_id: req.user.id });
        return res.json(connection);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/twitch/eventsub — create a stream.online/offline subscription.
router.post(
    "/admin/twitch/eventsub",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_twitch_eventsub", { resourceType: "twitch_eventsub_subscriptions" }),
    async (req, res, next) => {
        try {
            const sub = await createEventSubSubscription({
                subscription_type: req.body.subscription_type,
                broadcaster_user_id: req.body.broadcaster_user_id,
                twitch_connection_id: req.body.twitch_connection_id || null,
                callback: req.body.callback || process.env.TWITCH_EVENTSUB_CALLBACK_URL || null,
            });
            return res.status(201).json(sub);
        } catch (err) {
            next(err);
        }
    }
);

// DELETE /api/admin/twitch/eventsub/:id — remove a subscription (Twitch + our row).
router.delete(
    "/admin/twitch/eventsub/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("delete_twitch_eventsub", { resourceType: "twitch_eventsub_subscriptions" }),
    async (req, res, next) => {
        try {
            const removed = await deleteEventSubSubscription({ id: req.params.id });
            return res.json(removed);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/internal/twitch/eventsub — Twitch's signed EventSub callback. NO
// requireAuth: Twitch is the caller and authenticates via the HMAC signature
// (verified inside handleEventSubWebhook). requireInternal additionally requires
// the x-internal-secret header — set it on the EventSub callback URL config so
// only our configured webhook can reach this even before the HMAC check.
//
// RAW BODY: the HMAC is computed over the exact request bytes, so this route uses
// a route-level express.raw() parser to capture the unparsed body as a Buffer in
// req.body. The handler reads it via req.rawBody (preferred, if an upstream verify
// hook set it) falling back to that Buffer. NOTE: the app's global express.json()
// runs first; this raw parser is scoped to this route's content type so the bytes
// stay intact for the signature check.
router.post(
    "/internal/twitch/eventsub",
    requireInternal,
    express.raw({ type: () => true }),
    async (req, res, next) => {
        try {
            // req.rawBody if a global verify hook captured it; else the Buffer that
            // route-level express.raw() just parsed into req.body.
            const rawBody = req.rawBody ?? req.body;
            const result = await handleEventSubWebhook({
                headers: req.headers,
                rawBody,
            });
            if (result.contentType) res.type(result.contentType);
            return res.status(result.status).send(result.body);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
