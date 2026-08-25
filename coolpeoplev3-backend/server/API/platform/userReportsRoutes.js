const express = require("express");

const {
    fileUserReport,
    listUserReports,
    listReportsByReporter,
    resolveUserReport,
    markReportFalse,
} = require("../../DB/platform/userReports");
const { requireAuth, requireAdmin, recordAdminAction, rateLimit } = require("../../middleware");

const router = express.Router();

// POST /api/user-reports — file a report (community reporting).
// reporter_user_id is taken from the token, NEVER the body.
// Body: { reported_user_id?, reported_content_id?, report_category, description?, evidence_urls? }
// Rate-limited (reports_per_day) so the moderation queue can't be spammed / weaponized.
router.post(
    "/user-reports",
    requireAuth,
    rateLimit({ type: "reports_per_day", windowMs: 24 * 60 * 60 * 1000, max: 20 }),
    async (req, res, next) => {
    try {
        const row = await fileUserReport({
            reporter_user_id: req.user.id,
            reported_user_id: req.body?.reported_user_id || null,
            reported_content_id: req.body?.reported_content_id || null,
            report_category: req.body?.report_category,
            description: req.body?.description ?? null,
            evidence_urls: req.body?.evidence_urls ?? null,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /api/user-reports — the caller's OWN filed reports (?limit=).
router.get("/user-reports", requireAuth, async (req, res, next) => {
    try {
        const rows = await listReportsByReporter({
            reporter_user_id: req.user.id,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/user-reports — the admin triage queue.
// Filters: ?status=&report_category=&reported_user_id=&false_report_flag=&limit=
router.get("/admin/user-reports", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listUserReports({
            status: req.query.status || null,
            report_category: req.query.report_category || null,
            reported_user_id: req.query.reported_user_id || null,
            false_report_flag:
                req.query.false_report_flag === undefined
                    ? null
                    : req.query.false_report_flag === "true",
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/user-reports/:id/resolve — admin resolves/triages a report.
// Body: { status: under_review|resolved|dismissed|escalated, resolution? }
router.post(
    "/admin/user-reports/:id/resolve",
    requireAuth,
    requireAdmin(),
    recordAdminAction("resolve_user_report", { resourceType: "user_report" }),
    async (req, res, next) => {
        try {
            const row = await resolveUserReport({
                id: req.params.id,
                status: req.body?.status,
                resolution: req.body?.resolution ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/user-reports/:id/false — admin flags a report as false/abusive.
// Body: { resolution? }
router.post(
    "/admin/user-reports/:id/false",
    requireAuth,
    requireAdmin(),
    recordAdminAction("mark_report_false", { resourceType: "user_report" }),
    async (req, res, next) => {
        try {
            const row = await markReportFalse({
                id: req.params.id,
                resolution: req.body?.resolution ?? null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
