const { client, withTransaction } = require("../index.js");
const twitch = require("../../services/twitch");

// ============================================================================
// Twitch livestream integration (DB layer) — Debate Update [DB §4].
//
// Tables owned here (see migrations/1780700000000_debate-update.js):
//   twitch_connections           — per-user OAuth account link + onboarding gates
//   twitch_eventsub_subscriptions — the stream.online/offline subs we hold
//   twitch_eventsub_events       — idempotent inbound webhook log (message_id uniq)
//   debate_streams               — the debate's scheduled/live concluding stream
//
// All Twitch network I/O goes through the service adapter (server/services/
// twitch.js): OAuth exchange, EventSub create/delete, and HMAC verification. The
// adapter throws a 503 until TWITCH_CLIENT_ID/SECRET (+ EventSub secret) are set —
// that is expected in dev and surfaces straight to the caller.
//
// SECURITY: OAuth access/refresh tokens land in twitch_connections as text. They
// MUST be encrypted at rest before production (app-level crypto + KMS/secret key).
// The single place that writes them is flagged with a TODO below.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Map a raw pg error to an httpError. Shared by every catch here. Callers do
// `if (err.status) throw err;` first so already-mapped errors pass through.
const mapPgError = (err) => {
    if (err.code === "23505") return httpError(409, "that record already exists");
    if (err.code === "23503") return httpError(400, "a referenced row does not exist");
    if (err.code === "23514") return httpError(400, "a value violates an allowed-values check");
    if (err.code === "22P02") return httpError(400, "a uuid/enum field is malformed");
    return null;
};

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

// upsertTwitchConnection — exchange the OAuth `code` for tokens via the adapter,
// then upsert the caller's twitch_connections row (one per user). Stores the
// channel identity + tokens + scopes/expiry. developer_tos_accepted_at is
// stamped when the caller asserts they accepted the Twitch Dev ToS + our license.
//
// The OAuth exchange happens OUTSIDE the DB write so a Twitch 503/4xx never
// leaves a half-written row.
const upsertTwitchConnection = async ({
    user_id,
    code,
    redirect_uri = null,
    developer_tos_accepted = false,
}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!code) throw httpError(400, "code is required");

    // Adapter throws 503 until Twitch is configured — let it surface.
    const tokens = await twitch.exchangeOAuthCode({ code, redirect_uri });
    // Expected adapter shape: { twitch_user_id, login, display_name,
    //   access_token, refresh_token, scope (string[]), expires_in (seconds) }.
    const {
        twitch_user_id,
        login = null,
        display_name = null,
        access_token = null,
        refresh_token = null,
        scope = [],
        expires_in = null,
    } = tokens || {};

    if (!twitch_user_id) {
        throw httpError(502, "Twitch did not return a user id");
    }

    const token_expires_at =
        expires_in != null ? new Date(Date.now() + Number(expires_in) * 1000) : null;
    const scopes = Array.isArray(scope) ? scope : [];

    try {
        // TODO: encrypt OAuth tokens at rest — access_token/refresh_token below are
        // written as plaintext for now; wrap them in app-level crypto (KMS/secret
        // key) before production. Do not store plaintext long-term.
        const SQL = `
            INSERT INTO twitch_connections
                (user_id, twitch_user_id, twitch_login, twitch_display_name,
                 access_token, refresh_token, scopes, token_expires_at,
                 developer_tos_accepted_at, connected_at, disconnected_at, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8,
                 CASE WHEN $9 THEN NOW() ELSE NULL END, NOW(), NULL, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                twitch_user_id            = EXCLUDED.twitch_user_id,
                twitch_login              = EXCLUDED.twitch_login,
                twitch_display_name       = EXCLUDED.twitch_display_name,
                access_token              = EXCLUDED.access_token,
                refresh_token             = EXCLUDED.refresh_token,
                scopes                    = EXCLUDED.scopes,
                token_expires_at          = EXCLUDED.token_expires_at,
                developer_tos_accepted_at = COALESCE(twitch_connections.developer_tos_accepted_at,
                                                     EXCLUDED.developer_tos_accepted_at),
                disconnected_at           = NULL,
                updated_at                = NOW()
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            user_id,
            twitch_user_id,
            login,
            display_name,
            access_token,
            refresh_token,
            scopes,
            token_expires_at,
            !!developer_tos_accepted,
        ]);
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        // twitch_user_id is unique too — a 23505 here means another user already
        // linked that Twitch account.
        if (err.code === "23505") throw httpError(409, "that Twitch account is already linked");
        const mapped = mapPgError(err);
        if (mapped) throw mapped;
        console.error(err);
        throw err;
    }
};

// getTwitchConnectionByUser — the caller's connection (or null).
const getTwitchConnectionByUser = async ({ user_id }) => {
    const SQL = `SELECT * FROM twitch_connections WHERE user_id = $1`;
    const result = await client.query(SQL, [user_id]);
    return result.rows[0] || null;
};

// verifyVodStorage — flip vod_storage_verified_at after the streamer's first
// stream/VOD is confirmed (the onboarding gate that we can actually store + replay
// their VODs). Idempotent: COALESCE keeps the original verification timestamp.
// Accepts the connection's own id OR the user_id.
const verifyVodStorage = async ({ id = null, user_id = null }) => {
    if (!id && !user_id) throw httpError(400, "id or user_id is required");
    try {
        const SQL = `
            UPDATE twitch_connections
            SET vod_storage_verified_at = COALESCE(vod_storage_verified_at, NOW()),
                updated_at = NOW()
            WHERE ($1::uuid IS NOT NULL AND id = $1)
               OR ($2::uuid IS NOT NULL AND user_id = $2)
            RETURNING *;
        `;
        const result = await client.query(SQL, [id, user_id]);
        if (!result.rows.length) throw httpError(404, "twitch connection not found");
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        const mapped = mapPgError(err);
        if (mapped) throw mapped;
        console.error(err);
        throw err;
    }
};

// ---------------------------------------------------------------------------
// EventSub subscriptions (admin)
// ---------------------------------------------------------------------------

// createEventSubSubscription — register a stream.online/offline subscription with
// Twitch (via the adapter) and persist the resulting twitch_eventsub_subscriptions
// row. The Twitch call happens first; only a successful create is recorded.
const createEventSubSubscription = async ({
    subscription_type,
    broadcaster_user_id,
    twitch_connection_id = null,
    callback = null,
}) => {
    if (!subscription_type) throw httpError(400, "subscription_type is required");
    if (!broadcaster_user_id) throw httpError(400, "broadcaster_user_id is required");

    // Adapter throws 503 until configured — surface it.
    const created = await twitch.createEventSubSubscription({
        type: subscription_type,
        condition: { broadcaster_user_id },
        callback,
    });
    // Expected adapter shape: { id, status }.
    const subscription_id = created?.id;
    const status = created?.status || "pending";
    if (!subscription_id) throw httpError(502, "Twitch did not return a subscription id");

    try {
        const SQL = `
            INSERT INTO twitch_eventsub_subscriptions
                (twitch_connection_id, subscription_id, subscription_type,
                 broadcaster_user_id, status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            twitch_connection_id,
            subscription_id,
            subscription_type,
            broadcaster_user_id,
            status,
        ]);
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        const mapped = mapPgError(err);
        if (mapped) throw mapped;
        console.error(err);
        throw err;
    }
};

