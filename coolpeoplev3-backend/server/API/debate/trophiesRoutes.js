const express = require("express");

const {
    OPEN_RESPONSE_THRESHOLD,
    thresholdForDebate,
    quoteArrows,
    startArrowPurchase,
    finishArrowPurchase,
    forFunLeaderboard,
    closeForFunWindows,
    canRespondOpenly,
    getUserTrophies,
    evaluateBackdoor,
    award,
} = require("../../DB/debate/trophies");
const {
    SINGLE_PASS_CENTS,
    SUBSCRIPTION_CENTS,
    mayRespond,
    startSinglePass,
    finishSinglePass,
    startResponderSubscription,
} = require("../../DB/debate/responseAccess");
const { requireAuth, requireAdmin, requireInternal, recordAdminAction } = require("../../middleware");

const router = express.Router();

// ============================================================================
// Standing arrows: the case, the gate, the for-fun leaderboard, the backdoor.
// ============================================================================

// GET /api/users/:userId/trophies — a public trophy case.
//
// Public because the count is the point: it is what tells everyone else why
// this person's answer is sitting under a match they are not in.
router.get("/users/:userId/trophies", async (req, res, next) => {
    try {
        return res.json(await getUserTrophies({ user_id: req.params.userId }));
    } catch (err) {
        next(err);
    }
});

// GET /api/me/can-respond-openly — may I answer a match I'm not in, and if not,
// how far off am I?
//
// Returns the numbers, not just the verdict. A locked door with no indication
// of the distance to it is a wall, and the whole design of the threshold is
// that it is something to climb toward.
router.get("/me/can-respond-openly", requireAuth, async (req, res, next) => {
    try {
        // ?debate_id scopes it to that debate's door, which is the only number
        // that means anything on a match page — the flat floor is just the
        // cheapest a debate can be.
        return res.json(
            await canRespondOpenly({ user_id: req.user.id, debate_id: req.query.debate_id || null })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/response-threshold — what it costs to answer a match in
// THIS debate from outside, and where the number came from.
//
// Public and itemised. A door whose price is a mystery reads as arbitrary; one
// that says "100 base + 50 for the prize + 24 for the field" reads as a rule.
router.get("/debates/:id/response-threshold", async (req, res, next) => {
    try {
        return res.json(await thresholdForDebate({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/me/may-respond?debate_id=&prompt_id= — the whole access answer, with
// the reason and both prices.
//
// One endpoint rather than three, because the paywall's job is to show the
// cheapest route that actually applies, and it cannot pick that from three
// separate answers without reimplementing the precedence the server already has.
router.get("/me/may-respond", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await mayRespond({
                user_id: req.user.id,
                debate_id: req.query.debate_id || null,
                prompt_id: req.query.prompt_id || null,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/response-pricing — what the two paid routes cost. Public, so a
// signed-out reader can be shown the price before being asked to make an
// account for it.
router.get("/response-pricing", (_req, res) =>
    res.json({
        single_pass_cents: SINGLE_PASS_CENTS,
        subscription_cents: SUBSCRIPTION_CENTS,
    })
);

// POST /api/response-passes — $5 for one prompt. Refused when the caller can
// already answer: taking money for a door somebody can walk through is
// technically a sale and actually a complaint.
router.post("/response-passes", requireAuth, async (req, res, next) => {
    try {
        return res.status(201).json(
            await startSinglePass({ user_id: req.user.id, prompt_id: req.body?.prompt_id })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/response-passes/:id/confirm — the money landed.
// Confirms with Stripe, never with the browser. Idempotent.
router.post("/response-passes/:id/confirm", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await finishSinglePass({
                pass_id: req.params.id,
                payment_intent_id: req.body?.payment_intent_id ?? null,
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/responder-subscription — $10 a month, any prompt.
router.post("/responder-subscription", requireAuth, async (req, res, next) => {
    try {
        return res.status(201).json(await startResponderSubscription({ user_id: req.user.id }));
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:id/for-fun-leaderboard — every answer by likes.
//
// Public DURING the month, not only at the end: the mechanic is that you can
// see you have been overtaken and write something better. Revealed only at the
// close, it would be a lottery.
router.get("/debates/:id/for-fun-leaderboard", async (req, res, next) => {
    try {
        return res.json({
            threshold: OPEN_RESPONSE_THRESHOLD,
            leaderboard: await forFunLeaderboard({ debate_id: req.params.id }),
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/trophies/close-for-fun — the monthly sweep (internal/cron).
// Idempotent, so running it hourly, daily or twice is the same.
router.post(
    "/trophies/close-for-fun",
    (req, res, next) => {
        if (req.get("x-internal-secret")) return requireInternal(req, res, next);
        return requireAuth(req, res, (err) => (err ? next(err) : requireAdmin()(req, res, next)));
    },
    async (req, res, next) => {
        try {
            return res.json(await closeForFunWindows({ window_days: req.body?.window_days }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/matches/:matchId/evaluate-backdoor — re-check a match for a seat
// change (admin/internal).
//
// The like path already runs this on every like, so this exists for backfills
// and for an admin fixing a match whose likes were corrected.
router.post(
    "/matches/:matchId/evaluate-backdoor",
    (req, res, next) => {
        if (req.get("x-internal-secret")) return requireInternal(req, res, next);
        return requireAuth(req, res, (err) => (err ? next(err) : requireAdmin()(req, res, next)));
    },
    async (req, res, next) => {
        try {
            return res.json(await evaluateBackdoor({ match_id: req.params.matchId }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/users/:userId/trophies — award by hand (admin).
// Audited, because minting the currency that unlocks writing in other people's
// debates is not a thing that should be possible without a record of who did it.
router.post(
    "/users/:userId/trophies",
    requireAuth,
    requireAdmin(),
    recordAdminAction("award_trophy", { resourceType: "user_trophies" }),
    async (req, res, next) => {
        try {
            return res.status(201).json(
                await award({
                    user_id: req.params.userId,
                    kind: req.body?.kind,
                    debate_id: req.body?.debate_id ?? null,
                    note: req.body?.note ?? null,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
