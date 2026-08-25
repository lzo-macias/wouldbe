const { client, withTransaction } = require("../index.js");

// ============================================================================
// §17 notification_criteria_versions — the frozen "pre-established objective
// criteria" (11 CFR 110.13) that govern candidate-facing notification sends.
//
// WHY versioned-as-data: the safe harbor is that EVERY candidate ran through the
// same neutral formula. So we freeze the algorithm's parameters as a jsonb row,
// version them, and pin each notification to the version in force when it fired
// (notifications.criteria_version_id). "Current" = the open row
// (effective_until IS NULL); publishing a new version closes the prior one.
// Mirrors jurisdiction_rules_versions / rulesVersions exactly.
//
// Append-only: never UPDATE a published row's parameters — supersede it by
// inserting a new version and stamping effective_until on the old one.
// ============================================================================

// the only algorithm_key the table's CHECK allows today; validated up-front so a
// typo is a clean 400 rather than a raw 23514.
const ALGORITHM_KEYS = ["wouldbe_notification"];

// getCurrentCriteria({ algorithmKey }) — the in-force version (the open row,
// effective_until IS NULL). This is what the engine reads on every evaluation.
const getCurrentCriteria = async ({ algorithmKey = "wouldbe_notification" } = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT * FROM notification_criteria_versions
             WHERE algorithm_key = $1 AND effective_until IS NULL`,
            [algorithmKey]
        );
        return rows[0] || null;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a field is malformed");
        console.error(err);
        throw err;
    }
};

// listCriteriaVersions({ algorithmKey }) — full append-only history, newest
// first. The audit view: every formula that was ever in effect.
const listCriteriaVersions = async ({ algorithmKey = "wouldbe_notification" } = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT * FROM notification_criteria_versions
             WHERE algorithm_key = $1
             ORDER BY version DESC`,
            [algorithmKey]
        );
        return rows;
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "a field is malformed");
        console.error(err);
        throw err;
    }
};

// publishCriteriaVersion — open a new version and close the prior one atomically.
// Admin-only at the route layer; created_by_user_id is the publishing admin.
// The version number is auto-derived (MAX(version)+1) under the transaction so
// concurrent publishes can't collide on the unique (algorithm_key, version).
const publishCriteriaVersion = async ({
    algorithmKey = "wouldbe_notification",
    description = null,
    parameters,
    effective_from = null,
    created_by_user_id = null,
}) => {
    if (!ALGORITHM_KEYS.includes(algorithmKey)) {
        throw httpError(400, `algorithm_key must be one of: ${ALGORITHM_KEYS.join(", ")}`);
    }
    if (parameters == null || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw httpError(400, "parameters (a JSON object) is required");
    }
    try {
        return await withTransaction(async (tx) => {
            // next version number for this algorithm (1 if none yet).
            const { rows: vRows } = await tx.query(
                `SELECT COALESCE(MAX(version), 0) + 1 AS next
                 FROM notification_criteria_versions
                 WHERE algorithm_key = $1`,
                [algorithmKey]
            );
            const nextVersion = vRows[0].next;

            // when the new version takes effect (defaults to now()).
            const effectiveFrom = effective_from || new Date().toISOString();

            // close the currently-open version (set its effective_until to the
            // new version's effective_from). No-op on the very first publish.
            await tx.query(
                `UPDATE notification_criteria_versions
                 SET effective_until = $2
                 WHERE algorithm_key = $1 AND effective_until IS NULL`,
                [algorithmKey, effectiveFrom]
            );

            const { rows } = await tx.query(
                `INSERT INTO notification_criteria_versions
                   (algorithm_key, version, description, parameters,
                    effective_from, effective_until, created_by_user_id)
                 VALUES ($1, $2, $3, $4, $5, NULL, $6)
                 RETURNING *`,
                [
                    algorithmKey,
                    nextVersion,
                    description,
                    JSON.stringify(parameters),
                    effectiveFrom,
                    created_by_user_id,
                ]
            );
            return rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "that criteria version already exists");
        if (err.code === "23503") throw httpError(400, "created_by_user_id does not exist");
        if (err.code === "23514") throw httpError(400, "a criteria field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid/json field is malformed");
        console.error(err);
        throw err;
    }
};

// tiny helper so routes can map thrown errors to status codes
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

module.exports = {
    ALGORITHM_KEYS,
    getCurrentCriteria,
    listCriteriaVersions,
    publishCriteriaVersion,
};
