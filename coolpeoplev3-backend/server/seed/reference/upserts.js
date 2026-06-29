/*
 * Idempotent writers for the reference tables. Re-running any source must
 * REFRESH rows, never duplicate them — so every write is keyed on a stable
 * natural/external key, not on the surrogate uuid.
 *
 * Two mechanisms:
 *   1. ON CONFLICT — for tables that already have a unique key
 *      (jurisdiction.ocd_division_id, election_date_anchors,
 *       office_recommended_goals.office_id).
 *   2. upsertByKey() — SELECT-by-natural-key then INSERT/UPDATE, for tables
 *      without one yet (office, races, deadlines, filing_authorities, ...).
 *      RECOMMENDED HARDENING: add unique indexes for these so #2 can become a
 *      true atomic ON CONFLICT (see README "Hardening"). Until then, run seeds
 *      single-threaded (the CLI does).
 *
 * Regulations are NEVER mutated in place — publishRulesVersion() is append-only
 * and versioned (effective_from/until), so you can reconstruct what the rules
 * were on any past date. That is the whole point of jurisdiction_rules_versions.
 *
 * Every fn takes the transaction `client` as its first arg.
 */

// Generic: find one row by natural key, UPDATE it, else INSERT. Returns
// { row, action: 'inserted' | 'updated' }.
async function upsertByKey(client, table, matchCols, row) {
    const match = {};
    for (const c of matchCols) match[c] = row[c] ?? null;
    const whereSQL = matchCols.map((c, i) => `${c} IS NOT DISTINCT FROM $${i + 1}`).join(' AND ');
    const found = await client.query(
        `SELECT id FROM ${table} WHERE ${whereSQL} LIMIT 1`,
        matchCols.map((c) => match[c])
    );

    const cols = Object.keys(row);
    if (found.rows[0]) {
        const setSQL = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        const vals = cols.map((c) => row[c] ?? null);
        const r = await client.query(
            `UPDATE ${table} SET ${setSQL} WHERE id = $${cols.length + 1} RETURNING *`,
            [...vals, found.rows[0].id]
        );
        return { row: r.rows[0], action: 'updated' };
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const r = await client.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        cols.map((c) => row[c] ?? null)
    );
    return { row: r.rows[0], action: 'inserted' };
}

// ---- jurisdiction (true ON CONFLICT on ocd_division_id) -------------------
async function upsertJurisdiction(client, j) {
    const r = await client.query(
        `
        INSERT INTO jurisdiction
            (name, type, parent_jurisdiction_id, state_code,
             election_authority_name, election_authority_url,
             ocd_division_id, fips_code, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (ocd_division_id) WHERE ocd_division_id IS NOT NULL
        DO UPDATE SET
            name = EXCLUDED.name, type = EXCLUDED.type,
            parent_jurisdiction_id = EXCLUDED.parent_jurisdiction_id,
            state_code = EXCLUDED.state_code,
            election_authority_name = EXCLUDED.election_authority_name,
            election_authority_url = EXCLUDED.election_authority_url,
            fips_code = EXCLUDED.fips_code,
            latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
        RETURNING *;
        `,
        [j.name, j.type, j.parent_jurisdiction_id ?? null, j.state_code ?? null,
         j.election_authority_name ?? null, j.election_authority_url ?? null,
         j.ocd_division_id, j.fips_code ?? null, j.latitude ?? null, j.longitude ?? null]
    );
    return r.rows[0];
}

// ---- office (natural key: jurisdiction_id + office_name + district_identifier)
// Carries the [WB §9] eligibility-display columns + [v2] resolution_method.
async function upsertOffice(client, o) {
    const { row } = await upsertByKey(
        client, 'office',
        ['jurisdiction_id', 'office_name', 'district_identifier'],
        {
            jurisdiction_id: o.jurisdiction_id,
            office_name: o.office_name,
            office_type: o.office_type ?? null,
            chamber: o.chamber ?? null,
            district_identifier: o.district_identifier ?? null,
            district_name: o.district_name,
            term_length: o.term_length,
            max_terms: o.max_terms ?? null,
            is_partisan: o.is_partisan ?? true,
            min_age: o.min_age,
            resolution_method: o.resolution_method ?? null,
            // [WB §9] displayed eligibility (informational; self-filed)
            citizenship_requirement: o.citizenship_requirement ?? null,
            citizenship_years_required: o.citizenship_years_required ?? null,
            residency_requirement: o.residency_requirement ?? null,
            residency_duration: o.residency_duration ?? null,
            eligibility_is_encoded: o.eligibility_is_encoded ?? false,
            eligibility_source_url: o.eligibility_source_url ?? null,
            eligibility_notes: o.eligibility_notes ?? null,
        }
    );
    return row;
}

