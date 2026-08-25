const express = require("express");

const { getUserInterests, setUserInterests } = require("../../DB/elections/interests");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// GET /api/users/:userId/interests — the categories a user follows.
router.get("/users/:userId/interests", requireAuth, async (req, res, next) => {
    try {
        const rows = await getUserInterests({ userId: req.params.userId });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// PUT /api/users/:userId/interests — owner-only. REPLACES the interest set.
// Body: { category_keys: ["climate_change", "tenant_rights", ...] }
router.put("/users/:userId/interests", requireAuth, async (req, res, next) => {
    if (req.user.id !== req.params.userId) {
        return res.status(403).json({ error: "You can only edit your own interests" });
    }
    try {
        const rows = await setUserInterests({
            userId: req.params.userId,
            category_keys: req.body?.category_keys,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
