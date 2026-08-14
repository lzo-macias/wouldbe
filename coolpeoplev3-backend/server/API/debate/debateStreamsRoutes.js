const express = require("express");

const {
    scheduleDebateStream,
    getDebateStream,
    connectStreamChannel,
    skipStreamChannel,
    getStreamLineup,
    ingestStreamRecording,
    attachStreamerVod,
    setRecordingModerationStatus,
    publishRecording,
    purgeExpiredRecordings,
    recordStreamParticipantConsent,
} = require("../../DB/debate/debateStreams");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
    captureRequestContext,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// Debate concluding-stream API.
//   - schedule / read the stream          (auth; admin to schedule)
//   - ingest an R2 recording               (internal relay)
//   - attach an external VOD               (internal)
//   - moderation status / publish          (admin, or internal pipeline)
//   - purge expired recordings             (internal/cron)
//   - per-participant consent              (auth + captured request context)
// ============================================================================

// POST /api/debates/:id/stream — schedule the debate's concluding stream (admin).
router.post(
    "/debates/:id/stream",
    requireAuth,
    requireAdmin(),
    recordAdminAction("schedule_debate_stream", { resourceType: "debate_streams" }),
    async (req, res, next) => {
        try {
            const stream = await scheduleDebateStream({
                debate_id: req.params.id,
                method: req.body.method,
                twitch_connection_id: req.body.twitch_connection_id,
                host_user_id: req.body.host_user_id,
                twitch_channel: req.body.twitch_channel,
                twitch_broadcaster_user_id: req.body.twitch_broadcaster_user_id,
                embed_parent_domains: req.body.embed_parent_domains,
                scheduled_at: req.body.scheduled_at,
            });
            return res.status(201).json(stream);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/stream — the debate's (latest) stream row.
router.get("/debates/:id/stream", requireAuth, async (req, res, next) => {
    try {
        const stream = await getDebateStream({ debate_id: req.params.id });
        if (!stream) return res.status(404).json({ error: "no stream for this debate" });
        return res.json(stream);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/debates/:id/stream/channel — the sponsor connects their Twitch
// channel to the debate they just submitted. requireAuth only (NOT requireAdmin):
// this is the sponsor's own post-submission step, and ownership is enforced in
// the DB layer from the token's user_id.
router.patch("/debates/:id/stream/channel", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await connectStreamChannel({
                debate_id: req.params.id,
                user_id: req.user.id,
                twitch_channel: req.body.twitch_channel,
                twitch_broadcaster_user_id: req.body.twitch_broadcaster_user_id,
                twitch_connection_id: req.body.twitch_connection_id,
                scheduled_at: req.body.scheduled_at,
                invite_slots: req.body.invite_slots,
            })
        );
    } catch (err) {
        next(err);
    }
});

// PATCH /api/debates/:id/stream/skip — the sponsor opts out of streaming on
// Twitch. Sponsor-scoped like the connect route; recorded so the choice survives
// a reload and an admin can see it was deliberate.
router.patch("/debates/:id/stream/skip", requireAuth, async (req, res, next) => {
    try {
        return res.json(await skipStreamChannel({ debate_id: req.params.id, user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/stream/lineup — the nomination ranking for the broadcast,
// with `invited` marking everyone above the stream's invite_slots cut line.
// Returns the FULL ranking, not just the invitees: who narrowly missed is the
// part an admin actually needs to see before the invites go out.
router.get("/debates/:id/stream/lineup", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getStreamLineup({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debate-streams/:id/recordings — register a Method-2 R2 recording
// (internal relay). The bytes live in R2; we store the object key. Pass
// request_upload_url:true to also mint a presigned PUT for the upload target.
router.post(
    "/debate-streams/:id/recordings",
    requireInternal,
    async (req, res, next) => {
        try {
            const out = await ingestStreamRecording({
                debate_stream_id: req.params.id,
                debate_id: req.body.debate_id,
                source: req.body.source,
                r2_bucket: req.body.r2_bucket,
                r2_object_key: req.body.r2_object_key,
                playback_url: req.body.playback_url,
                duration_seconds: req.body.duration_seconds,
                auto_delete_at: req.body.auto_delete_at,
                request_upload_url: req.body.request_upload_url,
                upload_content_type: req.body.upload_content_type,
            });
            return res.status(201).json(out);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debate-streams/:id/recordings/vod — link an external (Twitch/own) VOD
// as a recording (internal).
router.post(
    "/debate-streams/:id/recordings/vod",
    requireInternal,
    async (req, res, next) => {
        try {
            const recording = await attachStreamerVod({
                debate_stream_id: req.params.id,
                debate_id: req.body.debate_id,
                source: req.body.source,
                playback_url: req.body.playback_url,
                vod_video_id: req.body.vod_video_id,
                duration_seconds: req.body.duration_seconds,
            });
            return res.status(201).json(recording);
        } catch (err) {
            next(err);
        }
    }
);

// PATCH /api/debate-streams/recordings/:id/moderation — set moderation status.
// Allowed for an admin OR the internal moderation pipeline. We try the internal
// gate first (no req.user), then fall back to admin auth.
router.patch(
    "/debate-streams/recordings/:id/moderation",
    (req, res, next) => {
        // internal pipeline path: internal secret present → skip admin auth.
        if (req.get("x-internal-secret") || req.headers["x-internal-secret"]) {
            return requireInternal(req, res, next);
        }
        return requireAuth(req, res, (err) => (err ? next(err) : requireAdmin()(req, res, next)));
    },
    (req, res, next) => {
        // record the admin action only when an admin (not the internal pipeline) acted.
        if (req.admin) {
            return recordAdminAction("moderate_stream_recording", {
                resourceType: "stream_recordings",
            })(req, res, next);
        }
        return next();
    },
    async (req, res, next) => {
        try {
            const recording = await setRecordingModerationStatus({
                id: req.params.id,
                status: req.body.status,
            });
            return res.json(recording);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debate-streams/recordings/:id/publish — publish a recording (admin).
router.post(
    "/debate-streams/recordings/:id/publish",
    requireAuth,
    requireAdmin(),
    recordAdminAction("publish_stream_recording", { resourceType: "stream_recordings" }),
    async (req, res, next) => {
        try {
            const recording = await publishRecording({
                id: req.params.id,
                playback_url: req.body.playback_url,
            });
            return res.json(recording);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debate-streams/recordings/purge — purge expired recordings
// (internal/cron): deletes the R2 object + soft-deletes the row for each.
router.post(
    "/debate-streams/recordings/purge",
    requireInternal,
    async (req, res, next) => {
        try {
            const out = await purgeExpiredRecordings({ limit: req.body.limit });
            return res.json(out);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debate-streams/:id/consent — record this participant's consent for
// the stream. captureRequestContext stamps ip + user_agent onto the legal record.
router.post(
    "/debate-streams/:id/consent",
    captureRequestContext,
    requireAuth,
    async (req, res, next) => {
        try {
            const consent = await recordStreamParticipantConsent({
                debate_stream_id: req.params.id,
                user_id: req.user.id,
                role: req.body.role,
                hosting_replay_license: req.body.hosting_replay_license,
                marketing_release: req.body.marketing_release,
                group_stream_consent: req.body.group_stream_consent,
                is_minor: req.body.is_minor,
                guardian_consent: req.body.guardian_consent,
                consent_document_version: req.body.consent_document_version,
                ip_address: req.context?.ip_address,
                user_agent: req.context?.user_agent,
            });
            return res.status(201).json(consent);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