// ---- office_recommended_goals (true ON CONFLICT on office_id) [WB §4] ------
async function upsertOfficeRecommendedGoal(client, g) {
    const r = await client.query(
        `
        INSERT INTO office_recommended_goals (office_id, recommended_goal_cents, rationale, source_url)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (office_id) DO UPDATE SET
            recommended_goal_cents = EXCLUDED.recommended_goal_cents,
            rationale = EXCLUDED.rationale,
            source_url = EXCLUDED.source_url,
            updated_at = now()
        RETURNING *;
        `,
        [g.office_id, g.recommended_goal_cents ?? null, g.rationale ?? null, g.source_url ?? null]
    );
    return r.rows[0];
}

// ---- politicians (natural key: fec_candidate_id, else bioguide_id) ---------
async function upsertPolitician(client, p) {
    const key = p.fec_candidate_id ? ['fec_candidate_id']
        : p.bioguide_id ? ['bioguide_id']
            : ['first_name', 'last_name', 'date_of_birth'];
    const { row } = await upsertByKey(client, 'politicians', key, {
        first_name: p.first_name, last_name: p.last_name,
        party: p.party ?? null, fec_candidate_id: p.fec_candidate_id ?? null,
        suffix: p.suffix ?? null, date_of_birth: p.date_of_birth ?? null,
        bioguide_id: p.bioguide_id ?? null, openstates_id: p.openstates_id ?? null,
        official_website: p.official_website ?? null, updated_at: new Date(),
    });
    return row;
}

// ---- races (natural key: office_id + election_cycle + election_type) -------
async function upsertRace(client, r) {
    const { row } = await upsertByKey(
        client, 'races',
        ['office_id', 'election_cycle', 'election_type'],
        {
            office_id: r.office_id, election_cycle: r.election_cycle,
            election_type: r.election_type ?? 'regular',
            primary_date: r.primary_date ?? null, general_date: r.general_date,
            filing_deadline: r.filing_deadline, is_open_seat: r.is_open_seat ?? null,
            is_approved_on_platform: r.is_approved_on_platform ?? false,
            updated_at: new Date(),
        }
    );
    return row;
}

// ---- filing_authorities (natural key: jurisdiction + authority + office) [WB §3/§8]
async function upsertFilingAuthority(client, f) {
    const { row } = await upsertByKey(
        client, 'filing_authorities',
        ['jurisdiction_id', 'authority_name', 'applies_to_office_id'],
        {
            jurisdiction_id: f.jurisdiction_id, applies_to_office_id: f.applies_to_office_id ?? null,
            authority_name: f.authority_name, authority_level: f.authority_level,
            registration_portal_url: f.registration_portal_url,
            how_to_file_url: f.how_to_file_url ?? null, how_to_file_guide: f.how_to_file_guide ?? null,
            treasurer_guide: f.treasurer_guide ?? null,
            candidate_may_self_treasure: f.candidate_may_self_treasure ?? null,
            committee_id_format: f.committee_id_format ?? null,
            is_active: f.is_active ?? true, source_url: f.source_url ?? null,
            updated_at: new Date(),
        }
    );
    return row;
}

// ---- election_date_anchors (true ON CONFLICT) [WB §6] ----------------------
async function upsertElectionAnchor(client, a) {
    const r = await client.query(
        `
        INSERT INTO election_date_anchors (jurisdiction_id, election_cycle, anchor_type, anchor_date, source_url)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (jurisdiction_id, election_cycle, anchor_type) DO UPDATE SET
            anchor_date = EXCLUDED.anchor_date, source_url = EXCLUDED.source_url, updated_at = now()
        RETURNING *;
        `,
        [a.jurisdiction_id, a.election_cycle, a.anchor_type, a.anchor_date, a.source_url ?? null]
    );
    return r.rows[0];
}

