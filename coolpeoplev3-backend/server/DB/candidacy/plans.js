const { client } = require("../index.js");

// ============================================================================
// plan + plan_components — the candidate's policy platform. One plan per WouldBe;
// each component is a position in a controlled category (plan_component_categories,
// the admin-curated taxonomy). Components are the "here's my stance on housing"
// entries shown on the WouldBe.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createPlan — one plan per WouldBe. office_id is denormalized off the WouldBe so
// the plan can be queried without a join. Idempotent-ish: a WouldBe should have a
// single plan, so we 409 if one already exists.
const createPlan = async ({ wouldbe_id, user_id, office_id = null }) => {
    if (!wouldbe_id || !user_id) throw httpError(400, "wouldbe_id and user_id are required");
    const existing = await client.query(`SELECT id FROM plan WHERE wouldbe_id = $1`, [wouldbe_id]);
    if (existing.rows.length) throw httpError(409, "this WouldBe already has a plan");
    try {
        const { rows } = await client.query(
            `INSERT INTO plan (wouldbe_id, user_id, office_id) VALUES ($1,$2,$3) RETURNING *`,
            [wouldbe_id, user_id, office_id]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "wouldbe_id, user_id or office_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getPlanForWouldbe — the plan plus its components (joined to category display).
const getPlanForWouldbe = async ({ wouldbeId }) => {
    const planRes = await client.query(`SELECT * FROM plan WHERE wouldbe_id = $1`, [wouldbeId]);
    const plan = planRes.rows[0];
    if (!plan) return null;
    const comps = await client.query(
        `SELECT pc.*, cat.display_name AS category_name, cat.category_group
         FROM plan_components pc
         JOIN plan_component_categories cat ON cat.category_key = pc.category_key
         WHERE pc.plan_id = $1
         ORDER BY cat.sort_order NULLS LAST, pc.created_at`,
        [plan.id]
    );
    return { ...plan, components: comps.rows };
};

// addPlanComponent — a position entry under one category.
const addPlanComponent = async ({ plan_id, category_key, title, description }) => {
    if (!plan_id || !category_key || !title || !description) {
        throw httpError(400, "plan_id, category_key, title and description are required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO plan_components (plan_id, category_key, title, description)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [plan_id, category_key, title, description]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "plan_id or category_key does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// updatePlanComponent — edit a component's category/title/description.
const updatePlanComponent = async ({ id, category_key = null, title = null, description = null }) => {
    try {
        const { rows } = await client.query(
            `UPDATE plan_components SET
                category_key = COALESCE($2, category_key),
                title        = COALESCE($3, title),
                description  = COALESCE($4, description)
             WHERE id = $1 RETURNING *`,
            [id, category_key, title, description]
        );
        if (!rows.length) throw httpError(404, "plan component not found");
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23503") throw httpError(400, "category_key does not exist");
        console.error(err);
        throw err;
    }
};

// deletePlanComponent — remove a component.
const deletePlanComponent = async ({ id }) => {
    const { rows } = await client.query(`DELETE FROM plan_components WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) throw httpError(404, "plan component not found");
    return { deleted: rows[0].id };
};

// listPlanCategories — the controlled taxonomy (active by default).
const listPlanCategories = async ({ includeInactive = false } = {}) => {
    const { rows } = await client.query(
        `SELECT * FROM plan_component_categories
         WHERE ($1::boolean = true OR is_active = true)
         ORDER BY sort_order NULLS LAST, display_name`,
        [includeInactive]
    );
    return rows;
};

// createPlanCategory — admin extends the taxonomy (INSERT, not a migration).
const createPlanCategory = async ({
    category_key, display_name, category_group, description = null, icon = null, sort_order = null, is_active = true,
}) => {
    if (!category_key || !display_name || !category_group) {
        throw httpError(400, "category_key, display_name and category_group are required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO plan_component_categories
               (category_key, display_name, category_group, description, icon, sort_order, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [category_key, display_name, category_group, description, icon, sort_order, is_active]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "a category with this category_key already exists");
        console.error(err);
        throw err;
    }
};

module.exports = {
    createPlan,
    getPlanForWouldbe,
    addPlanComponent,
    updatePlanComponent,
    deletePlanComponent,
    listPlanCategories,
    createPlanCategory,
};
