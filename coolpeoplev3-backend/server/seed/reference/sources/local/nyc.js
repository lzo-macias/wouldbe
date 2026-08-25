/*
 * SOURCE: New York City local — City Council (51 districts) + Mayor.
 *
 * Per the WouldBe Update §3/§6, NYC is the launch local jurisdiction. Two known
 * docs drive the calendar: the NYC CFB disclosure schedule + the NYC Board of
 * Elections calendar. Council-district resolution is point-in-polygon (our
 * GeoJSON boundary file), NOT geocodio — see resolution_method 'point_in_polygon'.
 *
 * NYC CFB is also a matching-funds program (8:1 small-dollar match) — captured in
 * the rules version. Primaries use ranked-choice voting with NO runoff (advancement
 * rule 'ranked_choice'); that drives whether a "passed primary" §7 gate clears.
 */
const { ocd, STATE_FIPS } = require('../../ocd');
const U = require('../../upserts');

const NYC_COUNCIL_DISTRICTS = 51;
const NYC_CFB = 'https://www.nyccfb.info';
const NYC_BOE = 'https://www.vote.nyc';

async function seed(client, { cycle, log }) {
    // NY state (parent) — created by the FEC/state seed too; upsert is idempotent.
    const ny = await U.upsertJurisdiction(client, {
        name: 'NY', type: 'state', state_code: 'NY',
        ocd_division_id: ocd.state('NY'), fips_code: STATE_FIPS.NY,
    });

    // NYC as a municipal place.
    // Place slug 'nyc' MUST match the council-district ids (ocd.councilDistrict
    // uses 'nyc'), because the boundary loader builds each council OCD-id by
    // appending '/council_district:N' to THIS place id. Keep them in lockstep.
    const nyc = await U.upsertJurisdiction(client, {
        name: 'New York City', type: 'municipal', parent_jurisdiction_id: ny.id,
        state_code: 'NY', ocd_division_id: ocd.place('NY', 'nyc'),
        election_authority_name: 'NYC Board of Elections', election_authority_url: NYC_BOE,
    });

    // [WB place-coverage] NYC elects its council by district (51 districts), resolved
    // by point-in-polygon. boundaries_loaded stays false until the council-district
    // GeoJSON is loaded; until then the resolver enqueues NYC users as pending and
    // backfillLocalJurisdictions() fills them once boundaries land.
    await client.query(
        `UPDATE jurisdiction SET council_structure = 'districted' WHERE id = $1`,
        [nyc.id]
    );

    // Mayor — municipality-wide (resolves to the NYC place; treat as statewide-style
    // membership test against the NYC place jurisdiction).
    await U.upsertOffice(client, {
        jurisdiction_id: nyc.id, office_name: 'Mayor of New York City',
        office_type: 'executive', chamber: 'single', district_identifier: 'NYC-MAYOR',
        district_name: 'New York City', term_length: 4, max_terms: 2, is_partisan: true,
        min_age: 18, resolution_method: 'point_in_polygon',
        citizenship_requirement: 'us_citizen', residency_requirement: 'nyc_resident',
        residency_duration: 'resident of New York City',
        eligibility_is_encoded: true,
        eligibility_notes: 'NYC Mayor: ≥18 · U.S. citizen · resident of New York City. (Informational — confirm with the NYC Charter / CFB.)',
        eligibility_source_url: 'https://www.nyc.gov/site/charter/index.page',
    });

    // City Council — 51 sub-municipal districts, point-in-polygon (GeoJSON).
    for (let n = 1; n <= NYC_COUNCIL_DISTRICTS; n++) {
        const dj = await U.upsertJurisdiction(client, {
            name: `NYC Council District ${n}`, type: 'city_council_district',
            parent_jurisdiction_id: nyc.id, state_code: 'NY',
            ocd_division_id: ocd.councilDistrict('NY', 'nyc', n),
        });
        await U.upsertOffice(client, {
            jurisdiction_id: dj.id, office_name: `NYC Council Member District ${n}`,
            office_type: 'legislative', chamber: 'single',
            district_identifier: `NYC-CD-${n}`, district_name: `NYC Council District ${n}`,
            term_length: 4, max_terms: 2, is_partisan: true, min_age: 18,
            resolution_method: 'point_in_polygon',
            citizenship_requirement: 'us_citizen', residency_requirement: 'council_district_resident',
            residency_duration: '1 year continuous in the district before nomination',
            eligibility_is_encoded: true,
            eligibility_notes: 'NYC Council: ≥18 · U.S. citizen · registered voter · 1 year continuous residency in the district before nomination. (Informational — confirm with the NYC Charter / CFB.)',
            eligibility_source_url: 'https://www.nyc.gov/site/charter/index.page',
        });
    }

    // Filing authority — NYC Campaign Finance Board.
    await U.upsertFilingAuthority(client, {
        jurisdiction_id: nyc.id, applies_to_office_id: null,
        authority_name: 'NYC Campaign Finance Board (CFB)', authority_level: 'municipal',
        registration_portal_url: `${NYC_CFB}/candidate-services/`,
        how_to_file_url: `${NYC_CFB}/candidate-services/getting-started/`,
        treasurer_guide: 'NYC requires a committee treasurer; confirm self-treasurer eligibility with the CFB.',
        candidate_may_self_treasure: null, // TBD — confirm with CFB
        source_url: NYC_CFB,
    });

    // Rules version — matching funds + RCV/no-runoff + CITY COUNCIL contribution
    // limit. NYC CFB limits are office-tier-specific: City Council = $1,050,
    // citywide (Mayor/Comptroller/PA) = $2,100, borough pres = $1,580. We store
    // the COUNCIL figure (platform's local focus) on this jurisdiction-level row;
    // the citywide tier differs and a single rules row can't distinguish them.
    // Matchable: first $175 (council) at 8:1. Display-only (processor enforces).
    await U.publishRulesVersion(client, {
        jurisdiction_id: nyc.id, version: `nyc-${cycle}`,
        effective_from: `${cycle - 1}-01-01`,
        candidacy_trigger_type: 'filing_based',
        contribution_limit_individual_primary: 1050, // NYC CFB City Council per-cycle limit
        committee_required_before_solicitation: true,
        matching_funds_program: true, matching_funds_rules_ref: `${NYC_CFB}/program/`,
        has_runoff: false, advancement_rule: 'ranked_choice',
        source_documents: [`${NYC_CFB}/candidate-services/limits-thresholds/2025/`, NYC_BOE],
    });

    log?.(`  NYC: mayor + ${NYC_COUNCIL_DISTRICTS} council districts + CFB authority/rules`);
}

