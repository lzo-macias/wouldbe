const { client } = require("../index.js")

// listElectionDeadlines({ state_code, deadline_type, limit }) — admin browser.
// Filters optional; capped limit because the full table is ~38k rows.
const listElectionDeadlines = async ({ state_code = null, deadline_type = null, limit = 500 } = {}) => {
    try{
        const SQL = `
            SELECT ed.*, j.name AS jurisdiction_name, j.state_code, j.type AS jurisdiction_type
            FROM election_deadlines ed
            JOIN jurisdiction j ON j.id = ed.jurisdiction_id
            WHERE ($1::text IS NULL OR j.state_code = $1)
              AND ($2::text IS NULL OR ed.deadline_type = $2)
            ORDER BY j.state_code NULLS FIRST, ed.deadline_date ASC NULLS LAST
            LIMIT $3
        `
        const result = await client.query(SQL, [state_code, deadline_type, Math.min(Number(limit) || 500, 2000)])
        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// getDeadlineCalendar({ userId, range }) — personalized calendar: the deadlines
// for the jurisdictions THIS user belongs to (via user_jurisdictions), within a
// date window. range = { from, to } (to optional; from defaults to today).
const getDeadlineCalendar = async ({ userId, range } = {}) => {
    try{
        const from = range?.from ?? new Date().toISOString().slice(0, 10) // default: today
        const to   = range?.to ?? null                                    // optional upper bound

        const SQL = `
            SELECT
                ed.*,
                j.name       AS jurisdiction_name,
                j.state_code
            FROM election_deadlines ed
            JOIN user_jurisdictions uj ON uj.jurisdiction_id = ed.jurisdiction_id
            JOIN jurisdiction j        ON j.id = ed.jurisdiction_id
            WHERE uj.user_id = $1
                AND ed.deadline_date IS NOT NULL
                AND ed.deadline_date >= $2
                AND ($3::date IS NULL OR ed.deadline_date <= $3)
            ORDER BY ed.deadline_date ASC
        `

        const result = await client.query(SQL, [userId, from, to])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// getDeadlinesByJurisdiction({ id, state_code, name }) — deadlines for a
// jurisdiction, queryable by ANY of the three: id (exact), state_code, or name
// (fuzzy). Joins jurisdiction so each row also carries the jurisdiction's
// name/state/type. Pass at least one filter.
const getDeadlinesByJurisdiction = async ({ id, state_code, name } = {}) => {
    try {
        if (!id && !state_code && !name) {
            throw new Error("provide one of: id, state_code, or name")
        }
        const SQL = `
            SELECT
                ed.*,
                j.name       AS jurisdiction_name,
                j.state_code,
                j.type       AS jurisdiction_type
            FROM election_deadlines ed
            JOIN jurisdiction j ON j.id = ed.jurisdiction_id
            WHERE ($1::uuid    IS NULL OR ed.jurisdiction_id = $1)
                AND ($2::char(2) IS NULL OR j.state_code = $2)
                AND ($3::text    IS NULL OR j.name ILIKE '%' || $3 || '%')
            ORDER BY ed.deadline_date ASC
        `
        const result = await client.query(SQL, [id ?? null, state_code ?? null, name ?? null])
        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// (admin) upsertElectionDeadline({...}) — admin writer for the deadline calendar.
// id given → partial UPDATE (COALESCE keeps existing when a field is omitted);
// else INSERT. COALESCE direction is ($new, existing): pass a value to change it,
// omit (null) to keep it. jurisdiction_id + deadline_type are required on insert.
const upsertElectionDeadline = async ({
    id = null,
    jurisdiction_id,
    election_cycle = null,
    deadline_type,
    deadline_date = null,
    deadline_time = null,
    applies_to_office_type = null,
    description = null,
    source_url = null,
    is_recurring_per_cycle = null,
}) => {
    try {
        const cols = [
            jurisdiction_id, election_cycle, deadline_type, deadline_date,
            deadline_time, applies_to_office_type, description, source_url,
            is_recurring_per_cycle,
        ]

        if (id) {
            const SQL = `
                UPDATE election_deadlines SET
                    jurisdiction_id        = COALESCE($2, jurisdiction_id),
                    election_cycle         = COALESCE($3, election_cycle),
                    deadline_type          = COALESCE($4, deadline_type),
                    deadline_date          = COALESCE($5, deadline_date),
                    deadline_time          = COALESCE($6, deadline_time),
                    applies_to_office_type = COALESCE($7, applies_to_office_type),
                    description            = COALESCE($8, description),
                    source_url             = COALESCE($9, source_url),
                    is_recurring_per_cycle = COALESCE($10, is_recurring_per_cycle),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *;
            `
            const result = await client.query(SQL, [id, ...cols])
            if (!result.rows.length) throw new Error("no election deadline with this id")
            return result.rows[0]
        }

        const SQL = `
            INSERT INTO election_deadlines (
                id, jurisdiction_id, election_cycle, deadline_type, deadline_date,
                deadline_time, applies_to_office_type, description, source_url,
                is_recurring_per_cycle
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
            RETURNING *;
        `
        const result = await client.query(SQL, cols)
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    listElectionDeadlines,
    getDeadlineCalendar,
    getDeadlinesByJurisdiction,
    upsertElectionDeadline,
}