const express = require("express");

const {
    createConversation,
    listConversationsForUser,
    getConversationById,
    addParticipant,
    removeParticipant,
    markConversationRead,
    leaveConversation,
} = require("../../DB/platform/conversations");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/conversations — start a thread. creator = caller (from token).
// Body: { participant_user_ids[], type, title }.
router.post("/conversations", requireAuth, async (req, res, next) => {
    try {
        const conversation = await createConversation({
            creator_user_id: req.user.id,
            participant_user_ids: req.body?.participant_user_ids,
            type: req.body?.type,
            title: req.body?.title,
        });
        return res.status(201).json(conversation);
    } catch (err) {
        next(err);
    }
});

// GET /api/conversations — the caller's inbox (their active threads).
router.get("/conversations", requireAuth, async (req, res, next) => {
    try {
        return res.json(await listConversationsForUser({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/conversations/:id — one thread + participants. 403 if not a member.
router.get("/conversations/:id", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getConversationById({ conversation_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

// POST /api/conversations/:id/participants — add a member (caller must be a
// member). Body: { user_id, role }.
router.post("/conversations/:id/participants", requireAuth, async (req, res, next) => {
    try {
        const participant = await addParticipant({
            conversation_id: req.params.id,
            actor_user_id: req.user.id,
            user_id: req.body?.user_id,
            role: req.body?.role,
        });
        return res.status(201).json(participant);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/conversations/:id/participants/:userId — soft-remove a member.
router.delete("/conversations/:id/participants/:userId", requireAuth, async (req, res, next) => {
    try {
        const participant = await removeParticipant({
            conversation_id: req.params.id,
            actor_user_id: req.user.id,
            user_id: req.params.userId,
        });
        return res.json(participant);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/conversations/:id/read — stamp the caller's last_read_at.
router.patch("/conversations/:id/read", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await markConversationRead({ conversation_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

// PATCH /api/conversations/:id/leave — the caller soft-leaves the thread.
router.patch("/conversations/:id/leave", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await leaveConversation({ conversation_id: req.params.id, user_id: req.user.id })
        );
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
