const { client } = require("../index.js")

// ============================================================================
// category_judging_criteria — the CATALOG of pre-disclosed judging criteria,
// one rubric per debate category.
//
// This is the source of truth the apply form renders and the source
// applyCategoryCriteria() copies from when a debate is created. It is NOT what
// a debate is judged on: that is debate_judging_criteria, a per-debate SNAPSHOT
// taken at creation time (see debateCriteria.js). Editing the catalog changes
// what future debates disclose and leaves every existing debate untouched —
// pre-disclosure is only meaningful if the published text can't move afterwards.
//
// Category matching is case-insensitive because debates.category is free text
// (the form's "other" option). A category with no catalog rows yields no
// criteria and no error; an admin adds them per-debate through the existing
// POST /api/debates/:id/criteria.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const DEFAULT_VERSION = "v1"

// getCategoryRubric — the active criteria for one category, in display order.
// version defaults to the newest version on file for that category, so adding a
// 'v2' switches new debates over without a code change.
const getCategoryRubric = async ({ category, criteria_version = null }, db = client) => {
    if (!category) throw httpError(400, "category is required")
    const SQL = `
        SELECT * FROM category_judging_criteria
        WHERE LOWER(category) = LOWER($1)
          AND is_active = true
          AND criteria_version = COALESCE(
                $2,
                (SELECT MAX(criteria_version) FROM category_judging_criteria
                 WHERE LOWER(category) = LOWER($1) AND is_active = true)
              )
        ORDER BY display_order, created_at
    `
    const { rows } = await db.query(SQL, [String(category).trim(), criteria_version])
    return rows
}

// listCategoryRubrics — the whole catalog grouped by category. What the admin
// screen and the apply form both read; the form picks its category out of the
// object rather than making one request per category.
const listCategoryRubrics = async ({ include_inactive = false } = {}) => {
    const SQL = `
        SELECT * FROM category_judging_criteria
        WHERE ($1::boolean IS TRUE OR is_active = true)
        ORDER BY category, display_order, created_at
    `
    const { rows } = await client.query(SQL, [include_inactive])
    const byCategory = {}
    for (const row of rows) {
        if (!byCategory[row.category]) byCategory[row.category] = []
        byCategory[row.category].push(row)
    }
    return byCategory
}

// applyCategoryCriteria — copy a category's rubric onto a debate.
//
// Runs on the CALLER'S transaction (db = tx) so a debate is never created
// without its criteria: submitDebateApplication passes its tx, and any failure
// here rolls the debate back with it.
//
// ON CONFLICT DO NOTHING makes it idempotent — re-running for a debate that
// already has a criterion with that key is a no-op rather than a 23505, which
// matters for the admin backfill path.
//
// Returns { applied, criteria_version, criteria }. applied is 0 when the
// category has no rubric ("other", or a free-text category); that is a valid
// outcome, not an error — the caller decides whether to care.
const applyCategoryCriteria = async ({ debate_id, category, criteria_version = null }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!category) return { applied: 0, criteria_version: null, criteria: [] }

    const rubric = await getCategoryRubric({ category, criteria_version }, db)
    if (!rubric.length) return { applied: 0, criteria_version: null, criteria: [] }

    const version = rubric[0].criteria_version
    const inserted = []
    for (const c of rubric) {
        const { rows } = await db.query(
            `INSERT INTO debate_judging_criteria
                (debate_id, criterion_key, display_name, description, weight, display_order)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (debate_id, criterion_key) DO NOTHING
             RETURNING *;`,
            [debate_id, c.criterion_key, c.display_name, c.description, c.weight, c.display_order]
        )
        if (rows.length) inserted.push(rows[0])
    }

    // Stamp which catalog version this debate's published criteria came from, so
    // a user_criteria_acknowledgments row can be tied back to exact text.
    await db.query(`UPDATE debates SET criteria_version = $2 WHERE id = $1`, [debate_id, version])

    return { applied: inserted.length, criteria_version: version, criteria: inserted }
}

// applyCategoryCriteriaToDebate — the admin backfill path. Reads the debate's
// own category (so the caller can't retag a debate by accident) unless one is
// passed explicitly, then applies. 404s when the debate doesn't exist.
const applyCategoryCriteriaToDebate = async ({ debate_id, category = null, criteria_version = null }) => {
    const { rows } = await client.query(`SELECT id, category FROM debates WHERE id = $1`, [debate_id])
    if (!rows.length) throw httpError(404, "debate not found")
    return applyCategoryCriteria({
        debate_id: rows[0].id,
        category: category || rows[0].category,
        criteria_version,
    })
}

// upsertCategoryCriterion — admin edit of the catalog. Keyed on the natural key
// (category, criteria_version, criterion_key) so re-posting the same criterion
// updates it instead of erroring.
const upsertCategoryCriterion = async ({
    category,
    criterion_key,
    display_name,
    description,
    weight,
    display_order = 0,
    criteria_version = DEFAULT_VERSION,
    is_active = true,
}) => {
    if (!category || !criterion_key || !display_name || !description || weight == null) {
        throw httpError(400, "category, criterion_key, display_name, description and weight are required")
    }
    const w = Number(weight)
    if (!(w > 0 && w <= 1)) throw httpError(400, "weight must be a fraction in (0, 1] — 25% is 0.25")
    try {
        const { rows } = await client.query(
            `INSERT INTO category_judging_criteria
                (category, criteria_version, criterion_key, display_name, description, weight, display_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (category, criteria_version, criterion_key) DO UPDATE SET
                display_name  = EXCLUDED.display_name,
                description   = EXCLUDED.description,
                weight        = EXCLUDED.weight,
                display_order = EXCLUDED.display_order,
                is_active     = EXCLUDED.is_active,
                updated_at    = NOW()
             RETURNING *;`,
            [String(category).trim(), criteria_version, criterion_key, display_name, description, w, display_order, is_active]
        )
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "weight must be greater than 0 and at most 1")
        console.error(err)
        throw err
    }
}

// validateRubricWeights — does a category's rubric sum to ~1.0? The per-debate
// equivalent is validateCriteriaWeightsSum in debateCriteria.js; this one checks
// the catalog BEFORE it gets copied onto any debate.
const validateRubricWeights = async ({ category, criteria_version = null, tolerance = 0.001 }) => {
    const rubric = await getCategoryRubric({ category, criteria_version })
    const total = rubric.reduce((sum, c) => sum + Number(c.weight), 0)
    return {
        category,
        criteria_version: rubric.length ? rubric[0].criteria_version : null,
        count: rubric.length,
        total,
        valid: rubric.length > 0 && Math.abs(total - 1) <= tolerance,
    }
}

module.exports = {
    DEFAULT_VERSION,
    getCategoryRubric,
    listCategoryRubrics,
    applyCategoryCriteria,
    applyCategoryCriteriaToDebate,
    upsertCategoryCriterion,
    validateRubricWeights,
}