// deleteEventSubSubscription — remove the subscription at Twitch (via adapter)
// then delete our row. `id` is the twitch_eventsub_subscriptions PK.
const deleteEventSubSubscription = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const found = await client.query(
            `SELECT * FROM twitch_eventsub_subscriptions WHERE id = $1`,
            [id]
        );
        const row = found.rows[0];
        if (!row) throw httpError(404, "eventsub subscription not found");

        // Adapter throws 503 until configured — surface it (row is left intact).
        await twitch.deleteEventSubSubscription({ id: row.subscription_id });

        const del = await client.query(
            `DELETE FROM twitch_eventsub_subscriptions WHERE id = $1 RETURNING *`,
            [id]
        );
        return del.rows[0];
    } catch (err) {
        if (err.status) throw err;
        const mapped = mapPgError(err);
        if (mapped) throw mapped;
        console.error(err);
        throw err;
    }
};

// ---------------------------------------------------------------------------
// Stream lifecycle (driven by EventSub)
// ---------------------------------------------------------------------------

// markStreamLive — a stream.online event arrived for a broadcaster. Flip the most
// recent matching debate_streams row to 'live' and stamp started_at. Returns the
// updated row (or null if no debate_streams row is tracking this broadcaster).
const markStreamLive = async ({ broadcaster_user_id, started_at = null }, db = client) => {
    if (!broadcaster_user_id) throw httpError(400, "broadcaster_user_id is required");
    const SQL = `
        UPDATE debate_streams
        SET status = 'live',
            started_at = COALESCE($2, NOW()),
            updated_at = NOW()
        WHERE id = (
            SELECT id FROM debate_streams
            WHERE twitch_broadcaster_user_id = $1
              AND status IN ('scheduled', 'offline')
            ORDER BY scheduled_at DESC NULLS LAST, created_at DESC
            LIMIT 1
        )
        RETURNING *;
    `;
    const result = await db.query(SQL, [broadcaster_user_id, started_at]);
    return result.rows[0] || null;
};

