const { client } = require("../index.js");

// ============================================================================
// plan_component_categories — the canonical issue taxonomy (controlled
// vocabulary). Users/posts/prompts/plan_components all FK into category_key.
// Reads are public; writes are admin-only (see categoriesRoutes) so the
// vocabulary stays clean. Adding a category later is just createCategory() — no
// migration needed, because this is a reference table, not an enum.
// ============================================================================

// listCategories({ group, includeInactive }) — the picker list. Active-only by
// default, ordered for display.
const listCategories = async ({ group, includeInactive = false } = {}) => {
    try {
        const SQL = `
            SELECT category_key, display_name, category_group, description, icon, sort_order, is_active
            FROM plan_component_categories
            WHERE ($1::text    IS NULL OR category_group = $1)
              AND ($2::boolean OR is_active = true)
            ORDER BY category_group, sort_order NULLS LAST, display_name
        `;
        const { rows } = await client.query(SQL, [group ?? null, includeInactive]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// createCategory(...) — admin-only. Upsert on the natural key (category_key) so
// re-adding refreshes metadata instead of erroring. category_key should be a
// stable snake_case slug.
const createCategory = async ({
    category_key,
    display_name,
    category_group,
    description = null,
    icon = null,
    sort_order = null,
}) => {
    if (!category_key || !display_name || !category_group) {
        const e = new Error("category_key, display_name, and category_group are required");
        e.status = 400;
        throw e;
    }
    try {
        const SQL = `
            INSERT INTO plan_component_categories
                (category_key, display_name, category_group, description, icon, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (category_key) DO UPDATE SET
                display_name   = EXCLUDED.display_name,
                category_group = EXCLUDED.category_group,
                description    = EXCLUDED.description,
                icon           = EXCLUDED.icon,
                sort_order     = EXCLUDED.sort_order
            RETURNING *;
        `;
        const { rows } = await client.query(SQL, [
            category_key, display_name, category_group, description, icon, sort_order,
        ]);
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// setCategoryActive({ category_key, is_active }) — admin-only soft toggle.
// Retiring a category keeps historic FKs intact (it just drops out of pickers).
const setCategoryActive = async ({ category_key, is_active }) => {
    try {
        const { rows } = await client.query(
            `UPDATE plan_component_categories SET is_active = $2 WHERE category_key = $1 RETURNING *`,
            [category_key, is_active]
        );
        if (!rows.length) {
            const e = new Error("no category with that key");
            e.status = 404;
            throw e;
        }
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = { listCategories, createCategory, setCategoryActive };
