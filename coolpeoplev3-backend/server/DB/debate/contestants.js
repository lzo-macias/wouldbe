const { client } = require("../index.js")

// ============================================================================
// contestants — a user entered into a specific debate. state/city/age are
// SNAPSHOTS taken at entry (eligibility lock) and are DERIVED SERVER-SIDE from the
// user's profile — never trusted from the request body. UNIQUE (debate_id,
// user_id) means one entry per user per debate. NOTE: no updated_at column.
// ============================================================================

// httpError is sync — an async version returns a Promise, so `throw httpError(...)`
// would throw a Promise (losing .status) instead of an Error.
const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// createContestant — enter a user into a debate. Eligibility is enforced
// SERVER-SIDE against the debates row (open for entry, participation, age floor,
// excluded states) so a caller can't bypass the gates by hitting this directly.
// The snapshot (state/city/age) is read from the users row, never the caller, so
// it can't be spoofed. id/status/joined_at use column defaults. UNIQUE
// (debate_id, user_id) rejects a double entry.
// NOTE: this enforces ELIGIBILITY only; it does not write the debate_entries
// legal record (attestations + rules ack) — that is enterDebate's job.
// db defaults to the pool; pass a withTransaction `tx` so enterDebate can create
// the contestant + debate_entries legal record atomically. See [[project_db_pool_transactions]].
const createContestant = async ({ debate_id, user_id }, db = client) => {
    if (!user_id) {
        throw httpError(400, "must create an account to compete in a debate")
    }
    if (!debate_id) {
        throw httpError(400, "debate_id is required")
    }
    try {
        // Read the debate's entry rules + the applicant's profile in one query,
        // then gate before inserting. (FK existence alone wouldn't stop an
        // underage or geo-excluded entrant, or entry into a closed debate.)
        const pre = await db.query(
            `SELECT
                 d.status, d.participation_type, d.retired,
                 d.min_age_required, d.excluded_states,
                 u.id AS user_exists, u.state,
                 date_part('year', age(u.date_of_birth))::int AS age
             FROM debates d
             LEFT JOIN users u ON u.id = $2
             WHERE d.id = $1`,
            [debate_id, user_id]
        )
        if (!pre.rows.length) throw httpError(404, "debate not found")
        const d = pre.rows[0]
        if (!d.user_exists) throw httpError(404, "user not found")
        if (d.retired || d.status !== "open_entry") {
            throw httpError(409, "this debate is not open for entry")
        }
        if (d.participation_type !== "open") {
            throw httpError(403, "this debate is invitation-only; entry is by nomination")
        }
        if (!d.state) {
            throw httpError(400, "complete your profile (state is required) before entering")
        }
        if (d.age < d.min_age_required) {
            throw httpError(403, `entrants must be at least ${d.min_age_required}`)
        }
        if (Array.isArray(d.excluded_states) && d.excluded_states.includes(d.state)) {
            throw httpError(403, "entry is not available in your state")
        }

        const SQL = `
            INSERT INTO contestants (
                debate_id,
                user_id,
                state_at_entry,
                city_at_entry,
                age_at_entry
            )
            SELECT
                $1,
                u.id,
                u.state,
                u.city,
                date_part('year', age(u.date_of_birth))::int
            FROM users u
            WHERE u.id = $2
            RETURNING *;
        `

        const result = await db.query(SQL, [debate_id, user_id])

        if (!result.rows.length) throw httpError(404, "user not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "this user is already entered in this debate")
        if (err.code === "23502") throw httpError(400, "complete your profile (state is required) before entering")
        if (err.code === "23503") throw httpError(400, "debate_id does not exist")
        if (err.code === "23514") throw httpError(400, "a contestant field violates a check constraint")
        console.error(err)
        throw err
    }
}

// getDebateContestants — entrants for a debate, joined to their user identity.
// Defaults to the active roster (hides withdrawn AND disqualified); pass
// { all: true } for the full admin view.
const getDebateContestants = async ({ debate_id, all = false }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        // Column set is chosen by the `all` flag (a server-controlled boolean,
        // never user input — safe to interpolate). The public roster exposes only
        // identity + status; the admin view also returns the eligibility snapshot
        // (state/city/age) and the disqualification reason.
        const cols = all
            ? "c.*"
            : "c.id, c.debate_id, c.user_id, c.status, c.joined_at, c.withdrew_at"
        const SQL = `
            SELECT
                ${cols},
                u.first_name,
                u.last_name,
                u.username
            FROM contestants AS c
            JOIN users AS u ON u.id = c.user_id
            WHERE c.debate_id = $1
              AND ($2::boolean = true OR (c.withdrew_at IS NULL AND c.status <> 'disqualified'))
            ORDER BY c.joined_at DESC;
        `
        const result = await client.query(SQL, [debate_id, all])

        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getContestantById — look up one contestant by its id, or by (user_id +
// debate_id) which is unique. A bare user_id is rejected because it isn't
// debate-scoped (a user can be a contestant in many debates).
const getContestantById = async ({
    contestant_id = null,
    user_id = null,
    debate_id = null,
}) => {
    if (!contestant_id && !(user_id && debate_id)) {
        throw httpError(400, "provide a contestant_id, or a user_id and debate_id")
    }
    try {
        // Public-safe projection: identity + status only. The eligibility snapshot
        // (state/city/age) and disqualification_reason are intentionally NOT
        // returned here — those live behind the admin roster.
        const SQL = `
            SELECT
                c.id, c.debate_id, c.user_id, c.status, c.joined_at, c.withdrew_at,
                u.first_name, u.last_name, u.username
            FROM contestants AS c
            JOIN users AS u ON u.id = c.user_id
            WHERE ($1::uuid IS NOT NULL AND c.id = $1)
               OR ($2::uuid IS NOT NULL AND c.user_id = $2 AND c.debate_id = $3)
        `

        const result = await client.query(SQL, [contestant_id, user_id, debate_id])

        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// withdrawContestant — a contestant pulls out of ONE debate. Owner-scoped: the
// row must match both the contestant id and the authed user_id, so a caller can
// only withdraw their own entry. Sets withdrew_at and flips status to 'withdrawn'.
const withdrawContestant = async ({ contestant_id, user_id }) => {
    if (!contestant_id || !user_id) {
        throw httpError(400, "contestant_id and user_id are required")
    }
    try {
        const SQL = `
            UPDATE contestants
            SET
                withdrew_at = NOW(),
                status = 'withdrawn'
            WHERE id = $1
              AND user_id = $2
            RETURNING *;
        `

        const result = await client.query(SQL, [contestant_id, user_id])

        if (!result.rows.length) throw httpError(404, "contestant not found or not yours")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// disqualifyContestant — admin removes a contestant FOR CAUSE. Always sets status
// to 'disqualified' and requires a reason (the audit trail). Target by contestant
// id, or by (user_id + debate_id) which is unique.
const disqualifyContestant = async ({
    id = null,
    user_id = null,
    debate_id = null,
    disqualification_reason,
}) => {
    if (!id && !(user_id && debate_id)) {
        throw httpError(400, "provide a contestant id, or a user_id and debate_id")
    }
    if (!disqualification_reason || !disqualification_reason.trim()) {
        throw httpError(400, "disqualification_reason is required")
    }
    try {
        const SQL = `
            UPDATE contestants
            SET
                status = 'disqualified',
                disqualification_reason = $4
            WHERE ($1::uuid IS NOT NULL AND id = $1)
               OR ($2::uuid IS NOT NULL AND user_id = $2 AND debate_id = $3)
            RETURNING *;
        `

        const result = await client.query(SQL, [id, user_id, debate_id, disqualification_reason])

        if (!result.rows.length) throw httpError(404, "contestant not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// assertFinalistEligible — once a debate's finalists are locked, votes/ballots
// may only target finalists. If the debate has NO finalists yet (pre-final
// round), this is a no-op so normal voting isn't blocked. Pass a `db` to run on a
// caller's transaction. Throws 403 if any given contestant isn't a finalist.
const assertFinalistEligible = async (debate_id, contestant_ids, db = client) => {
    const ids = [...new Set(
        (Array.isArray(contestant_ids) ? contestant_ids : [contestant_ids]).filter(Boolean)
    )]
    if (!debate_id || ids.length === 0) return
    const { rows } = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM contestants
              WHERE debate_id = $1 AND status = 'finalist')::int AS finalists,
            (SELECT COUNT(*) FROM contestants
              WHERE debate_id = $1 AND status = 'finalist' AND id = ANY($2::uuid[]))::int AS matched`,
        [debate_id, ids]
    )
    const { finalists, matched } = rows[0]
    if (finalists > 0 && matched < ids.length) {
        throw httpError(403, "the final round only accepts votes for finalists")
    }
}

module.exports = {
    createContestant,
    getDebateContestants,
    getContestantById,
    withdrawContestant,
    disqualifyContestant,
    assertFinalistEligible,
}
