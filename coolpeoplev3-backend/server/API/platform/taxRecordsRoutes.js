const express = require("express");

const {
    upsertTaxRecord,
    listTaxRecords,
    attachW9ToTaxRecord,
    generate1099,
    mark1099Filed,
    computeUserYearGross,
} = require("../../DB/platform/taxRecords");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// §14 tax records routes — ADMIN only. These touch tax-sensitive data, so every
// mutation runs through requireAdmin() + recordAdminAction (admin_actions audit).
// ============================================================================

// POST /api/admin/tax-records — create or update a recipient/year/form record.
// Body: { tax_year, recipient_user_id, form_type, gross_amount_cents,
//         w9_received?, w9_storage_url? }
router.post(
    "/admin/tax-records",
    requireAuth,
    requireAdmin(),
    recordAdminAction("upsert_tax_record", { resourceType: "tax_record" }),
    async (req, res, next) => {
        try {
            const row = await upsertTaxRecord(req.body || {});
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/tax-records — the queue.
//   ?tax_year=&recipient_user_id=&form_type=&w9_received=&filed=&limit=&offset=
router.get("/admin/tax-records", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listTaxRecords({
            tax_year: req.query.tax_year,
            recipient_user_id: req.query.recipient_user_id,
            form_type: req.query.form_type,
            w9_received: req.query.w9_received === undefined ? null : req.query.w9_received === "true",
            filed: req.query.filed === undefined ? null : req.query.filed === "true",
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/tax-records/user/:user_id/gross?year= — computed taxable gross.
router.get(
    "/admin/tax-records/user/:user_id/gross",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const result = await computeUserYearGross({
                user_id: req.params.user_id,
                year: req.query.year,
            });
            return res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/tax-records/:id/w9 — attach a received W-9.
// Body: { w9_storage_url }
router.post(
    "/admin/tax-records/:id/w9",
    requireAuth,
    requireAdmin(),
    recordAdminAction("attach_w9", { resourceType: "tax_record" }),
    async (req, res, next) => {
        try {
            const row = await attachW9ToTaxRecord({
                id: req.params.id,
                w9_storage_url: req.body?.w9_storage_url,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/tax-records/:id/generate — record intent + stamp generated-at.
// (Actual PDF render is external; see DB module TODO.)
router.post(
    "/admin/tax-records/:id/generate",
    requireAuth,
    requireAdmin(),
    recordAdminAction("generate_1099", { resourceType: "tax_record" }),
    async (req, res, next) => {
        try {
            const row = await generate1099({ id: req.params.id });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/tax-records/:id/filed — mark filed with the IRS.
// Body: { irs_acknowledgment? }
router.post(
    "/admin/tax-records/:id/filed",
    requireAuth,
    requireAdmin(),
    recordAdminAction("mark_1099_filed", { resourceType: "tax_record" }),
    async (req, res, next) => {
        try {
            const row = await mark1099Filed({
                id: req.params.id,
                irs_acknowledgment: req.body?.irs_acknowledgment,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
