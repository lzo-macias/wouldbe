const express = require("express");

const {
    recordFinancialEvent,
    listFinancialAuditEvents,
    getFinancialEventsForUser,
    reconcileWithStripe,
} = require("../../DB/platform/financialAudit");
const {
    requireAuth,
    requireAdmin,
    requireInternal,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// ============================================================================
// §14 financial audit log routes — ADMIN + INTERNAL.
//
//  - The READ endpoints are admin-only (finance/super_admin in practice).
//  - recordFinancialEvent has TWO entry points:
//      * INTERNAL (x-internal-secret): other services emit events as money
//        moves (tip charged, prize paid, fee taken). This is the hot path.
//      * ADMIN: manual back-fill / correction of a missed event.
// ============================================================================

// POST /api/internal/financial-audit — service-to-service event emission.
router.post("/internal/financial-audit", requireInternal, async (req, res, next) => {
    try {
        const row = await recordFinancialEvent(req.body || {});
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/financial-audit — manual admin back-fill of an event.
router.post(
    "/admin/financial-audit",
    requireAuth,
    requireAdmin(),
    recordAdminAction("record_financial_event", { resourceType: "financial_audit_log" }),
    async (req, res, next) => {
        try {
            const row = await recordFinancialEvent(req.body || {});
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/financial-audit — the ledger.
//   ?event_category=&user_id=&currency=&from=&to=&stripe_charge_id=&limit=&offset=
router.get("/admin/financial-audit", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listFinancialAuditEvents({
            event_category: req.query.event_category,
            user_id: req.query.user_id,
            currency: req.query.currency,
            from: req.query.from,
            to: req.query.to,
            stripe_charge_id: req.query.stripe_charge_id,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/financial-audit/user/:user_id — one user's financial events.
router.get(
    "/admin/financial-audit/user/:user_id",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await getFinancialEventsForUser({ user_id: req.params.user_id });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/financial-audit/reconcile — DB-side reconciliation snapshot.
// Stripe-side diff is not wired (returns status:"reconciliation_not_wired").
// Body: { from, to }
router.post(
    "/admin/financial-audit/reconcile",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const result = await reconcileWithStripe({
                from: req.body?.from,
                to: req.body?.to,
            });
            return res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
