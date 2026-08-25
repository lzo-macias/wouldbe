/*
 * SOURCE TEMPLATE: one state's legislature + statewide executives.
 *
 * Copy this to `<state>.js` (e.g. ny.js) and fill in. Each state encodes its own
 * political calendar (one doc) + offset rules; where a value isn't known yet,
 * leave it out and mark the deadline is_tbd so the UI shows "TBD".
 *
 * What a state source seeds:
 *   - state legislature offices: senate (sldu, geocodio_district) + house/assembly
 *     (sldl, geocodio_district), one office per district
 *   - statewide executives: Governor, AG, Sec of State (resolution_method statewide)
 *   - the state's filing authority (registration portal + treasurer rules)
 *   - the state campaign-finance rules version (append-only)
 *   - election-date anchors (primary/general/runoff) + offset rules → deadlines
 *
 * Resolution methods: state leg = geocodio_district; statewide exec = statewide.
 */
const { ocd, STATE_FIPS } = require('../../ocd');
const U = require('../../upserts');

// Override these per state.
const STATE = 'XX';
const SENATE_DISTRICTS = 0; // e.g. NY = 63
const ASSEMBLY_DISTRICTS = 0; // e.g. NY = 150 (lower chamber; "House"/"Assembly")
const LOWER_CHAMBER_NAME = 'State Representative'; // NY = 'Assembly Member'

async function seed(client, { cycle, log }) {
    const stj = await U.upsertJurisdiction(client, {
        name: STATE, type: 'state', state_code: STATE,
        ocd_division_id: ocd.state(STATE), fips_code: STATE_FIPS[STATE],
    });

    // --- statewide executives ---
    for (const name of ['Governor', 'Attorney General', 'Secretary of State']) {
        await U.upsertOffice(client, {
            jurisdiction_id: stj.id, office_name: `${STATE} ${name}`,
            office_type: 'executive', chamber: 'single',
            district_identifier: `${STATE}-${name.replace(/\s+/g, '').slice(0, 6).toUpperCase()}`,
            district_name: `${STATE} (statewide)`, term_length: 4, is_partisan: true,
            min_age: 18, resolution_method: 'statewide',
            eligibility_is_encoded: false,
            eligibility_notes: 'Confirm age/residency with your state authority.',
        });
    }

    // --- state senate (upper, sldu) ---
    for (let n = 1; n <= SENATE_DISTRICTS; n++) {
        const j = await U.upsertJurisdiction(client, {
            name: `${STATE} State Senate District ${n}`, type: 'state_leg_upper',
            parent_jurisdiction_id: stj.id, state_code: STATE, ocd_division_id: ocd.sldu(STATE, n),
        });
        await U.upsertOffice(client, {
            jurisdiction_id: j.id, office_name: `${STATE} State Senator District ${n}`,
            office_type: 'legislative', chamber: 'upper',
            district_identifier: `${STATE}-SD-${n}`, district_name: `${STATE} State Senate District ${n}`,
            term_length: 4, is_partisan: true, min_age: 18, resolution_method: 'geocodio_district',
            eligibility_is_encoded: false,
        });
    }

    // --- state house / assembly (lower, sldl) ---
    for (let n = 1; n <= ASSEMBLY_DISTRICTS; n++) {
        const j = await U.upsertJurisdiction(client, {
            name: `${STATE} State House District ${n}`, type: 'state_leg_lower',
            parent_jurisdiction_id: stj.id, state_code: STATE, ocd_division_id: ocd.sldl(STATE, n),
        });
        await U.upsertOffice(client, {
            jurisdiction_id: j.id, office_name: `${STATE} ${LOWER_CHAMBER_NAME} District ${n}`,
            office_type: 'legislative', chamber: 'lower',
            district_identifier: `${STATE}-HD-${n}`, district_name: `${STATE} State House District ${n}`,
            term_length: 2, is_partisan: true, min_age: 18, resolution_method: 'geocodio_district',
            eligibility_is_encoded: false,
        });
    }

    // --- filing authority + rules + election anchors (fill in per state) ---
    // await U.upsertFilingAuthority(client, { jurisdiction_id: stj.id, ... });
    // await U.publishRulesVersion(client, { jurisdiction_id: stj.id, version: `${STATE}-${cycle}`, ... });
    // await U.upsertElectionAnchor(client, { jurisdiction_id: stj.id, election_cycle: cycle, anchor_type: 'primary', anchor_date: 'YYYY-MM-DD' });
    // await U.upsertOffsetRule(client, { jurisdiction_id: stj.id, deadline_type: 'filing_close', anchor_type: 'primary', offset_days: -90, effective_from: `${cycle-1}-01-01` });

    log?.(`  ${STATE}: ${SENATE_DISTRICTS} senate + ${ASSEMBLY_DISTRICTS} house + statewide execs`);
}

module.exports = { seed, STATE };
