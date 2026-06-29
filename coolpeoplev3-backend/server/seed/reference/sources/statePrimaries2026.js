/*
 * SOURCE: 2026 state primary dates + candidate filing deadlines (Ballotpedia).
 *
 * Fills the PER-STATE deadline layer for the federal congressional offices
 * (US Senate + US House) that the uniform federal layer (fec.js) could not:
 *   - the `primary` anchor (date varies per state — THE missing piece)
 *   - the candidate `filing_close` deadline (the legally-operative cutoff)
 *   - and, now that a primary anchor exists, the `fec_pre_primary_report`
 *     (primary − 12 days) which the federal layer left uncomputable.
 *
 * Data transcribed via pdftotext from the user's Ballotpedia export (exact dates,
 * not OCR). "Election date" column = the statewide PRIMARY date. Dates are
 * "subject to change" (Ballotpedia's own caveat) — cite the state SoS/BOE before
 * relying in production.
 *
 * Office-split states (the filing deadline differs by office) are encoded with
 * `sen`/`hou` overrides. Specials:
 *   - LA: congressional uses the Nov-3 majority-vote system (no separate primary)
 *         → noPrimary, filing only.
 *   - UT: no 2026 US Senate race → House-only filing.
 *   - Senate filing is seeded only for states with a 2026 Senate contest
 *     (Class II + the FL special); the Senate office exists everywhere but most
 *     states have no 2026 Senate race.
 */
const U = require('../upserts');

// st: [primary, filing]  — or  [primary, { sen, hou }]  — plus optional flags.
const DATA = [
    ['AL', '2026-05-19', '2026-01-23'],
    ['AK', '2026-08-18', '2026-06-01'],
    ['AZ', '2026-07-21', '2026-03-23'],
    ['AR', '2026-03-03', '2025-11-12'],
    ['CA', '2026-06-02', '2026-03-06'],
    ['CO', '2026-06-30', '2026-03-18'],
    ['CT', '2026-08-11', '2026-06-09'],
    ['DE', '2026-09-15', '2026-07-14'],
    ['FL', '2026-08-18', { sen: '2026-04-24', hou: '2026-06-12' }],
    ['GA', '2026-05-19', '2026-03-06'],
    ['HI', '2026-08-08', '2026-06-02'],
    ['ID', '2026-05-19', '2026-02-27'],
    ['IL', '2026-03-17', '2025-11-03'],
    ['IN', '2026-05-05', '2026-02-06'],
    ['IA', '2026-06-02', '2026-03-13'],
    ['KS', '2026-08-04', '2026-06-01'],
    ['KY', '2026-05-19', '2026-01-09'],
    ['LA', '2026-11-03', '2026-08-07', { noPrimary: true }],
    ['ME', '2026-06-09', '2026-03-16'],
    ['MD', '2026-06-23', '2026-02-24'],
    ['MA', '2026-09-01', '2026-06-02'],
    ['MI', '2026-08-04', '2026-04-21'],
    ['MN', '2026-08-11', '2026-06-02'],
    ['MS', '2026-03-10', '2025-12-26'],
    ['MO', '2026-08-04', '2026-03-31'],
    ['MT', '2026-06-02', '2026-03-04'],
    ['NE', '2026-05-12', '2026-03-02'],
    ['NV', '2026-06-09', '2026-03-13'],
    ['NH', '2026-09-08', '2026-06-12'],
    ['NJ', '2026-06-02', '2026-03-23'],
    ['NM', '2026-06-02', '2026-02-03'],
    ['NY', '2026-06-23', '2026-04-06'],
    ['NC', '2026-03-03', '2025-12-19'],
    ['ND', '2026-06-09', '2026-04-06'],
    ['OH', '2026-05-05', '2026-02-04'],
    ['OK', '2026-06-16', '2026-04-03'],
    ['OR', '2026-05-19', '2026-03-10'],
    ['PA', '2026-05-19', '2026-03-10'],
    ['RI', '2026-09-09', '2026-06-24'],
    ['SC', '2026-06-09', '2026-03-30'],
    ['SD', '2026-06-02', '2026-03-31'],
    ['TN', '2026-08-06', { sen: '2026-03-10', hou: '2026-05-15' }],
    ['TX', '2026-03-03', '2025-12-08'],
    ['UT', '2026-06-23', { hou: '2026-03-13' }],
    ['VT', '2026-08-11', '2026-05-28'],
    ['VA', '2026-08-04', { sen: '2026-04-02', hou: '2026-05-26' }],
    ['WA', '2026-08-04', '2026-05-08'],
    ['WV', '2026-05-12', '2026-01-31'],
    ['WI', '2026-08-11', '2026-06-01'],
    ['WY', '2026-08-18', '2026-05-29'],
];

