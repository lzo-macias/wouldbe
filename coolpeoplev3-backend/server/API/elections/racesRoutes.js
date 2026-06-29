const express = require("express");

const {
    listRaces,
    getRaceById,
    getUpcomingRaces,
    getRaceCandidates,
    approveRaceForPlatform,
    upsertRace,
} = require("../../DB/elections/races");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "race" })];

// GET /races — filtered list (office_id, election_cycle, election_type, approved).
router.get("/races", async (req, res, next) => {
    try {
        const { office_id, election_cycle, election_type, is_approved_on_platform, limit } = req.query;
        const rows = await listRaces({ office_id, election_cycle, election_type, is_approved_on_platform, limit });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /races/upcoming — races whose general date is in the future. Before /:id.
router.get("/races/upcoming", async (_req, res, next) => {
    try {
        const rows = await getUpcomingRaces();
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /races/:id/candidates — WouldBe campaigns running in this race.
router.get("/races/:id/candidates", async (req, res, next) => {
    try {
        const rows = await getRaceCandidates({ id: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /races/:id — single race.
router.get("/races/:id", async (req, res, next) => {
    try {
        const row = await getRaceById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "race not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /admin/races/:id/approve — flip is_approved_on_platform. Body: { approved }.
router.post("/admin/races/:id/approve", adminWrite("approve_race"), async (req, res, next) => {
    try {
        const row = await approveRaceForPlatform({ id: req.params.id, approved: req.body?.approved ?? true });
        return res.json(row);
    } catch (err) {
        if (/no race with this id/i.test(err.message)) {
            return res.status(404).json({ error: err.message });
        }
        next(err);
    }
});

// POST /admin/races — scraper / admin writer (id → update; else insert).
router.post("/admin/races", adminWrite("upsert_race"), async (req, res, next) => {
    try {
        const row = await upsertRace(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
