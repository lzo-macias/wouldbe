const express = require("express");

const {
    listPIIAccessEventsV2,
    getPIIAccessForUser,
} = require("../../DB/platform/PIIAccess");

const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

const adminOnly = [requireAuth, requireAdmin()];

// GET /admin/pii-access-log — the PII-access audit log, filterable by accessor,
// subject, date window, and field.
router.get("/admin/pii-access-log", adminOnly, async (req, res, next) => {
    try {
        const { accessor_user_id, accessed_user_id, access_date_start, access_date_end, field, limit } = req.query;
        const events = await listPIIAccessEventsV2({
            accessor_user_id,
            accessed_user_id,
            access_date_start,
            access_date_end,
            field,
            limit,
        });
        return res.json(events);
    } catch (err) {
        next(err);
    }
});

// GET /admin/pii-access-log/user/:userId — every PII read against one user.
router.get("/admin/pii-access-log/user/:userId", adminOnly, async (req, res, next) => {
    try {
        return res.json(await getPIIAccessForUser({ accessed_user_id: req.params.userId }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
