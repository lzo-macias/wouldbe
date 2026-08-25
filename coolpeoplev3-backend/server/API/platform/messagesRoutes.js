const express = require("express");

const {
    sendMessage,
    getMessages,
    updateMessage,
    softDeleteMessage,
} = require("../../DB/platform/messages");
const { requireAuth } = require("../../middleware");

const router = express.Router();

// POST /api/conversations/:id/messages — post into a thread. sender = caller
// (from token); the DB layer enforces the sender is a participant (403 else).
// Body: { body, attachment_url, reply_to_message_id }.
router.post("/conversations/:id/messages", requireAuth, async (req, res, next) => {
    try {
        const message = await sendMessage({
            conversation_id: req.params.id,
            sender_user_id: req.user.id,
            body: req.body?.body,
            attachment_url: req.body?.attachment_url,
            reply_to_message_id: req.body?.reply_to_message_id,
        });
        return res.status(201).json(message);
    } catch (err) {
        next(err);
    }
});

// GET /api/conversations/:id/messages — paginated history. 403 if not a member.
// Query: ?limit=&before= (ISO timestamp cursor).
router.get("/conversations/:id/messages", requireAuth, async (req, res, next) => {
    try {
        const messages = await getMessages({
            conversation_id: req.params.id,
            user_id: req.user.id,
            limit: req.query.limit,
            before: req.query.before || null,
        });
        return res.json(messages);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/conversations/:id/messages/:messageId — author edits their message.
router.patch("/conversations/:id/messages/:messageId", requireAuth, async (req, res, next) => {
    try {
        const message = await updateMessage({
            id: req.params.messageId,
            sender_user_id: req.user.id,
            body: req.body?.body,
            attachment_url: req.body?.attachment_url,
        });
        return res.json(message);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/conversations/:id/messages/:messageId — author soft-deletes their
// message (sets deleted_at; never a hard delete).
router.delete("/conversations/:id/messages/:messageId", requireAuth, async (req, res, next) => {
    try {
        const message = await softDeleteMessage({
            id: req.params.messageId,
            sender_user_id: req.user.id,
        });
        return res.json(message);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
