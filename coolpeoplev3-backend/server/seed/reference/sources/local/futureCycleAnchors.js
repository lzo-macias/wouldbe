/*
 * Future-cycle election ANCHORS for offices that the 2026 reference seed skips
 * because they don't hold elections in 2026.
 *
 * Why this exists: the WouldBe feed shows an office's next filing deadline, or —
 * when none is known — the next election YEAR. Off-cycle legislatures and the
 * presidency have no 2026 election, so without a future anchor they render a bare
 * "Filing date TBD". These groups DO have a legally-fixed next election year:
 *
 *   - LA / MS / NJ / VA legislatures → 2027   (odd-year legislative states)
 *   - President of the United States → 2028
 *   - NYC municipal (Mayor + 51 Council seats) → 2029  (last elected 2025)
 *
 * Only the YEAR is authoritative here — it lives in election_cycle, which is what
 * the UI reads. anchor_date is a year-only marker (Jan 1 of the cycle): we don't
 * know the exact election day yet, so we don't invent one. It exists only to (a)
 * be a future date so "soonest upcoming" ordering works and (b) be superseded, day
 * and all, when the real 2027/2028/2029 calendars get seeded via the
 * (jurisdiction, cycle, anchor_type) ON CONFLICT upsert.
 */
const U = require('../../upserts');

const SRC = 'projected: election year (election_cycle) is authoritative; exact date not yet set';

// anchor_date is Jan 1 of the cycle — a "year only, day unknown" marker. The year
// shown to users comes from election_cycle, never from this date.
const GROUPS = [
    {
        label: 'LA/MS/NJ/VA legislatures 2027',
        cycle: 2027,
        anchor_date: '2027-01-01',
        sql: `
            SELECT id FROM jurisdiction
            WHERE state_code IN ('LA','MS','NJ','VA')
              AND type IN ('state_leg_lower','state_leg_upper')
        `,
    },
    {
        label: 'President 2028',
        cycle: 2028,
        anchor_date: '2028-01-01',
        sql: `
            SELECT DISTINCT j.id
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE o.office_name ILIKE '%President of the United States%'
        `,
    },
    {
        label: 'NYC municipal 2029',
        cycle: 2029,
        anchor_date: '2029-01-01',
        sql: `
            SELECT DISTINCT j.id
            FROM office o
            JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE o.district_identifier LIKE 'NYC-%'
        `,
    },
];

async function seed(client, { log = () => {} } = {}) {
    let total = 0;
    for (const g of GROUPS) {
        const { rows } = await client.query(g.sql);
        for (const r of rows) {
            await U.upsertElectionAnchor(client, {
                jurisdiction_id: r.id,
                election_cycle: g.cycle,
                anchor_type: 'general',
                anchor_date: g.anchor_date,
                source_url: SRC,
            });
        }
        total += rows.length;
        log(`  ${g.label}: ${rows.length} jurisdictions`);
    }
    log(`✓ future-cycle anchors upserted: ${total}`);
    return total;
}

module.exports = { seed };
