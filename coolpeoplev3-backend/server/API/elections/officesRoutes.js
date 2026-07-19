const express = require("express");

const {
    listOffices,
    getOfficeById,
    getOfficeByJurisdiction,
    getOfficesByState,
    getOfficeEligibility,
    getQualifyingOffices,
    getRelevantOffices,
    upsertOffice,
} = require("../../DB/elections/offices");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "office" })];

// GET /offices?state=NY — all offices, or every office in a state when ?state.
router.get("/offices", async (req, res, next) => {
    try {
        const rows = req.query.state
            ? await getOfficesByState({ state: req.query.state })
            : await listOffices();
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /offices/qualifying — offices the authed user could run for (age + geo).
// Declared BEFORE /:id so "qualifying" isn't matched as an office id.
router.get("/offices/qualifying", authed, async (req, res, next) => {
    try {
        const rows = await getQualifyingOffices({ userId: req.user.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /offices/relevant — superset of /qualifying: every office in the user's
// districts + their state + national, WITHOUT the age gate. Each row carries
// `qualifies` and `relevance_tier` so the feed can show "you qualify" alongside
// "you don't qualify yet (age 25)" and remaining statewide offices.
router.get("/offices/relevant", authed, async (req, res, next) => {
    try {
        const rows = await getRelevantOffices({ userId: req.user.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /offices/:id/eligibility — displayed requirements (informational, not a gate).
router.get("/offices/:id/eligibility", async (req, res, next) => {
    try {
        const row = await getOfficeEligibility({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "office not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// GET /offices/:id — single office.
router.get("/offices/:id", async (req, res, next) => {
    try {
        const row = await getOfficeById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "office not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// GET /jurisdictions/:id/offices — every office in a jurisdiction.
router.get("/jurisdictions/:id/offices", async (req, res, next) => {
    try {
        const rows = await getOfficeByJurisdiction({ jurisdiction_id: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/offices — scraper / admin writer (source_key | id | insert).
router.post("/admin/offices", adminWrite("upsert_office"), async (req, res, next) => {
    try {
        const row = await upsertOffice(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
