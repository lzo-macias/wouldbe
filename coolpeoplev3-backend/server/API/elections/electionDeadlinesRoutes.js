const express = require("express");

const {
    listElectionDeadlines,
    getDeadlineCalendar,
    getDeadlinesByJurisdiction,
    upsertElectionDeadline,
} = require("../../DB/elections/electionDeadline");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "election_deadline" })];

// GET /election-deadlines?state_code=&deadline_type=&limit= — filterable list.
router.get("/election-deadlines", async (req, res, next) => {
    try {
        const rows = await listElectionDeadlines({
            state_code: req.query.state_code,
            deadline_type: req.query.deadline_type,
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /election-deadlines/calendar?from&to — the authed user's personalized
// calendar (deadlines for the jurisdictions they belong to).
router.get("/election-deadlines/calendar", authed, async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const rows = await getDeadlineCalendar({
            userId: req.user.id,
            range: { from, to },
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /jurisdictions/:id/deadlines — deadlines for one jurisdiction (by id).
router.get("/jurisdictions/:id/deadlines", async (req, res, next) => {
    try {
        const rows = await getDeadlinesByJurisdiction({ id: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/election-deadlines — admin writer (id → update; else insert).
router.post("/admin/election-deadlines", adminWrite("upsert_election_deadline"), async (req, res, next) => {
    try {
        const row = await upsertElectionDeadline(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
