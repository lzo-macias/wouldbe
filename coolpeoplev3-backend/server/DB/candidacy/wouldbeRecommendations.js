const { client, withTransaction } = require("../index.js")

// ============================================================================
// wouldbe_recommendations — the ranking-page "I think this person should run
// for X" button. Nominator side: recommender_user_id, target_user_id, optional
// office/race/source_debate anchor, recommendation_type ('race_specific' |
// 'general'). Nominee side (full-scope §F): target_response
// ('pending'|'viewed'|'accepted'|'declined'), responded_at, resulting_wouldbe_id.
// recommender_user_id always comes from the caller's token, never the body.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const RECOMMENDATION_TYPES = ["race_specific", "general"]
const TARGET_RESPONSES = ["pending", "viewed", "accepted", "declined"]

// createRecommendation — record that recommender thinks target should run.
const createRecommendation = async ({
    recommender_user_id,
    target_user_id,
    office_id = null,
    race_id = null,
    source_debate_id = null,
    recommendation_type,
    reason_text = null,
}, db = client) => {
    if (!recommender_user_id) throw httpError(401, "authentication required")
    if (!target_user_id) throw httpError(400, "target_user_id is required")
    if (recommender_user_id === target_user_id) {
        throw httpError(400, "you cannot recommend yourself")
    }
    if (!RECOMMENDATION_TYPES.includes(recommendation_type)) {
        throw httpError(400, `recommendation_type must be one of: ${RECOMMENDATION_TYPES.join(", ")}`)
    }
    try {
        const SQL = `
            INSERT INTO wouldbe_recommendations
                (recommender_user_id, target_user_id, office_id, race_id,
                 source_debate_id, recommendation_type, reason_text)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `
        const result = await db.query(SQL, [
            recommender_user_id, target_user_id, office_id, race_id,
            source_debate_id, recommendation_type, reason_text,
        ])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "recommendation already exists")
        if (err.code === "23503") throw httpError(400, "referenced user, office, race, or debate does not exist")
        if (err.code === "23514") throw httpError(400, "invalid recommendation: check type or self-recommendation")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// deleteRecommendation — retract a recommendation. Scoped to the recommender so
// a caller can only undo their own. Returns the deleted row (or undefined).
const deleteRecommendation = async ({ id, recommender_user_id }, db = client) => {
    if (!recommender_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "id is required")
    try {
        const SQL = `
            DELETE FROM wouldbe_recommendations
            WHERE id = $1 AND recommender_user_id = $2
            RETURNING *;
        `
        const result = await db.query(SQL, [id, recommender_user_id])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getRecommendationsReceived — recommendations where the user is the target,
// with office/race/recommender detail, newest first.
const getRecommendationsReceived = async ({ target_user_id }) => {
    if (!target_user_id) throw httpError(400, "target_user_id is required")
    try {
        const SQL = `
            SELECT
                wr.*,
                o.office_name,
                r.election_cycle AS race_election_cycle,
                r.election_type AS race_election_type,
                u.username AS recommender_username
            FROM wouldbe_recommendations wr
            LEFT JOIN office o ON o.id = wr.office_id
            LEFT JOIN races r ON r.id = wr.race_id
            LEFT JOIN users u ON u.id = wr.recommender_user_id
            WHERE wr.target_user_id = $1
            ORDER BY wr.created_at DESC;
        `
        const result = await client.query(SQL, [target_user_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// getRecommendationsGiven — recommendations the user has made, with office/race/
// target detail, newest first.
const getRecommendationsGiven = async ({ recommender_user_id }) => {
    if (!recommender_user_id) throw httpError(400, "recommender_user_id is required")
    try {
        const SQL = `
            SELECT
                wr.*,
                o.office_name,
                r.election_cycle AS race_election_cycle,
                r.election_type AS race_election_type,
                u.username AS target_username
            FROM wouldbe_recommendations wr
            LEFT JOIN office o ON o.id = wr.office_id
            LEFT JOIN races r ON r.id = wr.race_id
            LEFT JOIN users u ON u.id = wr.target_user_id
            WHERE wr.recommender_user_id = $1
            ORDER BY wr.created_at DESC;
        `
        const result = await client.query(SQL, [recommender_user_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

// respondToRecommendation — the nominee acts on a recommendation. Only the
// target may respond, enforced by target_user_id. On 'accepted' with a
// resultingWouldbeId, atomically (a) stamp the recommendation's response and
// link, and (b) mark that wouldbe as nomination-originated (entry_path).
const respondToRecommendation = async ({ id, target_user_id, response, resultingWouldbeId = null }) => {
    if (!target_user_id) throw httpError(401, "authentication required")
    if (!id) throw httpError(400, "id is required")
    if (!TARGET_RESPONSES.includes(response)) {
        throw httpError(400, `response must be one of: ${TARGET_RESPONSES.join(", ")}`)
    }
    if (response === "accepted" && resultingWouldbeId) {
        try {
            return await withTransaction(async (tx) => {
                const upd = await tx.query(
                    `UPDATE wouldbe_recommendations
                     SET target_response = $1, responded_at = NOW(), resulting_wouldbe_id = $2
                     WHERE id = $3 AND target_user_id = $4
                     RETURNING *;`,
                    [response, resultingWouldbeId, id, target_user_id]
                )
                if (upd.rows.length === 0) {
                    throw httpError(404, "recommendation not found")
                }
                const wb = await tx.query(
                    `UPDATE wouldbe
                     SET entry_path = 'nomination', updated_at = NOW()
                     WHERE id = $1
                     RETURNING id;`,
                    [resultingWouldbeId]
                )
                if (wb.rows.length === 0) {
                    throw httpError(400, "resulting wouldbe does not exist")
                }
                return upd.rows[0]
            })
        } catch (err) {
            if (err.status) throw err
            if (err.code === "23503") throw httpError(400, "resulting wouldbe does not exist")
            if (err.code === "23514") throw httpError(400, "invalid response or entry_path")
            if (err.code === "22P02") throw httpError(400, "invalid id format")
            console.error(err)
            throw err
        }
    }
    try {
        const SQL = `
            UPDATE wouldbe_recommendations
            SET target_response = $1,
                responded_at = NOW(),
                resulting_wouldbe_id = COALESCE($2, resulting_wouldbe_id)
            WHERE id = $3 AND target_user_id = $4
            RETURNING *;
        `
        const result = await client.query(SQL, [response, resultingWouldbeId, id, target_user_id])
        if (result.rows.length === 0) throw httpError(404, "recommendation not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23503") throw httpError(400, "resulting wouldbe does not exist")
        if (err.code === "23514") throw httpError(400, "invalid response")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }
}

module.exports = {
    RECOMMENDATION_TYPES,
    TARGET_RESPONSES,
    createRecommendation,
    deleteRecommendation,
    getRecommendationsReceived,
    getRecommendationsGiven,
    respondToRecommendation,
}
