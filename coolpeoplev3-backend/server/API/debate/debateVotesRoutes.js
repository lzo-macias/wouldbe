const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const {
    castDebateVote,
    addVoteScores,
    getMyVote,
    getVoteTally,
    invalidateVote,
} = require("../../DB/debate/debateVotes");
const { requireAuth, requireCriteriaAck, requireInternal } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:debateId/votes — cast a vote, optionally with per-criterion
// scores. requireCriteriaAck('final_round') verifies the criteria ack SERVER-SIDE
// (no client attestation param); we stamp acknowledged_criteria = true. The vote
// and its scores are written in one transaction so they can't half-commit.
router.post(
    "/debates/:debateId/votes",
    requireAuth,
    requireCriteriaAck("final_round"),
    async (req, res, next) => {
        try {
            const out = await withTransaction(async (tx) => {
                const vote = await castDebateVote(
                    {
                        debate_id: req.params.debateId,
                        voter_user_id: req.user.id,
                        contestant_id: req.body.contestant_id,
                        acknowledged_criteria: true,
                        acknowledged_at: req.body.acknowledged_at,
                        rules_version_seen: req.body.rules_version_seen,
                        view_minutes_logged: req.body.view_minutes_logged,
                        voter_ip: req.ip,
                        voter_device_fingerprint: req.body.voter_device_fingerprint,
                    },
                    tx
                );
                let scores = [];
                if (Array.isArray(req.body.scores) && req.body.scores.length) {
                    scores = await addVoteScores({ vote_id: vote.vote_id, scores: req.body.scores }, tx);
                }
                return { vote, scores };
            });
            return res.status(201).json(out);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:debateId/votes/me — the caller's vote (+ scores).
router.get("/debates/:debateId/votes/me", requireAuth, async (req, res, next) => {
    try {
        const v = await getMyVote({ debate_id: req.params.debateId, voter_user_id: req.user.id });
        if (!v) return res.status(404).json({ error: "you have not voted in this debate" });
        return res.json(v);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:debateId/votes/tally — public per-contestant tally.
router.get("/debates/:debateId/votes/tally", async (req, res, next) => {
    try {
        return res.json(await getVoteTally({ debate_id: req.params.debateId }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:debateId/votes/:voteId/invalidate — fraud action, internal only.
router.post("/debates/:debateId/votes/:voteId/invalidate", requireInternal, async (req, res, next) => {
    try {
        return res.json(
            await invalidateVote({
                vote_id: req.params.voteId,
                invalidation_reason: req.body.invalidation_reason,
            })
        );
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