/*
 * NYC deadlines for the municipal cycle. NYC elects Mayor + Council in ODD years
 * (last regular cycle: 2025; next: 2029). Seeds the 2025 NYC BOE / CFB calendar
 * onto every NYC office (Mayor + 51 council), office-specifically (like the state
 * layer) so each office's timeline resolves. Run separately from seed() so it
 * doesn't churn the append-only rules version. For 2029, re-run with the BOE
 * dates once published.
 */
async function seedDeadlines(client, { cycle = 2025, log }) {
    const PRIMARY = '2025-06-24';   // NYC primary (ranked-choice), NYC BOE
    const GENERAL = '2025-11-04';   // general election
    const FILING = '2025-04-03';    // designating-petition filing deadline (confirm w/ BOE)
    const PET_START = '2025-02-25'; // designating-petition circulation opens (approximate)
    const effFrom = `${cycle - 1}-01-01`;

    const offices = await client.query(
        `SELECT o.id, o.jurisdiction_id FROM office o
         JOIN jurisdiction j ON j.id = o.jurisdiction_id
         WHERE j.state_code = 'NY' AND j.type IN ('municipal','city_council_district')`
    );
    const anchored = new Set();
    let n = 0;
    for (const o of offices.rows) {
        if (!anchored.has(o.jurisdiction_id)) {
            await U.upsertElectionAnchor(client, { jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, anchor_type: 'primary', anchor_date: PRIMARY, source_url: NYC_BOE });
            await U.upsertElectionAnchor(client, { jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, anchor_type: 'general', anchor_date: GENERAL, source_url: NYC_BOE });
            anchored.add(o.jurisdiction_id);
        }
        const rows = [
            ['primary_date', PRIMARY, { anchor_type: 'primary', offset_days: 0 }],
            ['general_date', GENERAL, { anchor_type: 'general', offset_days: 0 }],
            ['filing_close', FILING, { is_fixed_date: true, fixed_date: FILING }],
            ['petition_filing_deadline', FILING, { is_fixed_date: true, fixed_date: FILING, note: 'NYC designating-petition filing deadline — confirm with NYC BOE.' }],
            ['petition_circulation_start', PET_START, { is_fixed_date: true, fixed_date: PET_START, is_tbd: true, note: 'NYC designating-petition circulation opens (approximate) — confirm with NYC BOE.' }],
        ];
        for (const [dt, date, opt] of rows) {
            const r = await U.upsertOffsetRule(client, {
                jurisdiction_id: o.jurisdiction_id, applies_to_office_id: o.id, deadline_type: dt,
                anchor_type: opt.anchor_type ?? null, offset_days: opt.offset_days ?? null,
                is_fixed_date: !!opt.is_fixed_date, fixed_date: opt.fixed_date ?? null,
                effective_from: effFrom, source_url: NYC_BOE, notes: opt.note ?? null,
            });
            await U.upsertElectionDeadline(client, {
                jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, deadline_type: dt,
                deadline_date: date, applies_to_office_id: o.id, anchor_type: opt.anchor_type ?? null,
                offset_rule_id: r.id, is_tbd: opt.is_tbd ?? false, description: opt.note ?? null, source_url: NYC_BOE,
            });
        }
        n += 1;
    }
    log?.(`  NYC deadlines: ${n} offices (cycle ${cycle}; primary ${PRIMARY}, general ${GENERAL})`);
}

module.exports = { seed, seedDeadlines };
