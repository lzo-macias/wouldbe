#!/usr/bin/env node
/*
 * DEV-ONLY: a TYPED debate mid-flight, so the conversation view has something in
 * it. Nothing else in the database is typed — `debates.format` defaults to
 * 'live' and every seeded debate predates the column — which is why the
 * responses pane renders nothing on any of them: it is gated on format, and
 * correctly so.
 *
 * WHAT IT PRODUCES
 *   · 8 contestants, 7 match prompts, one per bracket match
 *   · round 0 and round 1 RELEASED — prompts public, both answers published,
 *     comments and likes on them, and their votes auto-opened
 *   · round 2 (the final) OPEN — prompt public, answers sealed, one side in
 *   · debate_matches rows for the decided rounds so the bracket advances
 *
 * THE THREE ROUND STATES ARE ALL ON SCREEN AT ONCE, on purpose: released, open
 * and (nothing) pending is the one arrangement where you can see that sealing
 * works, that releasing works, and that the sidebar tells them apart.
 *
 * IDEMPOTENT, deterministic, own pg connection — same rules as devPastDebate.js.
 *
 *   npm run seed:typed-debate
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const MOCK_DOMAIN = 'typed.coolpeople.dev';
const PASSWORD = 'MockDebate!2026';
const TITLE = 'Should the city cap rent increases, or build its way out?';
const GRACE_HOURS = 24;

const PEOPLE = [
    ['Imogen',  'Vasquez',  'NY'],  // host
    ['Theo',    'Adeyemi',  'NY'],  // 1..8 contestants
    ['Nadia',   'Kaplan',   'NJ'],
    ['Soren',   'Lindqvist','NY'],
    ['Priya',   'Venkatesh','NY'],
    ['Cassius', 'Moreau',   'CT'],
    ['Leila',   'Haddad',   'NY'],
    ['Bo',      'Nakamura', 'NJ'],
    ['Marisol', 'Ferrer',   'NY'],
    ['Xu',      'Chen',     'NY'],  // 9..14 audience
    ['Frida',   'Olsen',    'NJ'],
    ['Amos',    'Whitfield','NY'],
    ['Petra',   'Novak',    'CT'],
    ['Kwame',   'Boateng',  'NY'],
    ['Ines',    'Duarte',   'NJ'],
];

const RUBRIC = [
    ['argument', 'Argument', 'How well the case was made — reasoning, structure, and whether it answered the question asked.', 0.300, 1],
    ['evidence', 'Evidence', 'Facts, sources and examples used to support the case, and whether they held up.', 0.250, 2],
    ['clarity',  'Clarity',  'How clearly and directly the position was communicated to the room.', 0.250, 3],
    ['conduct',  'Conduct',  "Engaging with the opponent's actual point, and debating in good faith.", 0.200, 4],
];

// One prompt per match, in slot order — the same order bracketSlots() returns.
const PROMPTS = [
    ['left',  0, 0, 'A cap holds rents down for whoever is already inside. What does it do for the person looking for a first apartment?'],
    ['left',  0, 1, 'Name the building that does not get built if you are right. Who was going to live in it?'],
    ['right', 0, 0, 'Supply takes a decade. What do you say to somebody being priced out this year?'],
    ['right', 0, 1, 'Which is the bigger problem here — the rent, or what people earn? Pick one and defend it.'],
    ['left',  1, 0, 'Your opponent just named a real cost of your position. Answer it without changing the subject.'],
    ['right', 1, 0, 'Point to a city that already tried your answer. What happened, including the parts that went badly?'],
    ['final', 2, 0, 'Last word. Make the case in the terms someone who disagrees with you would accept.'],
];

// Written answers, so the conversation pane has prose in it rather than lorem.
const ANSWERS = {
    'left:0:0': [
        "It does nothing for them directly, and pretending otherwise is how caps lose their credibility. What it does is stop the person already inside from becoming the person looking. Every household a cap keeps housed is one that is not competing for that first apartment next year, and in a market this tight the competition is the whole problem. Pair it with a build mandate or it is a one-generation policy.",
        "It prices them out, and the cap is the reason. Freeze the rent on the existing stock and you have told every owner of a vacant lot that the return on building is worse than the return on waiting. The first apartment gets built or it does not, and nobody has ever been housed by a rule about a building that was never started.",
    ],
    'left:0:1': [
        "The 200-unit infill on the avenue, and the people who were going to live in it are the ones who currently commute ninety minutes. I am not going to pretend that building does not exist. My answer is that it gets built anyway, because the cap I am arguing for exempts new construction for fifteen years — which is the only version of this policy worth defending.",
        "Nothing does not get built, because nothing was being built at this rate anyway. We approved four hundred units last year in a city of eight million. The cap is not what is stopping construction; a zoning code written in 1961 is. Blaming tenant protection for a supply failure is how the supply failure survives another decade.",
    ],
    'right:0:0': [
        "I say the truthful thing: supply will not save you this year. That is exactly why the emergency measure and the structural one are not alternatives. You cap now so the person has an apartment in ten years' time to still be living in, and you build now so their kid has one at all.",
        "I say move the money instead of the rule. A voucher lands in somebody's account this month; a cap takes a year to litigate and then applies to the units that already had the longest waiting lists. If the emergency is this year, use the instrument that works this year.",
    ],
    'right:0:1': [
        "Earnings, and it is not close. Rent is a symptom that rises to whatever a market can bear, and what it can bear is set by wages and by how many people are bidding. Fix the second and you have moved the rent without touching a lease.",
        "The rent, because it is the one you can act on this year. Wages are a national argument I cannot win from a city council seat. Anyone who tells you the answer is a labour market is telling you they intend to do nothing about your lease.",
    ],
    'left:1:0': [
        "The real cost is that a fifteen-year exemption is a promise a future council can break, and if developers price in that risk the building does not happen. I accept it. My answer is to put the exemption in the charter rather than in the code, which is the difference between a promise and a rule.",
        "The real cost of my position is that somebody gets evicted while we wait for a crane. I am not going to dress that up. What I will say is that the alternative has been tried in four cities and produced the same waiting list with less housing at the end of it.",
    ],
    'right:1:0': [
        "Vienna, and it worked — but the part everyone skips is that the city owns a quarter of the stock. The rule did not do it; sixty years of building did, and the rule protected what the building produced. If you want the outcome you have to want the whole policy.",
        "St Paul, 2021. Twenty per cent cap, and permits fell by eighty per cent within a year until they amended it. I bring up the failure rather than a success because the amendment is the interesting part: what worked was the version with the new-construction exemption, which is the version I am arguing for.",
    ],
};

const COMMENTS = [
    ["This is the first answer in the whole debate that named a building.", []],
    ["The charter-versus-code point is the actual crux and everyone else keeps talking past it.",
     ["Agreed — though a charter amendment is a two-year fight.",
      "Two years is faster than the last rezoning.",
      "Depends entirely on who is on the council by then.",
      "Still the strongest thing said today."]],
    ["Naming St Paul rather than a success story earned my vote.", ["Same. Nobody argues against themselves any more."]],
];

const slug = (f, l) => `${f}.${l}`.toLowerCase();
const emailFor = (f, l) => `${slug(f, l)}@${MOCK_DOMAIN}`;
const dobFor = (i) => `19${84 + (i % 14)}-0${(i % 9) + 1}-1${i % 9}`;
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
    const { rows } = await c.query('SELECT id FROM debates WHERE title = $1', [TITLE]);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
        await c.query(`DELETE FROM comments WHERE response_id IN
            (SELECT id FROM match_responses WHERE debate_id = ANY($1))`, [ids]);
        await c.query(`DELETE FROM match_responses WHERE debate_id = ANY($1)`, [ids]);
        await c.query(`DELETE FROM debate_match_vote_scores WHERE vote_id IN
            (SELECT vote_id FROM debate_match_votes WHERE debate_id = ANY($1))`, [ids]);
        for (const t of ['debate_match_votes', 'debate_matches', 'debate_results',
                         'debate_judging_criteria', 'prompts', 'nominations',
                         'contestants', 'debate_streams', 'debate_nomination_invites']) {
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
            console.log(`· cleared previous typed-debate data (${gone.debates} debate(s), ${gone.users} user(s))`);
        }

        // ---- people ---------------------------------------------------------
        const hash = await bcrypt.hash(PASSWORD, 10);
        const users = [];
        for (let i = 0; i < PEOPLE.length; i++) {
            const [first, last, state] = PEOPLE[i];
            const dob = dobFor(i);
            const { rows } = await c.query(
                `INSERT INTO users (first_name, last_name, username, date_of_birth, password,
                                    email, state, city, political_lean, bio, profile_photo_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING id, first_name, last_name, username, state`,
                [first, last, slug(first, last), dob, hash, emailFor(first, last), state,
                 'Brooklyn', (i % 10) + 1,
                 `Mock account for local development. ${first} is arguing about housing in writing.`,
                 FACES[i % FACES.length]]
            );
            users.push({ ...rows[0], age: ageFrom(dob) });
        }
        const host = users[0];
        const field = users.slice(1, 9);
        const audience = users.slice(9);

        const { rows: sp } = await c.query(
            `INSERT INTO sponsors (user_id, type, display_name, verified_at)
             VALUES ($1,'casual',$2,NOW()) RETURNING id, display_name`,
            [host.id, `${host.first_name} ${host.last_name}`]
        );
        const sponsor = sp[0];

        // ---- the debate -----------------------------------------------------
        // Started two grace periods ago, so rounds 0 and 1 are RELEASED and the
        // final is OPEN right now. That is the arrangement where all three
        // states are visible on one screen.
        const startedAt = new Date(Date.now() - 2 * GRACE_HOURS * 3600e3 - 3600e3);
        const { rows: dr } = await c.query(
            `INSERT INTO debates (
                sponsor_id, title, description, category, format,
                win_type, contribution_type, participation_type,
                prize_type, sponsor_contribution_cents,
                status, start_date, end_date, start_at, start_timezone,
                min_age_required, max_contestants, round_grace_hours, scoring_methodology
             ) VALUES ($1,$2,$3,'Politics','typed',
                'general_vote','closed','open',
                'cash',180000,
                'live',$4,$5,$6,'America/New_York',
                18,8,$7,$8)
             RETURNING id, title`,
            [sponsor.id, TITLE,
             'Eight people, seven matches, argued in writing. Each round opens for a day; both answers publish together when it closes.',
             isoDate(startedAt), isoDate(new Date(Date.now() + 864e5)), startedAt, GRACE_HOURS,
             'Head-to-head bracket, answered in writing. The room scores both answers on the published criteria.']
        );
        const debate = dr[0];

        for (const [key, name, desc, weight, order] of RUBRIC) {
            await c.query(
                `INSERT INTO debate_judging_criteria (debate_id, criterion_key, display_name, description, weight, display_order)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [debate.id, key, name, desc, weight, order]
            );
        }

        // ---- contestants (joined_at DESC IS the bracket seeding) -------------
        for (let i = 0; i < field.length; i++) {
            await c.query(
                `INSERT INTO contestants (debate_id, user_id, state_at_entry, city_at_entry, age_at_entry, status, joined_at)
                 VALUES ($1,$2,$3,'Brooklyn',$4,'active', NOW() - ($5 || ' minutes')::interval)`,
                [debate.id, field[i].id, field[i].state, field[i].age, String((field.length - i) * 7)]
            );
        }
        const { rows: seats } = await c.query(
            `SELECT c.id, c.user_id, u.first_name FROM contestants c JOIN users u ON u.id=c.user_id
             WHERE c.debate_id=$1 ORDER BY c.joined_at DESC`, [debate.id]
        );

        // nominations, so the other tab is not empty
        for (let i = 0; i < field.length; i++) {
            for (let k = 1; k <= (i % 4) + 1; k++) {
                await c.query(
                    `INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
                     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
                    [debate.id, audience[(i + k) % audience.length].id, field[i].id]
                );
            }
        }

        // ---- prompts, with the round clock written on them -------------------
        const promptIds = {};
        for (let i = 0; i < PROMPTS.length; i++) {
            const [side, round, position, body] = PROMPTS[i];
            const opens = new Date(startedAt.getTime() + round * GRACE_HOURS * 3600e3);
            const closes = new Date(startedAt.getTime() + (round + 1) * GRACE_HOURS * 3600e3);
            const { rows } = await c.query(
                `INSERT INTO prompts (debate_id, prompt_order, prompt_type, body,
                                      bracket_round, bracket_side, bracket_position,
                                      release_at, response_deadline)
                 VALUES ($1,$2,'response',$3,$4,$5,$6,$7,$8) RETURNING id`,
                [debate.id, i + 1, body, round, side, position, opens, closes]
            );
            promptIds[`${side}:${round}:${position}`] = rows[0].id;
        }

        // ---- the bracket: rounds 0 and 1 played ------------------------------
        const left = seats.slice(0, 4), right = seats.slice(4);
        const pairs = {
            'left:0:0': [left[0], left[1]],
            'left:0:1': [left[2], left[3]],
            'right:0:0': [right[0], right[1]],
            'right:0:1': [right[2], right[3]],
        };
        // Winners: the first-named of each pair, then the left/right winners meet.
        const w = {
            'left:0:0': left[0], 'left:0:1': left[2],
            'right:0:0': right[0], 'right:0:1': right[2],
        };
        pairs['left:1:0'] = [w['left:0:0'], w['left:0:1']];
        pairs['right:1:0'] = [w['right:0:0'], w['right:0:1']];
        w['left:1:0'] = w['left:0:0'];
        w['right:1:0'] = w['right:0:0'];
        pairs['final:2:0'] = [w['left:1:0'], w['right:1:0']];

        // WHO IS DECIDED, AND WHO IS STILL BEING VOTED ON.
        //
        // Round 0 is closed with winners — it has to be, or round 1 would have no
        // pairings. Round 1 is RELEASED BUT STILL OPEN: both answers are public
        // and the room is voting, which is the state the vote panel exists to
        // show. Seeding every played round as already-decided (what this did
        // first) left nothing votable anywhere, because ensureTypedMatchVote
        // will not reopen a closed match — correctly, a decided match is over.
        //
        // The FINAL gets no match row at all: its pairing is not knowable until
        // the semifinal votes close, and inventing one would put two people in a
        // match the bracket has not sent them to.
        for (const [key, [a, b]] of Object.entries(pairs)) {
            if (key === 'final:2:0') continue;
            const [side, round, position] = key.split(':');
            const decided = Number(round) === 0;
            await c.query(
                `INSERT INTO debate_matches (debate_id, round, side, position,
                        contestant_a_id, contestant_b_id, voting_state, opened_at,
                        closed_at, winner_contestant_id, auto_opened)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,true)
                 ON CONFLICT DO NOTHING`,
                [debate.id, Number(round), side, Number(position), a.id, b.id,
                 decided ? 'closed' : 'open', decided ? new Date() : null,
                 decided ? w[key].id : null]
            );
        }

        // ---- answers ---------------------------------------------------------
        let answers = 0;
        const responseByKey = {};
        for (const [key, bodies] of Object.entries(ANSWERS)) {
            const pair = pairs[key];
            if (!pair) continue;
            responseByKey[key] = [];
            for (let i = 0; i < pair.length; i++) {
                const { rows } = await c.query(
                    `INSERT INTO match_responses (debate_id, prompt_id, contestant_id, user_id, body, submitted_at)
                     VALUES ($1,$2,$3,$4,$5, NOW() - ($6 || ' hours')::interval)
                     RETURNING id`,
                    [debate.id, promptIds[key], pair[i].id, pair[i].user_id, bodies[i], String(30 - answers)]
                );
                await c.query(`INSERT INTO response_engagement (response_id) VALUES ($1) ON CONFLICT DO NOTHING`,
                    [rows[0].id]);
                responseByKey[key].push(rows[0].id);
                answers++;
            }
        }

        // The final's window is open and its prompt is public, but nobody has
        // filed: the two people who will argue it are still being decided one
        // round below. "0 of 2 in — sealed" is exactly what that looks like.

        // ---- comments and likes on the released answers ----------------------
        let comments = 0, likes = 0;
        const targets = ['left:0:0', 'left:1:0', 'right:1:0'];
        for (let t = 0; t < targets.length; t++) {
            const rid = responseByKey[targets[t]]?.[t % 2];
            if (!rid) continue;
            const [body, replies] = COMMENTS[t];
            const { rows: parent } = await c.query(
                `INSERT INTO comments (response_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id`,
                [rid, audience[t % audience.length].id, body]
            );
            comments++;
            for (let r = 0; r < replies.length; r++) {
                await c.query(
                    `INSERT INTO comments (response_id, author_user_id, parent_comment_id, body)
                     VALUES ($1,$2,$3,$4)`,
                    [rid, audience[(t + r + 1) % audience.length].id, parent[0].id, replies[r]]
                );
                comments++;
            }
            for (let l = 0; l <= t + 1; l++) {
                await c.query(`INSERT INTO response_likes (response_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                    [rid, audience[l % audience.length].id]);
                likes++;
            }
            await c.query(
                `UPDATE response_engagement SET
                    comment_count = (SELECT COUNT(*) FROM comments WHERE response_id=$1 AND removed_at IS NULL),
                    like_count    = (SELECT COUNT(*) FROM response_likes WHERE response_id=$1),
                    profile_click_count = $2
                 WHERE response_id=$1`,
                [rid, t + 1]
            );
        }

        console.log('\n✓ one typed debate, mid-flight\n');
        console.log(`  ${debate.title}`);
        console.log(`    format       typed   grace ${GRACE_HOURS}h per round`);
        console.log(`    rounds       0 decided · 1 released, VOTES OPEN · 2 (final) open, unanswered`);
        console.log(`    prompts      ${PROMPTS.length}   answers ${answers}   comments ${comments}   likes ${likes}`);
        console.log(`    open         /debate/${debate.id}\n`);
        console.log(`  sign in: username ${slug(...PEOPLE[9].slice(0, 2))} | password ${PASSWORD}`);
        console.log(`  host:    ${sponsor.display_name} (login ${host.username})\n`);
    } finally {
        await c.end();
    }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
