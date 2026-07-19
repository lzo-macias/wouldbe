const express = require("express");

const {
    recordModerationEvent,
    applyAutoDecision,
    getModerationEventsForItem,
} = require("../../DB/platform/moderationEvents");
const { requireAuth, requireAdmin, requireInternal } = require("../../middleware");

const router = express.Router();

// POST /api/content-items/:id/moderation-events — INTERNAL. A provider/system
// records a single scan result for the item. Append-only evidence; does NOT
// change the item's moderation_status. requireInternal (vendor callback).
// Body: { provider, provider_version?, result, confidence_score?,
//         category_scores?, raw_response?, scan_duration_ms?, cost_cents?,
//         reviewed_by_user_id? }
router.post("/content-items/:id/moderation-events", requireInternal, async (req, res, next) => {
    try {
        const event = await recordModerationEvent({
            content_item_id: req.params.id,
            provider: req.body?.provider,
            provider_version: req.body?.provider_version ?? null,
            result: req.body?.result,
            confidence_score: req.body?.confidence_score ?? null,
            category_scores: req.body?.category_scores ?? null,
            raw_response: req.body?.raw_response ?? null,
            scan_duration_ms: req.body?.scan_duration_ms ?? null,
            cost_cents: req.body?.cost_cents ?? null,
            reviewed_by_user_id: req.body?.reviewed_by_user_id ?? null,
        });
        return res.status(201).json(event);
    } catch (err) {
        next(err);
    }
});

// POST /api/content-items/:id/auto-decision — INTERNAL. Records the scan event
// AND, atomically, applies a moderation_status to the item when the verdict +
// confidence cross policy thresholds. requireInternal (pipeline only).
// Body: same shape as moderation-events.
router.post("/content-items/:id/auto-decision", requireInternal, async (req, res, next) => {
    try {
        const result = await applyAutoDecision({
            content_item_id: req.params.id,
            provider: req.body?.provider,
            provider_version: req.body?.provider_version ?? null,
            result: req.body?.result,
            confidence_score: req.body?.confidence_score ?? null,
            category_scores: req.body?.category_scores ?? null,
            raw_response: req.body?.raw_response ?? null,
            scan_duration_ms: req.body?.scan_duration_ms ?? null,
            cost_cents: req.body?.cost_cents ?? null,
            reviewed_by_user_id: req.body?.reviewed_by_user_id ?? null,
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /api/content-items/:id/moderation-events — admin-only. Full scan history
// (exposes raw provider payloads + category scores).
router.get(
    "/content-items/:id/moderation-events",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await getModerationEventsForItem({ content_item_id: req.params.id });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
