const express = require("express");

const {
    getAnchors,
    upsertElectionAnchor,
    getOffsetRules,
    upsertOffsetRule,
    computeDeadlinesForOffice,
} = require("../../DB/elections/electionCalendar");

const { requireAuth, requireAdmin, requireInternal, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "election_calendar" })];

// GET /election-anchors?jurisdictionId&cycle — the cycle's anchor dates.
router.get("/election-anchors", async (req, res, next) => {
    try {
        const rows = await getAnchors({
            jurisdiction_id: req.query.jurisdictionId,
            cycle: req.query.cycle,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/election-anchors — admin writer (atomic ON CONFLICT upsert).
router.post("/admin/election-anchors", adminWrite("upsert_election_anchor"), async (req, res, next) => {
    try {
        const row = await upsertElectionAnchor(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// GET /offset-rules?jurisdictionId&officeId&deadlineType — offset rules.
router.get("/offset-rules", async (req, res, next) => {
    try {
        const rows = await getOffsetRules({
            jurisdictionId: req.query.jurisdictionId,
            officeId: req.query.officeId,
            deadlineType: req.query.deadlineType,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/offset-rules — admin writer (id → update; else insert).
router.post("/admin/offset-rules", adminWrite("upsert_offset_rule"), async (req, res, next) => {
    try {
        const row = await upsertOffsetRule(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// POST /internal/election-calendar/recompute — the §6 engine. Body: { officeId, cycle }.
// Reads anchors + offset rules → writes computed election_deadlines (is_tbd where unencoded).
router.post("/internal/election-calendar/recompute", requireInternal, async (req, res, next) => {
    try {
        const { officeId, cycle } = req.body;
        const rows = await computeDeadlinesForOffice({ officeId, cycle });
        return res.json({ office_id: officeId, cycle, computed: rows });
    } catch (err) {
        if (/no office with this id/i.test(err.message) || /are required/i.test(err.message)) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});

module.exports = { router };
