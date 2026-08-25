const { client } = require("../index.js")


// listJurisdictions(filters) — unified search. Query by any of the three:
// NAME (q, fuzzy ILIKE), STATE (state_code), or ID (id, exact) — plus type/parent.
// All filters optional and AND together; omit everything for "all".
// (getJurisdictionByIdV2 remains the direct single-id lookup.)
const listJurisdictionsV2 = async ({
    q,                       // name search (case-insensitive, partial)
    id,                      // exact id
    type,
    state_code,
    parent_jurisdiction_id,
    limit = 100,
} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM jurisdiction
            WHERE ($1::text    IS NULL OR name ILIKE '%' || $1 || '%')
                AND ($2::uuid    IS NULL OR id = $2)
                AND ($3::text    IS NULL OR type = $3)
                AND ($4::char(2) IS NULL OR state_code = $4)
                AND ($5::uuid    IS NULL OR parent_jurisdiction_id = $5)
            ORDER BY name
            LIMIT $6
        `

        const result = await client.query(SQL, [
            q ?? null,
            id ?? null,
            type ?? null,
            state_code ?? null,
            parent_jurisdiction_id ?? null,
            Math.min(Number(limit) || 100, 500),
        ])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// getJurisdictionById(id) — Single row.
const getJurisdictionByIdV2 = async ({
    id,
}) => {
    try{
        const SQL = `
            SELECT *
            FROM jurisdiction
            WHERE id = $1
        `

        const result = await client.query(SQL, [id])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// getJurisdictionChildren(id) — WHERE parent_jurisdiction_id.
const getJurisdictionChildren = async ({
    parent_id
}) => {
    try{
        const SQL = `
            SELECT *
            FROM jurisdiction
            WHERE parent_jurisdiction_id = $1
        `

        const result = await client.query(SQL, [parent_id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}


// lookupJurisdictionsByLocation(loc) — Used on user onboarding.
const lookupJurisdictionsByLocationV2 = async ({
    ocd_division_id,
    fips_code,
    state_code,
    type,
    name,
} = {}) => {
    try {
        const SQL = `
            SELECT *
            FROM jurisdiction
            WHERE ($1::text    IS NULL OR ocd_division_id = $1)
                AND ($2::text    IS NULL OR fips_code = $2)
                AND ($3::char(2) IS NULL OR state_code = $3)
                AND ($4::text    IS NULL OR type = $4)
                AND ($5::text    IS NULL OR name = $5)
        `

        const result = await client.query(SQL, [
            ocd_division_id ?? null,
            fips_code ?? null,
            state_code ?? null,
            type ?? null,
            name ?? null,
        ])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// upsertJurisdiction(data) — Used by sync jobs.

const upsertJurisdictionV2 = async ({
    name,
    type,
    parent_jurisdiction_id,
    state_code,
    election_authority_name,
    election_authority_url,
    ocd_division_id,
    fips_code,
    latitude,
    longitude,
}) => {
    try {
        const SQL = `
            INSERT INTO jurisdiction (
                name,
                type,
                parent_jurisdiction_id,
                state_code,
                election_authority_name,
                election_authority_url,
                ocd_division_id,
                fips_code,
                latitude,
                longitude
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            ON CONFLICT (ocd_division_id) WHERE ocd_division_id IS NOT NULL
            DO UPDATE SET
                name                    = EXCLUDED.name,
                type                    = EXCLUDED.type,
                parent_jurisdiction_id  = EXCLUDED.parent_jurisdiction_id,
                state_code              = EXCLUDED.state_code,
                election_authority_name = EXCLUDED.election_authority_name,
                election_authority_url  = EXCLUDED.election_authority_url,
                fips_code               = EXCLUDED.fips_code,
                latitude                = EXCLUDED.latitude,
                longitude               = EXCLUDED.longitude
            RETURNING *;
        `

        const result = await client.query(SQL, [
            name,
            type,
            parent_jurisdiction_id ?? null,
            state_code ?? null,
            election_authority_name ?? null,
            election_authority_url ?? null,
            ocd_division_id ?? null,
            fips_code ?? null,
            latitude ?? null,
            longitude ?? null,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

module.exports = {
    listJurisdictionsV2,
    getJurisdictionByIdV2,
    getJurisdictionChildren,
    lookupJurisdictionsByLocationV2,
    upsertJurisdictionV2,
}