// ---- deadline_offset_rules (natural key: jurisdiction+office+type+effective_from) [WB §6]
async function upsertOffsetRule(client, o) {
    const { row } = await upsertByKey(
        client, 'deadline_offset_rules',
        ['jurisdiction_id', 'applies_to_office_id', 'deadline_type', 'effective_from'],
        {
            jurisdiction_id: o.jurisdiction_id, applies_to_office_id: o.applies_to_office_id ?? null,
            deadline_type: o.deadline_type, anchor_type: o.anchor_type ?? null,
            offset_days: o.offset_days ?? null, fixed_date: o.fixed_date ?? null,
            is_fixed_date: o.is_fixed_date ?? false, effective_from: o.effective_from,
            effective_until: o.effective_until ?? null, source_url: o.source_url ?? null,
            notes: o.notes ?? null,
        }
    );
    return row;
}

// ---- election_deadlines (natural key: jurisdiction+type+cycle+office) -------
async function upsertElectionDeadline(client, d) {
    const { row } = await upsertByKey(
        client, 'election_deadlines',
        ['jurisdiction_id', 'deadline_type', 'election_cycle', 'applies_to_office_id'],
        {
            jurisdiction_id: d.jurisdiction_id, election_cycle: d.election_cycle ?? null,
            deadline_type: d.deadline_type, deadline_date: d.deadline_date ?? null,
            deadline_time: d.deadline_time ?? null,
            applies_to_office_type: d.applies_to_office_type ?? null,
            applies_to_office_id: d.applies_to_office_id ?? null,
            description: d.description ?? null, source_url: d.source_url ?? null,
            is_recurring_per_cycle: d.is_recurring_per_cycle ?? null,
            anchor_type: d.anchor_type ?? null, offset_rule_id: d.offset_rule_id ?? null,
            is_tbd: d.is_tbd ?? false, is_calendar_anchor: d.is_calendar_anchor ?? false,
            updated_at: new Date(),
        }
    );
    return row;
}

/*
 * publishRulesVersion — APPEND-ONLY regulation versioning. [regulations]
 * Never UPDATE an existing rules row. Instead: close the current open version
 * (set effective_until = the new version's effective_from), then insert the new
 * one. This preserves "what the rules were on date X" forever, which is the
 * compliance-defense purpose of jurisdiction_rules_versions. Skips the insert if
 * the latest open version is byte-identical (no-op refresh).
 */
async function publishRulesVersion(client, v) {
    const current = await client.query(
        `SELECT * FROM jurisdiction_rules_versions
         WHERE jurisdiction_id = $1 AND effective_until IS NULL
         ORDER BY effective_from DESC LIMIT 1`,
        [v.jurisdiction_id]
    );
    const open = current.rows[0];

    // unchanged? skip (idempotent re-run)
    if (open && open.version === v.version) {
        return { row: open, action: 'unchanged' };
    }
    // close the prior open version
    if (open) {
        await client.query(
            `UPDATE jurisdiction_rules_versions SET effective_until = $2 WHERE id = $1`,
            [open.id, v.effective_from]
        );
    }
    const r = await client.query(
        `
        INSERT INTO jurisdiction_rules_versions
            (jurisdiction_id, version, effective_from, effective_until,
             candidacy_trigger_type, candidacy_trigger_value,
             contribution_limit_individual_primary, contribution_limit_individual_general,
             contribution_limit_aggregate, committee_required_before_solicitation,
             off_session_fundraising_ban, matching_funds_program, matching_funds_rules_ref,
             contest_registration_threshold, created_by_user_id, source_documents,
             has_runoff, advancement_rule, advancement_threshold)
        VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *;
        `,
        [v.jurisdiction_id, v.version, v.effective_from,
         v.candidacy_trigger_type ?? null, v.candidacy_trigger_value ?? null,
         v.contribution_limit_individual_primary ?? null, v.contribution_limit_individual_general ?? null,
         v.contribution_limit_aggregate ?? null, v.committee_required_before_solicitation ?? null,
         v.off_session_fundraising_ban ?? null, v.matching_funds_program ?? null,
         v.matching_funds_rules_ref ?? null, v.contest_registration_threshold ?? null,
         v.created_by_user_id ?? null, v.source_documents ? JSON.stringify(v.source_documents) : null,
         v.has_runoff ?? null, v.advancement_rule ?? null, v.advancement_threshold ?? null]
    );
    return { row: r.rows[0], action: open ? 'superseded' : 'inserted' };
}

module.exports = {
    upsertByKey,
    upsertJurisdiction,
    upsertOffice,
    upsertOfficeRecommendedGoal,
    upsertPolitician,
    upsertRace,
    upsertFilingAuthority,
    upsertElectionAnchor,
    upsertOffsetRule,
    upsertElectionDeadline,
    publishRulesVersion,
};
