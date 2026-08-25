const express = require("express");

const {
    listPoliticians,
    getPoliticianById,
    getPoliticianTerms,
    claimPoliticianProfile,
    upsertPolitician,
} = require("../../DB/candidacy/politicians");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "politician" })];

// GET /politicians — full roster (alphabetical by last name).
router.get("/politicians", async (_req, res, next) => {
    try {
        const rows = await listPoliticians();
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /politicians/:id/terms — office-holding history (joined to office/jurisdiction).
router.get("/politicians/:id/terms", async (req, res, next) => {
    try {
        const rows = await getPoliticianTerms({ id: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /politicians/:id — single politician.
router.get("/politicians/:id", async (req, res, next) => {
    try {
        const row = await getPoliticianById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "politician not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /politicians/:id/claim — the authed user claims an unclaimed profile.
router.post("/politicians/:id/claim", authed, async (req, res, next) => {
    try {
        const row = await claimPoliticianProfile({ user_id: req.user.id, id: req.params.id });
        return res.json(row);
    } catch (err) {
        if (/not found or already claimed/i.test(err.message)) {
            return res.status(409).json({ error: err.message });
        }
        next(err);
    }
});

// POST /admin/politicians — scraper / admin writer (id → update; else insert).
router.post("/admin/politicians", adminWrite("upsert_politician"), async (req, res, next) => {
    try {
        const row = await upsertPolitician(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
