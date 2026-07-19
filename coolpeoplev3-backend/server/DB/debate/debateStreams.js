const { client, withTransaction } = require("../index.js");
const r2 = require("../../services/r2");

// ============================================================================
// debate_streams / stream_recordings / stream_participant_consents
//
// The "concluding livestream" for a debate (Twitch). Two methods:
//   - 'embed'         (Method 1) — Twitch bears the hosting cost; we only embed.
//   - 'hybrid_record' (Method 2) — we ALSO keep our own copy on R2 with its own
//                                  moderation lifecycle + auto-delete window.
//
// The recording FILE lives in R2 (Cloudflare). We never store the bytes in PG —
// only the object key (stream_recordings.r2_object_key) + bucket + a playback url.
// ingest can hand back a presigned PUT (r2.getUploadUrl) so the relay/uploader
// writes straight to R2. purgeExpiredRecordings deletes the R2 object (by key)
// AND soft-deletes the row, both inside one transaction.
//
// Consent rows are append-only + carry ip/user_agent (legal record), like the
// other consent tables. One consent row per (debate_stream_id, user_id).
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// CHECK-backed enums (kept in sync with 1780700000000_debate-update.js).
const STREAM_METHODS = ["embed", "hybrid_record"];
const RECORDING_SOURCES = ["ingest_relay", "streamer_upload", "twitch_vod"];
const RECORDING_MODERATION_STATUSES = [
    "pending",
    "clearing",
    "published",
    "rejected",
    "removed",
];
const CONSENT_ROLES = ["host", "debater", "guest", "sponsor"];

// Map common PG errors → HTTP. Mirrors the house convention.
const mapPgError = (err) => {
    if (err.status) return err;
    if (err.code === "23505") return httpError(409, "already exists");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    if (err.code === "23514") return httpError(400, "violates a check constraint");
    if (err.code === "22P02") return httpError(400, "invalid input syntax");
    return err;
};

// ---- debate_streams --------------------------------------------------------

// scheduleDebateStream — create the debate's scheduled concluding stream
// (admin / sponsor). method defaults to 'embed'. embed_parent_domains feeds the
// iframe `parent` param for an embed (the #1 reason embeds black-box), so it is
// accepted here as a text[].
const scheduleDebateStream = async (
    {
        debate_id,
        method = "embed",
        twitch_connection_id = null,
        host_user_id = null,
        twitch_channel = null,
        twitch_broadcaster_user_id = null,
        embed_parent_domains = [],
        scheduled_at = null,
    },
    db = client
) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    if (!STREAM_METHODS.includes(method)) {
        throw httpError(400, `method must be one of: ${STREAM_METHODS.join(", ")}`);
    }
    try {
        const SQL = `
            INSERT INTO debate_streams
                (debate_id, twitch_connection_id, host_user_id, method,
                 twitch_channel, twitch_broadcaster_user_id, embed_parent_domains,
                 scheduled_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        const { rows } = await db.query(SQL, [
            debate_id,
            twitch_connection_id,
            host_user_id,
            method,
            twitch_channel,
            twitch_broadcaster_user_id,
            embed_parent_domains,
            scheduled_at,
        ]);
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// getDebateStream — the (latest) stream row for a debate, or null.
const getDebateStream = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    try {
        const { rows } = await client.query(
            `SELECT * FROM debate_streams
             WHERE debate_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [debate_id]
        );
        return rows[0] || null;
    } catch (err) {
        throw mapPgError(err);
    }
};

// ---- stream_recordings -----------------------------------------------------

