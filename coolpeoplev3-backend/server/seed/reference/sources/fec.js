/*
 * SOURCE: Federal (FEC) — US President, Senate, House.
 *
 * Federal offices are CONSTITUTIONAL and uniform nationwide, so their structure
 * is seeded deterministically (not fetched): President (national), Senate (2 per
 * state, statewide), House (1 per congressional district, geocodio_district).
 * The FEC API is then used to populate live data ON TOP — candidates →
 * politicians, committees → candidate_committees — and to verify committees.
 *
 * API: https://api.open.fec.gov/v1/ — get a free key at https://api.open.fec.gov
 * and put it in .env as FEC_API_KEY. Docs: https://api.open.fec.gov/developers/
 *
 * Re-runnable: every write goes through the idempotent upserts; re-running with a
 * newer cycle or refreshed data updates rows in place.
 */
const { ocd, STATE_FIPS } = require('../ocd');
const U = require('../upserts');

const FEC_BASE = 'https://api.open.fec.gov/v1';

// House seats per state (2020 apportionment, effective 2023–2033). Sums to 435.
// DC has no voting House/Senate seats, so it is intentionally excluded here.
const HOUSE_SEATS = {
    AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
    HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
    MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
    NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
    SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};

const FEC_FILING_GUIDE =
    'https://www.fec.gov/help-candidates-and-committees/registering-candidate/';

