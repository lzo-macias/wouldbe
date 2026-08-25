const { client } = require("../index.js")

// ============================================================================
// debate_judging_criteria — the weighted dimensions a debate is scored on.
// weight is a FRACTION (numeric(4,3), 0 < weight <= 1); a debate's criteria are
// meant to sum to ~1.0 (validateCriteriaWeightsSum). (debate_id, criterion_key)
// is UNIQUE, so the DB enforces no duplicate key per debate — no manual pre-check.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const assertWeight = (weight) => {
    const w = Number(weight)
    if (!(w > 0 && w <= 1)) throw httpError(400, "weight must be a fraction in (0, 1]")
    return w
}

// addCriterion — insert one scoring dimension. Relies on the unique constraint
// for duplicate detection (no transaction needed).
const addCriterion = async ({
    debate_id,
    criterion_key,
    display_name,
    description,
    weight,
    display_order = 0,
}) => {
    if (!debate_id || !criterion_key || !display_name || !description || weight == null) {
        throw httpError(400, "debate_id, criterion_key, display_name, description and weight are required")
    }
    const w = assertWeight(weight)
    try {
        const SQL = `
            INSERT INTO debate_judging_criteria (
                debate_id, criterion_key, display_name, description, weight, display_order
            ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
            RETURNING *;
        `
        const result = await client.query(SQL, [debate_id, criterion_key, display_name, description, w, display_order])
        return result.rows[0]
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "a criterion with this criterion_key already exists for this debate")
        if (err.code === "23514") throw httpError(400, "weight must be greater than 0 and at most 1")
        if (err.code === "23503") throw httpError(400, "debate_id does not exist")
        console.error(err)
        throw err
    }
}

// getDebateCriteria — all criteria for a debate, in display order.
const getDebateCriteria = async ({ debate_id }) => {
    const SQL = `
        SELECT * FROM debate_judging_criteria
        WHERE debate_id = $1
        ORDER BY display_order, created_at
    `
    const result = await client.query(SQL, [debate_id])
    return result.rows
}

// updateCriterion — edit an existing criterion (keyed on criterion_id). COALESCE
// keeps existing values when a field is omitted; PK/debate_id/created_at are fixed.
const updateCriterion = async ({
    criterion_id,
    criterion_key = null,
    display_name = null,
    description = null,
    weight = null,
    display_order = null,
}) => {
    if (!criterion_id) throw httpError(400, "criterion_id is required")
    if (weight != null) assertWeight(weight)
    try {
        const SQL = `
            UPDATE debate_judging_criteria SET
                criterion_key = COALESCE($2, criterion_key),
                display_name  = COALESCE($3, display_name),
                description   = COALESCE($4, description),
                weight        = COALESCE($5, weight),
                display_order = COALESCE($6, display_order)
            WHERE criterion_id = $1
            RETURNING *;
        `
        const result = await client.query(SQL, [
            criterion_id, criterion_key, display_name, description, weight, display_order,
        ])
        if (!result.rows.length) throw httpError(404, "criterion not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "a criterion with this criterion_key already exists for this debate")
        if (err.code === "23514") throw httpError(400, "weight must be greater than 0 and at most 1")
        console.error(err)
        throw err
    }
}

// deleteCriterion — remove a criterion.
const deleteCriterion = async ({ criterion_id }) => {
    const SQL = `DELETE FROM debate_judging_criteria WHERE criterion_id = $1 RETURNING *`
    const result = await client.query(SQL, [criterion_id])
    if (!result.rows.length) throw httpError(404, "criterion not found")
    return { deleted: result.rows[0].criterion_id, criterion: result.rows[0] }
}

// validateCriteriaWeightsSum — do a debate's criteria weights sum to ~1.0?
// Returns the running total, count, and a valid flag (within a small tolerance).
// Call after add/update so a debate can't be scored on weights that don't add up.
const validateCriteriaWeightsSum = async ({ debate_id, tolerance = 0.001 }) => {
    const SQL = `
        SELECT COALESCE(SUM(weight), 0)::float AS total, COUNT(*)::int AS count
        FROM debate_judging_criteria WHERE debate_id = $1
    `
    const result = await client.query(SQL, [debate_id])
    const { total, count } = result.rows[0]
    return { debate_id, total, count, valid: count > 0 && Math.abs(total - 1) <= tolerance }
}

module.exports = {
    addCriterion,
    getDebateCriteria,
    updateCriterion,
    deleteCriterion,
    validateCriteriaWeightsSum,
}