// States with a 2026 US Senate contest (Class II + the FL special). Senate
// filing is seeded only here; elsewhere the Senate office has no 2026 race.
const SENATE_RACE_2026 = new Set([
    'AL','AK','AR','CO','DE','GA','ID','IL','IA','KS','KY','LA','ME','MA','MI','MN',
    'MS','MT','NE','NH','NJ','NM','NC','OK','OR','RI','SC','SD','TN','TX','VA','WV','WY','FL',
]);

const SRC = 'https://ballotpedia.org/2026_election_and_voting_dates';
// Derived petition window: circulation is assumed to open ~90 days before the
// filing deadline. Approximate (for goal-pacing), NOT an authoritative per-state date.
const PETITION_WINDOW_DAYS = 90;
const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

// filing value for an office given the row's filing field (string or {sen,hou}).
const filingFor = (filing, kind) =>
    typeof filing === 'string' ? filing : filing?.[kind] ?? null;

async function seedOffice(client, { officeId, jurisdictionId, cycle, primary, filing, noPrimary, effFrom, anchored }) {
    // primary anchor (once per jurisdiction)
    if (!noPrimary && !anchored.has(jurisdictionId)) {
        await U.upsertElectionAnchor(client, {
            jurisdiction_id: jurisdictionId, election_cycle: cycle,
            anchor_type: 'primary', anchor_date: primary, source_url: SRC,
        });
        anchored.add(jurisdictionId);
    }

    // filing_close (fixed statutory date)
    if (filing) {
        const r = await U.upsertOffsetRule(client, {
            jurisdiction_id: jurisdictionId, applies_to_office_id: officeId,
            deadline_type: 'filing_close', is_fixed_date: true, fixed_date: filing,
            effective_from: effFrom, source_url: SRC,
        });
        await U.upsertElectionDeadline(client, {
            jurisdiction_id: jurisdictionId, election_cycle: cycle,
            deadline_type: 'filing_close', deadline_date: filing,
            applies_to_office_id: officeId, offset_rule_id: r.id, is_tbd: false, source_url: SRC,
        });

        // Derived petition window (goal-pacing, NOT authoritative): the signature
        // END equals the candidate filing deadline in fee-or-petition states; the
        // circulation START defaults to ~90 days prior (is_tbd — verify per state).
        for (const [deadline_type, date, tbd, note] of [
            ['petition_filing_deadline', filing, false,
                'Derived: signatures due by the candidate filing deadline (fee-or-petition states).'],
            ['petition_circulation_start', addDays(filing, -PETITION_WINDOW_DAYS), true,
                `Approximate: circulation typically opens ~${PETITION_WINDOW_DAYS}d before the filing deadline — verify per state.`],
        ]) {
            const pr = await U.upsertOffsetRule(client, {
                jurisdiction_id: jurisdictionId, applies_to_office_id: officeId,
                deadline_type, is_fixed_date: true, fixed_date: date,
                effective_from: effFrom, source_url: SRC, notes: note,
            });
            await U.upsertElectionDeadline(client, {
                jurisdiction_id: jurisdictionId, election_cycle: cycle,
                deadline_type, deadline_date: date, applies_to_office_id: officeId,
                offset_rule_id: pr.id, is_tbd: tbd, description: note, source_url: SRC,
            });
        }
    }

    if (noPrimary) return;

    // primary_date (anchor + 0) and pre-primary FEC report (anchor − 12)
    for (const [deadline_type, date, offset] of [
        ['primary_date', primary, 0],
        ['fec_pre_primary_report', addDays(primary, -12), -12],
    ]) {
        const r = await U.upsertOffsetRule(client, {
            jurisdiction_id: jurisdictionId, applies_to_office_id: officeId,
            deadline_type, anchor_type: 'primary', offset_days: offset,
            effective_from: effFrom, source_url: SRC,
        });
        await U.upsertElectionDeadline(client, {
            jurisdiction_id: jurisdictionId, election_cycle: cycle,
            deadline_type, deadline_date: date, applies_to_office_id: officeId,
            anchor_type: 'primary', offset_rule_id: r.id, is_tbd: false, source_url: SRC,
        });
    }
}

