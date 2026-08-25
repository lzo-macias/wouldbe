const { client, withTransaction } = require("../index.js")
const crypto = require("crypto")

// ============================================================================
// debate_official_rules — versioned, frozen rules per debate. The CURRENT
// version is the row with superseded_at IS NULL. Publishing a new version closes
// the prior one (sets its superseded_at) and inserts version = max+1. version is
// stored as text; we keep it numeric-as-text so it sorts/increments cleanly.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex")

// publishDebateRules — publish a NEW version and close the prior current one,
// atomically. Locks the open row (FOR UPDATE) so concurrent publishes can't both
// claim the same next version.
const publishDebateRules = async ({
    debate_id,
    rules_text,
    rules_url = null,
    body_hash = null,
    age_eligibility_min = null,
    age_eligibility_max = null,
    minor_entry_allowed = null,
    minor_entry_methods = null,
}) => {
    if (!debate_id || !rules_text) throw httpError(400, "debate_id and rules_text are required")
    if (age_eligibility_min != null && age_eligibility_max != null && age_eligibility_min > age_eligibility_max)
        throw httpError(400, "age_eligibility_min cannot exceed age_eligibility_max")
    if (minor_entry_methods != null && !Array.isArray(minor_entry_methods))
        throw httpError(400, "minor_entry_methods must be an array")

    try {
        return await withTransaction(async (tx) => {
            // current (open) version — locked — + the next version number
            const cur = await tx.query(
                `SELECT rules_id FROM debate_official_rules
                 WHERE debate_id = $1 AND superseded_at IS NULL
                 FOR UPDATE`,
                [debate_id]
            )
            const maxv = await tx.query(
                `SELECT COALESCE(MAX(version::int), 0) AS maxv
                 FROM debate_official_rules WHERE debate_id = $1`,
                [debate_id]
            )
            const nextVersion = String(Number(maxv.rows[0].maxv) + 1)

            // close the prior current version
            if (cur.rows[0]) {
                await tx.query(
                    `UPDATE debate_official_rules SET superseded_at = NOW() WHERE rules_id = $1`,
                    [cur.rows[0].rules_id]
                )
            }

            // insert the new current version. COALESCE keeps the NOT-NULL-with-default
            // columns valid when omitted (incl. the jsonb default).
            const SQL = `
                INSERT INTO debate_official_rules (
                    debate_id, version, rules_text, rules_url, body_hash, effective_at,
                    age_eligibility_min, age_eligibility_max, minor_entry_allowed, minor_entry_methods
                ) VALUES (
                    $1, $2, $3, $4, $5, NOW(),
                    COALESCE($6, 18), COALESCE($7, 100), COALESCE($8, false),
                    COALESCE($9::jsonb, '["nominated"]'::jsonb)
                )
                RETURNING *;
            `
            const result = await tx.query(SQL, [
                debate_id,
                nextVersion,
                rules_text,
                rules_url,
                body_hash || sha256(rules_text),
                age_eligibility_min,
                age_eligibility_max,
                minor_entry_allowed,
                minor_entry_methods == null ? null : JSON.stringify(minor_entry_methods),
            ])

            return result.rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "debate_id does not exist")
        if (err.code === "23514") throw httpError(400, "a rules field violates a check constraint")
        if (err.code === "22P02") throw httpError(400, "a field is malformed")
        console.error(err)
        throw err
    }
}

// getCurrentDebateRules — the in-force version (superseded_at IS NULL).
const getCurrentDebateRules = async ({ debate_id }) => {
    const SQL = `
        SELECT * FROM debate_official_rules
        WHERE debate_id = $1 AND superseded_at IS NULL
        ORDER BY version::int DESC
        LIMIT 1
    `
    const result = await client.query(SQL, [debate_id])
    return result.rows[0] || null
}

// getDebateRulesHistory — every version, newest first.
const getDebateRulesHistory = async ({ debate_id }) => {
    const SQL = `
        SELECT * FROM debate_official_rules
        WHERE debate_id = $1
        ORDER BY version::int DESC
    `
    const result = await client.query(SQL, [debate_id])
    return result.rows
}

// getRulesByVersion — a specific version of a debate's rules.
const getRulesByVersion = async ({ debate_id, version }) => {
    const SQL = `
        SELECT * FROM debate_official_rules
        WHERE debate_id = $1 AND version = $2
    `
    const result = await client.query(SQL, [debate_id, String(version)])
    return result.rows[0] || null
}

module.exports = {
    publishDebateRules,
    getCurrentDebateRules,
    getDebateRulesHistory,
    getRulesByVersion,
}
