const { getUserProfile } = require("../../DB/platform/userProfile");
const express = require("express")

const { getUserFull } = require("../../DB/platform/userFull.js");

const {
    createUsers,
    fetchUserById,
    fetchPublicUserById,
    updateUser,
    getUserEndorsementHistory,
    getAllUserWouldbes,
    getCurrentUserWouldbes,
    getUserCurrentDebates,
    getUserDebateHistory,
    deactivateUser,
    searchUsers
} = require("../../DB/platform/users")

const { recordPromptResponse, getDuePrompts } = require("../../DB/debate/prompts")
const { listUserWouldbes } = require("../../DB/candidacy/wouldbe")
const { findUserByToken } = require("../../DB/platform/auth")
const { requireAuth } = require("../../middleware")

const router = express.Router();

// NOTE: literal routes (/search, /me/...) must be declared BEFORE the catch-all
// "/:userId" below, or Express captures "search"/"me" as a userId.

// GET /search?q=&limit= — public people-search (public-safe fields only).
router.get("/search", requireAuth, async (req, res, next) => {
    try {
        const results = await searchUsers({ q: req.query.q, limit: req.query.limit });
        return res.json(results);
    } catch (err) {
        console.error(err);
        next(err);
    }
});

// GET /me/prompts — which soft asks are currently due for the logged-in user.
router.get("/me/prompts", requireAuth, async (req, res, next) => {
    try {
        const due = await getDuePrompts({ user_id: req.user.id });
        return res.json({ due });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

// POST /me/prompts — record the user's response to a soft ask.
// Body: { prompt_type, response, session_number?, next_eligible_at? }.
router.post("/me/prompts", requireAuth, async (req, res, next) => {
    try {
        const { prompt_type, response, session_number, next_eligible_at } = req.body;
        if (!prompt_type || !response) {
            return res.status(400).json({ error: "prompt_type and response are required" });
        }
        const row = await recordPromptResponse({
            user_id: req.user.id,
            prompt_type,
            response,
            session_number,
            next_eligible_at,
        });
        return res.status(201).json(row);
    } catch (err) {
        console.error(err);
        next(err);
    }
});


router.get("/:userId/userendorsementhistory", async (req, res, next) => {
    const { userId } = req.params;
    try{
        const endorsementhitory = await getUserEndorsementHistory({ id: userId });
        console.log(endorsementhitory)
        return res.json(endorsementhitory)
    }catch(err){
        console.error(err)
        next(err)
    }
})


// GET /api/users/:userId/wouldbes — the campaigns one user is running, for their
// profile.
//
// Auth is OPTIONAL and only ever widens the response (same pattern as
// /api/users/:userId/sponsored-debates): without a matching token you get
// launch_status='active' only, because a draft nobody paid for and a campaign
// sitting in the review queue are states the person hasn't chosen to publish.
// With it — viewer IS :userId — you get every status, which is what
// /api/wouldbes/mine returns. A bad or expired token degrades to the public view
// rather than 401, so profiles keep working logged-out.
//
// Rows carry office_name, state_code, election_cycle, general_date and
// pledger_count alongside wouldbe.*, so a profile card renders without a second
// round of lookups.
router.get("/:userId/wouldbes", async (req, res, next) => {
    const { userId } = req.params;
    try {
        let isOwner = false;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization)
                isOwner = !!viewer && viewer.id === userId
            } catch {
                isOwner = false
            }
        }
        const wouldbes = await listUserWouldbes({ user_id: userId, includeUnlisted: isOwner })
        return res.json(wouldbes)
    }catch(err){
        if (err.code === "22P02") {
            return res.status(400).json({ error: "userId must be a valid uuid" })
        }
        console.error(err)
        next(err)
    }
})


router.get("/:userId/allwouldbes", async (req, res, next) => {
    const { userId } = req.params;
    try {
        const allwouldbes = await getAllUserWouldbes({ id: userId })
        return res.json(allwouldbes)
    }catch(err){
        console.error(err)
        next(err)
    }
})


