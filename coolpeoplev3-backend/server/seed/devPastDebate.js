#!/usr/bin/env node
/*
 * DEV-ONLY: one FINISHED debate — a full bracket played out, every match voted
 * on, a champion crowned — so the Past screen can be looked at without spending
 * twenty minutes clicking through seven matches.
 *
 * WHAT IT PRODUCES
 *   · 8 contestants, a power of two, so every seat is real and there are no byes
 *   · 4 of them with an ACTIVE WouldBe campaign, because the nomination board
 *     renders those and an empty column proves nothing
 *   · 7 matches (4 + 2 + 1), all closed, all with per-criterion ballots behind
 *     them from 6 audience voters
 *   · a debate_results row: the champion, and the whole bracket frozen in
 *     final_calculation — the same shape crownBracketChampion writes
 *   · the debate closed, the champion promoted to 'winner', the losing finalist
 *     to 'runner_up'
 *
 * THE NOMINATION TALLY DISAGREES WITH THE POINTS ON PURPOSE. The most-nominated
 * person is NOT the winner: the board ranks by nominations until the first
 * ballot lands and by points after, and if both orders were identical you could
 * not tell whether that rule was working.
 *
 * DETERMINISTIC. No Math.random: the same run produces the same scores, so a
 * screenshot taken today matches one taken tomorrow and a rendering bug can't
 * hide behind "the numbers moved".
 *
 * IDEMPOTENT: re-running wipes everything it made last time (matched on its own
 * mock email domain and the debate title) and rebuilds it.
 *
 * Own pg connection, like devOngoingDebates.js — requiring server/DB/index.js
 * would boot Express and the cron scheduler as a side effect.
 *
 *   node server/seed/devPastDebate.js
 *   npm run seed:past-debate
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

// Its OWN domain, distinct from devOngoingDebates' mock.coolpeople.dev: the two
// seeds must be runnable in either order without one wiping the other's people.
const MOCK_DOMAIN = 'past.coolpeople.dev';
const PASSWORD = 'MockDebate!2026';

const TITLE = 'Should the city fund a year-round shelter system, or pay for hotel rooms?';

// 15: 1 sponsor + 8 contestants + 6 audience voters. Keep this in step with the
// slices in main() — one short and the last voter silently vanishes.
const PEOPLE = [
    ['Adaeze',  'Nwosu',     'NY'], // 0  sponsor / host
    ['Julian',  'Okafor',    'NY'], // 1..8 the field
    ['Beatriz', 'Salgado',   'NJ'],
    ['Wren',    'Castellano','NY'],
    ['Mikhail', 'Ivanov',    'CT'],
    ['Amara',   'Diallo',    'NY'],
    ['Ezra',    'Blumenthal','NJ'],
    ['Talia',   'Farrokh',   'NY'],
    ['Desmond', 'Achebe',    'NY'],
    ['Kenji',   'Watanabe',  'NY'], // 9..14 the audience
    ['Rosalind','Meyer',     'NJ'],
    ['Ibrahim', 'Toure',     'NY'],
    ['Clara',   'Nyberg',    'CT'],
    ['Malik',   'Robinson',  'NY'],
    ['Yuki',    'Tanaka',    'NJ'],
];

// The rubric this debate is scored on. MUST match DEFAULT_DEBATE_RUBRIC in
// server/DB/debate/debateCriteria.js — the seed writes it directly rather than
// calling that module, which would drag in the whole DB/Express boot.
const RUBRIC = [
    ['argument', 'Argument', 'How well the case was made — reasoning, structure, and whether it answered the question asked.', 0.300, 1],
    ['evidence', 'Evidence', 'Facts, sources and examples used to support the case, and whether they held up.', 0.250, 2],
    ['clarity',  'Clarity',  'How clearly and directly the position was communicated to the room.', 0.250, 3],
    ['conduct',  'Conduct',  'Engaging with the opponent\'s actual point, and debating in good faith.', 0.200, 4],
];

// Four of the eight are running for something. Titles are real-sounding local
// races, because "Test Campaign 1" tells you nothing about whether the column
// lays out at a realistic length.
const CAMPAIGNS = [
    ['Julian',  'Julian Okafor for City Council, District 35', 'Shelter beds before hotel vouchers. Thirty-five is where the waiting list is longest and the vacant buildings are emptiest.'],
    ['Amara',   'Amara Diallo for State Assembly, 57th',       'Housing, transit and the bus lanes that were promised in 2019 and still are not painted.'],
    ['Talia',   'Talia Farrokh for Public Advocate',           'The office is supposed to answer the phone when the city will not. Mine will.'],
    ['Desmond', 'Desmond Achebe for Comptroller',              'Every dollar the city spends on emergency hotel rooms is a dollar it did not spend on a permanent bed.'],
];

// Faces, so the host card and the board render the photo path rather than the
// initial-on-a-disc fallback. These are the stock images already in the
// frontend's /public — same-origin paths the dev server serves directly, which
// is the only kind of avatar URL a seed can produce without an upload.
const FACES = [
    '/StockImages/Candidate.png',
    '/StockImages/Candidatetwo.png',
    '/StockImages/candidatethree.png',
    '/StockImages/candidatefour.png',
];

const slug = (f, l) => `${f}.${l}`.toLowerCase();
const emailFor = (f, l) => `${slug(f, l)}@${MOCK_DOMAIN}`;

// DOBs are plain 'YYYY-MM-DD' STRINGS, never `new Date(...)`. date_of_birth is a
// DATE column, and binding a JS Date makes the driver send a timestamp Postgres
// shifts by the connection timezone — landing people on the previous day and,
// near a birthday, a year off in age_at_entry.
const dobFor = (i) => `19${86 + (i % 12)}-0${(i % 9) + 1}-1${i % 9}`;
const ageFrom = (dob) => {
    const [y, m, d] = dob.split('-').map(Number);
    const now = new Date();
    let age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
    return age;
};
const isoDate = (d) => d.toISOString().slice(0, 10);

// Deterministic 0..n-1 from two indices. Stands in for Math.random so scores
// vary between voters and matches but never between RUNS.
const jitter = (a, b, n) => ((a * 7 + b * 13 + a * b * 3) % n);

// ---------------------------------------------------------------------------

async function wipe(c) {
    const { rows: debates } = await c.query('SELECT id FROM debates WHERE title = $1', [TITLE]);
    const ids = debates.map((d) => d.id);
    if (ids.length) {
        // Children first, deepest first. debate_match_vote_scores -> votes ->
        // matches: the FKs cascade, but a seed that relies on someone else's
        // ON DELETE is a seed that breaks the day that changes.
        await c.query(
            `DELETE FROM debate_match_vote_scores WHERE vote_id IN
                (SELECT vote_id FROM debate_match_votes WHERE debate_id = ANY($1))`, [ids]
        );
        for (const t of [
            'debate_match_votes', 'debate_matches', 'debate_results',
            'debate_judging_criteria', 'nominations', 'contestants',
            'debate_nomination_invites',
        ]) {
            await c.query(`DELETE FROM ${t} WHERE debate_id = ANY($1)`, [ids]);
        }
        await c.query('DELETE FROM debates WHERE id = ANY($1)', [ids]);
    }
    await c.query(
        `DELETE FROM wouldbe WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [`%@${MOCK_DOMAIN}`]
    );
    // sponsors before users: a sponsor row REFERENCES users.
    await c.query(
        `DELETE FROM sponsors WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [`%@${MOCK_DOMAIN}`]
    );
    const { rowCount } = await c.query('DELETE FROM users WHERE email LIKE $1', [`%@${MOCK_DOMAIN}`]);
    return { debates: ids.length, users: rowCount };
}

async function makeUsers(c) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const made = [];
    for (let i = 0; i < PEOPLE.length; i++) {
        const [first, last, state] = PEOPLE[i];
        const dob = dobFor(i);
        const { rows } = await c.query(
            `INSERT INTO users (first_name, last_name, username, date_of_birth,
                                password, email, state, city, political_lean, bio,
                                profile_photo_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id, first_name, last_name, username, state, profile_photo_url`,
            [
                first, last, slug(first, last), dob, hash, emailFor(first, last),
                state, 'Brooklyn',
                (i % 10) + 1,
                `Mock account for local development. ${first} was in the room for a debate that has already finished.`,
                FACES[i % FACES.length],
            ]
        );
        made.push({ ...rows[0], dob, age: ageFrom(dob) });
    }
    return made;
}

async function makeCampaigns(c, field) {
    const byFirst = new Map(field.map((p) => [p.first_name, p]));
    const deadline = isoDate(new Date(Date.now() + 120 * 864e5));
    const made = [];
    for (const [first, title, description] of CAMPAIGNS) {
        const owner = byFirst.get(first);
        if (!owner) continue;
        const { rows } = await c.query(
            // launch_status 'active' + retired false is exactly what
            // getDebateNominationCounts filters on — a draft would not show on
            // the board, which is the whole thing being demonstrated here.
            // goal_cents has a CHECK: $50,000 minimum.
            `INSERT INTO wouldbe (title, description, user_id, goal_cents, deadline,
                                  launch_status, entry_path, creation_fee_paid_at)
             VALUES ($1,$2,$3,$4,$5,'active','self_start',NOW())
             RETURNING id, title`,
            [title, description, owner.id, 5_000_00 * 100, deadline]
        );
        made.push({ ...rows[0], owner });
    }
    return made;
}

async function makeDebate(c, sponsor) {
    const now = new Date();
    const started = new Date(now.getTime() - 6 * 864e5);   // ran six days ago
    const { rows } = await c.query(
        `INSERT INTO debates (
            sponsor_id, title, description, category,
            win_type, contribution_type, participation_type,
            prize_type, sponsor_contribution_cents,
            status, start_date, end_date, start_at, start_timezone,
            min_age_required, max_contestants, scoring_methodology,
            results_announce_at
         ) VALUES (
            $1,$2,$3,'local_government',
            'general_vote','closed','open',
            'cash',$4,
            'closed',$5,$6,$7,'America/New_York',
            18,8,$8,
            NOW()
         ) RETURNING id, title, status`,
        [
            sponsor.id,
            TITLE,
            'One line item, two philosophies. The room scored every head-to-head on the published rubric and the bracket did the rest.',
            250000,
            isoDate(started), isoDate(new Date(now.getTime() - 5 * 864e5)),
            started,
            'Head-to-head bracket. The room scored both contestants 1–5 on every criterion; the winner of each match advanced.',
        ]
    );
    const debate = rows[0];

    for (const [key, name, desc, weight, order] of RUBRIC) {
        await c.query(
            `INSERT INTO debate_judging_criteria
                (debate_id, criterion_key, display_name, description, weight, display_order)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [debate.id, key, name, desc, weight, order]
        );
    }
    const { rows: criteria } = await c.query(
        `SELECT criterion_id, criterion_key, weight FROM debate_judging_criteria
         WHERE debate_id = $1 ORDER BY display_order`,
        [debate.id]
    );
    return { debate, criteria };
}

// Nominations, tallied so the MOST-NOMINATED person is not the eventual winner.
// TALLY is indexed by position in `field`, and the champion is seeded to be
// beaten on nominations by the runner-up — that gap is what makes the board's
// switch from nomination order to points order visible.
async function makeNominations(c, debate, field, audience) {
    const TALLY = [3, 6, 2, 4, 5, 2, 3, 1];
    const pool = [...field, ...audience];
    let made = 0;
    for (let j = 0; j < field.length; j++) {
        const want = Math.min(TALLY[j] ?? 1, pool.length - 1);
        for (let k = 1; k <= want; k++) {
            // Nominators taken from the ring after the nominee, so nobody
            // nominates themselves and no (nominator, nominee) pair repeats.
            const nominator = pool[(j + k) % pool.length];
            if (nominator.id === field[j].id) continue;
            const r = await c.query(
                `INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
                 VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
                [debate.id, nominator.id, field[j].id]
            );
            made += r.rowCount;
        }
    }
    return made;
}

async function makeContestants(c, debate, field) {
    for (let i = 0; i < field.length; i++) {
        const p = field[i];
        await c.query(
            `INSERT INTO contestants (debate_id, user_id, state_at_entry,
                                      city_at_entry, age_at_entry, status, joined_at)
             VALUES ($1,$2,$3,$4,$5,'active', NOW() - ($6 || ' minutes')::interval)`,
            [debate.id, p.id, p.state, 'Brooklyn', p.age, String((field.length - i) * 7)]
        );
    }
    // Read the seating back rather than assuming it: getDebateContestants orders
    // by joined_at DESC and THAT order is the bracket seeding. Deriving it here
    // from the same query the API uses is what keeps the seeded matches on the
    // same slots the frontend will draw.
    const { rows } = await c.query(
        `SELECT c.id, c.user_id, u.first_name
         FROM contestants c JOIN users u ON u.id = c.user_id
         WHERE c.debate_id = $1 AND c.withdrew_at IS NULL AND c.status <> 'disqualified'
         ORDER BY c.joined_at DESC`,
        [debate.id]
    );
    return rows;
}

// One match: the row, then a ballot from every audience voter, then the close.
//
// Ballots are NOT unanimous. Two voters per match are seeded to score it the
// other way, so the tally reads like a room rather than a switch, and the
// "N–M" on the results panel has something to show.
async function playMatch(c, ctx, { round, side, position, a, b, winner, matchIndex }) {
    const { debate, criteria, audience } = ctx;
    const loser = winner.id === a.id ? b : a;

    const { rows: mrows } = await c.query(
        `INSERT INTO debate_matches
            (debate_id, round, side, position, contestant_a_id, contestant_b_id,
             voting_state, opened_at, opened_by_user_id, closed_at, winner_contestant_id)
         VALUES ($1,$2,$3,$4,$5,$6,'closed',
                 NOW() - ($7 || ' minutes')::interval, $8,
                 NOW() - ($9 || ' minutes')::interval, $10)
         RETURNING id`,
        [
            debate.id, round, side, position, a.id, b.id,
            String(240 - matchIndex * 25), ctx.hostUserId,
            String(230 - matchIndex * 25), winner.id,
        ]
    );
    const matchId = mrows[0].id;

    const NOTES = [
        'Answered the cost question straight instead of talking around it.',
        'The hotel-voucher numbers were the only real evidence anyone brought.',
        'Both good, but only one of them engaged with the other\'s actual point.',
        null,
        null,
        'Close. Could have gone either way for me.',
    ];

    let tally = { [a.id]: 0, [b.id]: 0 };
    for (let v = 0; v < audience.length; v++) {
        // Two dissenters per match, chosen deterministically.
        const dissents = (v + matchIndex) % 3 === 0 && v > 0;
        const favoured = dissents ? loser : winner;
        const other = favoured.id === a.id ? b : a;

        const scores = [];
        let favTotal = 0;
        let othTotal = 0;
        for (let ci = 0; ci < criteria.length; ci++) {
            const crit = criteria[ci];
            const hi = 4 + (jitter(v, ci + matchIndex, 2));       // 4 or 5
            const lo = 2 + (jitter(v + 1, ci + matchIndex, 2));   // 2 or 3
            scores.push([favoured.id, crit.criterion_id, hi]);
            scores.push([other.id, crit.criterion_id, lo]);
            favTotal += Number(crit.weight) * hi;
            othTotal += Number(crit.weight) * lo;
        }

        // contestant_id is the winner the SCORES imply — the same rule
        // castMatchVote applies server-side. Seeding it any other way would put
        // rows in the table the API could never have produced.
        const implied = favTotal === othTotal ? null : favTotal > othTotal ? favoured.id : other.id;
        if (implied) tally[implied] += 1;

        const { rows: vrows } = await c.query(
            `INSERT INTO debate_match_votes
                (match_id, debate_id, voter_user_id, contestant_id, comment,
                 acknowledged_criteria, acknowledged_at, created_at)
             VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW() - ($6 || ' minutes')::interval)
             RETURNING vote_id`,
            [matchId, debate.id, audience[v].id, implied, NOTES[v] ?? null,
             String(235 - matchIndex * 25)]
        );
        const voteId = vrows[0].vote_id;

        await c.query(
            `INSERT INTO debate_match_vote_scores (vote_id, contestant_id, criterion_id, score)
             SELECT $1, cc, kk, ss
             FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS t(cc, kk, ss)`,
            [voteId, scores.map((s) => s[0]), scores.map((s) => s[1]), scores.map((s) => s[2])]
        );
    }
    return { matchId, tally, winner, loser };
}

async function crown(c, ctx, finalMatch) {
    const { debate } = ctx;
    const { rows: matches } = await c.query(
        `SELECT id, round, side, position, contestant_a_id, contestant_b_id,
                winner_contestant_id, decided_by_host, closed_at
         FROM debate_matches WHERE debate_id = $1 ORDER BY round, side, position`,
        [debate.id]
    );
    const { rows: counts } = await c.query(
        `SELECT match_id, contestant_id, COUNT(*)::int AS votes,
                COALESCE(SUM(weight),0)::float AS weighted_votes
         FROM debate_match_votes WHERE debate_id = $1 AND invalidated_at IS NULL
         GROUP BY match_id, contestant_id`,
        [debate.id]
    );
    const byMatch = {};
    for (const r of counts) (byMatch[r.match_id] ||= []).push({
        contestant_id: r.contestant_id, votes: r.votes, weighted_votes: r.weighted_votes,
    });

    // Identical in shape to what crownBracketChampion writes, so the Past screen
    // reads a seeded debate and a real one through exactly the same fields.
    const final_calculation = {
        method: 'bracket',
        champion_contestant_id: finalMatch.winner.id,
        runner_up_contestant_id: finalMatch.loser.id,
        final_decided_by_host: false,
        matches: matches.map((m) => ({
            round: m.round, side: m.side, position: m.position,
            contestant_a_id: m.contestant_a_id, contestant_b_id: m.contestant_b_id,
            winner_contestant_id: m.winner_contestant_id,
            decided_by_host: m.decided_by_host, closed_at: m.closed_at,
            tally: byMatch[m.id] || [],
        })),
    };

    await c.query(
        `INSERT INTO debate_results
            (debate_id, winner_contestant_id, result_type, crowd_score_data,
             final_calculation, locked_at, announced_at, dispute_window_ends_at, notes)
         VALUES ($1,$2,'general_vote',$3,$4,
                 NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days',
                 NOW() + INTERVAL '2 days', $5)`,
        [
            debate.id, finalMatch.winner.id,
            JSON.stringify({ per_match: byMatch }),
            JSON.stringify(final_calculation),
            'Winner of the head-to-head bracket.',
        ]
    );

    await c.query(`UPDATE contestants SET status='winner' WHERE id = $1`, [finalMatch.winner.id]);
    await c.query(`UPDATE contestants SET status='runner_up' WHERE id = $1`, [finalMatch.loser.id]);
}

// ---------------------------------------------------------------------------

(async () => {
    const c = new Client(
        process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}
    );
    await c.connect();
    try {
        const gone = await wipe(c);
        if (gone.debates || gone.users) {
            console.log(`· cleared previous past-debate data (${gone.debates} debate(s), ${gone.users} user(s))`);
        }

        const users = await makeUsers(c);
        const hostUser = users[0];
        const field = users.slice(1, 9);
        const audience = users.slice(9, 15);
        if (field.length !== 8 || audience.length !== 6) {
            throw new Error(`field/audience sizes wrong — PEOPLE needs 15 entries`);
        }

        const { rows: srows } = await c.query(
            `INSERT INTO sponsors (user_id, type, display_name, verified_at)
             VALUES ($1,'casual',$2,NOW()) RETURNING id, display_name`,
            [hostUser.id, `${hostUser.first_name} ${hostUser.last_name}`]
        );
        const sponsor = srows[0];

        const campaigns = await makeCampaigns(c, field);
        const { debate, criteria } = await makeDebate(c, sponsor);
        const nominations = await makeNominations(c, debate, field, audience);
        const seats = await makeContestants(c, debate, field);

        const ctx = { debate, criteria, audience, hostUserId: hostUser.id };
        const left = seats.slice(0, 4);
        const right = seats.slice(4);

        // The bracket, in the order it was played. Winners are chosen by hand so
        // the champion is a specific person and the story is stable across runs.
        let i = 0;
        const l0 = await playMatch(c, ctx, { round: 0, side: 'left',  position: 0, a: left[0],  b: left[1],  winner: left[0],  matchIndex: i++ });
        const l1 = await playMatch(c, ctx, { round: 0, side: 'left',  position: 1, a: left[2],  b: left[3],  winner: left[3],  matchIndex: i++ });
        const r0 = await playMatch(c, ctx, { round: 0, side: 'right', position: 0, a: right[0], b: right[1], winner: right[1], matchIndex: i++ });
        const r1 = await playMatch(c, ctx, { round: 0, side: 'right', position: 1, a: right[2], b: right[3], winner: right[2], matchIndex: i++ });

        const lf = await playMatch(c, ctx, { round: 1, side: 'left',  position: 0, a: l0.winner, b: l1.winner, winner: l0.winner, matchIndex: i++ });
        const rf = await playMatch(c, ctx, { round: 1, side: 'right', position: 0, a: r0.winner, b: r1.winner, winner: r1.winner, matchIndex: i++ });

        const fin = await playMatch(c, ctx, { round: 2, side: 'final', position: 0, a: lf.winner, b: rf.winner, winner: lf.winner, matchIndex: i++ });

        await crown(c, ctx, fin);

        // ---- report -----------------------------------------------------------
        const { rows: board } = await c.query(
            `SELECT u.first_name,
                    (SELECT COUNT(DISTINCT n.nominator_user_id) FROM nominations n
                      WHERE n.debate_id = $1 AND n.nominee_user_id = c.user_id)::int AS noms,
                    (SELECT COALESCE(SUM(s.score),0) FROM debate_match_vote_scores s
                       JOIN debate_match_votes v ON v.vote_id = s.vote_id
                      WHERE s.contestant_id = c.id)::int AS points,
                    c.status
             FROM contestants c JOIN users u ON u.id = c.user_id
             WHERE c.debate_id = $1
             ORDER BY points DESC`,
            [debate.id]
        );

        console.log('\n✓ one past debate ready\n');
        console.log(`  ${debate.title}`);
        console.log(`    status       ${debate.status}  (-> Past screen)`);
        console.log(`    champion     ${fin.winner.first_name}  (runner-up ${fin.loser.first_name})`);
        console.log(`    matches      7, all closed, ${audience.length} ballots each`);
        console.log(`    nominations  ${nominations}`);
        console.log(`    campaigns    ${campaigns.length} active wouldbes on the board`);
        console.log(`    open         /debate/${debate.id}\n`);
        console.log('    board — points order vs nomination order:');
        for (const r of board) {
            const tag = r.status === 'winner' ? ' ← winner' : r.status === 'runner_up' ? ' ← runner-up' : '';
            console.log(`      ${String(r.points).padStart(4)} pts   ${String(r.noms).padStart(2)} noms   ${r.first_name}${tag}`);
        }
        console.log(`\n  sign in as anyone: username ${slug(...PEOPLE[1].slice(0, 2))} | password ${PASSWORD}`);
        console.log(`  host: ${sponsor.display_name} (login ${hostUser.username})\n`);
    } finally {
        await c.end();
    }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
