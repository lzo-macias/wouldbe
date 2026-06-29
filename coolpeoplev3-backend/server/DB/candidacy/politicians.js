const { client } = require("../index.js")

const listPoliticians = async ({} = {}) => {
    try {
        const SQL = `
            SELECT *
            FROM politicians
            ORDER BY last_name ASC
        `

        const result = await client.query(SQL)

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

const getPoliticianById = async ({
    id
}) => {
    try {
        const SQL = `
            SELECT *
            FROM politicians
            WHERE id = $1
        `

        const result = await client.query(SQL, [id])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

const getPoliticianTerms = async ({
    id
}) => {
    try{
        const SQL = `
            SELECT
                t.*,
                p.first_name,
                p.last_name,
                p.photo_url,
                o.office_name,
                o.office_type,
                o.chamber,
                o.district_name,
                j.name       AS jurisdiction_name,
                j.state_code
            FROM politicians p
            JOIN terms t        ON t.politician_id = p.id
            JOIN office o       ON o.id = t.office_id
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE p.id = $1
            ORDER BY t.term_end_date DESC
        `

        const result = await client.query(SQL, [id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

const claimPoliticianProfile = async ({
    user_id,
    id
}) => {
    try{
        const SQL = `
            UPDATE politicians SET linked_user_id = $1, updated_at = NOW()
            WHERE id = $2
                AND linked_user_id IS NULL
            RETURNING *
        `

        const result = await client.query(SQL, [user_id, id])

        if (!result.rows.length) {
            throw new Error("politician not found or already claimed")
        }
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// upsertPolitician({...}) — the scraper's writer. id given → UPDATE; else INSERT.
// IMPORTANT: linked_user_id is platform-owned (set by claimPoliticianProfile),
// NOT from the scrape — so the UPDATE COALESCEs it to preserve an existing claim
// instead of wiping it back to NULL on every re-scrape.
const upsertPolitician = async ({
    id = null,
    first_name,
    last_name,
    party = null,
    fec_candidate_id = null,
    suffix = null,
    date_of_birth = null,
    bioguide_id = null,
    openstates_id = null,
    ballotpedia_url = null,
    wikipedia_url = null,
    photo_url = null,
    official_website = null,
    twitter_handle = null,
    linked_user_id = null,
}) => {
    try {
        const cols = [
            first_name, last_name, party, fec_candidate_id, suffix, date_of_birth,
            bioguide_id, openstates_id, ballotpedia_url, wikipedia_url, photo_url,
            official_website, twitter_handle, linked_user_id,
        ]

        if (id) {
            const SQL = `
                UPDATE politicians SET
                    first_name = $2, last_name = $3, party = $4, fec_candidate_id = $5,
                    suffix = $6, date_of_birth = $7, bioguide_id = $8, openstates_id = $9,
                    ballotpedia_url = $10, wikipedia_url = $11, photo_url = $12,
                    official_website = $13, twitter_handle = $14,
                    linked_user_id = COALESCE($15, linked_user_id),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *;
            `
            const r = await client.query(SQL, [id, ...cols])
            if (!r.rows.length) throw new Error("no politician with this id")
            return r.rows[0]
        }

        const SQL = `
            INSERT INTO politicians (
                id, first_name, last_name, party, fec_candidate_id, suffix, date_of_birth,
                bioguide_id, openstates_id, ballotpedia_url, wikipedia_url, photo_url,
                official_website, twitter_handle, linked_user_id
            ) VALUES (
                uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
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
    listPoliticians,
    getPoliticianById,
    getPoliticianTerms,
    claimPoliticianProfile,
    upsertPolitician,
}