const { client } = require("../index.js");

// ============================================================================
// candidate_committees — the load-bearing legal gate. NO public pledge campaign
// (§5 wouldbe.launch_status = 'active') exists without a row here in an
// acceptable status.
//
// Two entry points onto the SAME row:
//   1. createCandidateCommittee — the candidate files, shows a receipt. The
//      committee ID often lags the filing (slow authorities), so we accept the
//      receipt provisionally: registration_status='provisional_on_receipt',
//      committee_id_status='provisional'. This already satisfies the launch gate.
//   2. verifyCommitteeViaAPI → confirmCommittee — later, we confirm the committee
//      against the authority's API (FEC/state). On a match the same row upgrades
//      to registration_status='verified_active', committee_id_status='confirmed'.
//
// Receipts are NOT a separate table: filing_receipt_url / filing_receipt_number /
// filed_at live as columns on the committee row itself.
// ============================================================================

const COMMITTEE_TYPES = ["principal", "authorized", "joint_fundraising", "leadership_pac"];
const TREASURER_RELATIONSHIPS = ["self", "spouse_family_friend", "volunteer", "paid_professional"];
// Statuses that satisfy the launch gate (live + provisional-on-receipt both count).
const GATE_OK_STATUSES = ["verified_active", "provisional_on_receipt"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createCandidateCommittee — record a committee for a candidate. If a filing
// receipt is supplied we accept it provisionally (the launch-gate-passing state);
// otherwise the row is pending_verification until the API confirms it.
// Reads filing_authorities (R) to resolve/validate the authority + self-treasurer.
// db defaults to the pool but accepts a withTransaction `tx` connection so this
// write can be made atomic with a caller's transaction (e.g. TTW conversion).
const createCandidateCommittee = async ({
    user_id,
    jurisdiction_id,
    committee_name,
    committee_type,
    office_sought,
    office_district = null,
    cycle_year,
    external_committee_id = null,
    external_candidate_id = null,
    filing_authority_id = null,
    treasurer_name = null,
    treasurer_relationship = null,
    is_self_treasurer = null,
    filing_receipt_url = null,
    filing_receipt_number = null,
    filed_at = null,
}, db = client) => {
    if (!user_id || !jurisdiction_id || !committee_name || !committee_type || !office_sought || !cycle_year) {
        throw httpError(400, "user_id, jurisdiction_id, committee_name, committee_type, office_sought and cycle_year are required");
    }
    if (!COMMITTEE_TYPES.includes(committee_type)) {
        throw httpError(400, `committee_type must be one of: ${COMMITTEE_TYPES.join(", ")}`);
    }
    if (treasurer_relationship && !TREASURER_RELATIONSHIPS.includes(treasurer_relationship)) {
        throw httpError(400, `treasurer_relationship must be one of: ${TREASURER_RELATIONSHIPS.join(", ")}`);
    }

    // A filing receipt is what lets a candidate go live immediately, before the
    // authority's API has the committee. No receipt → pending_verification.
    const hasReceipt = !!(filing_receipt_url || filing_receipt_number);
    const registration_status = hasReceipt ? "provisional_on_receipt" : "pending_verification";
    // committee_id_status is null until a filing exists; a receipt makes it provisional.
    const committee_id_status = hasReceipt ? "provisional" : null;

    // Resolve the filing authority if not passed (most specific active match).
    let authorityId = filing_authority_id;
    if (!authorityId) {
        const { rows } = await db.query(
            `SELECT id FROM filing_authorities
             WHERE jurisdiction_id = $1 AND is_active = true
             ORDER BY (applies_to_office_id IS NOT NULL) DESC
             LIMIT 1`,
            [jurisdiction_id]
        );
        authorityId = rows[0]?.id || null;
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO candidate_committees
               (user_id, jurisdiction_id, committee_name, committee_type, external_committee_id,
                external_candidate_id, office_sought, office_district, cycle_year, registration_status,
                verified_via_api, filing_authority_id, treasurer_name, treasurer_relationship,
                is_self_treasurer, filing_receipt_url, filing_receipt_number, filed_at, committee_id_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING *`,
            [
                user_id, jurisdiction_id, committee_name, committee_type, external_committee_id,
                external_candidate_id, office_sought, office_district, cycle_year, registration_status,
                authorityId, treasurer_name, treasurer_relationship, is_self_treasurer,
                filing_receipt_url, filing_receipt_number, filed_at, committee_id_status,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "a committee field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "jurisdiction_id or filing_authority_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getUserCommittees({ userId }) — all committees a candidate owns.
const getUserCommittees = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT cc.*, j.name AS jurisdiction_name, fa.authority_name
         FROM candidate_committees cc
         JOIN jurisdiction j ON j.id = cc.jurisdiction_id
         LEFT JOIN filing_authorities fa ON fa.id = cc.filing_authority_id
         WHERE cc.user_id = $1
         ORDER BY cc.created_at DESC`,
        [userId]
    );
    return rows;
};

// getCommitteeById({ id }) — single committee.
const getCommitteeById = async ({ id }) => {
    const { rows } = await client.query(
        `SELECT cc.*, j.name AS jurisdiction_name, fa.authority_name
         FROM candidate_committees cc
         JOIN jurisdiction j ON j.id = cc.jurisdiction_id
         LEFT JOIN filing_authorities fa ON fa.id = cc.filing_authority_id
         WHERE cc.id = $1`,
        [id]
    );
    return rows[0] || null;
};

// confirmCommittee — the DB writer that upgrades a committee to verified_active.
// Pass the authority's raw response for audit. Idempotent-ish: flips status,
// stamps verified_via_api / last_verified_at, marks the id confirmed.
const confirmCommittee = async ({ id, verification_response = null, verified_via_api = true, external_committee_id = null }) => {
    const { rows } = await client.query(
        `UPDATE candidate_committees SET
            registration_status   = 'verified_active',
            committee_id_status   = 'confirmed',
            verified_via_api      = $2,
            verification_response = COALESCE($3, verification_response),
            external_committee_id = COALESCE($4, external_committee_id),
            last_verified_at      = now()
         WHERE id = $1
         RETURNING *`,
        [id, verified_via_api, verification_response ? JSON.stringify(verification_response) : null, external_committee_id]
    );
    if (!rows.length) throw httpError(404, "committee not found");
    return rows[0];
};

// verifyCommitteeViaAPI — orchestrator: provisional → verified_active by calling
// the relevant authority's API (FEC for federal, state portals otherwise), then
// confirmCommittee on a match.
//
// [TODO/INFRA] No runtime FEC/state API client exists yet (seed-time reference
// lives in server/seed/reference/sources/fec.js, not a live verifier). Until that
// client lands this performs the DB-side confirmation from a payload the caller
// supplies (e.g. an admin who checked the FEC record). Wire the real fetch here:
//   const payload = await fecClient.getCommittee(committee.external_committee_id)
//   if (!matches(payload, committee)) throw httpError(422, "authority record mismatch")
const verifyCommitteeViaAPI = async ({ id, verification_response = null, external_committee_id = null }) => {
    const committee = await getCommitteeById({ id });
    if (!committee) throw httpError(404, "committee not found");
    if (!committee.external_committee_id && !external_committee_id) {
        throw httpError(422, "committee has no external_committee_id to verify against the authority API yet");
    }
    return confirmCommittee({ id, verification_response, verified_via_api: true, external_committee_id });
};

// updateCommittee({ id, ...fields }) — partial update (COALESCE keeps existing).
const updateCommittee = async ({
    id,
    committee_name = null,
    committee_type = null,
    external_committee_id = null,
    external_candidate_id = null,
    office_sought = null,
    office_district = null,
    treasurer_name = null,
    treasurer_relationship = null,
    is_self_treasurer = null,
    filing_receipt_url = null,
    filing_receipt_number = null,
    filed_at = null,
    termination_date = null,
}) => {
    if (committee_type && !COMMITTEE_TYPES.includes(committee_type)) {
        throw httpError(400, `committee_type must be one of: ${COMMITTEE_TYPES.join(", ")}`);
    }
    if (treasurer_relationship && !TREASURER_RELATIONSHIPS.includes(treasurer_relationship)) {
        throw httpError(400, `treasurer_relationship must be one of: ${TREASURER_RELATIONSHIPS.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `UPDATE candidate_committees SET
                committee_name         = COALESCE($2, committee_name),
                committee_type         = COALESCE($3, committee_type),
                external_committee_id  = COALESCE($4, external_committee_id),
                external_candidate_id  = COALESCE($5, external_candidate_id),
                office_sought          = COALESCE($6, office_sought),
                office_district        = COALESCE($7, office_district),
                treasurer_name         = COALESCE($8, treasurer_name),
                treasurer_relationship = COALESCE($9, treasurer_relationship),
                is_self_treasurer      = COALESCE($10, is_self_treasurer),
                filing_receipt_url     = COALESCE($11, filing_receipt_url),
                filing_receipt_number  = COALESCE($12, filing_receipt_number),
                filed_at               = COALESCE($13, filed_at),
                termination_date       = COALESCE($14, termination_date)
             WHERE id = $1
             RETURNING *`,
            [
                id, committee_name, committee_type, external_committee_id, external_candidate_id,
                office_sought, office_district, treasurer_name, treasurer_relationship,
                is_self_treasurer, filing_receipt_url, filing_receipt_number, filed_at, termination_date,
            ]
        );
        if (!rows.length) throw httpError(404, "committee not found");
        return rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23514") throw httpError(400, "a committee field violates a check constraint");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// hasActiveVerifiedCommittee({ userId, raceId }) — THE launch gate §5 consults
// before flipping a WouldBe to active. Accepts provisional_on_receipt (a receipt
// is enough to go live). When a raceId is given we narrow to the race's
// jurisdiction + cycle (the reliable keys; office_sought is a free-text label).
// Returns the matching committee row, or null.
const hasActiveVerifiedCommittee = async ({ userId, raceId = null }) => {
    if (raceId) {
        const { rows } = await client.query(
            `SELECT cc.*
             FROM candidate_committees cc
             JOIN races r ON r.id = $2
             JOIN office o ON o.id = r.office_id
             WHERE cc.user_id = $1
               AND cc.jurisdiction_id = o.jurisdiction_id
               AND cc.cycle_year = r.election_cycle
               AND cc.registration_status = ANY($3)
             ORDER BY cc.registration_status = 'verified_active' DESC, cc.created_at DESC
             LIMIT 1`,
            [userId, raceId, GATE_OK_STATUSES]
        );
        return rows[0] || null;
    }
    const { rows } = await client.query(
        `SELECT * FROM candidate_committees
         WHERE user_id = $1 AND registration_status = ANY($2)
         ORDER BY registration_status = 'verified_active' DESC, created_at DESC
         LIMIT 1`,
        [userId, GATE_OK_STATUSES]
    );
    return rows[0] || null;
};

module.exports = {
    createCandidateCommittee,
    getUserCommittees,
    getCommitteeById,
    verifyCommitteeViaAPI,
    confirmCommittee,
    updateCommittee,
    hasActiveVerifiedCommittee,
};
