const express = require("express");

const {
    issueStrike,
    getStrikesForUser,
    appealStrike,
    expireStrike,
} = require("../../DB/platform/userStrikes");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/admin/users/:id/strikes — admin issues a strike against a user.
// issued_by_user_id is the acting admin's user id (from the token).
// Body: { strike_type, severity, reason, details?, related_content_item_id?,
//         related_report_id?, expires_at? }
router.post(
    "/admin/users/:id/strikes",
    requireAuth,
    requireAdmin(),
    recordAdminAction("issue_strike", { resourceType: "user_strike" }),
    async (req, res, next) => {
        try {
            const row = await issueStrike({
                user_id: req.params.id,
                strike_type: req.body?.strike_type,
                severity: req.body?.severity,
                reason: req.body?.reason,
                details: req.body?.details ?? null,
                related_content_item_id: req.body?.related_content_item_id ?? null,
                related_report_id: req.body?.related_report_id ?? null,
                issued_by_user_id: req.user.id,
                expires_at: req.body?.expires_at ?? null,
            });
            return res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/admin/users/:id/strikes — a user's strike history (?activeOnly=true).
router.get(
    "/admin/users/:id/strikes",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const rows = await getStrikesForUser({
                user_id: req.params.id,
                activeOnly: req.query.activeOnly === "true",
            });
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/strikes/:id/appeal — the STRUCK user appeals their own strike.
// appellant id is taken from the token; the DB layer enforces ownership.
// Body: { appeal_status? }
router.post("/strikes/:id/appeal", requireAuth, async (req, res, next) => {
    try {
        const row = await appealStrike({
            id: req.params.id,
            appellant_user_id: req.user.id,
            appeal_status: req.body?.appeal_status || "pending",
        });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/strikes/:id/expire — admin/cron expires a strike off the
// active record.
router.post(
    "/admin/strikes/:id/expire",
    requireAuth,
    requireAdmin(),
    recordAdminAction("expire_strike", { resourceType: "user_strike" }),
    async (req, res, next) => {
        try {
            const row = await expireStrike({ id: req.params.id });
            return res.json(row);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
