const { client } = require("../index.js")

// deriveAgeBand(dob) — single source of band logic, shared by create + refresh.
// under_13 / 13_17 gate safety/legal features; the rest are 5-year marketing segments up to 90+.
const deriveAgeBand = (dateOfBirth) => {
    if(!dateOfBirth) return null;
    const dob = new Date(dateOfBirth)
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || m === 0 && today.getDate() < dob.getDate()) age --;
    if (age < 13) return 'under_13';
    if (age < 18) return '13_17';
    if (age < 25) return '18_24';
    if (age < 30) return '25_29';
    if (age < 35) return '30_34';
    if (age < 40) return '35_39';
    if (age < 45) return '40_44';
    if (age < 50) return '45_49';
    if (age < 55) return '50_54';
    if (age < 60) return '55_59';
    if (age < 65) return '60_64';
    if (age < 70) return '65_69';
    if (age < 75) return '70_74';
    if (age < 80) return '75_79';
    if (age < 85) return '80_84';
    if (age < 90) return '85_89';
    return '90_plus';
}

// createChildSafetyRecord(userId, dob) — On signup; compute age_band; set the consent-required flags.
// coppa flag is true only for under_13; minor-participation flag true only for 13_17.

const createChildSafetyRecord = async ({
    userId,
    dob,
    age_verification_method,
    age_verified_value,
}) => {
    try{
        const age_band = deriveAgeBand(dob)
        const coppa_parental_consent_required = age_band === 'under_13'
        const minor_participation_consent_required = age_band === '13_17'

        const SQL = `
            INSERT INTO child_safety_records (
                id,
                user_id,
                age_verification_method,
                age_verified_value,
                age_band,
                coppa_parental_consent_required,
                minor_participation_consent_required
            ) VALUES (
                uuid_generate_v4(),
                $1, $2, $3, $4, $5, $6
            )
            RETURNING *;
        `
        const result = await client.query(SQL, [
            userId,
            age_verification_method,
            age_verified_value,
            age_band,
            coppa_parental_consent_required,
            minor_participation_consent_required,
        ])
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// refreshAgeBands() — nightly job. Recomputes every user's band from date_of_birth
// (the source of truth), updates only rows that changed, and resets the consent-required
// flags to match the new band. Idempotent and self-healing (a missed run is caught the next).
// Returns the rows that changed today so the caller can fire side effects (re-consent, emails).

const refreshAgeBands = async () => {
    try{
        const SQL = `
            UPDATE child_safety_records csr
            SET age_band = computed.band,
                coppa_parental_consent_required = (computed.band = 'under_13'),
                minor_participation_consent_required = (computed.band = '13_17')
            FROM (
                SELECT
                    u.id AS user_id,
                    CASE
                        WHEN date_part('year', age(u.date_of_birth)) < 13 THEN 'under_13'
                        WHEN date_part('year', age(u.date_of_birth)) < 18 THEN '13_17'
                        WHEN date_part('year', age(u.date_of_birth)) < 25 THEN '18_24'
                        WHEN date_part('year', age(u.date_of_birth)) < 30 THEN '25_29'
                        WHEN date_part('year', age(u.date_of_birth)) < 35 THEN '30_34'
                        WHEN date_part('year', age(u.date_of_birth)) < 40 THEN '35_39'
                        WHEN date_part('year', age(u.date_of_birth)) < 45 THEN '40_44'
                        WHEN date_part('year', age(u.date_of_birth)) < 50 THEN '45_49'
                        WHEN date_part('year', age(u.date_of_birth)) < 55 THEN '50_54'
                        WHEN date_part('year', age(u.date_of_birth)) < 60 THEN '55_59'
                        WHEN date_part('year', age(u.date_of_birth)) < 65 THEN '60_64'
                        WHEN date_part('year', age(u.date_of_birth)) < 70 THEN '65_69'
                        WHEN date_part('year', age(u.date_of_birth)) < 75 THEN '70_74'
                        WHEN date_part('year', age(u.date_of_birth)) < 80 THEN '75_79'
                        WHEN date_part('year', age(u.date_of_birth)) < 85 THEN '80_84'
                        WHEN date_part('year', age(u.date_of_birth)) < 90 THEN '85_89'
                        ELSE '90_plus'
                    END AS band
                FROM users u
            ) computed
            WHERE csr.user_id = computed.user_id
              AND csr.age_band IS DISTINCT FROM computed.band
            RETURNING csr.user_id, csr.age_band;
        `
        const result = await client.query(SQL)
        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}


// getChildSafetyRecord(userId) — Single row by user.
const getChildSafetyRecord = async ({
    user_id
}) => {
    try{
        const SQL = `
            SELECT * 
            FROM child_safety_records
            WHERE user_id = $1
        `

        const result = await client.query(SQL, [user_id])
        return result.rows[0]

    }catch(err){
        console.error(err)
        throw err
    }
}

// recordParentalConsent(data) — Sets parental_consent_at + method.

const recordParentalConsent = async ({
    parental_consent_method,
    parental_email,
    features_restricted,
    verified_at,
    verified_by,
    user_id
}) => {
    try{
        const SQL = `
            UPDATE child_safety_records
            SET
                parental_consent_method = COALESCE($1, parental_consent_method),
                parental_email          = COALESCE($2, parental_email),
                parental_consent_at     = NOW(),
                features_restricted     = COALESCE($3, features_restricted),
                verified_at             = COALESCE($4, verified_at),
                verified_by             = COALESCE($5, verified_by)
            WHERE user_id = $6
            RETURNING *;
        `

        const result = await client.query(SQL, [
            parental_consent_method,
            parental_email,
            features_restricted ? JSON.stringify(features_restricted) : null,
            verified_at,
            verified_by,
            user_id,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}


// submitAgeVerification(data) — Sets verification method + age_verified_value.
const submitAgeVerification = async ({
    user_id,
    age_verification_method,
    age_verified_value
}) => {
    try {
        const SQL = `
            UPDATE child_safety_records
            SET
                age_verification_method = COALESCE($1, age_verification_method),
                age_verified_value      = COALESCE($2, age_verified_value)
            WHERE user_id = $3
            RETURNING *;
        `

        const result = await client.query(SQL, [age_verification_method, age_verified_value, user_id])


        return result.rows[0]

    }catch(err){
        console.error(err)
        throw err
    }
}

// featuresRestrictedFor(userId) — Returns JSONB of blocked features by age_band.

const featuresRestrictedFor = async ({
    user_id,
}) => {
    try {
        const SQL = `
            SELECT features_restricted
            FROM child_safety_records
            WHERE user_id = $1
        `

        const result = await client.query(SQL, [user_id])
        return result.rows[0]?.features_restricted ?? null
    }catch(err){
        console.error(err)
        throw err
    }
}

module.exports = {
    deriveAgeBand,
    createChildSafetyRecord,
    refreshAgeBands,
    getChildSafetyRecord,
    recordParentalConsent,
    submitAgeVerification,
    featuresRestrictedFor
};
