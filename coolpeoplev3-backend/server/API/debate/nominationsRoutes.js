const express = require("express");

const {
    createNomination,
    deleteNomination,
    getDebateNominationCounts,
    getNominationsReceived,
} = require("../../DB/debate/nominations");
const {
    inviteToNominate,
    listInvitesSent,
    getInviteByToken,
} = require("../../DB/debate/nominationInvites");
const { requireAuth, rateLimit } = require("../../middleware");

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

// POST /api/debates/:id/nominations/invite — nominate by EMAIL OR USERNAME.
//
// No phone number is accepted, deliberately. The response carries a `share`
// block (link + prepared text) and the BROWSER opens the nominator's own
// Messages app with it — so a number never reaches this request or its logs.
//
// Distinct from the route above rather than folded into it: that one takes a
// nominee_user_id and returns a nominations row, this one takes a handle nobody
// has verified and returns "nominated OR invited, and here is what we sent".
// Two answers, two routes.
//
// Rate-limited because it is the one authenticated route that sends mail and SMS
// to an address the caller typed — i.e. the one that can be pointed at a
// stranger's inbox. The cap is per (ip + route), so a burst of invites to
// different people from one session is throttled the same as a burst at one.
//
// Declared BEFORE the bare "/debates/:id/nominations" DELETE below only for
// readability; Express matches on path, and "/invite" cannot collide with it.
router.post(
    "/debates/:id/nominations/invite",
    requireAuth,
    rateLimit({ type: "nomination_invite", windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res, next) => {
        try {
            const result = await inviteToNominate({
                debate_id: req.params.id,
                nominator_user_id: req.user.id,
                // `handle` is the field name; email/username are accepted as
                // aliases so a caller can be explicit about which one they hold.
                handle: req.body.handle ?? req.body.email ?? req.body.username,
            });
            return res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/nomination-invites/:token — what a nomination link resolves to.
//
// DELIBERATELY PUBLIC. The token is the credential, and the person following the
// link is by definition not signed in yet — that is the whole point of the link.
// requireAuth here would make it unusable by the only people it is for.
//
// It answers with a masked email and nothing else identifying. A 404 covers
// unknown, forged and deleted tokens alike, so the endpoint cannot be used to
// test whether a token is real.
router.get("/nomination-invites/:token", async (req, res, next) => {
    try {
        const invite = await getInviteByToken({ token: req.params.token });
        if (!invite) return res.status(404).json({ error: "that invite link is not valid" });
        return res.json(invite);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:id/nominations/invites — the CALLER'S OWN invites for this
// debate. Never anyone else's: these rows hold a third party's email address.
router.get("/debates/:id/nominations/invites", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await listInvitesSent({
                debate_id: req.params.id,
                nominator_user_id: req.user.id,
            })
        );
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