// ingestStreamRecording — register a Method-2 R2 copy (internal). The file lives
// in R2; we store the object key (+ bucket / playback url). source defaults to
// 'ingest_relay'. When request_upload_url is set we mint a presigned PUT so the
// relay/uploader can write straight to R2 at r2_object_key — returned alongside
// the row as { recording, upload_url }. (r2.getUploadUrl throws 503 until R2 is
// configured — that surfaces to the caller, by design.)
const ingestStreamRecording = async ({
    debate_stream_id,
    debate_id,
    source = "ingest_relay",
    r2_bucket = null,
    r2_object_key = null,
    playback_url = null,
    duration_seconds = null,
    auto_delete_at = null,
    request_upload_url = false,
    upload_content_type = "video/mp4",
}) => {
    if (!debate_stream_id) throw httpError(400, "debate_stream_id is required");
    if (!debate_id) throw httpError(400, "debate_id is required");
    if (!RECORDING_SOURCES.includes(source)) {
        throw httpError(400, `source must be one of: ${RECORDING_SOURCES.join(", ")}`);
    }
    try {
        const SQL = `
            INSERT INTO stream_recordings
                (debate_stream_id, debate_id, source, r2_bucket, r2_object_key,
                 playback_url, duration_seconds, auto_delete_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        const { rows } = await client.query(SQL, [
            debate_stream_id,
            debate_id,
            source,
            r2_bucket,
            r2_object_key,
            playback_url,
            duration_seconds,
            auto_delete_at,
        ]);
        const recording = rows[0];

        let upload_url = null;
        if (request_upload_url) {
            if (!recording.r2_object_key) {
                throw httpError(400, "r2_object_key is required to mint an upload URL");
            }
            // throws 503 until R2 is configured (expected/scaffold behaviour).
            upload_url = await r2.getUploadUrl({
                key: recording.r2_object_key,
                contentType: upload_content_type,
            });
        }
        return { recording, upload_url };
    } catch (err) {
        throw mapPgError(err);
    }
};

// attachStreamerVod — link an external (streamer-owned) VOD as a recording row,
// source = 'streamer_upload' or 'twitch_vod' (defaults to 'twitch_vod'). There is
// no R2 object for an external VOD — only a playback_url. We also surface the VOD
// onto the parent debate_streams row (vod_video_id / vod_url) for the embed.
const attachStreamerVod = async ({
    debate_stream_id,
    debate_id,
    source = "twitch_vod",
    playback_url = null,
    vod_video_id = null,
    duration_seconds = null,
}) => {
    if (!debate_stream_id) throw httpError(400, "debate_stream_id is required");
    if (!debate_id) throw httpError(400, "debate_id is required");
    if (!["streamer_upload", "twitch_vod"].includes(source)) {
        throw httpError(400, "source must be 'streamer_upload' or 'twitch_vod'");
    }
    return withTransaction(async (tx) => {
        try {
            const ins = await tx.query(
                `INSERT INTO stream_recordings
                    (debate_stream_id, debate_id, source, playback_url, duration_seconds)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *;`,
                [debate_stream_id, debate_id, source, playback_url, duration_seconds]
            );
            const recording = ins.rows[0];

            await tx.query(
                `UPDATE debate_streams
                    SET vod_video_id = COALESCE($2, vod_video_id),
                        vod_url      = COALESCE($3, vod_url),
                        updated_at   = now()
                  WHERE id = $1`,
                [debate_stream_id, vod_video_id, playback_url]
            );
            return recording;
        } catch (err) {
            throw mapPgError(err);
        }
    });
};

// setRecordingModerationStatus — move a recording through its moderation
// lifecycle (admin / internal pipeline: FFmpeg → NudeNet → PhotoDNA → Perspective).
const setRecordingModerationStatus = async ({ id, status }) => {
    if (!id) throw httpError(400, "id is required");
    if (!RECORDING_MODERATION_STATUSES.includes(status)) {
        throw httpError(
            400,
            `status must be one of: ${RECORDING_MODERATION_STATUSES.join(", ")}`
        );
    }
    try {
        const { rows } = await client.query(
            `UPDATE stream_recordings
                SET moderation_status = $2,
                    updated_at        = now()
              WHERE id = $1
              RETURNING *;`,
            [id, status]
        );
        if (!rows.length) throw httpError(404, "recording not found");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// publishRecording — mark a recording public (admin). Only a cleared recording
// should be published; we set moderation_status='published' + published_at.
const publishRecording = async ({ id, playback_url = null }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `UPDATE stream_recordings
                SET moderation_status = 'published',
                    published_at      = now(),
                    playback_url      = COALESCE($2, playback_url),
                    updated_at        = now()
              WHERE id = $1
                AND deleted_at IS NULL
              RETURNING *;`,
            [id, playback_url]
        );
        if (!rows.length) throw httpError(404, "recording not found or deleted");
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

// purgeExpiredRecordings — cron/internal. Delete recordings whose auto_delete_at
// has passed (the end of the decision window) and that still hold an R2 object.
// For each: delete the R2 object by key, then soft-delete the row (deleted_at +
// moderation_status='removed', clear the key). Done inside one transaction so a
// row is never marked deleted while its bytes remain (and vice-versa). Returns a
// per-recording result list so the caller/cron can log partial failures.
const purgeExpiredRecordings = async ({ limit = 100 } = {}) => {
    return withTransaction(async (tx) => {
        // FOR UPDATE SKIP LOCKED so concurrent cron runs don't fight.
        const { rows: due } = await tx.query(
            `SELECT id, r2_object_key
               FROM stream_recordings
              WHERE auto_delete_at IS NOT NULL
                AND auto_delete_at <= now()
                AND deleted_at IS NULL
              ORDER BY auto_delete_at ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED`,
            [limit]
        );

        const results = [];
        for (const rec of due) {
            try {
                if (rec.r2_object_key) {
                    // throws 503 until R2 is configured (expected/scaffold behaviour).
                    await r2.deleteObject({ key: rec.r2_object_key });
                }
                const { rows } = await tx.query(
                    `UPDATE stream_recordings
                        SET deleted_at        = now(),
                            moderation_status = 'removed',
                            r2_object_key     = NULL,
                            updated_at        = now()
                      WHERE id = $1
                      RETURNING id;`,
                    [rec.id]
                );
                results.push({ id: rec.id, deleted: true, row: rows[0] });
            } catch (err) {
                // Re-throw so the whole transaction rolls back: we must not leave
                // a row marked deleted while its R2 object survives (or partially
                // commit some purges and not others within this batch).
                throw mapPgError(err);
            }
        }
        return { purged: results.length, results };
    });
};

// ---- stream_participant_consents -------------------------------------------

// recordStreamParticipantConsent — append the per-participant consent record for
// a stream (hosting/replay license, marketing/likeness release, group-stream /
// Guest Star consent, minor handling). user from the token; ip/user_agent from
// req.context (route uses captureRequestContext). One row per (stream, user) —
// re-consenting refreshes the timestamps rather than 409-ing.
const recordStreamParticipantConsent = async ({
    debate_stream_id,
    user_id,
    role,
    hosting_replay_license = false,
    marketing_release = false,
    group_stream_consent = false,
    is_minor = false,
    guardian_consent = false,
    consent_document_version = null,
    ip_address = null,
    user_agent = null,
}) => {
    if (!user_id) throw httpError(401, "authentication required");
    if (!debate_stream_id) throw httpError(400, "debate_stream_id is required");
    if (!CONSENT_ROLES.includes(role)) {
        throw httpError(400, `role must be one of: ${CONSENT_ROLES.join(", ")}`);
    }
    if (is_minor && !guardian_consent) {
        throw httpError(400, "guardian consent is required for a minor");
    }
    // Booleans → the timestamptz columns the table actually stores (now() when
    // granted, NULL when not).
    const tsHosting = hosting_replay_license ? "now()" : "NULL";
    const tsMarketing = marketing_release ? "now()" : "NULL";
    const tsGroup = group_stream_consent ? "now()" : "NULL";
    const tsGuardian = guardian_consent ? "now()" : "NULL";
    try {
        const SQL = `
            INSERT INTO stream_participant_consents
                (debate_stream_id, user_id, role,
                 hosting_replay_license_at, marketing_release_at,
                 group_stream_consent_at, is_minor, guardian_consent_at,
                 consent_document_version, ip_address, user_agent)
            VALUES ($1, $2, $3, ${tsHosting}, ${tsMarketing}, ${tsGroup}, $4, ${tsGuardian}, $5, $6, $7)
            ON CONFLICT (debate_stream_id, user_id) DO UPDATE SET
                role                      = EXCLUDED.role,
                hosting_replay_license_at = COALESCE(EXCLUDED.hosting_replay_license_at, stream_participant_consents.hosting_replay_license_at),
                marketing_release_at      = COALESCE(EXCLUDED.marketing_release_at, stream_participant_consents.marketing_release_at),
                group_stream_consent_at   = COALESCE(EXCLUDED.group_stream_consent_at, stream_participant_consents.group_stream_consent_at),
                is_minor                  = EXCLUDED.is_minor,
                guardian_consent_at       = COALESCE(EXCLUDED.guardian_consent_at, stream_participant_consents.guardian_consent_at),
                consent_document_version  = COALESCE(EXCLUDED.consent_document_version, stream_participant_consents.consent_document_version),
                ip_address                = EXCLUDED.ip_address,
                user_agent                = EXCLUDED.user_agent
            RETURNING *;
        `;
        const { rows } = await client.query(SQL, [
            debate_stream_id,
            user_id,
            role,
            is_minor,
            consent_document_version,
            ip_address,
            user_agent,
        ]);
        return rows[0];
    } catch (err) {
        throw mapPgError(err);
    }
};

module.exports = {
    STREAM_METHODS,
    RECORDING_SOURCES,
    RECORDING_MODERATION_STATUSES,
    CONSENT_ROLES,
    scheduleDebateStream,
    getDebateStream,
    ingestStreamRecording,
    attachStreamerVod,
    setRecordingModerationStatus,
    publishRecording,
    purgeExpiredRecordings,
    recordStreamParticipantConsent,
};
