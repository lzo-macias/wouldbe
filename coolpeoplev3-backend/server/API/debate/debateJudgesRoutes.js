const express = require("express");

const {
    addJudge,
    getDebateJudges,
    recuseJudge,
    submitJudgeScores,
    lockJudgeScores,
    getDebateJudgeScores,
} = require("../../DB/debate/debateJudges");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// Judge management and scoring is admin-gated: off-platform judges can't auth, so
// an admin curates the panel and records scores on the panel's behalf.

// POST /api/debates/:id/judges — add a judge to the panel.
router.post(
    "/debates/:id/judges",
    requireAuth,
    requireAdmin(),
    recordAdminAction("add_debate_judge", { resourceType: "debate_judges" }),
    async (req, res, next) => {
        try {
            const judge = await addJudge({ ...req.body, debate_id: req.params.id });
            return res.status(201).json(judge);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/judges — the disclosed panel (public; transparency req).
router.get("/debates/:id/judges", async (req, res, next) => {
    try {
        return res.json(await getDebateJudges({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/judges/:id/recuse — mark a single judge recused, with a reason.
router.post(
    "/judges/:id/recuse",
    requireAuth,
    requireAdmin(),
    recordAdminAction("recuse_debate_judge", { resourceType: "debate_judges" }),
    async (req, res, next) => {
        try {
            return res.json(
                await recuseJudge({
                    judge_id: req.params.id,
                    recusal_reason: req.body.recusal_reason,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/judges/:id/scores — submit one score for a judge. Submitting locks it
// (judges can't edit after announcement); pass { draft: true } to leave it open.
router.post(
    "/judges/:id/scores",
    requireAuth,
    requireAdmin(),
    recordAdminAction("submit_judge_score", { resourceType: "debate_judge_scores" }),
    async (req, res, next) => {
        try {
            const score = await submitJudgeScores({ ...req.body, judge_id: req.params.id });
            if (req.body.draft) return res.status(201).json(score);
            const locked = await lockJudgeScores({ score_id: score.score_id });
            return res.status(201).json(locked);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/scores/:id/lock — lock a previously-submitted draft score.
router.post(
    "/scores/:id/lock",
    requireAuth,
    requireAdmin(),
    recordAdminAction("lock_judge_score", { resourceType: "debate_judge_scores" }),
    async (req, res, next) => {
        try {
            return res.json(await lockJudgeScores({ score_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/judge-scores — all judge scores for a debate, optionally
// narrowed to one judge via ?judge_id=. Admin (raw, pre-announcement scores).
router.get(
    "/debates/:id/judge-scores",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            return res.json(
                await getDebateJudgeScores({
                    debate_id: req.params.id,
                    judge_id: req.query.judge_id || null,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
