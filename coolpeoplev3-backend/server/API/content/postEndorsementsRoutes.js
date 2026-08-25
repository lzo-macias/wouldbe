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
const { client } = require("../../DB/index");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireCriteriaAck,
    captureRequestContext,
} = require("../../middleware");

const router = express.Router();

// requireEndorsementAck — resolve the post's debate (a debate_response post reaches
// its debate via its contestant) and scope the criteria ack to THAT debate, so a
// user can't endorse in Debate B off an ack they made for Debate A. A
// wouldbe_campaign post has no debate, so no debate criteria ack is required.
const requireEndorsementAck = async (req, res, next) => {
    try {
        const { rows } = await client.query(
            `SELECT p.post_type, c.debate_id
             FROM posts p
             LEFT JOIN contestants c ON c.id = p.contestant_id
             WHERE p.id = $1`,
            [req.params.id]
        );
        const post = rows[0];
        if (!post) return res.status(404).json({ error: "post not found" });
        if (post.post_type === "debate_response" && post.debate_id) {
            req.body = req.body || {};
            req.body.debate_id = post.debate_id; // scope the ack to this post's debate
            return requireCriteriaAck("landing_page")(req, res, next);
        }
        return next(); // no debate → no debate criteria ack to enforce
    } catch (err) {
        next(err);
    }
};

// POST /api/posts/:id/endorsements — the 3-second-hold endorsement. endorser_user_id
// comes from the token, NEVER the body. For debate posts the endorser must have
// acknowledged THAT debate's criteria (requireEndorsementAck scopes it correctly).
router.post(
    "/posts/:id/endorsements",
    requireAuth,
    requireEndorsementAck,
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
