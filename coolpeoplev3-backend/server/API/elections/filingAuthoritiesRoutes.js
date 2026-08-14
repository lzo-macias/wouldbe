const express = require("express");

const {
    getFilingAuthorityFor,
    listFilingAuthorities,
    getFilingAuthorityById,
    upsertFilingAuthority,
    recordLinkHealth,
} = require("../../DB/elections/filingAuthorities");

const { requireAuth, requireAdmin, requireInternal, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminWrite = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "filing_authority" })];

// GET /filing-authorities/for?jurisdictionId&officeId — the SINGLE authority a
// candidate files with (most specific: office-specific beats jurisdiction-wide).
// Declared before /:id so "for" isn't matched as an id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/filing-authorities/for", async (req, res, next) => {
    try {
        // Validate before touching pg. A caller sending the literal string
        // "undefined" (the classic templated-URL bug) reached the query and blew
        // up as an unhandled 22P02 — a 500 that reads like a server fault when it
        // is a malformed request.
        const { jurisdictionId, officeId } = req.query;
        if (!jurisdictionId || !UUID_RE.test(jurisdictionId)) {
            return res.status(400).json({ error: "jurisdictionId is required and must be a valid uuid" });
        }
        if (officeId && !UUID_RE.test(officeId)) {
            return res.status(400).json({ error: "officeId must be a valid uuid" });
        }

        const row = await getFilingAuthorityFor({ jurisdictionId, officeId });
        if (!row) return res.status(404).json({ error: "no filing authority for that jurisdiction/office" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// GET /filing-authorities — list with optional filters (jurisdiction_id,
// applies_to_office_id, authority_level, link_status, is_active).
router.get("/filing-authorities", async (req, res, next) => {
    try {
        const { jurisdiction_id, applies_to_office_id, authority_level, link_status, is_active, limit } = req.query;
        const rows = await listFilingAuthorities({
            jurisdiction_id,
            applies_to_office_id,
            authority_level,
            link_status,
            // pass through only when explicitly provided so the default (active-only) holds
            is_active: is_active === undefined ? undefined : is_active === "true",
            limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /filing-authorities/:id — single authority.
router.get("/filing-authorities/:id", async (req, res, next) => {
    try {
        const row = await getFilingAuthorityById({ id: req.params.id });
        if (!row) return res.status(404).json({ error: "filing authority not found" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

// POST /admin/filing-authorities — admin writer (insert; or update when body.id set).
router.post("/admin/filing-authorities", adminWrite("upsert_filing_authority"), async (req, res, next) => {
    try {
        const row = await upsertFilingAuthority(req.body);
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// PATCH /admin/filing-authorities/:id — partial update of one authority.
router.patch("/admin/filing-authorities/:id", adminWrite("upsert_filing_authority"), async (req, res, next) => {
    try {
        const row = await upsertFilingAuthority({ ...req.body, id: req.params.id });
        return res.json(row);
    } catch (err) {
        if (/no filing authority with this id/i.test(err.message)) {
            return res.status(404).json({ error: err.message });
        }
        next(err);
    }
});

// POST /internal/filing-authorities/:id/link-health — the §8 cron's writer.
// Body: { status } ∈ healthy|broken|redirected|unknown.
router.post("/internal/filing-authorities/:id/link-health", requireInternal, async (req, res, next) => {
    try {
        const row = await recordLinkHealth({ id: req.params.id, status: req.body?.status });
        return res.json(row);
    } catch (err) {
        if (/no filing authority with this id/i.test(err.message)) {
            return res.status(404).json({ error: err.message });
        }
        next(err);
    }
});

module.exports = { router };