// markStreamOffline — a stream.offline event arrived. Flip the live debate_streams
// row to 'offline' and stamp ended_at. Returns the updated row (or null).
const markStreamOffline = async ({ broadcaster_user_id, ended_at = null }, db = client) => {
    if (!broadcaster_user_id) throw httpError(400, "broadcaster_user_id is required");
    const SQL = `
        UPDATE debate_streams
        SET status = 'offline',
            ended_at = COALESCE($2, NOW()),
            updated_at = NOW()
        WHERE id = (
            SELECT id FROM debate_streams
            WHERE twitch_broadcaster_user_id = $1
              AND status = 'live'
            ORDER BY started_at DESC NULLS LAST, created_at DESC
            LIMIT 1
        )
        RETURNING *;
    `;
    const result = await db.query(SQL, [broadcaster_user_id, ended_at]);
    return result.rows[0] || null;
};

// ---------------------------------------------------------------------------
// EventSub webhook
// ---------------------------------------------------------------------------

// handleEventSubWebhook — the single entry point for Twitch's signed callbacks.
//   1. Verify the HMAC signature over (message_id + timestamp + rawBody) via the
//      adapter. A bad signature is a 403.
//   2. webhook_callback_verification → echo the `challenge` back as text/plain.
//   3. notification → dedupe by Twitch-Eventsub-Message-Id into
//      twitch_eventsub_events (ON CONFLICT DO NOTHING). On a fresh row, route
//      stream.online → markStreamLive / stream.offline → markStreamOffline.
//   4. revocation → log it (no stream change).
//
// Returns { status, body, contentType? } for the route to send. rawBody MUST be
// the unparsed request bytes (Buffer/string) so the HMAC matches.
const handleEventSubWebhook = async ({ headers = {}, rawBody }) => {
    // Header lookup is case-insensitive in Node (lower-cased), but be defensive.
    const h = (name) => headers[name] ?? headers[name.toLowerCase()] ?? null;

    // 1) Signature — adapter throws 503 until configured; a forged/altered body
    //    returns false → 403.
    const ok = twitch.verifyEventSubSignature({ headers, rawBody });
    if (!ok) throw httpError(403, "invalid EventSub signature");

    const messageType = h("Twitch-Eventsub-Message-Type");
    const messageId = h("Twitch-Eventsub-Message-Id");

    let payload;
    try {
        payload = JSON.parse(
            Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "")
        );
    } catch (_e) {
        throw httpError(400, "EventSub body is not valid JSON");
    }

    // 2) Callback verification challenge — echo it back verbatim as text/plain.
    if (messageType === "webhook_callback_verification") {
        return { status: 200, body: payload.challenge ?? "", contentType: "text/plain" };
    }

    // 3) Revocation — Twitch tells us a subscription was killed. Just ack.
    if (messageType === "revocation") {
        return { status: 200, body: "" };
    }

    // 4) Notification.
    if (messageType === "notification") {
        const subType = payload?.subscription?.type || h("Twitch-Eventsub-Subscription-Type");
        const broadcaster_user_id =
            payload?.event?.broadcaster_user_id ||
            payload?.subscription?.condition?.broadcaster_user_id ||
            null;

        return await withTransaction(async (tx) => {
            // Dedupe: a replayed message_id is a no-op (ON CONFLICT DO NOTHING).
            const ins = await tx.query(
                `INSERT INTO twitch_eventsub_events
                     (message_id, subscription_type, broadcaster_user_id,
                      signature_verified, event_payload)
                 VALUES ($1, $2, $3, true, $4)
                 ON CONFLICT (message_id) DO NOTHING
                 RETURNING id;`,
                [messageId, subType, broadcaster_user_id, JSON.stringify(payload)]
            );

            // Already processed this delivery — ack without re-applying side effects.
            if (!ins.rows.length) {
                return { status: 200, body: "", duplicate: true };
            }

            // Apply the stream-state side effect inside the same tx.
            if (subType === "stream.online") {
                const startedAt = payload?.event?.started_at || null;
                const stream = await markStreamLive({ broadcaster_user_id, started_at: startedAt }, tx);
                if (stream) {
                    await tx.query(
                        `UPDATE twitch_eventsub_events SET debate_stream_id = $2 WHERE id = $1`,
                        [ins.rows[0].id, stream.id]
                    );
                }
            } else if (subType === "stream.offline") {
                const stream = await markStreamOffline({ broadcaster_user_id }, tx);
                if (stream) {
                    await tx.query(
                        `UPDATE twitch_eventsub_events SET debate_stream_id = $2 WHERE id = $1`,
                        [ins.rows[0].id, stream.id]
                    );
                }
            }

            return { status: 200, body: "" };
        });
    }

    // Unknown message type — ack so Twitch doesn't retry forever.
    return { status: 200, body: "" };
};

module.exports = {
    upsertTwitchConnection,
    getTwitchConnectionByUser,
    verifyVodStorage,
    createEventSubSubscription,
    deleteEventSubSubscription,
    markStreamLive,
    markStreamOffline,
    handleEventSubWebhook,
};
