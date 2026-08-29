#!/usr/bin/env node
/*
 * DEV-ONLY: a FOR-FUN debate — one question, no prize, open to everyone.
 *
 * WHY THIS EXISTS AS ITS OWN SEEDER. A for-fun debate is not a cheap version of
 * a prize debate; it is a different shape, and every one of those differences is
 * a rule the row itself enforces:
 *
 *   · typed and open        — a CHECK refuses is_for_fun on a live or
 *                             invite-only debate
 *   · no prize at all       — the prize-shape CHECK exempts it, and the home
 *                             grid renders a "For fun" tag instead of a plaque
 *   · the prompt IS the title — one question, stored once
 *   · likes decide it       — most-liked answer after a month takes a standing
 *                             arrow, and ANYONE who held the lead keeps one
 *
 * WHAT IT PRODUCES
 *   · one host + 6 answerers + 4 lurkers who do the liking
 *   · one released prompt, so every answer is public immediately and the
 *     leaderboard is populated the moment you open it
 *   · a deliberate like SPREAD, so the ordering is visibly not entry order
 *   · a DETHRONING already recorded: an early leader who was overtaken still
 *     holds their arrow, which is the rule most likely to be broken by a
 *     refactor and the hardest to notice by eye
 *
 * IDEMPOTENT, deterministic, own pg connection — same rules as
 * devTypedDebate.js, which this deliberately mirrors so the two can be read
 * side by side.
 *
 *   node server/seed/devForFunDebate.js
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const MOCK_DOMAIN = 'forfun.coolpeople.dev';
const PASSWORD = 'MockDebate!2026';

// THE PROMPT IS THE TITLE. Stored once, in `title`, and copied to the prompt row
// so everything that reads an answer's question still finds one — the two are
// written from this single constant so they cannot drift.
const QUESTION = 'What is the most overrated piece of advice people give?';

const PEOPLE = [
    ['Odette',  'Marchetti', 'NY'],   // 0 host
    ['Ravi',    'Sundaram',  'NY'],   // 1..6 answer
    ['June',    'Okonkwo',   'NJ'],
    ['Hal',     'Brennan',   'CT'],
    ['Sable',   'Reyes',     'NY'],
    ['Tomas',   'Iversen',   'NY'],
    ['Wren',    'Ashby',     'NJ'],
    ['Mika',    'Delacroix', 'NY'],   // 7..10 lurk and like
    ['Ozzy',    'Hartnett',  'CT'],
    ['Nell',    'Faraday',   'NY'],
    ['Basil',   'Toure',     'NJ'],
];

// [answerer index, likes, body]. The like counts are the whole point of the
// fixture: they are deliberately NOT in entry order, so a leaderboard that
// silently falls back to submitted_at is obvious on sight rather than plausible.
const ANSWERS = [
    [1, 31, `"Follow your passion." It is advice from people who already found theirs, given to people who have not, and it quietly implies that if you are unsure you are also somehow behind.

Most of the people I know who love their work grew into it. They got good at something first and the caring showed up afterwards.`],
    [2, 47, `"Everything happens for a reason."

I understand why people say it and I know it is meant kindly. But it asks somebody in the middle of the worst week of their life to go looking for the lesson in it, which is work, and they are already doing enough work.`],
    [3, 12, `"Be yourself." Fine advice if you happen to already be likeable. Nobody says it to the person who needs to hear the opposite.`],
    [4, 58, `"Don't go to bed angry."

Some arguments are just two tired people being worse at talking than they normally are. I have never once solved something at 1am that would not have solved itself by 9. Sleep is not avoidance.`],
    [5, 24, `"Money can't buy happiness" — said almost exclusively by people who have enough of it that they have stopped noticing what it is doing for them.

It cannot buy happiness. It buys the removal of about nine specific miseries, and that is not nothing.`],
    [6, 39, `"Just be confident." Confidence is downstream of competence and evidence. Telling somebody to skip to the feeling is how you get a person who is loudly wrong.`],
];

// THE CROWD. A like is a ROW — one per (response, user) — so the like counts
// above are capped by how many people exist to cast them. With only the named
// cast, every one of them liked every answer and all six tied at nine, which is
// the exact failure the spread was designed to make visible.
//
// So the crowd is generated, sized from the largest like count with a little
// headroom. They are named rather than numbered because they show up in the
// likers list on screen, and "Crowd 41" reads as a bug.
const CROWD_SIZE = Math.max(...ANSWERS.map((a) => a[1])) + 6;
const FIRSTS = ['Ada','Bo','Cleo','Dev','Etta','Finn','Gia','Hugo','Ivy','Jonas',
                'Kit','Lena','Milo','Nia','Otis','Pia','Quinn','Rosa','Silas','Tess',
                'Uma','Vik','Wren','Xio','Yuri','Zane'];
const LASTS  = ['Alvarez','Bennett','Cho','Dumas','Eze','Ferro','Grant','Hoang',
                'Imani','Jansen','Kaur','Lund','Mbeki','Novo','Ozturk','Pak',
                'Quiroga','Rossi','Sato','Traore','Ueda','Vega','Walsh','Xu','Yoon','Zima'];

const slug = (f, l) => `${f}.${l}`.toLowerCase();
const emailFor = (f, l) => `${slug(f, l)}@${MOCK_DOMAIN}`;
const dobFor = (i) => `19${86 + (i % 12)}-0${(i % 9) + 1}-1${i % 9}`;
// contestants carries an eligibility SNAPSHOT — the state and age a person had
// when they entered, kept so a later move or birthday cannot retroactively
// change whether their entry was valid. Both columns are NOT NULL, so a fixture
// has to compute them rather than leave them to a default.
const ageFrom = (dob) => {
    const [y, m, d] = dob.split('-').map(Number);
    const now = new Date();
    let age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
    return age;
};
const isoDate = (d) => d.toISOString().slice(0, 10);
const FACES = [
    '/StockImages/Candidate.png',
    '/StockImages/Candidatetwo.png',
    '/StockImages/candidatethree.png',
    '/StockImages/candidatefour.png',
];

async function wipe(c) {
    const { rows } = await c.query('SELECT id FROM debates WHERE title = $1', [QUESTION]);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
        await c.query(`DELETE FROM response_likes WHERE response_id IN
            (SELECT id FROM match_responses WHERE debate_id = ANY($1))`, [ids]);
        await c.query(`DELETE FROM response_engagement WHERE response_id IN
            (SELECT id FROM match_responses WHERE debate_id = ANY($1))`, [ids]);
        await c.query(`DELETE FROM comments WHERE response_id IN
            (SELECT id FROM match_responses WHERE debate_id = ANY($1))`, [ids]);
        await c.query('DELETE FROM user_trophies WHERE debate_id = ANY($1)', [ids]);
        await c.query('DELETE FROM match_responses WHERE debate_id = ANY($1)', [ids]);
        for (const t of ['debate_matches', 'debate_results', 'debate_judging_criteria',
                         'prompts', 'nominations', 'contestants', 'debate_streams']) {
            await c.query(`DELETE FROM ${t} WHERE debate_id = ANY($1)`, [ids]);
        }
        await c.query('DELETE FROM debates WHERE id = ANY($1)', [ids]);
    }
    await c.query(`DELETE FROM sponsors WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [`%@${MOCK_DOMAIN}`]);
    const { rowCount } = await c.query('DELETE FROM users WHERE email LIKE $1', [`%@${MOCK_DOMAIN}`]);
    return { debates: ids.length, users: rowCount };
}

(async () => {
    const c = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
    await c.connect();
    try {
        const gone = await wipe(c);
        if (gone.debates || gone.users) {
            console.log(`· cleared previous for-fun data (${gone.debates} debate(s), ${gone.users} user(s))`);
        }

        // ---- people ---------------------------------------------------------
        const hash = await bcrypt.hash(PASSWORD, 10);
        const users = [];
        for (let i = 0; i < PEOPLE.length; i++) {
            const [first, last, state] = PEOPLE[i];
            const { rows } = await c.query(
                `INSERT INTO users (first_name, last_name, username, date_of_birth, password,
                                    email, state, city, political_lean, bio, profile_photo_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING id, first_name, last_name, username, state, date_of_birth`,
                [first, last, slug(first, last), dobFor(i), hash, emailFor(first, last), state,
                 'Brooklyn', (i % 10) + 1,
                 `Mock account for local development. ${first} is here for the fun one.`,
                 FACES[i % FACES.length]]
            );
            users.push({ ...rows[0], age: ageFrom(dobFor(i)) });
        }
        const host = users[0];
        const answerers = users.slice(1, 7);

        // The crowd, generated. Same shape as everyone else — real rows, real
        // logins — because response_likes is a foreign key and a fake liker is
        // not a liker.
        const crowd = [];
        for (let i = 0; i < CROWD_SIZE; i++) {
            const first = FIRSTS[i % FIRSTS.length];
            const last = LASTS[(i * 7 + 3) % LASTS.length];
            const dob = dobFor(i + 11);
            const { rows } = await c.query(
                `INSERT INTO users (first_name, last_name, username, date_of_birth, password,
                                    email, state, city, political_lean, profile_photo_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'Brooklyn',$8,$9)
                 ON CONFLICT (username) DO NOTHING
                 RETURNING id, first_name, last_name, username`,
                [first, last, `${slug(first, last)}.${i}`, dob, hash,
                 `${slug(first, last)}.${i}@${MOCK_DOMAIN}`,
                 ['NY','NJ','CT'][i % 3], (i % 10) + 1, FACES[i % FACES.length]]
            );
            if (rows[0]) crowd.push(rows[0]);
        }
        const lurkers = [...users.slice(7), ...crowd];

        const { rows: sp } = await c.query(
            `INSERT INTO sponsors (user_id, type, display_name, verified_at)
             VALUES ($1,'casual',$2,NOW()) RETURNING id`,
            [host.id, `${host.first_name} ${host.last_name}`]
        );

        // ---- the debate -----------------------------------------------------
        // Started 8 days ago so the round is RELEASED — every answer is public
        // and the leaderboard is populated the moment you open it. Still inside
        // the 30-day window, so the arrows awarded below are "led at some point"
        // rather than final, which is the state worth being able to look at.
        //
        // NO PRIZE AT ALL: prize_type 'non_cash' with a description and zero
        // contribution is the shape the for-fun exemption in
        // debates_prize_shape_chk allows.
        const startedAt = new Date(Date.now() - 8 * 864e5);
        const deadline = new Date(Date.now() - 7 * 864e5);   // round closed a week ago
        const { rows: dr } = await c.query(
            `INSERT INTO debates (
                sponsor_id, title, description, category, format, is_for_fun,
                win_type, contribution_type, participation_type,
                prize_type, prize_description, sponsor_contribution_cents,
                status, start_date, end_date, start_at, start_timezone,
                min_age_required, max_contestants, round_grace_hours, vote_window_hours,
                approved_at, seeding_locked_at
             ) VALUES ($1,$2,$3,'Culture','typed',TRUE,
                'general_vote','closed','open',
                'non_cash','For fun — no prize.',0,
                'live',$4,$5,$6,'America/New_York',
                18,8,24,24,
                $7,$8)
             RETURNING id, title`,
            [sp[0].id, QUESTION,
             'One question, no prize, open to anyone. Most-liked answer after a month takes a standing arrow — and so does anyone who held the lead along the way.',
             isoDate(startedAt), isoDate(new Date(Date.now() + 22 * 864e5)),
             startedAt, new Date(startedAt.getTime() - 9 * 864e5), startedAt]
        );
        const debate = dr[0];

        // ---- the one prompt --------------------------------------------------
        // Slot 'final:0:0' rather than a first-round slot: a for-fun debate is
        // one question, not a bracket, and hanging it off the final is the
        // honest coordinate for "this is the whole thing".
        //
        // response_deadline is IN THE PAST, which is what publishes every answer.
        const { rows: pr } = await c.query(
            `INSERT INTO prompts (debate_id, prompt_type, body, prompt_order,
                                  bracket_round, bracket_side, bracket_position,
                                  release_at, response_deadline)
             VALUES ($1,'response',$2, 1, 0,'final',0, $3, $4)
             RETURNING id`,
            [debate.id, QUESTION, startedAt, deadline]
        );
        const promptId = pr[0].id;

        // ---- answers ---------------------------------------------------------
        // Everyone who answers becomes a contestant: for-fun entry is open, so
        // answering IS entering. No seeds — there is no bracket to seed into.
        const responses = [];
        for (const [personIdx, likes, body] of ANSWERS) {
            const u = answerers[personIdx - 1];
            const { rows: cr } = await c.query(
                `INSERT INTO contestants (debate_id, user_id, status, state_at_entry, age_at_entry)
                 VALUES ($1,$2,'active',$3,$4) RETURNING id`,
                [debate.id, u.id, u.state, u.age]
            );
            const submittedAt = new Date(startedAt.getTime() + personIdx * 3600e3);
            const { rows: rr } = await c.query(
                `INSERT INTO match_responses (debate_id, prompt_id, contestant_id, user_id, body, submitted_at)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [debate.id, promptId, cr[0].id, u.id, body, submittedAt]
            );
            responses.push({ id: rr[0].id, user: u, likes });
        }

        // ---- likes -----------------------------------------------------------
        // Real rows, not just a counter: response_likes is what "have I liked
        // this" reads, and a fixture that fakes the count leaves the heart
        // unfilled for every one of these people. Likers cycle through the
        // lurkers and the other answerers, skipping self-likes.
        const likers = [...lurkers, ...answerers];
        for (let n = 0; n < responses.length; n++) {
            const r = responses[n];
            let placed = 0;
            // Rotated per response, so the same first N people are not the
            // likers on everything — which would make every avatar row on the
            // page identical.
            for (let i = 0; i < likers.length && placed < r.likes; i++) {
                const liker = likers[(i + n * 5) % likers.length];
                if (liker.id === r.user.id) continue;
                const { rowCount } = await c.query(
                    `INSERT INTO response_likes (response_id, user_id) VALUES ($1,$2)
                     ON CONFLICT DO NOTHING`,
                    [r.id, liker.id]
                );
                placed += rowCount;
            }
            const { rows: cnt } = await c.query(
                `SELECT COUNT(*)::int AS n FROM response_likes WHERE response_id = $1`, [r.id]
            );
            await c.query(
                `INSERT INTO response_engagement (response_id, like_count)
                 VALUES ($1,$2)
                 ON CONFLICT (response_id) DO UPDATE SET like_count = EXCLUDED.like_count`,
                [r.id, cnt[0].n]
            );
            r.actual = cnt[0].n;
        }

        // ---- arrows ----------------------------------------------------------
        // THE DETHRONING RULE, made visible. The current leader gets an arrow —
        // and so does an EARLIER leader who has since been overtaken, because
        // the rule is "anyone who held the lead", not "whoever survives".
        //
        // Recorded here rather than left to the like path so the fixture shows
        // the finished state: an arrow held by somebody who is no longer top is
        // the thing a refactor breaks silently.
        const ranked = [...responses].sort((a, b) => b.actual - a.actual);
        const leader = ranked[0];
        const dethroned = ranked[1];
        for (const [who, note] of [
            [leader, 'Top answer'],
            [dethroned, 'Held the lead — later overtaken'],
        ]) {
            await c.query(
                `INSERT INTO user_trophies (user_id, kind, source, debate_id, response_id, note)
                 VALUES ($1,'for_fun_response','earned',$2,$3,$4)
                 ON CONFLICT (user_id, debate_id, kind) WHERE debate_id IS NOT NULL DO NOTHING`,
                [who.user.id, debate.id, who.id, `${note} on "${QUESTION}"`]
            );
        }

        // ---- report -----------------------------------------------------------
        console.log(`\n  ${debate.title}`);
        console.log(`  /debate/${debate.id}\n`);
        console.log('  likes  who                    arrow');
        for (const r of ranked) {
            const gets = r.id === leader.id || r.id === dethroned.id;
            console.log(
                `  ${String(r.actual).padStart(5)}  ${(r.user.first_name + ' ' + r.user.last_name).padEnd(22)} ${gets ? '✓' : ''}`
            );
        }
        console.log(`\n  sign in as any of them — username below, password ${PASSWORD}`);
        for (const u of users.slice(0, 7)) console.log(`    ${u.username}`);
        console.log('');
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await c.end();
    }
})();
