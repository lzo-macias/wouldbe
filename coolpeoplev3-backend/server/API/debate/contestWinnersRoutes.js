const express = require("express");

const {
    recordContestWinner,
    getContestWinners,
    mark1099Filed,
} = require("../../DB/debate/contestWinners");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// Winner records are the tax/dispute audit trail, so writes are admin-gated.

// POST /api/debates/:id/winners — record one winner for a debate. Body:
// { contestant_id, user_id, placement, prize_amount_cents, selection_method,
//   vote_count?, selected_by_user_id?, selection_rationale?, irs_1099_required?,
//   prize_payment_method?, prize_payment_reference? }.
router.post(
    "/debates/:id/winners",
    requireAuth,
    requireAdmin(),
    recordAdminAction("record_contest_winner", { resourceType: "contest_winners" }),
    async (req, res, next) => {
        try {
            const winner = await recordContestWinner({
                ...req.body,
                debate_id: req.params.id,
            });
            return res.status(201).json(winner);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates/:id/winners — all recorded winners for a debate.
router.get(
    "/debates/:id/winners",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            return res.json(await getContestWinners({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/winners/:id/1099-filed — mark the 1099 obligation on record for a winner.
router.post(
    "/winners/:id/1099-filed",
    requireAuth,
    requireAdmin(),
    recordAdminAction("mark_winner_1099_filed", { resourceType: "contest_winners" }),
    async (req, res, next) => {
        try {
            return res.json(await mark1099Filed({ id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
