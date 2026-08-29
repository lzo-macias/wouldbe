#!/usr/bin/env node
/*
 * DEV-ONLY: two debates in the `live` state, fully populated, so the Ongoing
 * screen (the stream + tournament bracket) can be looked at without waiting for
 * a real debate to start.
 *
 * WHAT MAKES A DEBATE "ONGOING": nothing but `debates.status`. AnyDebate's
 * PHASE_BY_STATUS maps draft/open_entry -> screen 1, live/no_posting -> screen 2
 * (Ongoing), closed/cancelled -> screen 3. The clock is NOT consulted, so these
 * rows show the bracket the moment they exist, whatever their start_at says.
 *
 * TWO DEBATES ON PURPOSE, because the bracket has two genuinely different code
 * paths and one of them is where the bugs live:
 *
 *   8 contestants — a power of two. Every seat is filled, every match is real,
 *                   three clean rounds a side. The happy path.
 *   6 contestants — padded to 8, so two seats are EMPTY and two people walk
 *                   round 1 on a bye. That is the path where an "empty seat"
 *                   and an "undecided match" must NOT be confused; Ongoing.jsx
 *                   uses a Symbol for one and null for the other precisely
 *                   because conflating them promoted people for free.
 *
 * IDEMPOTENT: re-running wipes everything it made last time (matched on the
 * mock email domain and the two titles) and rebuilds it. Run it as often as you
 * like; it will never stack up duplicates.
 *
 * Own pg connection, like devUser.js — requiring server/DB/index.js would boot
 * Express and the cron scheduler as a side effect, which a seed has no business
 * doing.
 *
 *   node server/seed/devOngoingDebates.js
 *   npm run seed:debates
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

// Everything this script creates is tagged by this domain, which is what makes
// the wipe safe: it can never match a real account.
const MOCK_DOMAIN = 'mock.coolpeople.dev';
const PASSWORD = 'MockDebate!2026';

const DEBATE_A = 'Should City Council seats be term-limited to eight years?';
const DEBATE_B = 'Is ranked-choice voting worth the ballot complexity?';

// 15 people: 1 sponsor + 8 for debate A + 6 for debate B (no overlap, so the two
// brackets read as separate fields at a glance). Keep this count in sync with the
// slices below — one short and debate B silently loses a contestant, which shows
// up as an extra bye rather than as an error.
const PEOPLE = [
    ['Maya',    'Okonkwo',   'NY'], ['Daniel',  'Reyes',    'NY'],
    ['Priya',   'Raman',     'NJ'], ['Marcus',  'Bell',     'NY'],
    ['Sofia',   'Castellan', 'CT'], ['Aaron',   'Whitfield','NY'],
    ['Nina',    'Petrova',   'NJ'], ['Terrence','Boyd',     'NY'],
    ['Lucia',   'Moreno',    'NY'], ['Omar',    'Haddad',   'CT'],
    ['Grace',   'Lindqvist', 'NY'], ['Devon',   'Achebe',   'NJ'],
    ['Hannah',  'Sorkin',    'NY'], ['Isaac',   'Mbeki',    'NY'],
    ['Rosa',    'Delgado',   'NJ'],
];

const slug = (f, l) => `${f}.${l}`.toLowerCase();
const emailFor = (f, l) => `${slug(f, l)}@${MOCK_DOMAIN}`;

// DOBs are plain 'YYYY-MM-DD' STRINGS, never `new Date(...)`. date_of_birth is a
// DATE column, and binding a JS Date makes the driver send a timestamp that
// Postgres shifts by the connection's timezone — which silently lands people on
// the previous day and, near a birthday, off by a year in age_at_entry.
const dobFor = (i) => `19${88 + (i % 10)}-0${(i % 9) + 1}-1${i % 9}`;
const ageFrom = (dob) => {
    const [y, m, d] = dob.split('-').map(Number);
    const now = new Date();
    let age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
    return age;
};

async function wipe(c) {
    // Children first. Nothing here relies on ON DELETE CASCADE being configured
    // the way I hope it is — a seed that half-deletes is worse than one that
    // errors, because the leftovers are invisible until the next run collides.
    const { rows: debates } = await c.query(
        'SELECT id FROM debates WHERE title = ANY($1)', [[DEBATE_A, DEBATE_B]]
    );
    const debateIds = debates.map((d) => d.id);
    if (debateIds.length) {
        for (const t of ['nominations', 'contestants', 'debate_nomination_invites']) {
            await c.query(`DELETE FROM ${t} WHERE debate_id = ANY($1)`, [debateIds]);
        }
        await c.query('DELETE FROM debates WHERE id = ANY($1)', [debateIds]);
    }
    // sponsors before users: a sponsor row REFERENCES users, so deleting the
    // user first fails the FK rather than cascading.
    await c.query(
        `DELETE FROM sponsors WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [`%@${MOCK_DOMAIN}`]
    );
    const { rowCount } = await c.query(
        'DELETE FROM users WHERE email LIKE $1', [`%@${MOCK_DOMAIN}`]
    );
    return { debates: debateIds.length, users: rowCount };
}

async function makeUsers(c) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const made = [];
    for (let i = 0; i < PEOPLE.length; i++) {
        const [first, last, state] = PEOPLE[i];
        const dob = dobFor(i);
        const { rows } = await c.query(
            `INSERT INTO users (first_name, last_name, username, date_of_birth,
                                password, email, state, city, political_lean, bio)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id, first_name, last_name, username, state`,
            [
                first, last, slug(first, last), dob, hash, emailFor(first, last),
                state, 'Brooklyn',
                // smallint, NOT a label — it is a 1..10 scale. Spread across
                // the range so the mock field isn't ideologically identical.
                (i % 10) + 1,
                `Mock account for local development. ${first} argues in good faith and never about the seed script.`,
            ]
        );
        made.push({ ...rows[0], dob, age: ageFrom(dob) });
    }
    return made;
}

// debates.sponsor_id references sponsors(id), NOT users(id) — a sponsor is its
// own record with a display name, wrapping the user who owns it. One sponsor
// hosts both mock debates, which is also the realistic shape.
async function makeSponsor(c, user) {
    const { rows } = await c.query(
        `INSERT INTO sponsors (user_id, type, display_name, verified_at)
         VALUES ($1, 'casual', $2, NOW())
         RETURNING id, display_name`,
        [user.id, `${user.first_name} ${user.last_name}`]
    );
    return rows[0];
}

async function makeDebate(c, { title, sponsor, field, description }) {
    // Every NOT NULL and every CHECK the debates table carries, satisfied
    // explicitly rather than by hoping at a default:
    //   win_type          general_vote   (the bracket IS a vote)
    //   contribution_type closed         (nobody is contributing to a mock)
    //   prize_type cash   => sponsor_contribution_cents MUST be > 0
    //   prize_pool_cents  GENERATED from the contribution columns; never inserted
    //   max_contestants   >= 2 AND even
    //
    // start_date/end_date are DATE columns -> 'YYYY-MM-DD' strings, same trap as
    // date_of_birth above. start_at is timestamptz, so a real Date is correct there.
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const endsOn = new Date(today.getTime() + 7 * 864e5);

    const { rows } = await c.query(
        `INSERT INTO debates (
            sponsor_id, title, description, category,
            win_type, contribution_type, participation_type,
            prize_type, sponsor_contribution_cents,
            status, start_date, end_date, start_at, start_timezone,
            min_age_required, max_contestants, scoring_methodology
         ) VALUES (
            $1,$2,$3,$4,
            'general_vote','closed','open',
            'cash',$5,
            'live',$6,$7,$8,'America/New_York',
            18,$9,$10
         ) RETURNING id, title, status`,
        [
            sponsor.id, title, description, 'local_government',
            // prize_pool_cents is a GENERATED column
            // (sponsor_contribution + platform_top_up + user_contributions), so it
            // is never inserted — setting sponsor_contribution_cents IS setting the
            // pool. $2,500, comfortably under the 500000 ceiling that CHECK enforces.
            250000,
            iso(today), iso(endsOn),
            // Started an hour ago: it is live, and the countdown on any screen
            // that shows one reads as already begun rather than pending.
            new Date(today.getTime() - 3600e3),
            // even, >= 2, and >= the field so nobody is over the cap
            field.length % 2 === 0 ? field.length : field.length + 1,
            'Head-to-head bracket. The room votes each match; the winner advances.',
        ]
    );
    const debate = rows[0];

    // ---- nominations: a descending tally, so the board RANKS ------------
    // A flat two-each gave every contestant the same count, which made the
    // Nominations board a list in arbitrary order — useless for looking at the
    // thing it exists to show. Seed 0 gets the most and it falls away from there.
    //
    // Nominators are taken from the ring starting after the nominee, so nobody
    // nominates themselves (the API rejects it, and so would a CHECK) and no
    // (nominator, nominee) pair repeats — which is what UNIQUE on that pair wants.
    const TALLY = [5, 4, 4, 3, 2, 2, 1, 1];
    let nominations = 0;
    for (let j = 0; j < field.length; j++) {
        const want = Math.min(TALLY[j] ?? 1, field.length - 1);
        for (let k = 1; k <= want; k++) {
            const nominator = field[(j + k) % field.length];
            const r = await c.query(
                `INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
                 VALUES ($1,$2,$3)
                 ON CONFLICT DO NOTHING RETURNING id`,
                [debate.id, nominator.id, field[j].id]
            );
            nominations += r.rowCount;
        }
    }

    // ---- contestants: they all accepted and entered --------------------------
    // state_at_entry and age_at_entry are NOT NULL and are a SNAPSHOT — the
    // eligibility facts as they were at entry, which is why they are stored on
    // the row rather than joined from users at read time.
    //
    // joined_at is staggered because getDebateContestants orders by it DESC, and
    // that order is the bracket seeding. Identical timestamps would make the
    // seeding arbitrary and the bracket reshuffle between reads.
    for (let i = 0; i < field.length; i++) {
        const p = field[i];
        await c.query(
            `INSERT INTO contestants (debate_id, user_id, state_at_entry,
                                      city_at_entry, age_at_entry, status, joined_at)
             VALUES ($1,$2,$3,$4,$5,'active', NOW() - ($6 || ' minutes')::interval)`,
            [debate.id, p.id, p.state, 'Brooklyn', p.age, String((field.length - i) * 7)]
        );
    }

    return { debate, nominations, contestants: field.length };
}

(async () => {
    const c = new Client(
        process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}
    );
    await c.connect();
    try {
        const gone = await wipe(c);
        if (gone.debates || gone.users) {
            console.log(`· cleared previous mock data (${gone.debates} debate(s), ${gone.users} user(s))`);
        }

        const users = await makeUsers(c);
        const sponsorUser = users[0];
        const sponsor = await makeSponsor(c, sponsorUser);
        const fieldA = users.slice(1, 9);    // 8 — power of two, no byes
        const fieldB = users.slice(9, 15);   // 6 — padded to 8, two byes
        if (fieldA.length !== 8 || fieldB.length !== 6) {
            throw new Error(`field sizes wrong (${fieldA.length}/${fieldB.length}) — PEOPLE needs 15 entries`);
        }

        const a = await makeDebate(c, {
            title: DEBATE_A,
            description:
                'Eight years is two terms. Supporters say it breaks incumbency; opponents say it throws away institutional memory just as it becomes useful.',
            sponsor,
            field: fieldA,
        });
        const b = await makeDebate(c, {
            title: DEBATE_B,
            description:
                'RCV changes who wins and how campaigns behave. It also changes what a voter has to understand before they fill anything in.',
            sponsor,
            field: fieldB,
        });

        console.log('\n✓ two ongoing debates ready\n');
        for (const [r, note] of [[a, '8 contestants — full bracket, no byes'], [b, '6 contestants — 8-slot bracket, 2 byes']]) {
            console.log(`  ${r.debate.title}`);
            console.log(`    status      ${r.debate.status}  (-> Ongoing screen)`);
            console.log(`    ${note}`);
            console.log(`    nominations ${r.nominations}`);
            console.log(`    open        /debate/${r.debate.id}\n`);
        }
        console.log(`  sign in as any of them → username: ${slug(...PEOPLE[1].slice(0, 2))} | password: ${PASSWORD}`);
        console.log(`  sponsor: ${sponsor.display_name} (login ${sponsorUser.username})\n`);
    } finally {
        await c.end();
    }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
