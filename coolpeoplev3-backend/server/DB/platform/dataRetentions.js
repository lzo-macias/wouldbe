const { client, withTransaction } = require("../index.js")

// listRetentionPolicies(filters) — By category, active_until IS NULL.


const listRetentionPoliciesV2 = async ({
    category,
}) => {
    try {
        const SQL = `
            SELECT *
            FROM data_retention_policies
            WHERE data_category = $1
                AND active_until IS NULL
            ORDER BY active_from DESC
        `

        const result = await client.query(SQL, [category])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}


// upsertRetentionPolicy(data) — Close prior + INSERT new.

const upsertRetentionPolicyV2 = async ({
    category,
    retention_basis,
    retention_period_days,
    legal_basis,
    deletion_method,
    active_from,
}) => {
    try {
        return await withTransaction(async (tx) => {
            // close only the currently-active policy, as of when the new one starts
            await tx.query(
                `UPDATE data_retention_policies
                    SET active_until = $2
                    WHERE data_category = $1
                        AND active_until IS NULL`,
                [category, active_from],
            )

            const SQL = `
                INSERT INTO data_retention_policies (
                    id,
                    data_category,
                    retention_basis,
                    retention_period_days,
                    legal_basis,
                    deletion_method,
                    active_from,
                    active_until,
                    created_at
                ) VALUES (
                    uuid_generate_v4(),
                    $1, $2, $3, $4, $5, $6,
                    NULL,
                    NOW()
                )
                RETURNING *;
            `

            const result = await tx.query(SQL, [
                category,
                retention_basis,
                retention_period_days,
                legal_basis,
                deletion_method,
                active_from,
            ])

            return result.rows[0]
        })
    }catch(err){
        console.error(err)
        throw err
    }
}

// queueRetentionPurgeJob() — Enqueue system_jobs.
// --- FIXED ---
// Fixes: only the fields set at enqueue time — job_type is fixed
// ('retention_purge'); id/status/attempt_count/scheduled_for/created_at fall to
// their column defaults; started_at/completed_at/error_message/result_payload are
// written later by the worker, not here. Optional policy_id targets one policy;
// omit it for a global sweep. Completes the INSERT (VALUES + params + RETURNING)
// and returns the created job.
const queueRetentionPurgeJob = async ({
    policy_id = null,
} = {}) => {
    try {
        const SQL = `
            INSERT INTO system_jobs (
                job_type,
                target_resource_type,
                target_resource_id
            ) VALUES (
                'retention_purge',
                $1,
                $2
            )
            RETURNING *;
        `

        const result = await client.query(SQL, [
            policy_id ? 'data_retention_policy' : null,
            policy_id,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// getActivePolicyForCategory(category) — Used by deletion jobs.
// The active policy is the open-ended one (active_until IS NULL). Returns a
// single row (or undefined). LIMIT 1 is a safety net; the partial unique index
// (UNIQUE data_category WHERE active_until IS NULL) should guarantee at most one.
const getActivePolicyForCategory = async ({
    category,
}) => {
    try {
        const SQL = `
            SELECT *
            FROM data_retention_policies
            WHERE data_category = $1
                AND active_until IS NULL
            ORDER BY active_from DESC
            LIMIT 1
        `

        const result = await client.query(SQL, [category])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

module.exports = {
    listRetentionPoliciesV2,
    upsertRetentionPolicyV2,
    queueRetentionPurgeJob,
    getActivePolicyForCategory,
}
