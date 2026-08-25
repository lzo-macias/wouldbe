const express = require("express");

const {
    listJurisdictionsV2,
    getJurisdictionByIdV2,
    getJurisdictionChildren,
    lookupJurisdictionsByLocationV2,
    upsertJurisdictionV2,
} = require("../../DB/elections/jurisdictions");

const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "jurisdiction" })];

// GET /jurisdictions/lookup — onboarding resolver by ocd/fips/state/type/name.
// Declared BEFORE /:id so "lookup" isn't swallowed by the id param.
router.get("/jurisdictions/lookup", async (req, res, next) => {
    try {
        const { ocd_division_id, fips_code, state_code, type, name } = req.query;
        const rows = await lookupJurisdictionsByLocationV2({ ocd_division_id, fips_code, state_code, type, name });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /jurisdictions — unified search (q, id, type, state_code, parent, limit).
router.get("/jurisdictions", async (req, res, next) => {
    try {
        const { q, id, type, state_code, parent_jurisdiction_id, limit } = req.query;
        const rows = await listJurisdictionsV2({ q, id, type, state_code, parent_jurisdiction_id, limit });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /jurisdictions/:id/children — direct children of a jurisdiction.
router.get("/jurisdictions/:id/children", async (req, res, next) => {
    try {
        const rows = await getJurisdictionChildren({ parent_id: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /jurisdictions/:id — single jurisdiction.
router.get("/jurisdictions/:id", async (req, res, next) => {
    try {
        const row = await getJurisdictionByIdV2({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "jurisdiction not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /admin/jurisdictions — sync-job / admin writer (upsert on ocd_division_id).
router.post("/admin/jurisdictions", adminWrite("upsert_jurisdiction"), async (req, res, next) => {
    try {
        const row = await upsertJurisdictionV2(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