async function seed(client, { cycle, log }) {
    const effFrom = `${cycle - 1}-01-01`;
    const anchored = new Set();
    let nSen = 0, nHou = 0, nStates = 0;

    for (const [st, primary, filing, flags = {}] of DATA) {
        const { noPrimary = false } = flags;

        // US Senate (in the state jurisdiction) — only where a 2026 race exists
        if (SENATE_RACE_2026.has(st)) {
            const sen = await client.query(
                `SELECT o.id, o.jurisdiction_id FROM office o
                 JOIN jurisdiction j ON j.id = o.jurisdiction_id
                 WHERE j.state_code = $1 AND o.office_name LIKE 'US Senator%' LIMIT 1`,
                [st]
            );
            if (sen.rows[0]) {
                await seedOffice(client, {
                    officeId: sen.rows[0].id, jurisdictionId: sen.rows[0].jurisdiction_id,
                    cycle, primary, filing: filingFor(filing, 'sen'), noPrimary, effFrom, anchored,
                });
                nSen += 1;
            }
        }

        // US House (each in its CD jurisdiction)
        const house = await client.query(
            `SELECT o.id, o.jurisdiction_id FROM office o
             JOIN jurisdiction j ON j.id = o.jurisdiction_id
             WHERE j.state_code = $1 AND o.office_name LIKE 'US Representative%'`,
            [st]
        );
        for (const h of house.rows) {
            await seedOffice(client, {
                officeId: h.id, jurisdictionId: h.jurisdiction_id,
                cycle, primary, filing: filingFor(filing, 'hou'), noPrimary, effFrom, anchored,
            });
            nHou += 1;
        }
        nStates += 1;
    }
    log?.(`  state primaries/filing: ${nStates} states · ${nSen} senate · ${nHou} house offices seeded`);
}

// ---- Phase 2: state-LEGISLATURE deadlines -------------------------------
// Attaches the per-state primary/general/filing dates to the state-leg offices
// seeded by _stateLegislatures.js. State legislators file with STATE agencies on
// the STATE primary ballot — so they share the state's primary + filing dates,
// but get NO FEC report rows (those are federal-only).
const GENERAL_2026 = '2026-11-03';
// States with NO 2026 regular legislative election (odd-year cycle).
const NO_STATELEG_2026 = new Set(['LA', 'MS', 'NJ', 'VA']);
// State-leg filing deadline where it differs from the statewide/federal value
// (these states list a separate state-legislature filing deadline).
const STATELEG_FILING = { FL: '2026-06-12', TN: '2026-03-10', UT: '2026-01-08', MA: '2026-05-26' };

async function seedStateLegDeadlines(client, { cycle, log }) {
    const effFrom = `${cycle - 1}-01-01`;
    let nStates = 0, nOffices = 0;

    for (const [st, primary, filing] of DATA) {
        if (NO_STATELEG_2026.has(st)) continue; // no 2026 legislative election
        const fil = STATELEG_FILING[st] || (typeof filing === 'string' ? filing : null);

        const offices = await client.query(
            `SELECT o.id, o.jurisdiction_id FROM office o
             JOIN jurisdiction j ON j.id = o.jurisdiction_id
             WHERE j.state_code = $1 AND j.type IN ('state_leg_upper','state_leg_lower')`,
            [st]
        );

        for (const o of offices.rows) {
            await U.upsertElectionAnchor(client, { jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, anchor_type: 'primary', anchor_date: primary, source_url: SRC });
            await U.upsertElectionAnchor(client, { jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, anchor_type: 'general', anchor_date: GENERAL_2026, source_url: SRC });

            const rows = [
                ['primary_date', primary, { anchor_type: 'primary', offset_days: 0 }],
                ['general_date', GENERAL_2026, { anchor_type: 'general', offset_days: 0 }],
            ];
            if (fil) {
                rows.push(['filing_close', fil, { is_fixed_date: true, fixed_date: fil }]);
                rows.push(['petition_filing_deadline', fil, { is_fixed_date: true, fixed_date: fil, note: 'Derived: signatures due by the candidate filing deadline.' }]);
                const start = addDays(fil, -PETITION_WINDOW_DAYS);
                rows.push(['petition_circulation_start', start, { is_fixed_date: true, fixed_date: start, is_tbd: true, note: `Approximate: ~${PETITION_WINDOW_DAYS}d before filing — verify per state.` }]);
            }

            for (const [dt, date, opt] of rows) {
                const r = await U.upsertOffsetRule(client, {
                    jurisdiction_id: o.jurisdiction_id, applies_to_office_id: o.id, deadline_type: dt,
                    anchor_type: opt.anchor_type ?? null, offset_days: opt.offset_days ?? null,
                    is_fixed_date: !!opt.is_fixed_date, fixed_date: opt.fixed_date ?? null,
                    effective_from: effFrom, source_url: SRC, notes: opt.note ?? null,
                });
                await U.upsertElectionDeadline(client, {
                    jurisdiction_id: o.jurisdiction_id, election_cycle: cycle, deadline_type: dt,
                    deadline_date: date, applies_to_office_id: o.id, anchor_type: opt.anchor_type ?? null,
                    offset_rule_id: r.id, is_tbd: opt.is_tbd ?? false, description: opt.note ?? null, source_url: SRC,
                });
            }
            nOffices += 1;
        }
        nStates += 1;
    }
    log?.(`  state-leg deadlines: ${nStates} states · ${nOffices} offices (LA/MS/NJ/VA excluded — odd-year)`);
}

module.exports = { seed, seedStateLegDeadlines, DATA };
