const express = require("express");

const {
    recordCriteriaAck,
    getUserCriteriaAcks,
    hasUserAckedCriteria,
} = require("../../DB/debate/criteriaAcks");
const { requireAuth, captureRequestContext } = require("../../middleware");

const router = express.Router();

// POST /api/criteria-acks — record (idempotent) that the caller saw the criteria
// for a debate/context. captureRequestContext stamps ip + user_agent onto the
// legal record. Body: { debate_id, ack_type, criteria_version, rules_version_seen }.
router.post("/criteria-acks", captureRequestContext, requireAuth, async (req, res, next) => {
    try {
        const ack = await recordCriteriaAck({
            user_id: req.user.id,
            debate_id: req.body.debate_id,
            ack_type: req.body.ack_type,
            criteria_version: req.body.criteria_version,
            rules_version_seen: req.body.rules_version_seen,
            ip_address: req.context?.ip_address,
            user_agent: req.context?.user_agent,
        });
        return res.status(201).json(ack);
    } catch (err) {
        next(err);
    }
});

// GET /api/criteria-acks/has — boolean gate check (?ack_type=&debate_id=).
// Declared before the bare list route so the literal path matches first.
router.get("/criteria-acks/has", requireAuth, async (req, res, next) => {
    try {
        const acked = await hasUserAckedCriteria({
            user_id: req.user.id,
            ack_type: req.query.ack_type,
            debate_id: req.query.debate_id || null,
        });
        return res.json({ acked });
    } catch (err) {
        next(err);
    }
});

// GET /api/criteria-acks — the caller's acks (optional ?debate_id=).
router.get("/criteria-acks", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await getUserCriteriaAcks({ user_id: req.user.id, debate_id: req.query.debate_id || null })
        );
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
