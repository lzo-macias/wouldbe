const express = require("express");

const { client } = require("../../DB/index");
const {
    createFollow,
    deleteFollow,
    getFollowState,
    unfollowTarget,
    getFollowedTargets,
    getFollowers,
    getFollowing,
    getHomeFeed,
} = require("../../DB/platform/follows");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/follows — follow a target. Body: { followed_id, follow_type }.
router.post("/follows", requireAuth, async (req, res, next) => {
    try {
        const follow = await createFollow({
            follower_id: req.user.id,
            followed_id: req.body?.followed_id,
            follow_type: req.body?.follow_type,
        });
        return res.status(201).json(follow);
    } catch (err) {
        next(err);
    }
});

// GET /api/follows/state?followed_id=&follow_type= — is the caller following
// this one thing? Returns { following, follow }.
//
// Declared BEFORE /follows/:id so "state" is never parsed as an edge id.
//
// A follow button needs this on mount. Without it the only readers were
// /users/:id/following and /users/:id/followers, both hardwired to
// follow_type='User' — so a Debate or Wouldbe follow was write-only and every
// button reset to "Follow" on reload regardless of what was stored.
router.get("/follows/state", requireAuth, async (req, res, next) => {
    try {
        const follow = await getFollowState({
            follower_id: req.user.id,
            followed_id: req.query.followed_id,
            follow_type: req.query.follow_type,
        });
        return res.json({ following: !!follow, follow });
    } catch (err) {
        next(err);
    }
});

// GET /api/follows/mine?follow_type= — everything of one type the caller follows.
router.get("/follows/mine", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getFollowedTargets({
                follower_id: req.user.id,
                follow_type: req.query.follow_type,
            })
        );
    } catch (err) {
        next(err);
    }
});

// DELETE /api/follows?followed_id=&follow_type= — unfollow by TARGET, so a
// button that knows only what it points at can undo itself without first
// resolving the edge id. Idempotent.
router.delete("/follows", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await unfollowTarget({
                follower_id: req.user.id,
                followed_id: req.query.followed_id,
                follow_type: req.query.follow_type,
            })
        );
    } catch (err) {
        next(err);
    }
});

// DELETE /api/follows/:id — unfollow (only the follower may delete their edge).
router.delete("/follows/:id", requireAuth, async (req, res, next) => {
    try {
        const { rows } = await client.query(`SELECT follower_id FROM follows WHERE id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "follow not found" });
        if (rows[0].follower_id !== req.user.id) return res.status(403).json({ error: "Not your follow" });
        return res.json(await deleteFollow({ id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/followers — a user's followers (public).
router.get("/users/:id/followers", async (req, res, next) => {
    try {
        return res.json(await getFollowers({ userId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/following — who a user follows (public).
router.get("/users/:id/following", async (req, res, next) => {
    try {
        return res.json(await getFollowing({ userId: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/feed — the caller's home feed from who/what they follow.
router.get("/feed", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getHomeFeed({ userId: req.user.id, limit: req.query.limit }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
