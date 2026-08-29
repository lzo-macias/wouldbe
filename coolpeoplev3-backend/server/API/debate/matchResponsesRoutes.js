const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const {
    scheduleTypedRounds,
    getRoundSchedule,
    submitResponse,
    submitResponses,
    getMyPrompts,
    getMatchThread,
    getResponseComments,
    getCommentReplies,
    commentOnResponse,
    toggleResponseLike,
    recordEngagement,
    getTopResponses,
} = require("../../DB/debate/matchResponses");
const { requireAuth, requireAdmin } = require("../../middleware");
const { findUserByToken } = require("../../DB/platform/auth");

const router = express.Router();

// ============================================================================
// Typed debates: rounds on a clock, answers, and the thread underneath.
//
// Visibility is decided in the DB layer by ONE function (roundStateOf), so no
// route here can accidentally publish a round early — these handlers pass the
// viewer through and render whatever it hands back.
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

// GET /api/debates/:debateId/rounds — the round clock: when each opens, when it
// closes, what state it is in, and how many answers are in. Public — a schedule
// nobody can see is a schedule nobody turns up for. Prompt text stays hidden
// until its round opens.
router.get("/debates/:debateId/rounds", async (req, res, next) => {
    try {
        return res.json(await getRoundSchedule({ debate_id: req.params.debateId }));
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

// POST /api/debates/:debateId/rounds/schedule — (re)derive the round windows
// from the debate's start and grace period.
//
// Admin-gated: it moves deadlines people are writing against. The approval flow
// calls the DB function directly; this route is the manual lever for when a
// start time changes.
router.post("/debates/:debateId/rounds/schedule", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(
            await withTransaction((tx) => scheduleTypedRounds({ debate_id: req.params.debateId }, tx))
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:debateId/matches/:key/thread — one match's page: the prompt,
// its window, and both answers once the deadline has passed. `key` is the slot
// coordinate, "left:0:1".
router.get("/debates/:debateId/matches/:key/thread", async (req, res, next) => {
    try {
        return res.json(
            await getMatchThread({
                debate_id: req.params.debateId,
                key: req.params.key,
                viewer_user_id: await _viewer(req),
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "a uuid is malformed" });
        next(err);
    }
});

// POST /api/debates/:debateId/prompts/:promptId/response — a contestant answers.
// Body: { body }. Upsert: submitting again inside the window edits.
router.post("/debates/:debateId/prompts/:promptId/response", requireAuth, async (req, res, next) => {
    try {
        const response = await withTransaction((tx) =>
            submitResponse(
                { prompt_id: req.params.promptId, user_id: req.user.id, body: req.body?.body },
                tx
            )
        );
        return res.status(201).json(response);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:debateId/my-prompts — the contestant's whole answering
// surface: one prompt per round along the path their seed takes through the
// bracket, each with its deadline, its state and whatever they have written.
//
// Auth'd and self-scoped — the answer depends entirely on who is asking, and
// there is no version of this a third party should see. A non-contestant gets
// 403, not an empty list.
router.get("/debates/:debateId/my-prompts", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getMyPrompts({ debate_id: req.params.debateId, user_id: req.user.id })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// PUT /api/debates/:debateId/my-prompts — save several rounds at once.
// Body: { answers: [{ prompt_id, body }] }.
//
// NOT in one transaction, deliberately. Each answer stands alone, and one round
// closing while the contestant was typing must not throw away the four they got
// right — so every answer reports its own outcome and the response says which.
router.put("/debates/:debateId/my-prompts", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await submitResponses({
                debate_id: req.params.debateId,
                user_id: req.user.id,
                answers: req.body?.answers,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/responses/:responseId/comments?limit=&offset= — top-level comments,
// each with its first two replies and a count for "see more replies".
router.get("/responses/:responseId/comments", async (req, res, next) => {
    try {
        return res.json(
            await getResponseComments({
                response_id: req.params.responseId,
                limit: req.query.limit,
                offset: req.query.offset,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "responseId must be a valid uuid" });
        next(err);
    }
});

// GET /api/comments/:commentId/replies — the rest of one thread.
router.get("/comments/:commentId/replies", async (req, res, next) => {
    try {
        return res.json(
            await getCommentReplies({
                parent_comment_id: req.params.commentId,
                limit: req.query.limit,
                offset: req.query.offset,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/responses/:responseId/comments — comment, or reply with
// { parent_comment_id }. Refused until the round's answers are public.
router.post("/responses/:responseId/comments", requireAuth, async (req, res, next) => {
    try {
        const comment = await withTransaction((tx) =>
            commentOnResponse(
                {
                    response_id: req.params.responseId,
                    author_user_id: req.user.id,
                    parent_comment_id: req.body?.parent_comment_id ?? null,
                    body: req.body?.body,
                },
                tx
            )
        );
        return res.status(201).json(comment);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/responses/:responseId/like — toggle. Returns the new state, so the
// client never has to infer which way it went.
router.post("/responses/:responseId/like", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await withTransaction((tx) =>
                toggleResponseLike({ response_id: req.params.responseId, user_id: req.user.id }, tx)
            )
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/responses/:responseId/engage — the soft signals. Body: { kind }.
//
// FIRE AND FORGET, and deliberately cheap: deduped to one row per user, per
// kind, per DAY, so the fortieth click costs nothing. Signed-out clicks are not
// counted at all — there is no key to dedup them by, and a counter anyone can
// inflate is not a signal. Always 200s: a failed metric must never break the
// interaction the user was actually performing.
router.post("/responses/:responseId/engage", requireAuth, async (req, res) => {
    try {
        return res.json(
            await recordEngagement({
                response_id: req.params.responseId,
                user_id: req.user.id,
                kind: req.body?.kind,
            })
        );
    } catch (err) {
        return res.json({ counted: false, error: err.message });
    }
});

// GET /api/responses/top?limit=&debate_id=&since_days= — the most-engaged
// answers on the platform, ranked by the stored score (comments ×3, likes ×2,
// profile clicks ×1).
router.get("/responses/top", async (req, res, next) => {
    try {
        return res.json(
            await getTopResponses({
                limit: req.query.limit,
                debate_id: req.query.debate_id || null,
                since_days: req.query.since_days || null,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

module.exports = { router };
