const express = require("express");

const { listRateLimitViolations, countViolationsForIP } = require("../../DB/platform/rateLimit");
const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

// GET /api/admin/rate-limit-violations
//   ?user_id=&rate_limit_type=&ip_address=&action_taken=&since=&limit=
// Read-only abuse-investigation feed. When ?ip_address is given, also returns a
// convenience count of violations from that IP (within ?since if provided).
router.get(
    "/admin/rate-limit-violations",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            const violations = await listRateLimitViolations({
                user_id: req.query.user_id || null,
                rate_limit_type: req.query.rate_limit_type || null,
                ip_address: req.query.ip_address || null,
                action_taken: req.query.action_taken || null,
                since: req.query.since || null,
                limit: req.query.limit,
            });
            const ip_violation_count = req.query.ip_address
                ? await countViolationsForIP({
                    ip_address: req.query.ip_address,
                    since: req.query.since || null,
                })
                : null;
            return res.json({ violations, ip_violation_count });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
