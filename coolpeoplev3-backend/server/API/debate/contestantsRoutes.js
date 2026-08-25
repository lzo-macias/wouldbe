const express = require("express");

const {
    createContestant,
    getDebateContestants,
    getContestantById,
    withdrawContestant,
    disqualifyContestant,
} = require("../../DB/debate/contestants");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/debates/:id/contestants — the authed user enters this debate. user_id
// comes from the token and the eligibility snapshot (state/city/age) is derived
// server-side from the user's profile, so nothing here is caller-supplied.
router.post("/debates/:id/contestants", requireAuth, async (req, res, next) => {
    try {
        const contestant = await createContestant({
            debate_id: req.params.id,
            user_id: req.user.id,
        });
        return res.status(201).json(contestant);
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/contestants — public active roster (hides withdrawn and
// disqualified), joined to user identity. Admins use /admin/debates/:id/contestants
// for the full roster.
router.get("/debates/:id/contestants", async (req, res, next) => {
    try {
        return res.json(await getDebateContestants({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/debates/:id/contestants — full admin roster, including
// withdrawn and disqualified entrants.
router.get(
    "/admin/debates/:id/contestants",
    requireAuth,
    requireAdmin(),
    async (req, res, next) => {
        try {
            return res.json(await getDebateContestants({ debate_id: req.params.id, all: true }));
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/contestants/:id — a single contestant row.
router.get("/contestants/:id", async (req, res, next) => {
    try {
        const rows = await getContestantById({ contestant_id: req.params.id });
        if (!rows.length) return res.status(404).json({ error: "contestant not found" });
        return res.json(rows[0]);
    } catch (err) {
        next(err);
    }
});

// POST /api/contestants/:id/withdraw — the authed user pulls out of their own
// entry. Owner-scoped in the DB layer (id + user_id must both match).
router.post("/contestants/:id/withdraw", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await withdrawContestant({
                contestant_id: req.params.id,
                user_id: req.user.id,
            })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/contestants/:id/disqualify — admin removes a contestant for cause.
// Always sets status='disqualified'; disqualification_reason is required.
router.post(
    "/contestants/:id/disqualify",
    requireAuth,
    requireAdmin(),
    recordAdminAction("disqualify_contestant", { resourceType: "contestants" }),
    async (req, res, next) => {
        try {
            return res.json(
                await disqualifyContestant({
                    id: req.params.id,
                    disqualification_reason: req.body.disqualification_reason,
                })
            );
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
