#!/usr/bin/env node
/*
 * Reference-data seeder CLI.
 *
 *   node server/seed/reference/run.js --source fec   --cycle 2026
 *   node server/seed/reference/run.js --source fec   --cycle 2026 --with-candidates
 *   node server/seed/reference/run.js --source nyc   --cycle 2025
 *   node server/seed/reference/run.js --source state --state ny --cycle 2026
 *   node server/seed/reference/run.js --source all   --cycle 2026 --dry-run
 *
 * Flags:
 *   --source   fec | state | nyc | all        (which adapter to run)
 *   --state    2-letter code (for --source state)
 *   --cycle    election year (default: next even year)
 *   --with-candidates  also pull live candidates from the FEC API (needs FEC_API_KEY)
 *   --dry-run  run everything in a transaction, then ROLLBACK (writes nothing)
 *
 * Everything runs in ONE transaction per invocation: a mid-run error rolls back
 * cleanly, and a re-run refreshes via the idempotent upserts (no duplicates).
 */
const { pool, close } = require('./db');
const fec = require('./sources/fec');
const nyc = require('./sources/local/nyc');
const futureAnchors = require('./sources/local/futureCycleAnchors');
const primaries = require('./sources/statePrimaries2026');
const stateLegs = require('./sources/states/_stateLegislatures');
const stateLegElig = require('./sources/states/_stateLegEligibility');
const stateRegs = require('./sources/states/_stateRegsAndAuthorities');

function parseArgs(argv) {
    const a = { cycle: defaultCycle() };
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--dry-run') a.dryRun = true;
        else if (k === '--with-candidates') a.withCandidates = true;
        else if (k === '--source') a.source = argv[++i];
        else if (k === '--state') a.state = argv[++i]?.toUpperCase();
        else if (k === '--cycle') a.cycle = parseInt(argv[++i], 10);
    }
    return a;
}
function defaultCycle() {
    const y = new Date().getFullYear();
    return y % 2 === 0 ? y : y + 1;
}

async function run() {
    const args = parseArgs(process.argv);
    if (!args.source) {
        console.error('Missing --source (fec | state | nyc | all). See header for usage.');
        process.exit(1);
    }
    const log = (m) => console.log(m);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        log(`▶ seeding source=${args.source} cycle=${args.cycle}${args.dryRun ? ' (DRY RUN)' : ''}`);

        if (args.source === 'fec' || args.source === 'all') {
            log('FEC federal structure…');
            await fec.seedFederalStructure(client, { cycle: args.cycle, log });
            log('Federal deadline layer (Senate + House)…');
            await fec.seedFederalDeadlines(client, { cycle: args.cycle, log });
            if (args.withCandidates) {
                for (const office of ['P', 'S', 'H']) {
                    await fec.seedCandidatesFromFEC(client, { cycle: args.cycle, office, log });
                }
            }
        }
        if (args.source === 'state') {
            if (!args.state) throw new Error('--source state requires --state <XX>');
            const mod = require(`./sources/states/${args.state.toLowerCase()}.js`);
            log(`State ${args.state}…`);
            await mod.seed(client, { cycle: args.cycle, log });
        }
        if (args.source === 'statelegs' || args.source === 'all') {
            log('State legislatures (OCD census districts)…');
            await stateLegs.seed(client, { cycle: args.cycle, log });
        }
        if (args.source === 'primaries' || args.source === 'all') {
            log('State primaries + filing deadlines (Ballotpedia)…');
            await primaries.seed(client, { cycle: args.cycle, log });
        }
        if (args.source === 'state-regs' || args.source === 'all') {
            log('State filing authorities + contribution limits…');
            await stateRegs.seed(client, { cycle: args.cycle, log });
        }
        if (args.source === 'statelegeligibility' || args.source === 'all') {
            log('State-legislature eligibility (residency/citizenship/voter-reg)…');
            await stateLegElig.backfill(client, { log });
        }
        if (args.source === 'statelegdeadlines' || args.source === 'all') {
            log('State-legislature deadlines (primary/general/filing)…');
            await primaries.seedStateLegDeadlines(client, { cycle: args.cycle, log });
        }
        if (args.source === 'nyc' || args.source === 'all') {
            log('NYC local…');
            await nyc.seed(client, { cycle: args.cycle, log });
        }
        if (args.source === 'nyc-deadlines' || args.source === 'all') {
            log('NYC deadlines (BOE/CFB calendar)…');
            await nyc.seedDeadlines(client, { cycle: 2025, log });
        }
        if (args.source === 'future-anchors' || args.source === 'all') {
            log('Future-cycle election anchors (off-cycle legs + President + NYC)…');
            await futureAnchors.seed(client, { log });
        }

        if (args.dryRun) {
            await client.query('ROLLBACK');
            log('✓ dry run complete — rolled back, nothing persisted.');
        } else {
            await client.query('COMMIT');
            log('✓ committed.');
        }
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('✗ seed failed, rolled back:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await close();
    }
}

run();
