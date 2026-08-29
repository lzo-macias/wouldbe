const express = require("express");

const {
    getSeedingBoard,
    autoSeed,
    saveSeeding,
    shufflePrompts,
    lockSeeding,
    notifySponsorToSeed,
} = require("../../DB/debate/debateSeeding");
const { requireAuth, requireAdmin, requireInternal } = require("../../middleware");

const router = express.Router();

// ============================================================================
// Seeding day — the sponsor turns a finalised field into a bracket.
//
// EVERY ROUTE HERE IS SPONSOR-SCOPED, not public and not admin-only. The DB
// layer checks the caller against the debate's own sponsor from the token, so
// ownership is enforced once, where the debate row already is, rather than in
// five middlewares that can drift apart. `is_admin` widens it — an admin has to
// be able to seed a bracket for a sponsor who has gone quiet.
//
// The board is a READ that the page polls while the sponsor works, so it is the
// only GET; the three writes are a draft save, a prompt shuffle, and the lock.
// ============================================================================

// Admin flag without an admin GATE: requireAdmin() would 403 the sponsor, who is
// the primary user of every route below. This only reports whether the caller
// happens to be one.
const withAdminFlag = (req) => ({
    user_id: req.user?.id ?? null,
    is_admin: !!req.admin,
});

// GET /api/debates/:id/seeding — the whole seeding page in one read: the field
// with nomination counts, the current seeds, the round-0 pairing they imply,
// every match slot with its prompt, the round calendar, and what still blocks
// the lock.
router.get("/debates/:id/seeding", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getSeedingBoard({ debate_id: req.params.id, ...withAdminFlag(req) }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/seeding/auto — seed from the nomination ranking.
// Most-nominated becomes seed 1, which the standard pairing puts against the
// last seed. The sponsor's starting point, not their answer — they rearrange
// from here.
router.post("/debates/:id/seeding/auto", requireAuth, async (req, res, next) => {
    try {
        return res.json(await autoSeed({ debate_id: req.params.id, ...withAdminFlag(req) }));
    } catch (err) {
        next(err);
    }
});

// PATCH /api/debates/:id/seeding — save the draft. Seeds, prompts, or both;
// whichever half the page changed.
router.patch("/debates/:id/seeding", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await saveSeeding({
                debate_id: req.params.id,
                ...withAdminFlag(req),
                seeds: req.body?.seeds ?? null,
                prompts: req.body?.prompts ?? null,
            })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/seeding/shuffle-prompts — fill from the published
// template bank. Empty slots only by default, so a sponsor who wrote three good
// questions does not lose them; ?overwrite=true redraws the lot.
router.post("/debates/:id/seeding/shuffle-prompts", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await shufflePrompts({
                debate_id: req.params.id,
                ...withAdminFlag(req),
                overwrite: req.body?.overwrite === true,
            })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/seeding/lock — the irreversible one. Writes the
// first-round matches, freezes the prompts, starts the clock, and emails every
// contestant their opponent, their question and their deadline.
router.post("/debates/:id/seeding/lock", requireAuth, async (req, res, next) => {
    try {
        return res.json(await lockSeeding({ debate_id: req.params.id, ...withAdminFlag(req) }));
    } catch (err) {
        next(err);
    }
});

// POST /api/debates/:id/seeding/notify — "your field is final, come seed it".
//
// Internal or admin: this is fired by whatever closes entry on start day, not by
// a person clicking. It stamps seeding_notified_at, so a cron that runs every
// five minutes sends one email rather than two hundred and eighty-eight.
router.post(
    "/debates/:id/seeding/notify",
    (req, res, next) => {
        if (req.get("x-internal-secret")) return requireInternal(req, res, next);
        return requireAuth(req, res, (err) => (err ? next(err) : requireAdmin()(req, res, next)));
    },
    async (req, res, next) => {
        try {
            return res.json(await notifySponsorToSeed({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
