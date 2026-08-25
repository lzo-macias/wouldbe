const express = require("express");

const { createReport, listReports, reviewReport } = require("../../DB/platform/changeReports");
const { findUserByToken } = require("../../DB/platform/auth");
const { requireAuth, requireAdmin, recordAdminAction, rateLimit } = require("../../middleware");

const router = express.Router();

// Optional auth: attach the reporter's id IF a valid token is present, but never
// reject — anonymous "this is wrong" reports are allowed.
async function optionalReporterId(req) {
    try {
        const user = await findUserByToken(req.headers.authorization);
        return user?.id || null;
    } catch {
        return null; // expired/absent token → anonymous
    }
}

// POST /api/change-reports — the "this is wrong" button.
// Body: { target_type, target_id?, field_name?, current_value?, proposed_value?, source_url?, description }
// Throttled per-IP to blunt spam.
router.post(
    "/change-reports",
    rateLimit({ type: "change_report", windowMs: 60_000, max: 10 }),
    async (req, res, next) => {
        try {
            const reporter_user_id = await optionalReporterId(req);
            const row = await createReport({ ...req.body, reporter_user_id });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/change-reports?status=&target_type=&target_id=&limit= — the queue.
router.get("/admin/change-reports", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listReports({
            status: req.query.status,
            target_type: req.query.target_type,
            target_id: req.query.target_id,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/admin/change-reports/:id — move a report through review.
// Body: { status: under_review|verified_applied|rejected|duplicate, resolution_notes? }
// (Applying the corrected value to the live row is done via that row's own admin
//  edit route; this records the decision + stamps applied_at on 'verified_applied'.)
router.patch(
    "/admin/change-reports/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("review_change_report", { resourceType: "change_report" }),
    async (req, res, next) => {
        try {
            const row = await reviewReport({
                id: req.params.id,
                status: req.body?.status,
                resolution_notes: req.body?.resolution_notes,
                reviewed_by_user_id: req.user.id,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
