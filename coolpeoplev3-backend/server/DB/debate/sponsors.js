const { client } = require("../index.js");

// ============================================================================
// sponsors — whoever posts/funds a Debate: a 'casual' user or a 'corporate'
// entity (corporate carries heavier KYC + a separate verification step). A
// sponsor row is owned by one user. New sponsors start UNVERIFIED (verified_at
// null) until an admin runs verifySponsor.
// ============================================================================

const SPONSOR_TYPES = ["corporate", "casual"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createSponsor — register a sponsor profile for the calling user. id /
// created_at / updated_at default at the DB; verified_at + marketing_consent_at
// stay null until those explicit steps happen.
const createSponsor = async ({ user_id, type, display_name, logo_url = null }) => {
    if (!user_id || !type || !display_name) {
        throw httpError(400, "user_id, type and display_name are required");
    }
    if (!SPONSOR_TYPES.includes(type)) {
        throw httpError(400, `type must be one of: ${SPONSOR_TYPES.join(", ")}`);
    }
    try {
        const SQL = `
            INSERT INTO sponsors (user_id, type, display_name, logo_url)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await client.query(SQL, [user_id, type, display_name, logo_url]);
        return result.rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "type violates the allowed values");
        if (err.code === "23503") throw httpError(400, "user_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getSponsorById — a single sponsor by its OWN id (the /sponsors/:id param).
const getSponsorById = async ({ id }) => {
    const SQL = `SELECT * FROM sponsors WHERE id = $1`;
    const result = await client.query(SQL, [id]);
    return result.rows[0] || null;
};

// updateSponsor — edit mutable fields (owner only, enforced at the route).
// COALESCE keeps the existing value when a field is omitted (new value first!).
// Does NOT touch verified_at (admin-only, see verifySponsor) or the PK/created_at.
const updateSponsor = async ({ id, type = null, display_name = null, logo_url = null }) => {
    if (type && !SPONSOR_TYPES.includes(type)) {
        throw httpError(400, `type must be one of: ${SPONSOR_TYPES.join(", ")}`);
    }
    try {
        const SQL = `
            UPDATE sponsors SET
                type         = COALESCE($2, type),
                display_name = COALESCE($3, display_name),
                logo_url     = COALESCE($4, logo_url),
                updated_at   = NOW()
            WHERE id = $1
            RETURNING *;
        `;
        const result = await client.query(SQL, [id, type, display_name, logo_url]);
        if (!result.rows.length) throw httpError(404, "sponsor not found");
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23514") throw httpError(400, "type violates the allowed values");
        console.error(err);
        throw err;
    }
};

// setSponsorMarketingConsent — stamp (or clear) marketing_consent_at. consented
// true → NOW(); false → null (withdrawal). Owner only.
const setSponsorMarketingConsent = async ({ id, consented = true }) => {
    const SQL = `
        UPDATE sponsors
        SET marketing_consent_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *;
    `;
    const result = await client.query(SQL, [id, !!consented]);
    if (!result.rows.length) throw httpError(404, "sponsor not found");
    return result.rows[0];
};

// verifySponsor — admin-only identity verification. Sets verified_at = NOW()
// (or clears it when verified=false to revoke).
const verifySponsor = async ({ id, verified = true }) => {
    const SQL = `
        UPDATE sponsors
        SET verified_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *;
    `;
    const result = await client.query(SQL, [id, !!verified]);
    if (!result.rows.length) throw httpError(404, "sponsor not found");
    return result.rows[0];
};

// getSponsorDebates — every debate this sponsor posted, newest first.
const getSponsorDebates = async ({ sponsor_id }) => {
    const SQL = `
        SELECT * FROM debates
        WHERE sponsor_id = $1
        ORDER BY created_at DESC
    `;
    const result = await client.query(SQL, [sponsor_id]);
    return result.rows;
};

module.exports = {
    createSponsor,
    getSponsorById,
    updateSponsor,
    setSponsorMarketingConsent,
    verifySponsor,
    getSponsorDebates,
};
