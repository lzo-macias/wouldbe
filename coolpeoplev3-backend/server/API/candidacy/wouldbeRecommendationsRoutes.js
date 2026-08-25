const express = require("express");

const {
    createRecommendation,
    deleteRecommendation,
    getRecommendationsReceived,
    getRecommendationsGiven,
    respondToRecommendation,
} = require("../../DB/candidacy/wouldbeRecommendations");
const { getQualifyingOffices } = require("../../DB/elections/offices");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/recommendations — "I think this person should run for X." The
// recommender is the caller (token); body supplies target + anchors + type.
router.post("/recommendations", requireAuth, async (req, res, next) => {
    try {
        const rec = await createRecommendation({
            recommender_user_id: req.user.id,
            target_user_id: req.body.target_user_id,
            office_id: req.body.office_id || null,
            race_id: req.body.race_id || null,
            source_debate_id: req.body.source_debate_id || null,
            recommendation_type: req.body.recommendation_type,
            reason_text: req.body.reason_text || null,
        });
        return res.status(201).json(rec);
    } catch (err) {
        next(err);
    }
});

// GET /api/users/me/qualifying-offices — offices the caller could run for. Lets
// a nominee see what they actually qualify for before responding.
router.get("/users/me/qualifying-offices", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getQualifyingOffices({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/recommendations/received — recommendations where the caller is the
// target (the nominee inbox).
router.get("/recommendations/received", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getRecommendationsReceived({ target_user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/recommendations/given — recommendations the caller has made.
router.get("/recommendations/given", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getRecommendationsGiven({ recommender_user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/recommendations/:id/respond — the nominee acts on a recommendation.
// Body: { response, resulting_wouldbe_id? }. Only the target may respond.
router.post("/recommendations/:id/respond", requireAuth, async (req, res, next) => {
    try {
        const updated = await respondToRecommendation({
            id: req.params.id,
            target_user_id: req.user.id,
            response: req.body.response,
            resultingWouldbeId: req.body.resulting_wouldbe_id || null,
        });
        return res.json(updated);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/recommendations/:id — retract the caller's own recommendation.
router.delete("/recommendations/:id", requireAuth, async (req, res, next) => {
    try {
        const removed = await deleteRecommendation({
            id: req.params.id,
            recommender_user_id: req.user.id,
        });
        if (!removed) return res.status(404).json({ error: "recommendation not found" });
        return res.json(removed);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
