const express = require("express");

const {
    fileDMCANotice,
    listDMCANotices,
    actOnDMCA,
    fileCounterNotice,
    restoreAfterCounter,
} = require("../../DB/platform/dmca");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/dmca — file a takedown notice. The claimant identity comes entirely
// from the body (name/email/address/claimed_work/sworn_statement). The schema
// has no filer column, so req.user.id is NOT persisted on the row.
//
// NOTE: real DMCA notices can come from non-users (rights holders / their
// agents). A public (unauthenticated) intake form may be needed later; for now
// we gate this with requireAuth so the intake is at least attributable to an
// account. Body: { claimant_name, claimant_email, claimant_address,
// claimed_work, affected_content_item_id?, sworn_statement, received_at? }
router.post("/dmca", requireAuth, async (req, res, next) => {
    try {
        const row = await fileDMCANotice({
            claimant_name: req.body?.claimant_name,
            claimant_email: req.body?.claimant_email,
            claimant_address: req.body?.claimant_address,
            claimed_work: req.body?.claimed_work,
            affected_content_item_id: req.body?.affected_content_item_id || null,
            sworn_statement: req.body?.sworn_statement,
            received_at: req.body?.received_at || null,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/dmca — admin triage queue.
// Filters: ?action_taken=&affected_content_item_id=&pending_only=&limit=
router.get("/admin/dmca", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listDMCANotices({
            action_taken: req.query.action_taken || null,
            affected_content_item_id: req.query.affected_content_item_id || null,
            pending_only: req.query.pending_only === "true",
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/dmca/:id/act — admin acts on a notice.
// Body: { action: content_removed|no_action }. content_removed takes the
// affected content item down atomically.
router.post(
    "/admin/dmca/:id/act",
    requireAuth,
    requireAdmin(),
    recordAdminAction("act_on_dmca", { resourceType: "dmca_takedown" }),
    async (req, res, next) => {
        try {
            const row = await actOnDMCA({
                id: req.params.id,
                action: req.body?.action,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/dmca/:id/counter — the affected uploader disputes the takedown.
// The counter-notice filer comes from the token, NEVER the body.
router.post("/dmca/:id/counter", requireAuth, async (req, res, next) => {
    try {
        const row = await fileCounterNotice({
            id: req.params.id,
            counter_filer_user_id: req.user.id,
        });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/dmca/:id/restore — admin restores content after a valid
// counter-notice (flips the content item back to approved atomically).
router.post(
    "/admin/dmca/:id/restore",
    requireAuth,
    requireAdmin(),
    recordAdminAction("restore_after_counter", { resourceType: "dmca_takedown" }),
    async (req, res, next) => {
        try {
            const row = await restoreAfterCounter({ id: req.params.id });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