// GET /api/users/:userId/debate-history — every debate they competed in, won
// lost or ongoing. Declared before /:userId so it isn't captured as an id.
router.get("/:userId/debate-history", async (req, res, next) => {
    try {
        return res.json(await getUserDebateHistory({ id: req.params.userId }));
    } catch (err) {
        console.error(err);
        next(err);
    }
});

// GET /api/users/:userId/debates — only what's LIVE. Excludes concluded debates
// and withdrawn/disqualified entries; use /debate-history for the full record.
router.get("/:userId/debates", async (req, res, next) => {
    const { userId } = req.params;
    try {
        const currentdebates = await getUserCurrentDebates({id: userId})
        return res.json(currentdebates)
    }catch(err){
        console.error(err)
        next(err)
    }
})



// GET /api/users/:userId/full — the profile page in one request: the public
// user row, their interests, reviews + summary, live debates, full debate
// history and their campaigns.
//
// WHY: the page needed SIX round trips, each with its own loading state and its
// own chance to arrive out of order. Same reasoning and same shape as
// /debates/:id/full.
//
// Declared BEFORE /:userId so "full" isn't captured as a user id.
//
// Auth is OPTIONAL and only widens the response — it sets is_self, unlocks the
// owner's unlisted campaigns, and returns interests (which the standalone route
// gates behind requireAuth; logged-out callers get null there, not the list). A
// bad or expired token is treated as logged-out rather than 401, since the
// public view is still a perfectly valid answer.
// GET /api/users/:userId/profile — the public profile page in one read:
// identity (privacy applied), the standing chips, the argued-in feed and their
// campaigns.
//
// Auth is OPTIONAL and only ever widens: a token makes this the OWNER's copy,
// which is the one that shows hidden fields back to the person hiding them and
// includes their unlaunched campaigns. A bad token is treated as logged-out
// rather than 401 — the public view is a perfectly good answer.
router.get("/:userId/profile", async (req, res, next) => {
    try {
        let viewerUserId = null;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization);
                viewerUserId = viewer ? viewer.id : null;
            } catch {
                viewerUserId = null;
            }
        }
        return res.json(
            await getUserProfile({ user_id: req.params.userId, viewer_user_id: viewerUserId })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

router.get("/:userId/full", async (req, res, next) => {
    try {
        let viewerUserId = null;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization);
                viewerUserId = viewer ? viewer.id : null;
            } catch {
                viewerUserId = null;
            }
        }
        return res.json(
            await getUserFull({
                user_id: req.params.userId,
                viewer_user_id: viewerUserId,
            })
        );
    } catch (err) {
        next(err);
    }
});

// Public profile by id — PII-safe (fetchPublicUserById strips DOB/email/phone).
router.get("/:userId", async (req, res, next) => {
    const { userId } = req.params;
    try{
        const user = await fetchPublicUserById({id: userId})
        return res.json(user);
    }catch(err){
        console.error(err)
        next(err);
    }
})

// Update — authenticated AND only the owner may edit their own record.
router.put("/update/:userId", requireAuth, async (req, res, next) => {
    const { userId } = req.params
    if (req.user.id !== userId) {
        return res.status(403).json({ error: "You can only update your own account" });
    }
    // profile_photo_url is NOT user-settable. It is written only by
    // contentItems.syncProfilePhoto once a verdict lands, so accepting it here
    // would be a one-request bypass of the whole moderation pipeline: PUT any
    // URL and it renders as your avatar, unreviewed. Photos go through
    // POST /api/users/me/avatar-upload-url.
    const { profile_photo_url, ...payload } = req.body ?? {}
    try{
        const user = await updateUser({id: userId, payload})
        delete user.password
        return res.json(user);
    }catch(err){
        console.error(err)
        next(err)
    }
})

// Delete (soft) — authenticated + owner-only.
router.delete("/delete/:userId", requireAuth, async (req, res, next) => {
    const { userId } = req.params
    if (req.user.id !== userId) {
        return res.status(403).json({ error: "You can only deactivate your own account" });
    }
    try{
        const user = await deactivateUser({ id: userId })
        return res.json(user);
    }catch(err){
        console.error(err)
        next(err)
    }
})

// REQUIRED: without this the router is never exported and can't be mounted.
module.exports = { router };

