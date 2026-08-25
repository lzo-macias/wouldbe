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
    // office_id/race_id are the real keys — office_sought is a free-text label
    // and cannot be matched on. Nullable so an older client still works.
    office_id = null,
    race_id = null,
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
    filing_receipt_object_key = null,
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
    //
    // Three equivalent forms of proof: a link to the authority's own confirmation
    // page, a confirmation number, or an uploaded screenshot/PDF (stored as an R2
    // object key — see migration 1782500000000 for why a key and not a URL).
    const hasReceipt = !!(filing_receipt_url || filing_receipt_number || filing_receipt_object_key);
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
                is_self_treasurer, filing_receipt_url, filing_receipt_number, filed_at, committee_id_status,
                office_id, race_id, filing_receipt_object_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING *`,
            [
                user_id, jurisdiction_id, committee_name, committee_type, external_committee_id,
                external_candidate_id, office_sought, office_district, cycle_year, registration_status,
                authorityId, treasurer_name, treasurer_relationship, is_self_treasurer,
                filing_receipt_url, filing_receipt_number, filed_at, committee_id_status,
                office_id, race_id, filing_receipt_object_key,
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
    filing_receipt_object_key = null,
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
                termination_date       = COALESCE($14, termination_date),
                filing_receipt_object_key = COALESCE($15, filing_receipt_object_key),
                -- Attaching proof to a committee that had none is what promotes it
                -- out of pending_verification. Without this the upload would land
                -- but the launch gate would stay shut, which is the bug you'd only
                -- notice as "I uploaded it and nothing happened".
                registration_status = CASE
                    WHEN registration_status = 'pending_verification'
                     AND COALESCE($15, filing_receipt_object_key, filing_receipt_url, filing_receipt_number) IS NOT NULL
                    THEN 'provisional_on_receipt'
                    ELSE registration_status
                END,
                committee_id_status = CASE
                    WHEN committee_id_status IS NULL
                     AND COALESCE($15, filing_receipt_object_key, filing_receipt_url, filing_receipt_number) IS NOT NULL
                    THEN 'provisional'
                    ELSE committee_id_status
                END
             WHERE id = $1
             RETURNING *`,
            [
                id, committee_name, committee_type, external_committee_id, external_candidate_id,
                office_sought, office_district, treasurer_name, treasurer_relationship,
                is_self_treasurer, filing_receipt_url, filing_receipt_number, filed_at, termination_date,
                filing_receipt_object_key,
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

// hasActiveVerifiedCommittee — THE launch gate §5 consults before flipping a
// WouldBe to active. Accepts provisional_on_receipt: a filing receipt is enough
// to go live, because the committee ID often lags the filing.
//
// MATCHING IS PER CANDIDACY, most precise first:
//   1. race_id   — the exact contest. Implies office AND cycle.
//   2. office_id + cycle_year — the same candidacy, before a race row existed.
//   3. jurisdiction_id + cycle_year — LEGACY ONLY, and only for committees that
//      carry no office_id. This was the old behaviour and it is too loose: two
//      offices inside one jurisdiction (City Council Seat A and Seat B) would
//      share a committee, when they are two candidacies needing two filings.
//      Kept so committees filed before office_id existed still work.
//
// Returns the matching committee row, or null.
const hasActiveVerifiedCommittee = async ({ userId, raceId = null, officeId = null, cycleYear = null }) => {
    if (!userId) return null;

    // Fill in whatever the caller didn't pass, so a single raceId is enough.
    let office = officeId;
    let cycle = cycleYear;
    let jurisdiction = null;
    if (raceId) {
        const { rows } = await client.query(
            `SELECT r.office_id, r.election_cycle, o.jurisdiction_id
             FROM races r JOIN office o ON o.id = r.office_id
             WHERE r.id = $1`,
            [raceId]
        );
        if (rows.length) {
            office = office ?? rows[0].office_id;
            cycle = cycle ?? rows[0].election_cycle;
            jurisdiction = rows[0].jurisdiction_id;
        }
    } else if (office) {
        const { rows } = await client.query(`SELECT jurisdiction_id FROM office WHERE id = $1`, [office]);
        jurisdiction = rows[0]?.jurisdiction_id ?? null;
    }

    // ONE query, ranked. Doing this as three sequential queries would be three
    // round trips to answer one question, and the ranking is the whole point:
    // a race-bound committee should always beat a jurisdiction-wide one.
    const { rows } = await client.query(
        `SELECT cc.*,
                CASE
                    WHEN $2::uuid IS NOT NULL AND cc.race_id = $2 THEN 1
                    WHEN $3::uuid IS NOT NULL AND cc.office_id = $3
                         AND ($4::int IS NULL OR cc.cycle_year = $4) THEN 2
                    ELSE 3
                END AS match_rank
         FROM candidate_committees cc
         WHERE cc.user_id = $1
           AND cc.registration_status = ANY($5)
           AND (
                 ($2::uuid IS NOT NULL AND cc.race_id = $2)
              OR ($3::uuid IS NOT NULL AND cc.office_id = $3
                    AND ($4::int IS NULL OR cc.cycle_year = $4))
              OR (
                   -- legacy: only committees with NO office binding at all
                   cc.office_id IS NULL AND cc.race_id IS NULL
                   AND (
                        $6::uuid IS NULL
                        OR (cc.jurisdiction_id = $6 AND ($4::int IS NULL OR cc.cycle_year = $4))
                       )
                 )
               )
         ORDER BY match_rank ASC,
                  (cc.registration_status = 'verified_active') DESC,
                  cc.created_at DESC
         LIMIT 1`,
        [userId, raceId, office, cycle, GATE_OK_STATUSES, jurisdiction]
    );
    return rows[0] || null;
};

// hasCommitteeForWouldbe — the same gate, addressed by CAMPAIGN. Each WouldBe
// asks about its own candidacy rather than the caller asking "do I have any
// committee anywhere", which is the question that produced the bug.
const hasCommitteeForWouldbe = async ({ wouldbe_id }) => {
    if (!wouldbe_id) throw httpError(400, "wouldbe_id is required");
    const { rows } = await client.query(
        `SELECT w.user_id, w.race_id, w.office_id, r.election_cycle
         FROM wouldbe w LEFT JOIN races r ON r.id = w.race_id
         WHERE w.id = $1`,
        [wouldbe_id]
    );
    if (!rows.length) throw httpError(404, "WouldBe not found");
    const wb = rows[0];
    return hasActiveVerifiedCommittee({
        userId: wb.user_id,
        raceId: wb.race_id,
        officeId: wb.office_id,
        cycleYear: wb.election_cycle,
    });
};

module.exports = {
    createCandidateCommittee,
    getUserCommittees,
    getCommitteeById,
    verifyCommitteeViaAPI,
    confirmCommittee,
    updateCommittee,
    hasActiveVerifiedCommittee,
    hasCommitteeForWouldbe,
};
