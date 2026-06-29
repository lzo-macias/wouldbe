const express = require("express");

const {
    listAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    terminateAdmin,
    grantPIIAccess,
    revokePIIAccess,
} = require("../../DB/platform/admins");

const {
    requireAuth,
    requireAdmin,
    requireMFAFresh,
    recordAdminAction,
    rateLimit,
} = require("../../middleware");

const router = express.Router();

// Mutations: must be an authenticated user → an active super_admin → with MFA
// enabled, and are throttled. (Audit is written atomically in the DB layer, so
// recordAdminAction middleware is intentionally NOT added here — that would
// double-log and without the before/after snapshots the DB layer captures.)
const superAdminMFA = [
    requireAuth,
    requireAdmin("super_admin"),
    requireMFAFresh(),
    rateLimit({ type: "admin_mutation", windowMs: 60_000, max: 20 }),
];

// Reads: any active admin may view the admin roster.
const anyAdmin = [requireAuth, requireAdmin()];

const actorFrom = (req) => ({
    id: req.admin.id,
    user_id: req.admin.user_id,
    mfa_enabled: req.admin.mfa_enabled,
});

// GET /api/admin/me — "am I an admin?" Returns the caller's admin record (200)
// or 401/403 if not. Used by the frontend to gate the admin dashboard.
router.get("/admin/me", anyAdmin, (req, res) => {
    return res.json({
        id: req.admin.id,
        user_id: req.admin.user_id,
        role: req.admin.role,
        status: req.admin.status,
        mfa_enabled: req.admin.mfa_enabled,
    });
});

// GET /api/admin/admins?includeTerminated=true — roster.
router.get("/admin/admins", anyAdmin, async (req, res, next) => {
    try {
        const rows = await listAdmins({ includeTerminated: req.query.includeTerminated === "true" });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/admins/:id — one admin record.
router.get("/admin/admins/:id", anyAdmin, async (req, res, next) => {
    try {
        const row = await getAdminById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "admin not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/admins — promote a user to an admin role.
// Body: { user_id, role, permissions?, reason }
router.post("/admin/admins", superAdminMFA, async (req, res, next) => {
    try {
        const { user_id, role, permissions, reason } = req.body || {};
        const row = await createAdmin({
            actor: actorFrom(req),
            targetUserId: user_id,
            role,
            permissions,
            reason,
            ip: req.ip,
            userAgent: req.headers["user-agent"] || null,
        });
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/admin/admins/:id — change role/status/permissions.
// Body: { role?, status?, permissions?, reason }
router.patch("/admin/admins/:id", superAdminMFA, async (req, res, next) => {
    try {
        const { role, status, permissions, reason } = req.body || {};
        const row = await updateAdmin({
            actor: actorFrom(req),
            adminId: req.params.id,
            role,
            status,
            permissions,
            reason,
            ip: req.ip,
            userAgent: req.headers["user-agent"] || null,
        });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/admins/:id/terminate — revoke admin access.
// Body: { reason }
router.post("/admin/admins/:id/terminate", superAdminMFA, async (req, res, next) => {
    try {
        const row = await terminateAdmin({
            actor: actorFrom(req),
            adminId: req.params.id,
            reason: req.body?.reason,
            ip: req.ip,
            userAgent: req.headers["user-agent"] || null,
        });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/admins/:id/pii-access — grant an admin the PII-view capability.
// Body: { reason }. super_admin + fresh MFA only. (The DB layer also writes an
// atomic before/after audit row; recordAdminAction adds the standard middleware
// audit entry per the task's wiring.)
router.post(
    "/admin/admins/:id/pii-access",
    ...superAdminMFA,
    recordAdminAction("admin.pii_access.grant", { resourceType: "admin_user" }),
    async (req, res, next) => {
        try {
            const row = await grantPIIAccess({
                actor: actorFrom(req),
                adminId: req.params.id,
                reason: req.body?.reason,
                ip: req.ip,
                userAgent: req.headers["user-agent"] || null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

// DELETE /api/admin/admins/:id/pii-access — revoke the PII-view capability.
// Body: { reason }. super_admin + fresh MFA only.
router.delete(
    "/admin/admins/:id/pii-access",
    ...superAdminMFA,
    recordAdminAction("admin.pii_access.revoke", { resourceType: "admin_user" }),
    async (req, res, next) => {
        try {
            const row = await revokePIIAccess({
                actor: actorFrom(req),
                adminId: req.params.id,
                reason: req.body?.reason,
                ip: req.ip,
                userAgent: req.headers["user-agent"] || null,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
