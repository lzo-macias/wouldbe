const express = require("express");

const {
    calculateDebateResult,
    getDebateResult,
    announceDebateResult,
    voidDebateResult,
} = require("../../DB/debate/debateResults");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// Result lifecycle is admin-gated: announcing/voting freezes prize-pool math and
// promotes a winner, so only an admin may trigger it. Reading a result is public
// (transparency requirement — the announced math must be inspectable).

// POST /api/debates/:id/result — calculate the result fresh, then announce + lock it.
// Body may override the computed outcome: { result_type, winner_contestant_id, notes,
// dispute_window_days }.
router.post(
    "/debates/:id/result",
    requireAuth,
    requireAdmin(),
    recordAdminAction("announce_debate_result", { resourceType: "debate_results" }),
    async (req, res, next) => {
        try {
            const result = await announceDebateResult({
                debate_id: req.params.id,
                result_type: req.body.result_type ?? null,
                winner_contestant_id: req.body.winner_contestant_id ?? null,
                notes: req.body.notes ?? null,
                dispute_window_days: req.body.dispute_window_days,
            });
            return res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/result — the announced result row (or null if none yet).
// ?preview=true returns the computed (unpersisted) calculation instead, for admins.
router.get("/debates/:id/result", async (req, res, next) => {
    try {
        if (req.query.preview === "true") {
            return res.json(await calculateDebateResult({ debate_id: req.params.id }));
        }
        return res.json(await getDebateResult({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/result/void — terminal void of an announced result.
// Body: { reason } (required).
router.post(
    "/debates/:id/result/void",
    requireAuth,
    requireAdmin(),
    recordAdminAction("void_debate_result", { resourceType: "debate_results" }),
    async (req, res, next) => {
        try {
            const result = await voidDebateResult({
                debate_id: req.params.id,
                reason: req.body.reason,
            });
            return res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
