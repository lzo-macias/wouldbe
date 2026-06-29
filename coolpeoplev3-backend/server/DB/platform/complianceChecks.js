const { client } = require("../index.js");
const { getCurrentRulesForJurisdiction } = require("../elections/jurisdictionRules.js");

// ============================================================================
// compliance_checks — append-only ledger of every compliance decision. Each row
// pins the jurisdiction AND the rules version in force, so "what did the system
// know when it let user X do Y?" is always reconstructable. This module RECORDS
// outcomes (and stamps context); the per-check_type verdict logic is computed by
// the caller / sibling check modules and passed in as result + reason + details.
// ============================================================================

const CHECK_TYPES = [
    "committee_verification", "jurisdiction_eligibility",
    "fundraising_window", "contribution_limit", "age_eligibility",
];
const RESULTS = ["passed", "failed", "warning", "exception_granted"];
const PERFORMED_BY = ["system", "admin_review", "user_self_attestation"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// runComplianceCheck — record a check. If jurisdiction_id is omitted we resolve it
// from the user's linked jurisdictions; either way we stamp the current rules
// version so the decision is pinned to the law in force.
const runComplianceCheck = async ({
    userId,
    wouldbe_id = null,
    check_type,
    jurisdiction_id = null,
    result,
    reason = null,
    details = null,
    external_verification_payload = null,
    performed_by = "system",
    performed_by_user_id = null,
}) => {
    if (!userId || !check_type || !result) {
        throw httpError(400, "userId, check_type and result are required");
    }
    if (!CHECK_TYPES.includes(check_type)) {
        throw httpError(400, `check_type must be one of: ${CHECK_TYPES.join(", ")}`);
    }
    if (!RESULTS.includes(result)) {
        throw httpError(400, `result must be one of: ${RESULTS.join(", ")}`);
    }
    if (!PERFORMED_BY.includes(performed_by)) {
        throw httpError(400, `performed_by must be one of: ${PERFORMED_BY.join(", ")}`);
    }

    // Auto-resolve jurisdiction from the user's linked jurisdictions if not given.
    // Prefer a state-level link as the compliance anchor; fall back to any link.
    let jid = jurisdiction_id;
    if (!jid) {
        const { rows } = await client.query(
            `SELECT j.id, j.type FROM user_jurisdictions uj
             JOIN jurisdiction j ON j.id = uj.jurisdiction_id
             WHERE uj.user_id = $1
             ORDER BY (j.type = 'state') DESC
             LIMIT 1`,
            [userId]
        );
        jid = rows[0]?.id || null;
    }

    // Pin the rules version (its label) in force for this jurisdiction.
    let rulesVersion = null;
    if (jid) {
        const current = await getCurrentRulesForJurisdiction({ jurisdictionId: jid });
        rulesVersion = current?.version || null;
    }

    try {
        const { rows } = await client.query(
            `INSERT INTO compliance_checks
               (user_id, wouldbe_id, check_type, jurisdiction_id, jurisdiction_rules_version,
                result, reason, details, external_verification_payload, performed_by, performed_by_user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                userId, wouldbe_id, check_type, jid, rulesVersion,
                result, reason,
                details ? JSON.stringify(details) : null,
                external_verification_payload ? JSON.stringify(external_verification_payload) : null,
                performed_by, performed_by_user_id,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "a check field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "user_id, wouldbe_id or jurisdiction_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getChecksForUser({ userId }) — all checks for a user, newest first.
const getChecksForUser = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT * FROM compliance_checks WHERE user_id = $1 ORDER BY performed_at DESC`,
        [userId]
    );
    return rows;
};

// getChecksForWouldbe({ wouldbeId }) — all checks tied to a WouldBe.
const getChecksForWouldbe = async ({ wouldbeId }) => {
    const { rows } = await client.query(
        `SELECT * FROM compliance_checks WHERE wouldbe_id = $1 ORDER BY performed_at DESC`,
        [wouldbeId]
    );
    return rows;
};

// getLatestCheckResult({ wouldbeId, check_type }) — the most recent check of a
// type for a WouldBe (e.g. "latest committee_verification"). check_type optional.
const getLatestCheckResult = async ({ wouldbeId, check_type = null }) => {
    const { rows } = await client.query(
        `SELECT * FROM compliance_checks
         WHERE wouldbe_id = $1 AND ($2::text IS NULL OR check_type = $2)
         ORDER BY performed_at DESC
         LIMIT 1`,
        [wouldbeId, check_type]
    );
    return rows[0] || null;
};

module.exports = { runComplianceCheck, getChecksForUser, getChecksForWouldbe, getLatestCheckResult };
