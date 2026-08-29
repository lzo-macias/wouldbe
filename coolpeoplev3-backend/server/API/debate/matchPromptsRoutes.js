const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const {
    suggestMatchPrompts,
    getMatchPrompts,
    setMatchPrompts,
} = require("../../DB/debate/matchPrompts");
const { bracketSlots } = require("../../DB/debate/bracketSlots");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// ============================================================================
// Typed debates: the prompt attached to every bracket match, and the assist that
// drafts a set from the debate's category.
//
// Ownership and lifecycle gates live in the DB layer (setMatchPrompts), not
// here — the same three checks apply to every write and a gate next to the SQL
// cannot be skipped by a route that forgets it.
// ============================================================================

// GET /api/bracket-slots?field_size=16 — the matches a field of this size
// produces, with labels.
//
// PUBLIC AND STATELESS: the create form needs this BEFORE a debate exists, to
// render "16 contestants → 15 prompts to write" while the sponsor is still
// moving the stepper. It reads nothing and reveals nothing.
router.get("/bracket-slots", (req, res) => {
    const slots = bracketSlots(req.query.field_size);
    if (!slots.length) {
        return res.status(400).json({ error: "field_size must be at least 2" });
    }
    return res.json({ field_size: Number(req.query.field_size), count: slots.length, slots });
});

// GET /api/prompt-suggestions?category=Politics&field_size=16&offset=0
//
// The "assist" button. Draws from category_prompt_templates — reviewed text an
// admin curates — so it costs nothing, cannot fail on a third party being down,
// and never invents a question nobody has read. `offset` shuffles: the same
// call with a higher offset returns a different, still deterministic, spread.
//
// Auth required because it is a composition aid for sponsors, not public
// content, and rate-limiting it later needs a user to attribute it to.
router.get("/prompt-suggestions", requireAuth, async (req, res, next) => {
    try {
        return res.json({
            category: req.query.category || null,
            prompts: await suggestMatchPrompts({
                category: req.query.category,
                field_size: req.query.field_size,
                offset: req.query.offset,
            }),
        });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:debateId/match-prompts — every slot in the bracket with
// whatever has been written for it, filled or not.
//
// Public: in a typed debate the prompt IS the match, so hiding it would hide
// what the contestants are being asked and what the room is scoring. The holes
// are visible too — "12 of 15 written" is a fact about a draft, not a leak.
router.get("/debates/:debateId/match-prompts", async (req, res, next) => {
    try {
        return res.json(await getMatchPrompts({ debate_id: req.params.debateId }));
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

// PUT /api/debates/:debateId/match-prompts — HOST: write or rewrite the set.
// Body: { prompts: [{ bracket_round, bracket_side, bracket_position, body }] }
//
// One transaction: a set that half-lands leaves matches with no question, and
// the sponsor cannot tell which ones without reading all fifteen.
router.put("/debates/:debateId/match-prompts", requireAuth, async (req, res, next) => {
    try {
        const prompts = await withTransaction((tx) =>
            setMatchPrompts(
                {
                    debate_id: req.params.debateId,
                    user_id: req.user.id,
                    prompts: req.body?.prompts,
                },
                tx
            )
        );
        return res.json({ updated: prompts.length, prompts });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

module.exports = { router };
