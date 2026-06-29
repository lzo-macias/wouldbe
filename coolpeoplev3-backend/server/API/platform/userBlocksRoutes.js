const express = require("express");

const {
    blockUser,
    unblockUser,
    getMyBlocks,
    isBlockedBy,
} = require("../../DB/platform/userBlocks");

const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/block/:id — block another user. blocker_user_id comes from the token.
router.post("/block/:id", requireAuth, async (req, res, next) => {
    try {
        const blocked = await blockUser({
            blocker_user_id: req.user.id,
            blocked_user_id: req.params.id,
        });
        return res.status(201).json(blocked);
    } catch (err) {
        next(err);
    }
});

// POST /api/unblock/:id — remove a block (200, not 201 — it's a removal).
router.post("/unblock/:id", requireAuth, async (req, res, next) => {
    try {
        const unblocked = await unblockUser({
            blocker_user_id: req.user.id,
            blocked_user_id: req.params.id,
        });
        return res.json(unblocked);
    } catch (err) {
        next(err);
    }
});

// GET /api/blocks — the caller's OWN block list. blocker_user_id from the token
// (NEVER a URL param) so a user can't read someone else's blocks. getMyBlocks
// returns the array directly.
router.get("/blocks", requireAuth, async (req, res, next) => {
    try {
        const myblocks = await getMyBlocks({ blocker_user_id: req.user.id });
        return res.json(myblocks);
    } catch (err) {
        next(err);
    }
});

// GET /api/blocks/check/:id — "has user :id blocked me?" isBlockedBy returns a bool.
router.get("/blocks/check/:id", requireAuth, async (req, res, next) => {
    try {
        const blocked = await isBlockedBy({
            user_id: req.user.id, // me
            possible_blocker_user_id: req.params.id, // did THIS user block me?
        });
        return res.json({ blocked });
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
