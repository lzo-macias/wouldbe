const { client } = require("../index.js");

// listRulesVersions({ state_code, jurisdiction_id, currentOnly, limit }) — the
// campaign-finance "regulations" browser: contribution limits + advancement
// rules per jurisdiction (jurisdiction_rules_versions). currentOnly returns the
// open version (effective_until IS NULL); set false to see the full append-only
// history. Joined to jurisdiction for display.
const listRulesVersions = async ({ state_code = null, jurisdiction_id = null, currentOnly = true, limit = 200 } = {}) => {
    try {
        const SQL = `
            SELECT r.id, r.jurisdiction_id, r.version, r.effective_from, r.effective_until,
                   r.candidacy_trigger_type, r.candidacy_trigger_value,
                   r.contribution_limit_individual_primary, r.contribution_limit_individual_general,
                   r.committee_required_before_solicitation, r.matching_funds_program,
                   r.has_runoff, r.advancement_rule, r.source_documents,
                   j.name AS jurisdiction_name, j.state_code, j.type AS jurisdiction_type
            FROM jurisdiction_rules_versions r
            JOIN jurisdiction j ON j.id = r.jurisdiction_id
            WHERE ($1::text    IS NULL OR j.state_code = $1)
              AND ($2::uuid    IS NULL OR r.jurisdiction_id = $2)
              AND ($3::boolean = false OR r.effective_until IS NULL)
            ORDER BY j.state_code NULLS FIRST, j.name, r.effective_from DESC
            LIMIT $4
        `;
        const { rows } = await client.query(SQL, [
            state_code, jurisdiction_id, currentOnly, Math.min(Number(limit) || 200, 1000),
        ]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = { listRulesVersions };
