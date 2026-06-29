const express = require("express");

const {
    listAdminActions,
    getActionsForResource,
    getActionsByAdmin,
} = require("../../DB/platform/adminActions");

const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

// The admin_actions audit trail is read-only here and visible to any active
// admin (AD). It is NOT writable via these routes — the audit is appended by the
// recordAdminAction middleware and by admins.js, never by an admin endpoint.
const anyAdmin = [requireAuth, requireAdmin()];

// GET /api/admin/admin-actions
//   ?admin_user_id=&action_type=&target_resource_type=&target_resource_id=
//   &mfa_verified=&created_after=&created_before=&limit=
const parseBool = (v) =>
    v === undefined || v === "" || v === null
        ? null
        : v === "true" || v === "1" || v === true;

router.get("/admin/admin-actions", anyAdmin, async (req, res, next) => {
    try {
        const rows = await listAdminActions({
            admin_user_id: req.query.admin_user_id || null,
            action_type: req.query.action_type || null,
            target_resource_type: req.query.target_resource_type || null,
            target_resource_id: req.query.target_resource_id || null,
            mfa_verified: parseBool(req.query.mfa_verified),
            created_after: req.query.created_after || null,
            created_before: req.query.created_before || null,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/admin-actions/resource/:resourceType/:resourceId — full audit
// history for one polymorphic target.
router.get(
    "/admin/admin-actions/resource/:resourceType/:resourceId",
    anyAdmin,
    async (req, res, next) => {
        try {
            const rows = await getActionsForResource({
                resource_type: req.params.resourceType,
                resource_id: req.params.resourceId,
                limit: req.query.limit,
            });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/admin-actions/by-admin/:adminUserId — everything one admin did.
router.get(
    "/admin/admin-actions/by-admin/:adminUserId",
    anyAdmin,
    async (req, res, next) => {
        try {
            const rows = await getActionsByAdmin({
                admin_user_id: req.params.adminUserId,
                limit: req.query.limit,
            });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
