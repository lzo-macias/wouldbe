const { client } = require("../index")


// recordAttestation(data) — INSERT; context = signup|pledge_flow|debate_entry|candidate_onboarding.

const recordAttestation = async ({
    user_id,
    attestation_type,
    attested_value,
    attestation_version,
    attested_at,
    ip_address,
    context,
    expires_at,
    superseded_by_id,
}) => {
    try{
        const SQL = `
            INSERT INTO user_attestations (
                id,
                user_id,
                attestation_type,
                attested_value,
                attestation_version,
                attested_at,
                ip_address,
                context,
                expires_at,
                superseded_by_id,
                created_at
            )VALUES (
                uuid_generate_v4(),
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                NOW()
            )RETURNING *;
        `
        const result = await client.query(SQL, [
                user_id,
                attestation_type,
                attested_value,
                attestation_version,
                attested_at,
                ip_address,
                context,
                expires_at,
                superseded_by_id,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// getUserActiveAttestations(userId) — Latest non-expired non-superseded per type.

const getUserActiveAttestations = async ({
    user_id
}) => {
    try{

        const SQL = `
            SELECT DISTINCT ON (attestation_type) *
            FROM user_attestations
            WHERE user_id = $1
                AND (expires_at IS NULL OR NOW() < expires_at)
                AND superseded_by_id IS NULL
            ORDER BY attestation_type, created_at DESC
        `

        const result = await client.query(SQL, [user_id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// getMissingAttestations(userId, context) — Diff required vs user's active set.

const getMissingAttestations = async ({
    user_id,
    context,
}) => {

    const require_by_context = {
        signup:               ['age_13'],
        // [CLARIFICATION 2026-05-29] pledging requires attesting "US citizen OR lawful permanent
        // resident" (positive-only — see chk_pledge_eligibility_positive_only on user_attestations).
        pledge_flow:          ['age_18', 'own_funds', 'us_citizen_or_lpr'],
        debate_entry:         ['age_18', 'us_citizen'],
        // 13-17 entrants: no age_18 attestation — guardian consent is the gate
        // (enforced via child_safety_records + debate_entries.guardian_consent_at, not here)
        debate_entry_minor:   ['us_citizen'],
        candidate_onboarding: ['us_citizen', 'not_foreign_national','not_federal_contractor'],
    }

    const SQL = `
        SELECT DISTINCT attestation_type
        FROM user_attestations
        WHERE user_id = $1
            AND (expires_at IS NULL OR NOW() < expires_at)
            AND superseded_by_id IS NULL
    `

    const result = await client.query(SQL, [user_id])
    const activeTypes = new Set(result.rows.map(r => r.attestation_type))
    const required = require_by_context[context] ?? []

    return required.filter(type => !activeTypes.has(type))

}

// isAttestationCurrent(userId, type) — Helper for gate checks.

const isAttestationCurrent = async ({
    userId,
    type,
}) => {
    try{

        const SQL = `
            SELECT *
            FROM user_attestations
            WHERE user_id = $1
                AND attestation_type = $2
                AND (expires_at IS NULL OR NOW() < expires_at)
                AND superseded_by_id IS NULL
            ORDER BY created_at DESC
        `

        const result = await client.query(SQL, [userId, type])
        if (result.rows.length === 0) {
            console.log ("attestation non-existant or not current")
            return false
        }

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

module.exports = {
    recordAttestation,
    getUserActiveAttestations,
    getMissingAttestations,
    isAttestationCurrent,
};

