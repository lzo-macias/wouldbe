const express = require("express");

const { listCategories, createCategory, setCategoryActive } = require("../../DB/elections/categories");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

const adminWrite = (action) => [
    requireAuth,
    requireAdmin(),
    recordAdminAction(action, { resourceType: "category" }),
];

// GET /api/categories?group=&includeInactive= — the issue-category picker list.
// Public read so signup / post composer / debate setup can all render it.
router.get("/categories", async (req, res, next) => {
    try {
        const rows = await listCategories({
            group: req.query.group,
            includeInactive: req.query.includeInactive === "true",
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/categories — admin extends the controlled vocabulary.
// Body: { category_key, display_name, category_group, description?, icon?, sort_order? }
router.post("/admin/categories", adminWrite("create_category"), async (req, res, next) => {
    try {
        const row = await createCategory(req.body || {});
        return res.status(201).json(row);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/admin/categories/:key — retire/reactivate (soft) or refresh metadata.
// Body: { is_active } and/or { display_name, category_group, ... }.
router.patch("/admin/categories/:key", adminWrite("update_category"), async (req, res, next) => {
    try {
        const { is_active, ...meta } = req.body || {};
        let row;
        if (Object.keys(meta).length) {
            row = await createCategory({ ...meta, category_key: req.params.key });
        }
        if (is_active !== undefined) {
            row = await setCategoryActive({ category_key: req.params.key, is_active: !!is_active });
        }
        if (!row) return res.status(400).json({ error: "nothing to update" });
        return res.json(row);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
