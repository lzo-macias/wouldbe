/*
 * SOURCE: per-state campaign-finance FILING AUTHORITY + CONTRIBUTION LIMIT +
 * advancement rule, for the 50 state legislatures. Seeds onto each `state`
 * jurisdiction (applies to that state's leg offices):
 *   - filing_authorities  → the agency a candidate registers/files with
 *   - jurisdiction_rules_versions → individual contribution limit (legislative
 *     tier) + runoff/advancement rule + filing-based candidacy trigger
 *
 * Contribution limits are DISPLAY-ONLY (pledges ≠ contributions; the processor
 * enforces real limits). Compiled by parallel research agents from NCSL +
 * each state's campaign-finance agency + Ballotpedia (source URL kept per state).
 * ~11 states have NO individual limit (stored as null + "no limit" text).
 * Chamber-split states keep the precise text in source_documents; the numeric
 * field holds the lower-chamber figure.
 *
 * c = limit in CENTS (null = unlimited) · t = human-readable limit text
 * adv ∈ plurality|majority_or_runoff|top_two|ranked_choice · ro = has_runoff
 */
const U = require('../../upserts');

const REGS = {
    AL: { a: 'Alabama Secretary of State (Fair Campaign Practices Act)', p: 'https://fcpa.alabamavotes.gov/', h: 'https://www.sos.alabama.gov/alabama-votes/candidates/candidate-resources', c: null, t: 'No individual contribution limit (unlimited)', adv: 'majority_or_runoff', ro: true, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Alabama' },
    AK: { a: 'Alaska Public Offices Commission (APOC)', p: 'https://aws.state.ak.us/apocreports/campaigndisclosure/CDForms.aspx', h: 'https://apoc.doa.alaska.gov/filer-resources/campaign-disclosure/', c: null, t: 'No individual limit currently (HB 16 pending) — verify', adv: 'ranked_choice', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Alaska' },
    AZ: { a: 'Arizona Secretary of State', p: 'https://azsos.gov/elections/campaign-finance/filing-information', h: 'https://azsos.gov/elections/campaign-finance', c: 550000, t: '$5,500 per election', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Arizona' },
    AR: { a: 'Arkansas Secretary of State / Ethics Commission', p: 'https://financial-disclosures.sos.arkansas.gov/', h: 'https://www.sos.arkansas.gov/elections/financial-disclosure/', c: 350000, t: '$3,500 per election', adv: 'majority_or_runoff', ro: true, s: 'https://www.arkansasethics.com/campaign-contribution-limit/' },
    CA: { a: 'California Secretary of State / FPPC', p: 'https://calonline.sos.ca.gov/', h: 'https://www.fppc.ca.gov/learn/campaign-rules/candidate-toolkit-getting-started/getting-started.html', c: 590000, t: '$5,900 per election', adv: 'top_two', ro: false, s: 'https://www.fppc.ca.gov/learn/campaign-rules/state-contribution-limits.html' },
    CO: { a: 'Colorado Secretary of State (TRACER)', p: 'https://tracer.sos.colorado.gov/PublicSite/homepage.aspx', h: 'https://www.coloradosos.gov/pubs/elections/CampaignFinance/CampaignFinanceHome.html', c: 72500, t: '$725 per election cycle', adv: 'plurality', ro: false, s: 'https://www.coloradosos.gov/pubs/elections/CampaignFinance/limits/acceptance.html' },
    CT: { a: 'Connecticut State Elections Enforcement Commission (SEEC)', p: 'https://seec.ct.gov/eCrisHome/', h: 'https://seec.ct.gov/Portal/forms/RegForm', c: 25000, t: '$1,000/election (Senate) · $250/election (House)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Connecticut' },
    DE: { a: 'Delaware Department of Elections', p: 'https://cfrs.elections.delaware.gov', h: 'https://elections.delaware.gov/candidates/campaignfinance/cf_info.shtml', c: 60000, t: '$600 per election', adv: 'plurality', ro: false, s: 'https://delcode.delaware.gov/title15/c080/sc02/index.html' },
    FL: { a: 'Florida Division of Elections', p: 'https://efs.dos.state.fl.us/', h: 'https://dos.fl.gov/elections/candidates-committees/campaign-finance/', c: 100000, t: '$1,000 per election', adv: 'plurality', ro: false, s: 'https://dos.fl.gov/elections/candidates-committees/campaign-finance/' },
    GA: { a: 'Georgia Government Transparency & Campaign Finance Commission', p: 'https://efile.ethics.ga.gov/', h: 'https://ethics.ga.gov/campaign-finance/', c: 330000, t: '$3,300 per election (runoff treated separately)', adv: 'majority_or_runoff', ro: true, s: 'https://ethics.ga.gov/contribution-limits/' },
    HI: { a: 'Hawaii Campaign Spending Commission', p: 'https://csc.hawaii.gov/CFSPublic/menu/', h: 'https://ags.hawaii.gov/campaign/', c: 200000, t: '$2,000 (House) · $4,000 (Senate) per cycle', adv: 'plurality', ro: false, s: 'https://ags.hawaii.gov/campaign/contribution-limits/' },
    ID: { a: 'Idaho Secretary of State, Elections Division', p: 'https://sunshine.voteidaho.gov/', h: 'https://voteidaho.gov/campaign-finance-portal/', c: 100000, t: '$1,000 per election', adv: 'plurality', ro: false, s: 'https://legislature.idaho.gov/statutesrules/idstat/title67/t67ch66/sect67-6610a/' },
    IL: { a: 'Illinois State Board of Elections', p: 'https://www.elections.il.gov/CampaignDisclosure/CDFilersList.aspx', h: 'https://www.elections.il.gov/CampaignDisclosure.aspx', c: 730000, t: '$7,300 per cycle', adv: 'plurality', ro: false, s: 'https://www.elections.il.gov/CampaignDisclosure.aspx' },
    IN: { a: 'Indiana Election Division (Secretary of State)', p: 'https://campaignfinance.in.gov', h: 'https://www.in.gov/sos/elections/campaign-finance/', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://www.in.gov/sos/elections/campaign-finance/' },
    IA: { a: 'Iowa Ethics & Campaign Disclosure Board', p: 'https://webapp.iecdb.iowa.gov/Default.aspx', h: 'https://ethics.iowa.gov/campaigns/candidate-guide', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Iowa' },
    KS: { a: 'Kansas Governmental Ethics Commission', p: 'https://www.sos.ks.gov/elections/campaign_finance/cfr_online.aspx', h: 'https://ethics.kansas.gov/', c: 100000, t: '$2,000 (Senate) · $1,000 (House) per election', adv: 'plurality', ro: false, s: 'https://ethics.kansas.gov/' },
    KY: { a: 'Kentucky Registry of Election Finance', p: 'https://secure.kentucky.gov/kref/financial', h: 'https://kref.ky.gov/', c: 220000, t: '$2,200 per election', adv: 'plurality', ro: false, s: 'https://kref.ky.gov/Pages/Contribution-Limits.aspx' },
    LA: { a: 'Louisiana Board of Ethics', p: 'https://www.ethics.la.gov/EFFOnlineFilers.aspx', h: 'https://ethics.la.gov/', c: 250000, t: '$2,500 per election', adv: 'majority_or_runoff', ro: true, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Louisiana' },
    ME: { a: 'Maine Commission on Governmental Ethics & Election Practices', p: 'https://www.mainecampaignfinancedisclosure.com', h: 'https://www.maine.gov/ethics/candidates', c: 50000, t: '$500 per election', adv: 'ranked_choice', ro: false, s: 'https://www.maine.gov/ethics/political-activity/contributing-information' },
    MD: { a: 'Maryland State Board of Elections', p: 'https://campaignfinance.maryland.gov', h: 'https://elections.maryland.gov/campaign_finance/index.html', c: 600000, t: '$6,000 per cycle', adv: 'plurality', ro: false, s: 'https://elections.maryland.gov/campaign_finance/index.html' },
    MA: { a: 'Massachusetts Office of Campaign & Political Finance (OCPF)', p: 'https://www.ocpfreporter.us/onlineorganization/signup', h: 'https://www.ocpf.us/Filers/FilerInfo', c: 100000, t: '$1,000 per calendar year', adv: 'plurality', ro: false, s: 'https://www.ocpf.us/legal/contributionlimits' },
    MI: { a: 'Michigan Secretary of State, Bureau of Elections', p: 'https://www.michigan.gov/sos/elections/disclosure/cfr', h: 'https://www.michigan.gov/sos/elections/disclosure/cfr', c: 122500, t: '$1,225 (House) · $2,450 (Senate) per cycle', adv: 'plurality', ro: false, s: 'https://www.michigan.gov/sos/elections/disclosure/cfr/contribution-limits' },
    MN: { a: 'Minnesota Campaign Finance & Public Disclosure Board', p: 'https://cfb.mn.gov/', h: 'https://cfb.mn.gov/', c: 100000, t: '$1,000 per two-year segment', adv: 'plurality', ro: false, s: 'https://cfb.mn.gov/pdf/camfin/contrib_limits_2026.pdf' },
    MS: { a: 'Mississippi Secretary of State', p: 'https://www.sos.ms.gov/elections-voting/campaign-finance', h: 'https://www.sos.ms.gov/elections-voting/campaign-finance', c: null, t: 'No individual contribution limit (unlimited)', adv: 'majority_or_runoff', ro: true, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Mississippi' },
    MO: { a: 'Missouri Ethics Commission', p: 'https://www.mec.mo.gov/MEC/Campaign_Finance/CF_ElectronicFiling.aspx', h: 'https://www.mec.mo.gov/', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Missouri' },
    MT: { a: 'Montana Commissioner of Political Practices', p: 'https://cers-ext.mt.gov/', h: 'https://politicalpractices.mt.gov/candidate-and-committee-information/', c: 47000, t: '$470 per election', adv: 'plurality', ro: false, s: 'https://politicalpractices.mt.gov/' },
    NE: { a: 'Nebraska Accountability & Disclosure Commission (NADC)', p: 'https://nadc-e.nebraska.gov/PublicSite/Forms.aspx', h: 'https://nadc.nebraska.gov/candidate-committee-treasurers-guide', c: null, t: 'No individual contribution limit (unlimited)', adv: 'top_two', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Nebraska' },
    NV: { a: 'Nevada Secretary of State, Elections Division', p: 'https://www.nvsos.gov/SOSCandidateServices/Loginuu.aspx', h: 'https://www.nvsos.gov/sos/elections/candidate-information/campaign-finance-reporting-requirements', c: 500000, t: '$5,000 per election', adv: 'plurality', ro: false, s: 'https://www.nvsos.gov/sos/elections' },
    NH: { a: 'New Hampshire Secretary of State, Election Division', p: 'https://cfs.sos.nh.gov/Public/CandidateRegistrationPublic', h: 'https://www.sos.nh.gov/elections/campaign-finance', c: 500000, t: '$5,000/election (expenditure-limit signers; non-signers ~$1,000)', adv: 'plurality', ro: false, s: 'https://www.sos.nh.gov/elections/campaign-finance' },
    NJ: { a: 'New Jersey Election Law Enforcement Commission (ELEC)', p: 'https://www.njelecregister.com/', h: 'https://www.elec.nj.gov/forcandidates/forms_candidates.htm', c: 550000, t: '$5,500 per election', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_New_Jersey' },
    NM: { a: 'New Mexico Secretary of State', p: 'https://login.cfis.sos.state.nm.us/', h: 'https://www.sos.nm.gov/candidate-and-campaigns/', c: 620000, t: '$6,200 per election', adv: 'plurality', ro: false, s: 'https://www.sos.nm.gov/candidate-and-campaigns/how-to-become-a-candidate/campaign-contribution-limits/' },
    NY: { a: 'New York State Board of Elections', p: 'https://elections.ny.gov/electronic-filing-system-efs-web-application', h: 'https://elections.ny.gov/campaign-finance-handbook-forms-publications', c: 300000, t: '$3,000/election (Assembly) · $5,000/election (Senate)', adv: 'plurality', ro: false, s: 'https://elections.ny.gov/contribution-limits' },
    NC: { a: 'North Carolina State Board of Elections', p: 'https://www.ncsbe.gov/campaign-finance/candidate-committees', h: 'https://www.ncsbe.gov/campaign-finance', c: 680000, t: '$6,800 per election', adv: 'majority_or_runoff', ro: true, s: 'https://www.ncsbe.gov/campaign-finance' },
    ND: { a: 'North Dakota Secretary of State', p: 'https://cf.sos.nd.gov/', h: 'https://www.sos.nd.gov/elections/campaign-finance-and-disclosures', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_North_Dakota' },
    OH: { a: 'Ohio Secretary of State', p: 'https://www.ohiosos.gov/elections/campaign-finance', h: 'https://www.ohiosos.gov/elections/campaign-finance', c: 1661567, t: '$16,615.67 per election (indexed)', adv: 'plurality', ro: false, s: 'https://www.ohiosos.gov/campaign-finance/contribution-limits/' },
    OK: { a: 'Oklahoma Ethics Commission', p: 'https://guardian.ok.gov/PublicSite/Homepage.aspx', h: 'https://oklahoma.gov/ethics.html', c: 350000, t: '$3,500 per election', adv: 'majority_or_runoff', ro: true, s: 'https://oklahoma.gov/ethics/resources/contribution-charts.html' },
    OR: { a: 'Oregon Secretary of State, Elections Division', p: 'https://secure.sos.state.or.us/orestar/', h: 'https://sos.oregon.gov/elections/Documents/campaign-finance.pdf', c: null, t: 'No individual limit for 2026 (limits effective 2027)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Oregon' },
    PA: { a: 'Pennsylvania Department of State, Bureau of Elections', p: 'https://www.campaignfinanceonline.pa.gov/Pages/CFReportFiling.aspx', h: 'https://www.pa.gov/agencies/dos/programs/voting-and-elections/campaign-finance', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Pennsylvania' },
    RI: { a: 'Rhode Island Board of Elections, Campaign Finance Division', p: 'https://elections.ri.gov/campaign-finance', h: 'https://elections.ri.gov/campaign-finance', c: 200000, t: '$2,000 per calendar year', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Rhode_Island' },
    SC: { a: 'South Carolina State Ethics Commission', p: 'https://ethics.sc.gov/', h: 'https://ethics.sc.gov/public-information/candidates', c: 100000, t: '$1,000 per election', adv: 'majority_or_runoff', ro: true, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_South_Carolina' },
    SD: { a: 'South Dakota Secretary of State', p: 'https://sdsos.gov/elections-voting/campaign-finance/default.aspx', h: 'https://sdsos.gov/elections-voting/campaign-finance/default.aspx', c: 100000, t: '$1,000 per election', adv: 'plurality', ro: false, s: 'https://sdsos.gov/elections-voting/campaign-finance/contribution-limits.aspx' },
    TN: { a: 'Tennessee Registry of Election Finance (TREF)', p: 'https://apps.tn.gov/tncamp/', h: 'https://www.tn.gov/tref/tref-candidates.html', c: 190000, t: '$1,900 per election', adv: 'plurality', ro: false, s: 'https://www.tn.gov/tref.html' },
    TX: { a: 'Texas Ethics Commission', p: 'https://prd.tecprd.ethicsefile.com/TECFilerWeb/', h: 'https://www.ethics.state.tx.us/resources/cf/StartEndCampaign.php', c: null, t: 'No individual contribution limit (unlimited)', adv: 'majority_or_runoff', ro: true, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Texas' },
    UT: { a: "Utah Lieutenant Governor's Office, Elections Division", p: 'https://disclosures.utah.gov/', h: 'https://disclosures.utah.gov/Help/Faqs', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Utah' },
    VT: { a: 'Vermont Secretary of State, Elections Division', p: 'https://campaignfinance.vermont.gov', h: 'https://sos.vermont.gov/elections/campaign-finance', c: 129000, t: '$1,290 (House) · $1,940 (Senate) per cycle', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Vermont' },
    VA: { a: 'Virginia Department of Elections', p: 'https://cf.elections.virginia.gov', h: 'https://www.elections.virginia.gov/candidatepac-info/campaign-finance-filing/', c: null, t: 'No individual contribution limit (unlimited)', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_Virginia' },
    WA: { a: 'Washington State Public Disclosure Commission (PDC)', p: 'https://www.pdc.wa.gov/learn/file-online/campaign-online-filing', h: 'https://www.pdc.wa.gov/registration-reporting/candidates-committees/registration-reporting-basics', c: 120000, t: '$1,200 per election', adv: 'top_two', ro: false, s: 'https://www.pdc.wa.gov/rules-enforcement/guidelines-restrictions/contribution-limits' },
    WV: { a: 'West Virginia Secretary of State, Elections Division', p: 'https://cfrs.wvsos.gov/', h: 'https://sos.wv.gov/elections/Pages/CampFinGen.aspx', c: 280000, t: '$2,800 per election', adv: 'plurality', ro: false, s: 'https://ballotpedia.org/Campaign_finance_requirements_in_West_Virginia' },
    WI: { a: 'Wisconsin Ethics Commission', p: 'https://cfis.wi.gov', h: 'https://ethics.wi.gov/Pages/CampaignFinance/ContributionLimits.aspx', c: 100000, t: '$1,000 (Assembly) · $2,000 (Senate) per cycle', adv: 'plurality', ro: false, s: 'https://ethics.wi.gov/Pages/CampaignFinance/ContributionLimits.aspx' },
    WY: { a: 'Wyoming Secretary of State, Elections Division', p: 'https://www.wycampaignfinance.gov', h: 'https://sos.wyo.gov/Elections/', c: 150000, t: '$1,500 per election', adv: 'plurality', ro: false, s: 'https://sos.wyo.gov/Elections/' },
};

async function seed(client, { cycle, log }) {
    const sj = await client.query(`SELECT id, state_code FROM jurisdiction WHERE type = 'state'`);
    let nAuth = 0, nRules = 0;
    for (const r of sj.rows) {
        const e = REGS[r.state_code];
        if (!e) continue;

        await U.upsertFilingAuthority(client, {
            jurisdiction_id: r.id, applies_to_office_id: null,
            authority_name: e.a, authority_level: 'state',
            registration_portal_url: e.p, how_to_file_url: e.h,
            is_active: true, source_url: e.s,
        });
        nAuth += 1;

        await U.publishRulesVersion(client, {
            jurisdiction_id: r.id, version: `${r.state_code}-leg-${cycle}`,
            effective_from: `${cycle - 1}-01-01`,
            candidacy_trigger_type: 'filing_based',
            contribution_limit_individual_primary: e.c, // cents; null = unlimited (DISPLAY-ONLY)
            committee_required_before_solicitation: true,
            has_runoff: e.ro, advancement_rule: e.adv,
            source_documents: [`Individual contribution limit (legislative): ${e.t}`, e.s],
        });
        nRules += 1;
    }
    log?.(`  state regs/authorities: ${nAuth} filing authorities · ${nRules} rules versions`);
}

module.exports = { seed, REGS };
