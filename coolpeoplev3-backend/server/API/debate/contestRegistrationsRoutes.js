const express = require("express");

const {
    createStateRegistration,
    getStateRegistrations,
    updateStateRegistration,
    runStateRegistrationChecks,
} = require("../../DB/debate/contestRegistrations");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// State registration is a compliance workflow, so all of it is admin-gated.

// POST /api/debates/:id/state-registrations — create one (debate, state) row.
// Body: { state_code, registration_required, registration_status,
//         registration_id_external?, bond_amount_cents?, bond_provider?,
//         filed_at?, expires_at? }.
router.post(
    "/debates/:id/state-registrations",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_state_registration", { resourceType: "contest_state_registrations" }),
    async (req, res, next) => {
        try {
            const row = await createStateRegistration({
                ...req.body,
                debate_id: req.params.id,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/state-registrations — all registration rows for a debate.
// ?check=true runs the live per-state requirement check instead of listing rows.
router.get(
    "/debates/:id/state-registrations",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            if (req.query.check === "true") {
                return res.json(await runStateRegistrationChecks({ debate_id: req.params.id }));
            }
            return res.json(await getStateRegistrations({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// PATCH /api/state-registrations/:id — patch one registration row.
router.patch(
    "/state-registrations/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("update_state_registration", { resourceType: "contest_state_registrations" }),
    async (req, res, next) => {
        try {
            const row = await updateStateRegistration({
                ...req.body,
                id: req.params.id,
            });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
