const { client } = require("../index.js");
const { getCurrentRulesForJurisdiction } = require("../elections/jurisdictionRules.js");

// ============================================================================
// fundraising_eligibility_checks — append-only record of every "can I start
// fundraising?" decision, stored even when the user proceeds past warnings. The
// verdict is DERIVED from the jurisdiction's current rules version (committee
// requirement, off-session ban, contribution caps) and frozen onto the row.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Default platform lead-time recommendation (days) when rules don't specify one.
const DEFAULT_RECOMMENDED_LEAD_DAYS = 14;

// deriveVerdict — pure mapping from a rules row to an eligibility verdict.
const deriveVerdict = (rules, { off_session = false } = {}) => {
    const warnings = [];
    const committee_required = !!(rules && rules.committee_required_before_solicitation);

    let legal_status;
    if (off_session && rules && rules.off_session_fundraising_ban) {
        legal_status = "blocked_off_session";
        warnings.push("This jurisdiction bans off-session fundraising for this office.");
    } else if (committee_required) {
        legal_status = "can_with_committee_first";
        warnings.push("A registered committee is required before soliciting contributions.");
    } else {
        legal_status = "can_fundraise";
    }

    // contribution_limit_individual_primary is decimal DOLLARS → store cents.
    const dollars = rules?.contribution_limit_individual_primary;
    const max_individual_contribution_cents =
        dollars === null || dollars === undefined ? null : Math.round(Number(dollars) * 100);

    const check_passed = legal_status === "can_fundraise" || legal_status === "can_with_committee_first";

    return {
        legal_status,
        committee_required,
        max_individual_contribution_cents,
        warnings,
        check_passed,
    };
};

// runFundraisingEligibilityCheck — evaluate + record. jurisdiction_id optional
// (resolved from the user's links). Reads jurisdiction_rules_versions (R).
const runFundraisingEligibilityCheck = async ({
    userId,
    jurisdiction_id = null,
    office_sought,
    election_cycle,
    off_session = false,
    legal_minimum_lead_days = null,
    recommended_lead_days = null,
    required_filings = null,
}) => {
    if (!userId || !office_sought || !election_cycle) {
        throw httpError(400, "userId, office_sought and election_cycle are required");
    }

    let jid = jurisdiction_id;
    if (!jid) {
        const { rows } = await client.query(
            `SELECT j.id FROM user_jurisdictions uj
             JOIN jurisdiction j ON j.id = uj.jurisdiction_id
             WHERE uj.user_id = $1
             ORDER BY (j.type = 'state') DESC
             LIMIT 1`,
            [userId]
        );
        jid = rows[0]?.id || null;
    }
    if (!jid) throw httpError(422, "could not resolve a jurisdiction for this user; pass jurisdiction_id");

    const rules = await getCurrentRulesForJurisdiction({ jurisdictionId: jid });
    const v = deriveVerdict(rules, { off_session });

    try {
        const { rows } = await client.query(
            `INSERT INTO fundraising_eligibility_checks
               (user_id, jurisdiction_id, office_sought, election_cycle, check_date, legal_status,
                committee_required, required_filings, legal_minimum_lead_days, recommended_lead_days,
                max_individual_contribution_cents, warnings, check_passed)
             VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [
                userId, jid, office_sought, election_cycle, v.legal_status,
                v.committee_required,
                required_filings ? JSON.stringify(required_filings) : null,
                legal_minimum_lead_days,
                recommended_lead_days ?? DEFAULT_RECOMMENDED_LEAD_DAYS,
                v.max_individual_contribution_cents,
                JSON.stringify(v.warnings),
                v.check_passed,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "an eligibility field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "user_id or jurisdiction_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getUserFundraisingChecks({ userId }) — the user's checks, newest first.
const getUserFundraisingChecks = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT * FROM fundraising_eligibility_checks WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
    );
    return rows;
};

// getLatestEligibilityForJurisdiction({ userId, jurisdictionId }) — most recent
// check a user ran for a jurisdiction.
const getLatestEligibilityForJurisdiction = async ({ userId, jurisdictionId }) => {
    const { rows } = await client.query(
        `SELECT * FROM fundraising_eligibility_checks
         WHERE user_id = $1 AND jurisdiction_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, jurisdictionId]
    );
    return rows[0] || null;
};

module.exports = {
    runFundraisingEligibilityCheck,
    getUserFundraisingChecks,
    getLatestEligibilityForJurisdiction,
};
