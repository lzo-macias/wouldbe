const { client } = require("../index.js")

// listRaces(filters) — unified race list with office + jurisdiction display joins.
// All filters optional and AND together; omit everything for "all".
const listRaces = async ({
    office_id,
    election_cycle,
    election_type,
    is_approved_on_platform,
    limit = 100,
} = {}) => {
    try {
        const SQL = `
            SELECT
                r.*,
                o.office_name,
                o.office_type,
                j.name       AS jurisdiction_name,
                j.state_code
            FROM races r
            JOIN office o       ON o.id = r.office_id
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE ($1::uuid    IS NULL OR r.office_id = $1)
                AND ($2::int     IS NULL OR r.election_cycle = $2)
                AND ($3::text    IS NULL OR r.election_type = $3)
                AND ($4::boolean IS NULL OR r.is_approved_on_platform = $4)
            ORDER BY r.general_date ASC
            LIMIT $5
        `
        const result = await client.query(SQL, [
            office_id ?? null,
            election_cycle ?? null,
            election_type ?? null,
            is_approved_on_platform ?? null,
            Math.min(Number(limit) || 100, 500),
        ])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getRaceById = async ({
    id
}) => {
    try{
        const SQL = `
            SELECT *
            FROM races
            WHERE id = $1
        `

        const result = await client.query(SQL, [id])

        return result.rows[0]

    }catch(err){
        console.error(err)
        throw err
    }
}

const getUpcomingRaces = async ({} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM races
            WHERE general_date >= NOW()
            ORDER BY general_date ASC
        `

        const result = await client.query(SQL)

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

const getRaceCandidates = async ({
    id
}) => {
    try {
        
        const SQL =`
            SELECT
                w.id            AS wouldbe_id,
                w.title,
                w.goal_cents,
                w.pledged_total_cents,
                u.id            AS user_id,
                u.first_name,
                u.last_name,
                u.username,
                u.profile_photo_url,
                o.office_name
            FROM wouldbe w
            JOIN users u  ON u.id = w.user_id
            JOIN office o ON o.id = w.office_id
            WHERE w.race_id = $1
                AND w.retired IS NOT TRUE
            ORDER BY w.pledged_total_cents DESC
        `

        const result = await client.query(SQL, [id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// approveRaceForPlatform({ id, approved }) — flip the is_approved_on_platform
// gate. Only approved races can host WouldBe campaigns (wouldbe.race_id). Pass
// approved:false to pull a race back. The admin gate lives on the route
// (requireAdmin + recordAdminAction); this just sets the flag.
const approveRaceForPlatform = async ({ id, approved = true }) => {
    try {
        const SQL = `
            UPDATE races
            SET is_approved_on_platform = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await client.query(SQL, [id, approved])
        if (!result.rows.length) throw new Error("no race with this id")
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// upsertRace({...}) — id given → partial UPDATE (COALESCE keeps existing when a
// field is omitted); else INSERT. COALESCE direction is ($new, existing): pass a
// value to change it, omit (null) to keep it.
const upsertRace = async ({
    id = null,
    office_id,
    election_cycle,
    election_type = null,
    primary_date = null,
    general_date,
    filing_deadline,
    is_open_seat = null,
    is_approved_on_platform = null,
}) => {
    try {
        const cols = [
            office_id, election_cycle, election_type, primary_date,
            general_date, filing_deadline, is_open_seat, is_approved_on_platform,
        ]

        if (id) {
            const SQL = `
                UPDATE races SET
                    office_id               = COALESCE($2, office_id),
                    election_cycle          = COALESCE($3, election_cycle),
                    election_type           = COALESCE($4, election_type),
                    primary_date            = COALESCE($5, primary_date),
                    general_date            = COALESCE($6, general_date),
                    filing_deadline         = COALESCE($7, filing_deadline),
                    is_open_seat            = COALESCE($8, is_open_seat),
                    is_approved_on_platform = COALESCE($9, is_approved_on_platform),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *;
            `
            const result = await client.query(SQL, [id, ...cols])
            if (!result.rows.length) throw new Error("no race with this id")
            return result.rows[0]
        }

        const SQL = `
            INSERT INTO races (
                id, office_id, election_cycle, election_type, primary_date,
                general_date, filing_deadline, is_open_seat, is_approved_on_platform
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, COALESCE($8, false)
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
    listRaces,
    getRaceById,
    getUpcomingRaces,
    getRaceCandidates,
    approveRaceForPlatform,
    upsertRace,
}