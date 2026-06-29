const express = require("express")

const {
    createUsers,
    fetchUserById,
    fetchPublicUserById,
    updateUser,
    getUserEndorsementHistory,
    getAllUserWouldbes,
    getCurrentUserWouldbes,
    getUserCurrentDebates,
    deactivateUser,
    searchUsers
} = require("../../DB/platform/users")

const { recordPromptResponse, getDuePrompts } = require("../../DB/debate/prompts")
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


router.get("/:userId/wouldbes", async (req, res, next) => {
    const { userId } = req.params;
    try {
        const wouldbes = await getCurrentUserWouldbes({ id: userId })
        return res.json(wouldbes)
    }catch(err){
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
    const payload = req.body
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