// ---- FEC API helper (paginated) -------------------------------------------
async function fecGet(path, params = {}) {
    const key = process.env.FEC_API_KEY;
    if (!key) throw new Error('FEC_API_KEY missing in .env — get one at https://api.open.fec.gov');
    const url = new URL(`${FEC_BASE}${path}`);
    url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
        else if (v != null) url.searchParams.set(k, v);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FEC ${res.status} ${res.statusText} on ${path}`);
    return res.json();
}

// auto-paginate /candidates etc. (FEC uses page/pages)
async function* fecPaginate(path, params = {}) {
    let page = 1;
    for (;;) {
        const data = await fecGet(path, { ...params, page, per_page: 100 });
        for (const row of data.results || []) yield row;
        const pages = data.pagination?.pages ?? 1;
        if (page >= pages) break;
        page += 1;
    }
}

/*
 * Seed the federal STRUCTURE: jurisdictions + offices + the FEC filing authority
 * + the federal rules version. Deterministic; no API call. `cycle` is the
 * election year (e.g. 2026) used for the recommended-goal / race rows.
 */
async function seedFederalStructure(client, { cycle, log }) {
    // 1. National jurisdiction (President resolves to everyone).
    const us = await U.upsertJurisdiction(client, {
        name: 'United States', type: 'federal',
        ocd_division_id: ocd.country(),
        election_authority_name: 'Federal Election Commission',
        election_authority_url: 'https://www.fec.gov',
    });

    // FEC filing authority — applies to all federal offices (office-agnostic row).
    await U.upsertFilingAuthority(client, {
        jurisdiction_id: us.id, applies_to_office_id: null,
        authority_name: 'Federal Election Commission (FEC)', authority_level: 'federal',
        registration_portal_url: 'https://webforms.fec.gov/webforms/form1/index.htm',
        how_to_file_url: FEC_FILING_GUIDE,
        treasurer_guide:
            'Every federal committee must name a treasurer; the candidate MAY serve as their own treasurer. No transactions are valid before a treasurer is designated.',
        candidate_may_self_treasure: true,
        committee_id_format: 'C followed by 8 digits (e.g. C00123456)',
        source_url: 'https://www.fec.gov',
    });

    // Federal campaign-finance rules (append-only version). Figures are the
    // 2025–2026 cycle individual limit ($3,500/election) and the $5,000
    // statement-of-candidacy trigger. CONFIRM against current FEC tables before
    // relying on these in production.
    await U.publishRulesVersion(client, {
        jurisdiction_id: us.id, version: `fec-${cycle}`,
        effective_from: `${cycle - 1}-01-01`,
        candidacy_trigger_type: 'dollar_threshold', candidacy_trigger_value: 5000,
        contribution_limit_individual_primary: 3500,
        contribution_limit_individual_general: 3500,
        committee_required_before_solicitation: true,
        off_session_fundraising_ban: false, matching_funds_program: false,
        has_runoff: false, advancement_rule: 'plurality',
        source_documents: ['https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/contribution-limits/'],
    });

    // 2. President (national).
    await U.upsertOffice(client, {
        jurisdiction_id: us.id, office_name: 'President of the United States',
        office_type: 'executive', chamber: 'single',
        district_identifier: 'US-PRES', district_name: 'United States',
        term_length: 4, max_terms: 2, is_partisan: true, min_age: 35,
        resolution_method: 'national',
        citizenship_requirement: 'natural_born_citizen', residency_requirement: 'us_resident_14yrs',
        residency_duration: '14 years a U.S. resident', eligibility_is_encoded: true,
        eligibility_notes: 'US Const. Art. II §1: natural-born citizen, ≥35, ≥14 years a US resident.',
        eligibility_source_url: 'https://constitution.congress.gov/constitution/article-2/',
    });

    // 3. Per-state Senate (statewide) + House (per congressional district).
    for (const [state, seats] of Object.entries(HOUSE_SEATS)) {
        // state jurisdiction
        const stj = await U.upsertJurisdiction(client, {
            name: state, type: 'state', parent_jurisdiction_id: us.id, state_code: state,
            ocd_division_id: ocd.state(state), fips_code: STATE_FIPS[state],
        });

        // US Senate — statewide, resolves by users.state (no geocoding).
        await U.upsertOffice(client, {
            jurisdiction_id: stj.id, office_name: `US Senator (${state})`,
            office_type: 'legislative', chamber: 'upper',
            district_identifier: `${state}-SEN`, district_name: `${state} (statewide)`,
            term_length: 6, is_partisan: true, min_age: 30, resolution_method: 'statewide',
            citizenship_requirement: 'us_citizen', citizenship_years_required: 9,
            residency_requirement: 'inhabitant_of_state',
            residency_duration: 'inhabitant of the state when elected (no prior-residency duration)',
            eligibility_is_encoded: true,
            eligibility_notes: 'US Const. Art. I §3: ≥30, US citizen ≥9 years, inhabitant of the state when elected.',
            eligibility_source_url: 'https://constitution.congress.gov/constitution/article-1/',
        });

        // US House — one office per congressional district (geocodio_district).
        for (let n = 1; n <= seats; n++) {
            // at-large states still get a single district row; CONFIRM the at-large
            // OCD form (cd:1 vs cd:0) against geocodio output for your data.
            const cdj = await U.upsertJurisdiction(client, {
                name: `${state} Congressional District ${n}`, type: 'congressional_district',
                parent_jurisdiction_id: stj.id, state_code: state,
                ocd_division_id: ocd.cd(state, n),
            });
            await U.upsertOffice(client, {
                jurisdiction_id: cdj.id, office_name: `US Representative ${state}-${n}`,
                office_type: 'legislative', chamber: 'lower',
                district_identifier: `${state}-${n}`, district_name: `${state} Congressional District ${n}`,
                term_length: 2, is_partisan: true, min_age: 25, resolution_method: 'geocodio_district',
                citizenship_requirement: 'us_citizen', citizenship_years_required: 7,
                residency_requirement: 'inhabitant_of_state',
                residency_duration: 'inhabitant of the state when elected (no prior-residency duration)',
                eligibility_is_encoded: true,
                eligibility_notes: 'US Const. Art. I §2: ≥25, US citizen ≥7 years, inhabitant of the state when elected.',
                eligibility_source_url: 'https://constitution.congress.gov/constitution/article-1/',
            });
        }
        log?.(`  ${state}: senate + ${seats} house district(s)`);
    }
}

/*
 * Pull candidates from the FEC API → politicians. Scaffold: maps the common
 * fields; extend the mapping (party normalization, committee linkage, term
 * history) as you wire real data. office ∈ 'P' | 'S' | 'H'.
 */
async function seedCandidatesFromFEC(client, { cycle, office, log }) {
    let n = 0;
    for await (const c of fecPaginate('/candidates', { cycle, office, sort: 'name' })) {
        // FEC name is "LAST, FIRST" — split conservatively.
        const [last, first] = (c.name || '').split(',').map((s) => s.trim());
        await U.upsertPolitician(client, {
            first_name: first || c.name, last_name: last || '',
            fec_candidate_id: c.candidate_id,
            party: normalizeParty(c.party),
            // TODO: link to office/term via c.office + c.state + c.district; FEC
            // does not provide DOB, so date_of_birth stays null here.
        });
        n += 1;
    }
    log?.(`  FEC candidates (office=${office}, cycle=${cycle}): ${n}`);
    return n;
}

function normalizeParty(p) {
    if (!p) return null;
    if (/^DEM/i.test(p)) return 'Democrat';
    if (/^REP/i.test(p)) return 'Republican';
    if (/^IND/i.test(p)) return 'Independent';
    return 'Other';
}

// ---- date helpers (UTC, no TZ drift) --------------------------------------
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return fmt(d);
};
// Federal general election: first Tuesday after the first Monday in November.
function generalElectionDate(year) {
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const daysToMonday = (1 - nov1.getUTCDay() + 7) % 7; // 0..6
    const firstMonday = new Date(Date.UTC(year, 10, 1 + daysToMonday));
    return addDays(fmt(firstMonday), 1); // the Tuesday after
}

/*
 * Seed the UNIFORM FEDERAL DEADLINE LAYER for the congressional offices
 * (US Senate + US House). These deadlines are IDENTICAL for every federal
 * congressional candidate nationwide, because they're set by the FEC or by
 * federal statute — NOT by states:
 *   A. general election date  — statutory (1st Tue after 1st Mon of Nov)
 *   B. FEC reporting calendar — quarterly (fixed) + pre/post-general (offsets)
 *   C. registration deadlines — Statement of Candidacy (≤15d of crossing $5K)
 *                               + principal committee (≤10d of SoC). Event-
 *                               triggered, so stored as offset rules only
 *                               (anchor 'threshold_crossing'), never as a dated row.
 *
 * NOT here (state-administered, varies per state → seeded on each state):
 *   ballot access, primary dates, early voting, runoffs, pre-PRIMARY reports.
 * President is excluded — it runs on a different (monthly/primary) FEC calendar.
 *
 * The engine resolves an office's deadlines by its OWN jurisdiction_id with no
 * hierarchy walk, and office-agnostic rules apply to every office in that
 * jurisdiction — so we attach these OFFICE-SPECIFICALLY (applies_to_office_id)
 * to avoid leaking federal rules onto co-located state execs (e.g. Governor in
 * the state jurisdiction). All writes are idempotent.
 */
async function seedFederalDeadlines(client, { cycle, log }) {
    const FEC_CAL = 'https://www.fec.gov/help-candidates-and-committees/dates-and-deadlines/';
    const EC_URL = `https://www.archives.gov/electoral-college/${cycle}`;
    const effFrom = `${cycle - 1}-01-01`;
    const general = generalElectionDate(cycle);

    // The dated deadlines we materialize (buckets A + B). All deadline_types here
    // are in the election_deadlines CHECK.
    const dated = {
        general_date: general,
        fec_quarterly_q1: `${cycle}-04-15`,
        fec_quarterly_q2: `${cycle}-07-15`,
        fec_quarterly_q3: `${cycle}-10-15`,
        fec_year_end: `${cycle + 1}-01-31`,
        fec_pre_general_report: addDays(general, -12),
        fec_post_general_report: addDays(general, 30),
    };

    // Offset-rule definitions (the source of truth). computeDeadline:false ⇒ rule
    // only, no dated row (bucket C — per-candidate, no calendar anchor).
    const RULES = [
        { deadline_type: 'general_date', anchor_type: 'general', offset_days: 0 },
        { deadline_type: 'fec_quarterly_q1', is_fixed_date: true, fixed_date: dated.fec_quarterly_q1 },
        { deadline_type: 'fec_quarterly_q2', is_fixed_date: true, fixed_date: dated.fec_quarterly_q2 },
        { deadline_type: 'fec_quarterly_q3', is_fixed_date: true, fixed_date: dated.fec_quarterly_q3 },
        { deadline_type: 'fec_year_end', is_fixed_date: true, fixed_date: dated.fec_year_end },
        { deadline_type: 'fec_pre_general_report', anchor_type: 'general', offset_days: -12 },
        { deadline_type: 'fec_post_general_report', anchor_type: 'general', offset_days: 30 },
        { deadline_type: 'statement_of_candidacy', anchor_type: 'threshold_crossing', offset_days: 15, computeDeadline: false },
        { deadline_type: 'committee_registration', anchor_type: 'threshold_crossing', offset_days: 10, computeDeadline: false },
    ];

    const offices = await client.query(
        `SELECT id, jurisdiction_id FROM office
         WHERE office_name LIKE 'US Senator%' OR office_name LIKE 'US Representative%'`
    );

    const anchored = new Set();
    let nOffices = 0, nRules = 0, nDated = 0;
    for (const o of offices.rows) {
        // A) the general anchor lives on the jurisdiction (once per jurisdiction)
        if (!anchored.has(o.jurisdiction_id)) {
            await U.upsertElectionAnchor(client, {
                jurisdiction_id: o.jurisdiction_id, election_cycle: cycle,
                anchor_type: 'general', anchor_date: general, source_url: EC_URL,
            });
            anchored.add(o.jurisdiction_id);
        }
        for (const r of RULES) {
            const rule = await U.upsertOffsetRule(client, {
                jurisdiction_id: o.jurisdiction_id, applies_to_office_id: o.id,
                deadline_type: r.deadline_type, anchor_type: r.anchor_type ?? null,
                offset_days: r.offset_days ?? null, fixed_date: r.fixed_date ?? null,
                is_fixed_date: !!r.is_fixed_date, effective_from: effFrom, source_url: FEC_CAL,
            });
            nRules += 1;
            if (r.computeDeadline !== false && dated[r.deadline_type]) {
                await U.upsertElectionDeadline(client, {
                    jurisdiction_id: o.jurisdiction_id, election_cycle: cycle,
                    deadline_type: r.deadline_type, deadline_date: dated[r.deadline_type],
                    applies_to_office_id: o.id, anchor_type: r.anchor_type ?? null,
                    offset_rule_id: rule.id, is_tbd: false, source_url: FEC_CAL,
                });
                nDated += 1;
            }
        }
        nOffices += 1;
    }
    log?.(`  federal deadlines: ${nOffices} offices · ${nRules} offset rules · ${nDated} dated deadlines (general ${general}; President excluded)`);
}

module.exports = { seedFederalStructure, seedCandidatesFromFEC, seedFederalDeadlines, fecGet, fecPaginate };
