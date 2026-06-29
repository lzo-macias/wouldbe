const { client } = require("../index.js")

// ============================================================================
// debate_judges + debate_judge_scores — the judge panel for a debate and the
// per-judge, per-contestant, per-criterion scores they cast.
//
// Keys: debate_judges PK is judge_id; debate_judge_scores PK is score_id and has
// a UNIQUE (judge_id, contestant_id, criterion_id) — one score per judge per
// contestant per criterion (rely on the constraint, no manual pre-check).
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// addJudge — add one judge to a debate. judge_id/created_at use column defaults;
// disclosed_at defaults to now() when omitted. recused_at stays null (active).
const addJudge = async ({
    debate_id,
    user_id,
    external_name,
    external_bio,
    role,
    disclosed_at,
}) => {
    if (!debate_id || !role) {
        throw httpError(400, "debate_id and role are required")
    }
    if (!user_id && !external_name) {
        throw httpError(400, "either user_id or external_name is required")
    }
    try {
        const SQL = `
            INSERT INTO debate_judges (
                debate_id,
                user_id,
                external_name,
                external_bio,
                role,
                disclosed_at
            )
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
            RETURNING *;
        `

        const result = await client.query(SQL, [
            debate_id,
            user_id,
            external_name,
            external_bio,
            role,
            disclosed_at,
        ])

        return result.rows[0]
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "invalid role")
        if (err.code === "23503") throw httpError(400, "debate_id or user_id does not exist")
        console.error(err)
        throw err
    }
}

// getDebateJudges — the disclosed panel for a debate (public; transparency req).
// Public-safe projection: excludes the raw user_id (account linkage) and the
// recusal_reason; external_bio is public by design and recused_at is shown so the
// fact of a recusal stays transparent. On-platform judges surface as a username.
const getDebateJudges = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                dj.judge_id,
                dj.debate_id,
                dj.role,
                dj.external_name,
                dj.external_bio,
                dj.disclosed_at,
                dj.recused_at,
                u.username AS judge_username
            FROM debate_judges AS dj
            LEFT JOIN users AS u ON u.id = dj.user_id
            WHERE dj.debate_id = $1
            ORDER BY dj.disclosed_at;
        `

        const result = await client.query(SQL, [debate_id])

        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// recuseJudge — mark a single judge recused (keyed on judge_id, not debate_id —
// recusing by debate_id would recuse the entire panel).
const recuseJudge = async ({
    judge_id,
    recusal_reason,
}) => {
    if (!judge_id) throw httpError(400, "judge_id is required")
    try {
        const SQL = `
            UPDATE debate_judges
            SET
                recused_at = NOW(),
                recusal_reason = $2
            WHERE judge_id = $1
            RETURNING *;
        `

        const result = await client.query(SQL, [judge_id, recusal_reason])

        if (!result.rows.length) throw httpError(404, "judge not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// submitJudgeScores — cast one score. score_id/created_at/updated_at use column
// defaults; locking is a separate step (lockJudgeScores). The UNIQUE constraint
// rejects a duplicate (judge_id, contestant_id, criterion_id).
const submitJudgeScores = async ({
    debate_id,
    judge_id,
    contestant_id,
    criterion_id,
    score,
    notes,
}) => {
    if (!debate_id || !judge_id || !contestant_id || !criterion_id || score == null) {
        throw httpError(400, "debate_id, judge_id, contestant_id, criterion_id and score are required")
    }
    try {
        const SQL = `
            INSERT INTO debate_judge_scores (
                debate_id,
                judge_id,
                contestant_id,
                criterion_id,
                score,
                notes
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `

        const result = await client.query(SQL, [
            debate_id,
            judge_id,
            contestant_id,
            criterion_id,
            score,
            notes,
        ])

        return result.rows[0]
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "this judge already scored this contestant on this criterion")
        if (err.code === "23514") throw httpError(400, "score must be between 1 and 5")
        if (err.code === "23503") throw httpError(400, "debate_id, judge_id, contestant_id or criterion_id does not exist")
        console.error(err)
        throw err
    }
}

// lockJudgeScores — lock a submitted score so it can't be edited after
// announcement. Only locks if not already locked; updated_at bumps too.
const lockJudgeScores = async ({ score_id }) => {
    if (!score_id) throw httpError(400, "score_id is required")
    try {
        const SQL = `
            UPDATE debate_judge_scores
            SET
                locked_at = NOW(),
                updated_at = NOW()
            WHERE score_id = $1
              AND locked_at IS NULL
            RETURNING *;
        `

        const result = await client.query(SQL, [score_id])

        if (!result.rows.length) throw httpError(409, "score not found or already locked")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// getDebateJudgeScores — every score for a debate, joined to the judge (and the
// judge's on-platform user, if any), the contestant's user, and the criterion.
// Optionally narrowed to a single judge. Caller can organize the flat rows by
// judge / contestant / criterion_key.
const getDebateJudgeScores = async ({
    debate_id,
    judge_id = null,
}) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                djs.score_id,
                djs.debate_id,
                djs.judge_id,
                djs.contestant_id,
                djs.criterion_id,
                djs.score,
                djs.notes,
                djs.locked_at,
                djs.created_at,
                djs.updated_at,
                dj.user_id          AS judge_user_id,
                dj.external_name    AS judge_external_name,
                dj.role             AS judge_role,
                ju.username         AS judge_username,
                djc.criterion_key,
                djc.display_name    AS criterion_name,
                djc.weight          AS criterion_weight,
                djc.display_order   AS criterion_display_order,
                cu.username         AS contestant_username
            FROM debate_judge_scores AS djs
            JOIN debate_judges AS dj
                ON dj.judge_id = djs.judge_id
            LEFT JOIN users AS ju
                ON ju.id = dj.user_id
            JOIN debate_judging_criteria AS djc
                ON djc.criterion_id = djs.criterion_id
            JOIN contestants AS c
                ON c.id = djs.contestant_id
            JOIN users AS cu
                ON cu.id = c.user_id
            WHERE djs.debate_id = $1
              AND ($2::uuid IS NULL OR djs.judge_id = $2)
            ORDER BY djs.contestant_id, djs.judge_id, djc.display_order;
        `

        const result = await client.query(SQL, [debate_id, judge_id])

        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    addJudge,
    getDebateJudges,
    recuseJudge,
    submitJudgeScores,
    lockJudgeScores,
    getDebateJudgeScores,
}
