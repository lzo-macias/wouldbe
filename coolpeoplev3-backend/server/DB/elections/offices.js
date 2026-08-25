const { client } = require("../index.js")

// The year of the soonest still-upcoming general election for an office's
// jurisdiction. The YEAR comes from the authoritative election_cycle column (an
// integer) — never parsed out of anchor_date, whose day may be a year-only
// placeholder. Used by the UI as a fallback label ("2027 election") when an
// office has no concrete upcoming filing date, so off-cycle offices show a year
// instead of a bare "Filing date TBD".
const NEXT_ELECTION_YEAR_SUBQUERY = `
    (SELECT a.election_cycle
       FROM election_date_anchors a
      WHERE a.jurisdiction_id = o.jurisdiction_id
        AND a.anchor_type = 'general'
        AND a.anchor_date >= CURRENT_DATE
      ORDER BY a.anchor_date ASC
      LIMIT 1) AS next_election_year`

//list all offices. Joins jurisdiction so each office also carries state_code +
// jurisdiction_type (same shape as getQualifyingOffices). The frontend needs
// state_code to scope its per-state filing-deadline fetch — without it, no
// deadlines resolve and every office renders "Filing date TBD".
const listOffices = async ({} = {}) => {
    try{
        const SQL = `
            SELECT
                o.*,
                j.name AS jurisdiction_name,
                j.type AS jurisdiction_type,
                j.state_code,
                ${NEXT_ELECTION_YEAR_SUBQUERY}
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            ORDER BY o.office_name ASC
        `

        const listOfOffices = await client.query(SQL)

        return listOfOffices.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

//get one office 
const getOfficeById = async ({
    id
}) => {
    try {
        const SQL = `
            SELECT *
            FROM office
            WHERE id = $1
        `

        const result = await client.query(SQL, [id])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

//get office by jurisdiction
const getOfficeByJurisdiction = async ({
    jurisdiction_id
}) => {
    try {
        const SQL = `
            SELECT * 
            FROM office
            WHERE jurisdiction_id = $1
        `
        
        const result = await client.query(SQL, [jurisdiction_id])

        return result.rows

    }catch(err) {
        console.error(err)
        throw err
    }
}

// getOfficesByState({ state }) — every office in a state, across all levels.
// Works because jurisdiction.state_code is denormalized onto EVERY jurisdiction
// row (the state itself + every district/county/municipality within it), so one
// join + one filter returns statewide seats (US Senate, Governor), US House
// (congressional districts), state legislature (upper/lower), county, city
// councils, and school boards. Ordered federal → state → districts → local so
// the list reads top-down. Returns [] for an empty/missing code.
const getOfficesByState = async ({ state }) => {
    try {
        if (!state || !state.trim()) return [];
        const stateCode = state.trim().toUpperCase();

        const SQL = `
            SELECT
                o.*,
                j.name       AS jurisdiction_name,
                j.type       AS jurisdiction_type,
                j.state_code
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE j.state_code = $1
            ORDER BY
                CASE j.type
                    WHEN 'federal'                 THEN 1
                    WHEN 'state'                   THEN 2
                    WHEN 'congressional_district'  THEN 3
                    WHEN 'state_leg_upper'         THEN 4
                    WHEN 'state_leg_lower'         THEN 5
                    WHEN 'county'                  THEN 6
                    WHEN 'county_district'         THEN 7
                    WHEN 'municipal'               THEN 8
                    WHEN 'city_council_district'   THEN 9
                    WHEN 'school_district'         THEN 10
                    WHEN 'school_board_district'   THEN 11
                    ELSE 12
                END,
                o.office_name
        `;

        const result = await client.query(SQL, [stateCode]);
        return result.rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// getOfficeEligibility({ id }) — the DISPLAYED requirements for one office
// (informational; NOT a filing gate). Returns the actual requirement fields plus
// eligibility_is_encoded — when false, the UI must show generic guidance + a
// "confirm with your filing authority" disclaimer instead of hard numbers.
const getOfficeEligibility = async ({ id }) => {
    try {
        const SQL = `
            SELECT
                id,
                office_name,
                min_age,
                citizenship_requirement,
                citizenship_years_required,
                residency_requirement,
                residency_duration,
                eligibility_is_encoded,
                eligibility_source_url,
                eligibility_notes
            FROM office
            WHERE id = $1
        `
        const result = await client.query(SQL, [id])
        return result.rows[0]   // single office → one object (or undefined)
    } catch (err) {
        console.error(err)
        throw err
    }
}

// How a user is matched to an office, derived from the office's jurisdiction
// type when upsertOffice isn't given an explicit resolution_method.
//   national          → everyone (President)
//   statewide         → users.state (US Senate, Governor, AG…)
//   geocodio_district → user_jurisdictions ∩ office (US House, state leg, county, citywide)
//   point_in_polygon  → needs a GeoJSON boundary (city-council / trustee-area districts)
const RESOLUTION_BY_JURISDICTION_TYPE = {
    federal: 'national',
    state: 'statewide',
    county: 'geocodio_district',
    municipal: 'geocodio_district',
    school_district: 'geocodio_district',
    congressional_district: 'geocodio_district',
    state_leg_upper: 'geocodio_district',
    state_leg_lower: 'geocodio_district',
    county_district: 'geocodio_district',
    city_council_district: 'point_in_polygon',
    school_board_district: 'point_in_polygon',
}

// getQualifyingOffices({ userId }) — offices a user could run for, = the UNION of
// the three resolution methods, then filtered by age:
//   national  ∪  statewide(by users.state)  ∪  district(user_jurisdictions ∩ office)
// Age uses current age vs office.min_age (approximate — real eligibility is the
// §4 committee/compliance gate, not this). Drives the nominee/relevance screen.
const getQualifyingOffices = async ({ userId }) => {
    try {
        if (!userId) return [];
        const SQL = `
            WITH u AS (
                SELECT state, EXTRACT(YEAR FROM age(date_of_birth))::int AS age
                FROM users WHERE id = $1
            )
            SELECT
                o.*,
                j.name AS jurisdiction_name,
                j.type AS jurisdiction_type,
                j.state_code,
                ${NEXT_ELECTION_YEAR_SUBQUERY}
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            CROSS JOIN u
            WHERE (o.min_age IS NULL OR u.age >= o.min_age)
              AND (
                    o.resolution_method = 'national'
                 OR (o.resolution_method = 'statewide' AND j.state_code = u.state)
                 OR (o.resolution_method IN ('geocodio_district', 'point_in_polygon')
                     AND o.jurisdiction_id IN (
                         SELECT jurisdiction_id FROM user_jurisdictions WHERE user_id = $1
                     ))
              )
            ORDER BY
                CASE j.type
                    WHEN 'federal'                 THEN 1
                    WHEN 'state'                   THEN 2
                    WHEN 'congressional_district'  THEN 3
                    WHEN 'state_leg_upper'         THEN 4
                    WHEN 'state_leg_lower'         THEN 5
                    WHEN 'county'                  THEN 6
                    WHEN 'county_district'         THEN 7
                    WHEN 'municipal'               THEN 8
                    WHEN 'city_council_district'   THEN 9
                    WHEN 'school_district'         THEN 10
                    WHEN 'school_board_district'   THEN 11
                    ELSE 12
                END,
                o.office_name
        `
        const result = await client.query(SQL, [userId])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getRelevantOffices({ userId }) — the SUPERSET of getQualifyingOffices: the same
// national ∪ statewide(by state) ∪ district(user_jurisdictions) union, but WITHOUT
// the age gate, so we can also show offices the user doesn't yet qualify for. Each
// row is annotated:
//   qualifies       — bool, does the user currently meet the office's min_age
//   relevance_tier  — 'district' (their own districts) | 'statewide' (their state)
//                     | 'national' (President)
// Ordered qualified-first, then their own districts (by required age), then their
// state, then national — which is exactly how the feed groups them. Deadline
// filtering (hide-if-passed) still happens in the UI, per office.jurisdiction_id.
const getRelevantOffices = async ({ userId }) => {
    try {
        if (!userId) return []
        const SQL = `
            WITH u AS (
                SELECT state, EXTRACT(YEAR FROM age(date_of_birth))::int AS age
                FROM users WHERE id = $1
            ),
            uj AS (
                SELECT jurisdiction_id FROM user_jurisdictions WHERE user_id = $1
            )
            SELECT
                o.*,
                j.name AS jurisdiction_name,
                j.type AS jurisdiction_type,
                j.state_code,
                ${NEXT_ELECTION_YEAR_SUBQUERY},
                (o.min_age IS NULL OR u.age >= o.min_age) AS qualifies,
                CASE
                    WHEN o.resolution_method IN ('geocodio_district', 'point_in_polygon')
                        THEN 'district'
                    WHEN o.resolution_method = 'statewide' THEN 'statewide'
                    WHEN o.resolution_method = 'national'  THEN 'national'
                    ELSE 'other'
                END AS relevance_tier
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            CROSS JOIN u
            WHERE (o.resolution_method IN ('geocodio_district', 'point_in_polygon')
                       AND o.jurisdiction_id IN (SELECT jurisdiction_id FROM uj))
               OR (o.resolution_method = 'statewide' AND j.state_code = u.state)
               OR  o.resolution_method = 'national'
            ORDER BY
                (o.min_age IS NULL OR u.age >= o.min_age) DESC,   -- qualified first
                CASE
                    WHEN o.resolution_method IN ('geocodio_district','point_in_polygon') THEN 0
                    WHEN o.resolution_method = 'statewide' THEN 1
                    ELSE 2
                END,                                              -- own districts, then state, then national
                COALESCE(o.min_age, 0),                           -- by required age (18, 25, 30…)
                o.office_name
        `
        const result = await client.query(SQL, [userId])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// upsertOffice({...}) — the reference-data scraper's writer. Idempotency, in order
// of preference:
//   1. source_key given → INSERT … ON CONFLICT (source_key) DO UPDATE  (DB-enforced;
//      re-scrapes update in place keyed on the stable source id, not the name)
//   2. id given (no source_key) → UPDATE that row
//   3. neither → plain INSERT (new row)
// Auto-derives resolution_method from the jurisdiction's type when not passed.
const upsertOffice = async ({
    id = null,
    source_key = null,
    jurisdiction_id,
    office_name,
    office_type = null,
    chamber = null,
    district_identifier = null,
    district_name,
    term_length,
    max_terms = null,
    is_partisan = true,
    min_age,
    resolution_method = null,
    citizenship_requirement = null,
    citizenship_years_required = null,
    residency_requirement = null,
    residency_duration = null,
    eligibility_is_encoded = false,
    eligibility_source_url = null,
    eligibility_notes = null,
}) => {
    try {
        // Derive resolution_method from the jurisdiction's type if not supplied.
        let method = resolution_method
        if (!method) {
            const jr = await client.query(`SELECT type FROM jurisdiction WHERE id = $1`, [jurisdiction_id])
            if (!jr.rows.length) throw new Error("jurisdiction not found")
            method = RESOLUTION_BY_JURISDICTION_TYPE[jr.rows[0].type] || null
        }

        // Shared column values (used by all three paths). Order matters.
        const cols = [
            jurisdiction_id, office_name, office_type, chamber, district_identifier,
            district_name, term_length, max_terms, is_partisan, min_age, method,
            citizenship_requirement, citizenship_years_required, residency_requirement,
            residency_duration, eligibility_is_encoded, eligibility_source_url, eligibility_notes,
        ]

        // 1) Stable source key → DB-enforced upsert on the partial unique index.
        if (source_key) {
            const SQL = `
                INSERT INTO office (
                    id, source_key, jurisdiction_id, office_name, office_type, chamber,
                    district_identifier, district_name, term_length, max_terms, is_partisan,
                    min_age, resolution_method, citizenship_requirement, citizenship_years_required,
                    residency_requirement, residency_duration, eligibility_is_encoded,
                    eligibility_source_url, eligibility_notes
                ) VALUES (
                    uuid_generate_v4(), $1, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
                )
                ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET
                    jurisdiction_id = EXCLUDED.jurisdiction_id,
                    office_name = EXCLUDED.office_name,
                    office_type = EXCLUDED.office_type,
                    chamber = EXCLUDED.chamber,
                    district_identifier = EXCLUDED.district_identifier,
                    district_name = EXCLUDED.district_name,
                    term_length = EXCLUDED.term_length,
                    max_terms = EXCLUDED.max_terms,
                    is_partisan = EXCLUDED.is_partisan,
                    min_age = EXCLUDED.min_age,
                    resolution_method = EXCLUDED.resolution_method,
                    citizenship_requirement = EXCLUDED.citizenship_requirement,
                    citizenship_years_required = EXCLUDED.citizenship_years_required,
                    residency_requirement = EXCLUDED.residency_requirement,
                    residency_duration = EXCLUDED.residency_duration,
                    eligibility_is_encoded = EXCLUDED.eligibility_is_encoded,
                    eligibility_source_url = EXCLUDED.eligibility_source_url,
                    eligibility_notes = EXCLUDED.eligibility_notes
                RETURNING *;
            `
            const r = await client.query(SQL, [source_key, ...cols])
            return r.rows[0]
        }

        // 2) Update by id.
        if (id) {
            const SQL = `
                UPDATE office SET
                    jurisdiction_id = $2, office_name = $3, office_type = $4, chamber = $5,
                    district_identifier = $6, district_name = $7, term_length = $8, max_terms = $9,
                    is_partisan = $10, min_age = $11, resolution_method = $12,
                    citizenship_requirement = $13, citizenship_years_required = $14,
                    residency_requirement = $15, residency_duration = $16,
                    eligibility_is_encoded = $17, eligibility_source_url = $18, eligibility_notes = $19
                WHERE id = $1
                RETURNING *;
            `
            const r = await client.query(SQL, [id, ...cols])
            if (!r.rows.length) throw new Error("no office with this id")
            return r.rows[0]
        }

        // 3) Plain insert.
        const SQL = `
            INSERT INTO office (
                id, jurisdiction_id, office_name, office_type, chamber, district_identifier,
                district_name, term_length, max_terms, is_partisan, min_age, resolution_method,
                citizenship_requirement, citizenship_years_required, residency_requirement,
                residency_duration, eligibility_is_encoded, eligibility_source_url, eligibility_notes
            ) VALUES (
                uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
            )
            RETURNING *;
        `
        const r = await client.query(SQL, cols)
        return r.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    listOffices,
    getOfficeById,
    getOfficeByJurisdiction,
    getOfficesByState,
    getOfficeEligibility,
    getQualifyingOffices,
    getRelevantOffices,
    upsertOffice,
}