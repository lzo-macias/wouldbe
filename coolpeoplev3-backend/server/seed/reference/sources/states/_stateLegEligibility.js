/*
 * SOURCE: state-legislature candidate ELIGIBILITY (residency / citizenship /
 * voter-registration) per state, per chamber. Backfills the display-only
 * eligibility fields on the state-leg offices seeded by _stateLegislatures.js.
 *
 * Compiled from each state's constitution / Secretary-of-State candidate guide /
 * Ballotpedia (source URL kept per state). This is "save people the time" DISPLAY
 * data: eligibility_is_encoded stays FALSE (self-attested, not a hard gate), and
 * the note says "confirm with your authority." min_age is already on the office
 * rows (from _stateLegislatures.js); this adds residency + voter-reg.
 *
 * Per state: uniform { s, d, vr, u } OR chamber-split { su, du, sl, dl, vr, u }
 *   s/su/sl = state-residency duration · d/du/dl = district-residency duration
 *   vr = registered-voter-of-district required · u = source url
 *   'none' = no fixed duration (qualified-elector standard).
 */
const { AGE } = require('./_stateLegislatures');

const ELIG = {
    AL: { s: '3 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/Alabama_State_Legislature' },
    AK: { s: '3 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/Alaska_State_Legislature' },
    AZ: { s: '3 years', d: '1 year', vr: true, u: 'https://www.azleg.gov/const/4/2.p2.htm' },
    AR: { s: '2 years', d: '1 year', vr: true, u: 'https://law.justia.com/constitution/arkansas/article-5/section-4/' },
    CA: { s: '3 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/State_legislature_candidate_requirements_by_state' },
    CO: { s: '2 years', d: '1 year', vr: false, u: 'https://law.justia.com/constitution/colorado/cnart5.html' },
    CT: { s: 'none', d: 'none', vr: true, u: 'https://ballotpedia.org/Connecticut_General_Assembly' },
    DE: { s: '3 years', d: '1 year', vr: false, u: 'https://ballotpedia.org/Ballot_access_requirements_for_political_candidates_in_Delaware' },
    FL: { s: '2 years', d: 'at time of election', vr: true, u: 'http://fl.elaws.us/constitution/articleiii_section15' },
    GA: { s: '2 years', d: '1 year', vr: true, u: 'https://law.justia.com/constitution/georgia/conart3.html' },
    HI: { s: '3 years', d: 'none', vr: true, u: 'https://law.justia.com/constitution/hawaii/conart3.html' },
    ID: { s: 'none', d: '1 year', vr: true, u: 'https://sos.idaho.gov/ELECT/stcon/article_III.html' },
    IL: { s: '2 years', d: '2 years', vr: true, u: 'https://www.ilga.gov/commission/lrb/con4.htm' },
    IN: { s: '2 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/Article_4,_Indiana_Constitution' },
    IA: { s: '1 year', d: '60 days', vr: true, u: 'https://ballotpedia.org/Article_III,_Iowa_Constitution' },
    KS: { s: 'none', d: 'at time of election', vr: true, u: 'https://ksrevisor.gov/kanconst/093_002_0004.html' },
    KY: { su: '6 years', du: '1 year', sl: '2 years', dl: '1 year', vr: false, u: 'https://ballotpedia.org/How_to_run_for_office_in_Kentucky' },
    LA: { s: '2 years', d: '1 year', vr: true, u: 'https://law.justia.com/constitution/louisiana/Article3.html' },
    ME: { s: '1 year', d: '3 months', vr: false, u: 'https://ballotpedia.org/Maine_State_Senate' },
    MD: { s: '1 year', d: '6 months', vr: false, u: 'https://ballotpedia.org/Maryland_Residency_Requirements_for_State_Legislators_Amendment_(2022)' },
    MA: { su: '5 years', du: 'at time of election', sl: 'none', dl: '1 year', vr: true, u: 'https://malegislature.gov/Laws/Constitution' },
    MI: { s: 'none', d: 'at time of election', vr: true, u: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-Article-IV-7' },
    MN: { s: '1 year', d: '6 months', vr: true, u: 'https://www.revisor.mn.gov/constitution/' },
    MS: { s: '4 years', d: '2 years', vr: true, u: 'https://ballotpedia.org/Article_IV,_Mississippi_Constitution' },
    MO: { su: '3 years', du: '1 year', sl: '2 years', dl: '1 year', vr: true, u: 'https://law.justia.com/constitution/missouri/article-iii/section-6/' },
    MT: { s: '1 year', d: '6 months', vr: true, u: 'https://ballotpedia.org/Ballot_access_requirements_for_political_candidates_in_Montana' },
    NE: { s: '1 year', d: '1 year', vr: true, u: 'https://nebraskalegislature.gov/laws/articles.php?article=III-8' },
    NV: { s: '6 months', d: '30 days', vr: true, u: 'https://ballotpedia.org/How_to_run_for_office_in_Nevada' },
    NH: { su: '7 years', du: 'at time of election', sl: '2 years', dl: 'at time of election', vr: true, u: 'https://law.justia.com/constitution/new-hampshire/house.html' },
    NJ: { su: '4 years', du: '1 year', sl: '2 years', dl: '1 year', vr: true, u: 'https://ballotpedia.org/How_to_run_for_office_in_New_Jersey' },
    NM: { s: 'none', d: 'at time of election', vr: true, u: 'https://www.sos.nm.gov/' },
    NY: { s: '5 years', d: '12 months', vr: true, u: 'https://ballotpedia.org/How_to_run_for_office_in_New_York' },
    NC: { su: '2 years', du: '1 year', sl: 'none', dl: '1 year', vr: true, u: 'https://www.ncleg.gov/Laws/Constitution/Article2' },
    ND: { s: '1 year', d: 'none', vr: true, u: 'https://ballotpedia.org/North_Dakota_State_Legislature' },
    OH: { s: 'none', d: '1 year', vr: true, u: 'https://codes.ohio.gov/ohio-constitution/section-2.3' },
    OK: { s: 'none', d: '6 months', vr: true, u: 'https://oklahoma.gov/elections.html' },
    OR: { s: '1 year', d: '1 year', vr: true, u: 'https://en.wikisource.org/wiki/Oregon_Constitution/Article_IV' },
    PA: { s: '4 years', d: '1 year', vr: false, u: 'https://50constitutions.org/pa/constitution/section-id-129562' },
    RI: { s: 'none', d: 'at time of election', vr: true, u: 'https://vote.sos.ri.gov/Candidates/AreYouEligible' },
    SC: { s: 'none', d: 'at time of election', vr: true, u: 'https://www.scstatehouse.gov/scconstitution/A03.pdf' },
    SD: { s: '2 years', d: 'at time of election', vr: true, u: 'https://sdlegislature.gov/Constitution/3-1' },
    TN: { s: '3 years', d: '1 year', vr: true, u: 'https://sos.tn.gov/elections/guides/qualifications-for-all-elected-offices' },
    TX: { su: '5 years', du: '1 year', sl: '2 years', dl: '1 year', vr: true, u: 'https://www.sos.state.tx.us/elections/candidates/guide/2026/qualifications2026.shtml' },
    UT: { s: '3 years', d: '6 months', vr: true, u: 'https://le.utah.gov/xcode/Articlevi/Article_VI,_Section_5.html' },
    VT: { s: '2 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/Chapter_II,_Vermont_Constitution' },
    VA: { s: '1 year', d: 'at time of election', vr: true, u: 'https://law.lis.virginia.gov/constitutionexpand/article4/' },
    WA: { s: 'none', d: 'at time of election', vr: true, u: 'https://ballotpedia.org/How_to_run_for_office_in_Washington' },
    WV: { s: '5 years', d: '1 year', vr: true, u: 'https://ballotpedia.org/West_Virginia_State_Legislature' },
    WI: { s: '1 year', d: 'at time of election', vr: true, u: 'https://ballotpedia.org/Wisconsin_State_Legislature' },
    WY: { s: '1 year', d: '1 year', vr: true, u: 'https://ballotpedia.org/How_to_run_for_office_in_Wyoming' },
};

function durationText(stateRes, distRes) {
    const parts = [];
    if (stateRes && stateRes !== 'none') parts.push(`${stateRes} a state resident`);
    if (distRes && distRes !== 'none') {
        parts.push(distRes === 'at time of election'
            ? 'resident of the district at the time of election'
            : `${distRes} in the district before election`);
    }
    return parts.length ? parts.join('; ') : 'qualified elector of the district';
}

function noteText(minAge, stateRes, distRes, vr) {
    const bits = ['U.S. citizen'];
    if (vr) bits.push('registered voter of the district');
    if (minAge) bits.push(`at least ${minAge}`);
    bits.push(durationText(stateRes, distRes));
    return `Eligibility: ${bits.join(' · ')}. (Informational — confirm with your state election authority.)`;
}

async function backfill(client, { log }) {
    let updated = 0;
    for (const [st, e] of Object.entries(ELIG)) {
        const split = e.su !== undefined;
        for (const [chamber, jtype] of [['upper', 'state_leg_upper'], ['lower', 'state_leg_lower']]) {
            const age = AGE[st];
            const minAge = chamber === 'upper' ? age[0] : age[1];
            if (minAge == null) continue; // e.g. NE has no lower house
            const stateRes = split ? (chamber === 'upper' ? e.su : e.sl) : e.s;
            const distRes = split ? (chamber === 'upper' ? e.du : e.dl) : e.d;
            const r = await client.query(
                `UPDATE office o SET
                    residency_requirement  = 'state_resident_and_district_inhabitant',
                    residency_duration     = $3,
                    eligibility_notes      = $4,
                    eligibility_source_url = $5
                 FROM jurisdiction j
                 WHERE j.id = o.jurisdiction_id AND j.state_code = $1 AND j.type = $2`,
                [st, jtype, durationText(stateRes, distRes), noteText(minAge, stateRes, distRes, e.vr), e.u]
            );
            updated += r.rowCount;
        }
    }
    log?.(`  state-leg eligibility backfilled: ${updated} offices`);
}

module.exports = { backfill, ELIG };
