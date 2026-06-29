const express = require("express");

// NOTE: the DB filename is misspelled "postEndoresments" — import it as spelled.
const {
    createEndorsement,
    removeEndorsement,
    getEndorsementsForPost,
    getEndorsementsForContestant,
    getEndorsementsGivenByUser,
    getEndorsementLeaderboard,
    lockFinalists,
} = require("../../DB/content/postEndoresments");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireCriteriaAck,
    captureRequestContext,
} = require("../../middleware");

const router = express.Router();

// POST /api/posts/:id/endorsements — the 3-second-hold endorsement. endorser_user_id
// comes from the token, NEVER the body. requireCriteriaAck('landing_page') gates it.
// TODO: requireCriteriaAck scopes the ack by req.params.debateId / req.params.debate_id
// / req.body.debate_id, but here the only param is a POST id. To scope the ack to the
// right debate, this route should first resolve the post's debate_id (via the post's
// contestant) and put it on req.body.debate_id before requireCriteriaAck runs.
router.post(
    "/posts/:id/endorsements",
    requireAuth,
    requireCriteriaAck("landing_page"),
    async (req, res, next) => {
        try {
            const endorsement = await createEndorsement({
                ...req.body,
                post_id: req.params.id,
                endorser_user_id: req.user.id,
            });
            return res.status(201).json(endorsement);
        } catch (err) {
            next(err);
        }
    }
);

// DELETE /api/endorsements/:id — undo. Owner-scoped: endorser_user_id from token.
router.delete("/endorsements/:id", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await removeEndorsement({
                id: req.params.id,
                endorser_user_id: req.user.id,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/posts/:id/endorsements — endorsements on a post.
router.get("/posts/:id/endorsements", async (req, res, next) => {
    try {
        return res.json(await getEndorsementsForPost({ post_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/contestants/:id/endorsements — endorsements for a contestant.
router.get("/contestants/:id/endorsements", async (req, res, next) => {
    try {
        return res.json(await getEndorsementsForContestant({ contestant_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/endorsements-given — endorsements a user has given.
router.get("/users/:id/endorsements-given", async (req, res, next) => {
    try {
        return res.json(await getEndorsementsGivenByUser({ endorser_user_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/endorsement-leaderboard — debate endorsement ranking.
router.get("/debates/:id/endorsement-leaderboard", async (req, res, next) => {
    try {
        return res.json(await getEndorsementLeaderboard({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/lock-finalists — admin promotes top-N to finalist.
router.post(
    "/debates/:id/lock-finalists",
    requireAuth,
    requireAdmin(),
    recordAdminAction("lock_finalists", { resourceType: "contestants" }),
    async (req, res, next) => {
        try {
            return res.json(await lockFinalists({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
