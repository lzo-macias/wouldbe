const express = require("express");

const { submitRankedBallot, getRankedChoiceResult } = require("../../DB/debate/rankedVotes");
const { requireAuth, requireCriteriaAck } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:debateId/ranked-ballot — submit/replace a ranked ballot for
// the final round. requireCriteriaAck('final_round') verifies the ack server-side;
// acknowledged_criteria is stamped true in the DB layer.
router.post(
    "/debates/:debateId/ranked-ballot",
    requireAuth,
    requireCriteriaAck("final_round"),
    async (req, res, next) => {
        try {
            const rows = await submitRankedBallot({
                debate_id: req.params.debateId,
                voter_user_id: req.user.id,
                rankings: req.body.rankings,
                acknowledged_at: req.body.acknowledged_at,
            });
            return res.status(201).json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:debateId/ranked-result — instant-runoff result over the ballots.
router.get("/debates/:debateId/ranked-result", async (req, res, next) => {
    try {
        return res.json(await getRankedChoiceResult({ debate_id: req.params.debateId }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
