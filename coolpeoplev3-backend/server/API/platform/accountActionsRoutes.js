const express = require("express");

const {
    createAccountAction,
    getAccountActionsForUser,
    reverseAccountAction,
} = require("../../DB/platform/accountActions");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/admin/users/:id/actions — take an action against a user account.
// Body: { action_type, reason_category, reason_details?, duration_hours?, effective_until? }
// The acting admin's USER id (req.admin.user_id) is the recorded actor — never
// trusted from the body.
router.post(
    "/admin/users/:id/actions",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_account_action", { resourceType: "account_actions" }),
    async (req, res, next) => {
        try {
            const row = await createAccountAction({
                user_id: req.params.id,
                action_type: req.body?.action_type,
                reason_category: req.body?.reason_category,
                reason_details: req.body?.reason_details,
                actor_admin_id: req.admin.user_id,
                duration_hours: req.body?.duration_hours,
                effective_until: req.body?.effective_until,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/users/:id/actions — the action history for one user.
router.get(
    "/admin/users/:id/actions",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            return res.json(await getAccountActionsForUser({ user_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/admin/account-actions/:id/reverse — record a reversal of an action.
// Body: { reversal_reason? }. Reverser is req.admin.user_id.
router.post(
    "/admin/account-actions/:id/reverse",
    requireAuth,
    requireAdmin(),
    recordAdminAction("reverse_account_action", { resourceType: "account_actions" }),
    async (req, res, next) => {
        try {
            const row = await reverseAccountAction({
                id: req.params.id,
                reversed_by_user_id: req.admin.user_id,
                reversal_reason: req.body?.reversal_reason,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
