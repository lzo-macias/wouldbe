const express = require("express");

const {
    createNomination,
    deleteNomination,
    getDebateNominationCounts,
    getNominationsReceived,
} = require("../../DB/debate/nominations");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:id/nominations — nominate a user for this debate. The
// nominator is the caller (token); body supplies { nominee_user_id }.
router.post("/debates/:id/nominations", requireAuth, async (req, res, next) => {
    try {
        const nomination = await createNomination({
            debate_id: req.params.id,
            nominator_user_id: req.user.id,
            nominee_user_id: req.body.nominee_user_id,
        });
        return res.status(201).json(nomination);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/debates/:id/nominations — retract the caller's nomination of a
// user for this debate. Body: { nominee_user_id }.
router.delete("/debates/:id/nominations", requireAuth, async (req, res, next) => {
    try {
        const removed = await deleteNomination({
            debate_id: req.params.id,
            nominator_user_id: req.user.id,
            nominee_user_id: req.body.nominee_user_id,
        });
        if (!removed) return res.status(404).json({ error: "nomination not found" });
        return res.json(removed);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/nominations — distinct-nominator counts per nominee.
router.get("/debates/:id/nominations", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getDebateNominationCounts({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/nominations — nominations a user has received.
router.get("/users/:id/nominations", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getNominationsReceived({ nominee_user_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
