const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const {
    listConversations,
    ensureTypedMatchVote,
    listTypedBallots,
} = require("../../DB/debate/matchConversations");
const { findUserByToken } = require("../../DB/platform/auth");

const router = express.Router();

// ============================================================================
// A typed debate read as a message app: the sidebar's conversation list, and
// the ballot a released match opens by itself.
// ============================================================================

const _viewer = async (req) => {
    if (!req.headers.authorization) return null;
    try {
        const user = await findUserByToken(req.headers.authorization);
        return user?.id ?? null;
    } catch {
        return null;
    }
};

// GET /api/debates/:debateId/conversations — one row per match: who is in it,
// what it is about, whether it is still sealed. Public; previews and prompts of
// unreleased rounds are withheld by the query, not by the caller.
router.get("/debates/:debateId/conversations", async (req, res, next) => {
    try {
        return res.json(
            await listConversations({
                debate_id: req.params.debateId,
                viewer_user_id: await _viewer(req),
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

// GET /api/debates/:debateId/matches/:key/ballot — the vote for one typed match.
//
// A GET that WRITES, deliberately: a released typed match has no host to open
// its vote, so the first person to read it is what creates the (auto_opened) row.
// It is idempotent — every subsequent call upserts the same row — which is what
// makes it safe to fire from a page load.
router.get("/debates/:debateId/matches/:key/ballot", async (req, res, next) => {
    try {
        const viewer_user_id = await _viewer(req);
        return res.json(
            await withTransaction((tx) =>
                ensureTypedMatchVote(
                    { debate_id: req.params.debateId, key: req.params.key, viewer_user_id },
                    tx
                )
            )
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:debateId/ballots — EVERY match this viewer can vote on.
//
// The vote panel reads this instead of accumulating whatever the reader clicked.
// Which ballots are open to you is a fact about the debate and your account, not
// about your browsing history in this tab: signed in, the same set comes back
// after a reload or tomorrow, with the ones you have already scored marked.
//
// It WRITES, like the single-ballot route: a released match with no vote row yet
// opens its own here. Idempotent, so a page load is safe to repeat.
router.get("/debates/:debateId/ballots", async (req, res, next) => {
    try {
        const viewer_user_id = await _viewer(req);
        return res.json(
            await withTransaction((tx) =>
                listTypedBallots({ debate_id: req.params.debateId, viewer_user_id }, tx)
            )
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

module.exports = { router };
