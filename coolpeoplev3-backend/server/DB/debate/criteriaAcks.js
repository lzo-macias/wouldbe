const { client } = require("../index.js")

// ============================================================================
// user_criteria_acknowledgments — the compliance record that a user saw the
// endorsement/voting criteria for a debate before participating. One ack per
// (user, ack_type, debate). The requireCriteriaAck middleware reads this table;
// recordCriteriaAck writes it. Contexts: 'landing_page' / 'final_round' (new) and
// 'endorsement' / 'final_round_voting' (legacy) all remain valid.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const ACK_TYPES = ["landing_page", "final_round", "endorsement", "final_round_voting"]

// recordCriteriaAck — idempotent upsert. Re-acking the same (user, ack_type,
// debate) refreshes the version/timestamp/context rather than erroring.
const recordCriteriaAck = async ({
    user_id,
    debate_id,
    ack_type,
    criteria_version,
    rules_version_seen = null,
    ip_address = null,
    user_agent = null,
}, db = client) => {
    if (!user_id) throw httpError(401, "authentication required")
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!ACK_TYPES.includes(ack_type)) {
        throw httpError(400, `ack_type must be one of: ${ACK_TYPES.join(", ")}`)
    }
    if (!criteria_version) throw httpError(400, "criteria_version is required")
    try {
        const SQL = `
            INSERT INTO user_criteria_acknowledgments
                (user_id, ack_type, debate_id, criteria_version, rules_version_seen, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, ack_type, debate_id) DO UPDATE SET
                criteria_version  = EXCLUDED.criteria_version,
                rules_version_seen = EXCLUDED.rules_version_seen,
                ip_address        = EXCLUDED.ip_address,
                user_agent        = EXCLUDED.user_agent,
                acknowledged_at   = NOW()
            RETURNING *;
        `
        const result = await db.query(SQL, [
            user_id, ack_type, debate_id, criteria_version, rules_version_seen, ip_address, user_agent,
        ])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "user_id or debate_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid ack_type")
        console.error(err)
        throw err
    }
}

// getUserCriteriaAcks — the caller's acks, optionally scoped to one debate.
const getUserCriteriaAcks = async ({ user_id, debate_id = null }) => {
    if (!user_id) throw httpError(401, "authentication required")
    try {
        const SQL = `
            SELECT *
            FROM user_criteria_acknowledgments
            WHERE user_id = $1
              AND ($2::uuid IS NULL OR debate_id = $2)
            ORDER BY acknowledged_at DESC;
        `
        const result = await client.query(SQL, [user_id, debate_id])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// hasUserAckedCriteria — boolean check used for gating (mirrors what the
// requireCriteriaAck middleware enforces). debate_id is optional: omit to ask
// "acked this context for ANY debate".
const hasUserAckedCriteria = async ({ user_id, ack_type, debate_id = null }) => {
    if (!user_id || !ack_type) throw httpError(400, "user_id and ack_type are required")
    try {
        const { rows } = await client.query(
            `SELECT 1 FROM user_criteria_acknowledgments
             WHERE user_id = $1 AND ack_type = $2
               AND ($3::uuid IS NULL OR debate_id = $3)
             LIMIT 1`,
            [user_id, ack_type, debate_id]
        )
        return rows.length > 0
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    ACK_TYPES,
    recordCriteriaAck,
    getUserCriteriaAcks,
    hasUserAckedCriteria,
}
