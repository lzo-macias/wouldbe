const { client, withTransaction } = require("../index.js");

// ============================================================================
// jurisdiction_rules_versions — versioned election-finance law. The compliance
// engine pins each check to the exact rules version in force, so a 2026 decision
// can be reconstructed in 2029. "Current" = effective_until IS NULL; publishing a
// new version closes the prior one (sets its effective_until).
// ============================================================================

const ADVANCEMENT_RULES = ["top_two", "majority_or_runoff", "plurality", "ranked_choice"];
const CANDIDACY_TRIGGER_TYPES = ["dollar_threshold", "intent_based", "filing_based"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// getCurrentRulesForJurisdiction(jurisdictionId) — the in-force version (the open
// row, effective_until IS NULL).
const getCurrentRulesForJurisdiction = async ({ jurisdictionId }) => {
    const { rows } = await client.query(
        `SELECT * FROM jurisdiction_rules_versions
         WHERE jurisdiction_id = $1 AND effective_until IS NULL
         ORDER BY effective_from DESC
         LIMIT 1`,
        [jurisdictionId]
    );
    return rows[0] || null;
};

// getRulesHistory(jurisdictionId) — every version, newest first.
const getRulesHistory = async ({ jurisdictionId }) => {
    const { rows } = await client.query(
        `SELECT * FROM jurisdiction_rules_versions
         WHERE jurisdiction_id = $1
         ORDER BY effective_from DESC`,
        [jurisdictionId]
    );
    return rows;
};

// getRulesAtPointInTime(jurisdictionId, date) — the version in force on a date.
const getRulesAtPointInTime = async ({ jurisdictionId, date }) => {
    const { rows } = await client.query(
        `SELECT * FROM jurisdiction_rules_versions
         WHERE jurisdiction_id = $1
           AND effective_from <= $2
           AND (effective_until IS NULL OR effective_until > $2)
         ORDER BY effective_from DESC
         LIMIT 1`,
        [jurisdictionId, date]
    );
    return rows[0] || null;
};

// publishRulesVersion — open a new version and close the prior one atomically.
// Admin-only at the route layer; created_by_user_id is the publishing admin.
const publishRulesVersion = async ({
    jurisdiction_id,
    version,
    effective_from,
    candidacy_trigger_type = null,
    candidacy_trigger_value = null,
    contribution_limit_individual_primary = null,
    contribution_limit_individual_general = null,
    contribution_limit_aggregate = null,
    committee_required_before_solicitation = null,
    off_session_fundraising_ban = null,
    matching_funds_program = null,
    matching_funds_rules_ref = null,
    contest_registration_threshold = null,
    has_runoff = null,
    advancement_rule = null,
    advancement_threshold = null,
    source_documents = null,
    created_by_user_id = null,
}) => {
    if (!jurisdiction_id || !version || !effective_from) {
        throw httpError(400, "jurisdiction_id, version and effective_from are required");
    }
    if (candidacy_trigger_type && !CANDIDACY_TRIGGER_TYPES.includes(candidacy_trigger_type)) {
        throw httpError(400, `candidacy_trigger_type must be one of: ${CANDIDACY_TRIGGER_TYPES.join(", ")}`);
    }
    if (advancement_rule && !ADVANCEMENT_RULES.includes(advancement_rule)) {
        throw httpError(400, `advancement_rule must be one of: ${ADVANCEMENT_RULES.join(", ")}`);
    }
    try {
        return await withTransaction(async (tx) => {
            // Close the currently-open version for this jurisdiction (set effective_until
            // to the new version's effective_from).
            await tx.query(
                `UPDATE jurisdiction_rules_versions
                 SET effective_until = $2
                 WHERE jurisdiction_id = $1 AND effective_until IS NULL`,
                [jurisdiction_id, effective_from]
            );
            const { rows } = await tx.query(
                `INSERT INTO jurisdiction_rules_versions
                   (jurisdiction_id, version, effective_from, effective_until, candidacy_trigger_type,
                    candidacy_trigger_value, contribution_limit_individual_primary,
                    contribution_limit_individual_general, contribution_limit_aggregate,
                    committee_required_before_solicitation, off_session_fundraising_ban,
                    matching_funds_program, matching_funds_rules_ref, contest_registration_threshold,
                    has_runoff, advancement_rule, advancement_threshold, source_documents, created_by_user_id)
                 VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                 RETURNING *`,
                [
                    jurisdiction_id, version, effective_from, candidacy_trigger_type, candidacy_trigger_value,
                    contribution_limit_individual_primary, contribution_limit_individual_general,
                    contribution_limit_aggregate, committee_required_before_solicitation,
                    off_session_fundraising_ban, matching_funds_program, matching_funds_rules_ref,
                    contest_registration_threshold, has_runoff, advancement_rule, advancement_threshold,
                    source_documents ? JSON.stringify(source_documents) : null, created_by_user_id,
                ]
            );
            return rows[0];
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23514") throw httpError(400, "a rules field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "jurisdiction_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getAdvancementRule(jurisdictionId) — gate helper: how a contest advances
// (top_two / ranked_choice / plurality / majority_or_runoff) under current rules.
// Returns { advancement_rule, advancement_threshold, has_runoff } or null.
const getAdvancementRule = async ({ jurisdictionId }) => {
    const current = await getCurrentRulesForJurisdiction({ jurisdictionId });
    if (!current) return null;
    return {
        advancement_rule: current.advancement_rule,
        advancement_threshold: current.advancement_threshold,
        has_runoff: current.has_runoff,
    };
};

module.exports = {
    getCurrentRulesForJurisdiction,
    getRulesHistory,
    getRulesAtPointInTime,
    publishRulesVersion,
    getAdvancementRule,
};
