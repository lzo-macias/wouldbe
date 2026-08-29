const { client } = require("../index.js");
const { slotKey } = require("./bracketSlots");
const { roundStateOf } = require("./matchResponses");
const { ensureDebateCriteria } = require("./debateCriteria");

// ============================================================================
// A typed debate, read as a message app.
//
// Every match is a CONVERSATION: the prompt is its subject, and the two answers
// are the two messages in it. That is not a metaphor imposed on the data — it is
// what the data already is, which is why this file is a pair of reads and not a
// new set of tables.
//
// listConversations feeds the sidebar (who is in it, what it is about, is it
// still sealed). getMatchThread — already in matchResponses.js — feeds the pane.
//
// VOTES OPEN THEMSELVES HERE. In a live debate a host puts one match to the room
// at a time; a typed debate has no host in the room, and by the time you are
// reading round 3 the first two rounds have been public for days. So the release
// of the answers IS the opening of the vote, and every released match is votable
// at once. ensureTypedMatchVote is what makes that true, and auto_opened is what
// keeps the live one-at-a-time rule from being broken by it.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// WHEN VOTING ON A TYPED MATCH CLOSES.
//
// Derived, not stored: one VOTE WINDOW after the answers were released. That
// instant is also when the next round opens, which is what makes it the last
// moment the winner can be unknown without holding up the bracket.
//
// It used to be one GRACE period — the same window the contestants had to
// write — which put the vote's close at the same instant the NEXT round's
// answers were due, so round N+1's contestants learned they were in it as their
// deadline passed. debates.vote_window_hours is its own column now, and
// scheduleTypedRounds pitches rounds by write + read so the two agree.
//
// Deriving it means it cannot drift from the schedule the way a second column
// would, and a debate whose windows are edited moves every deadline with it.
const voteWindowEnd = (prompt, vote_window_hours) => {
    if (!prompt?.response_deadline) return null;
    return new Date(
        new Date(prompt.response_deadline).getTime() + Number(vote_window_hours || 0) * 3600e3
    ).toISOString();
};

// The host, or — for a debate a panel decides — the judges. The sidebar shows
// one or the other next to the two contestants, because who is standing over a
// match changes what the room is looking at.
const _authorityFor = async (debate_id, db = client) => {
    const { rows } = await db.query(
        `SELECT d.win_type,
                s.display_name AS host_name,
                COALESCE(s.logo_url, u.profile_photo_url) AS host_photo_url,
                u.id AS host_user_id
         FROM debates d
         JOIN sponsors s ON s.id = d.sponsor_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE d.id = $1`,
        [debate_id]
    );
    const row = rows[0];
    if (!row) throw httpError(404, "debate not found");

    // A hybrid or sponsor-decided debate has a panel; the sidebar shows a judge
    // rather than the host, because the judge is who the match answers to.
    if (row.win_type !== "general_vote") {
        const { rows: judges } = await db.query(
            `SELECT j.judge_id, j.display_name, u.profile_photo_url, u.first_name, u.last_name
             FROM debate_judges j
             LEFT JOIN users u ON u.id = j.user_id
             WHERE j.debate_id = $1 AND j.removed_at IS NULL
             ORDER BY j.disclosed_at
             LIMIT 3`,
            [debate_id]
        ).catch(() => ({ rows: [] }));
        if (judges.length) {
            return {
                kind: "judge",
                people: judges.map((j) => ({
                    name: j.display_name || [j.first_name, j.last_name].filter(Boolean).join(" "),
                    photo_url: j.profile_photo_url || null,
                })),
            };
        }
    }
    return {
        kind: "host",
        people: [{ name: row.host_name, photo_url: row.host_photo_url, user_id: row.host_user_id }],
    };
};

// listConversations — one row per match, in the order they are played.
//
// The two participants are whoever ANSWERED, not whoever the bracket seats:
// before a pairing is settled the seats do not exist yet, and the people who
// wrote in a match are the only ones a reader cares about anyway.
const listConversations = async ({ debate_id, viewer_user_id = null }, db = client) => {
    const { rows: dbt } = await db.query(
        `SELECT id, format, title, status FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = dbt[0];
    if (!debate) throw httpError(404, "debate not found");

    const { rows } = await db.query(
        `SELECT p.id AS prompt_id, p.body AS prompt, p.release_at, p.response_deadline,
                p.bracket_round, p.bracket_side, p.bracket_position,
                m.id AS match_id, m.voting_state, m.winner_contestant_id,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'response_id', r.id,
                            'contestant_id', r.contestant_id,
                            'user_id', r.user_id,
                            'first_name', u.first_name,
                            'last_name', u.last_name,
                            'username', u.username,
                            'profile_photo_url', u.profile_photo_url,
                            'submitted_at', r.submitted_at,
                            'preview', LEFT(r.body, 120),
                            'comment_count', COALESCE(e.comment_count, 0),
                            'like_count', COALESCE(e.like_count, 0)
                        ) ORDER BY r.submitted_at
                    ) FILTER (WHERE r.id IS NOT NULL),
                    '[]'::json
                ) AS people
         FROM prompts p
         LEFT JOIN debate_matches m
                ON m.debate_id = p.debate_id AND m.round = p.bracket_round
               AND m.side = p.bracket_side AND m.position = p.bracket_position
         LEFT JOIN match_responses r ON r.prompt_id = p.id AND r.removed_at IS NULL
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN response_engagement e ON e.response_id = r.id
         WHERE p.debate_id = $1 AND p.bracket_round IS NOT NULL
         GROUP BY p.id, m.id
         ORDER BY p.bracket_round, p.bracket_side, p.bracket_position`,
        [debate_id]
    );

    const authority = await _authorityFor(debate_id, db);

    const conversations = rows.map((row) => {
        const state = roundStateOf(row);
        const released = state === "released";
        return {
            key: slotKey(row.bracket_side, row.bracket_round, row.bracket_position),
            prompt_id: row.prompt_id,
            match_id: row.match_id,
            round: row.bracket_round,
            side: row.bracket_side,
            position: row.bracket_position,
            state,
            release_at: row.release_at,
            response_deadline: row.response_deadline,
            // The subject line. Withheld before the round opens, same rule as
            // everywhere else — a question read early is a question workshopped.
            title: state === "pending" ? null : row.prompt,
            // WHO IS IN IT. Previews and counts only make sense once the answers
            // are public; before that the sidebar shows the faces and nothing
            // they wrote, which is what "sealed" should look like.
            people: (row.people || []).map((p) => ({
                ...p,
                preview: released || p.user_id === viewer_user_id ? p.preview : null,
            })),
            message_count: (row.people || []).length,
            voting_state: row.voting_state,
            winner_contestant_id: row.winner_contestant_id,
        };
    });

    return {
        debate_id,
        debate_title: debate.title,
        format: debate.format,
        authority,
        conversations,
    };
};

// ensureTypedMatchVote — make a released typed match votable, and hand back the
// ballot for it.
//
// THE RELEASE IS THE OPENING. There is no host to press a button in a typed
// debate, so the moment both answers are public the match is one the room can
// decide. The row is created from the two people who ANSWERED — which is the
// only definition of "who is in this match" a typed debate needs, and it cannot
// disagree with the responses the ballot is scoring.
//
// auto_opened = true keeps this outside the one-open-per-debate index, so a
// typed debate can have every released round votable at once while a live one
// still shows exactly one vote screen.
const ensureTypedMatchVote = async ({ debate_id, key, viewer_user_id = null }, db = client) => {
    const [side, round, position] = String(key || "").split(":");
    const { rows } = await db.query(
        `SELECT p.id AS prompt_id, p.body AS prompt, p.release_at, p.response_deadline,
                p.bracket_round, p.bracket_side, p.bracket_position,
                d.format, d.status, d.win_type, d.category, d.vote_window_hours
         FROM prompts p JOIN debates d ON d.id = p.debate_id
         WHERE p.debate_id = $1 AND p.bracket_side = $2
           AND p.bracket_round = $3 AND p.bracket_position = $4`,
        [debate_id, side, Number(round), Number(position)]
    );
    const prompt = rows[0];
    if (!prompt) throw httpError(404, "no prompt for that match");
    if (prompt.format !== "typed") {
        throw httpError(409, "a live debate's votes are opened by its host");
    }

    const state = roundStateOf(prompt);
    if (state !== "released") {
        return { votable: false, reason: state, match: null, criteria: [] };
    }

    // The window has run out. The match is not reopened and the vote is over —
    // returned rather than thrown so the panel can say WHEN it closed.
    const closes_at = voteWindowEnd(prompt, prompt.vote_window_hours);
    if (closes_at && new Date(closes_at).getTime() <= Date.now()) {
        return { votable: false, reason: "vote_closed", closes_at, match: null, criteria: [] };
    }

    const { rows: responses } = await db.query(
        `SELECT r.id, r.contestant_id, r.user_id
         FROM match_responses r
         WHERE r.prompt_id = $1 AND r.removed_at IS NULL
         ORDER BY r.submitted_at`,
        [prompt.prompt_id]
    );
    if (responses.length < 2) {
        // One answer is not a match. Scoring it against an empty seat would
        // record a win nobody contested.
        return { votable: false, reason: "unanswered", match: null, criteria: [] };
    }

    const [a, b] = responses;
    const { rows: made } = await db.query(
        `INSERT INTO debate_matches
            (debate_id, round, side, position, contestant_a_id, contestant_b_id,
             voting_state, opened_at, auto_opened)
         VALUES ($1,$2,$3,$4,$5,$6,'open',NOW(),true)
         ON CONFLICT (debate_id, round, side, position) DO UPDATE
            SET voting_state = CASE
                    WHEN debate_matches.voting_state = 'pending' THEN 'open'
                    ELSE debate_matches.voting_state END,
                opened_at = COALESCE(debate_matches.opened_at, NOW()),
                auto_opened = debate_matches.auto_opened OR true,
                updated_at = NOW()
         RETURNING *`,
        [debate_id, Number(round), side, Number(position), a.contestant_id, b.contestant_id]
    );
    const match = made[0];

    const criteria = await ensureDebateCriteria(
        { debate_id, category: prompt.category },
        db
    );

    let my_vote = null;
    if (viewer_user_id) {
        const { rows: mine } = await db.query(
            `SELECT * FROM debate_match_votes WHERE match_id = $1 AND voter_user_id = $2`,
            [match.id, viewer_user_id]
        );
        my_vote = mine[0] || null;
    }

    // The same shape the live ballot renders, so one component draws both.
    const { rows: seats } = await db.query(
        `SELECT c.id AS contestant_id, c.user_id,
                u.first_name, u.last_name, u.username, u.profile_photo_url
         FROM contestants c JOIN users u ON u.id = c.user_id
         WHERE c.id = ANY($1::uuid[])`,
        [[match.contestant_a_id, match.contestant_b_id]]
    );
    const order = [match.contestant_a_id, match.contestant_b_id];

    return {
        votable: match.voting_state === "open",
        reason: match.voting_state,
        closes_at,
        criteria,
        my_vote,
        match: {
            ...match,
            prompt: prompt.prompt,
            contestants: order.map((id) => seats.find((s) => s.contestant_id === id)).filter(Boolean),
        },
    };
};

// listTypedBallots — EVERY match this person can vote on right now.
//
// This replaces "whatever the reader happened to click". Which matches are open
// to you is a fact about the debate and your account, not about your browsing
// history in this tab: a signed-in voter who reloads, or comes back tomorrow,
// must see the same set — including the ones they have already scored, marked as
// scored. Accumulating them client-side meant the panel showed one ballot until
// you went hunting for the others, and forgot them the moment you refreshed.
//
// Signed out, the same list comes back with my_vote null everywhere: you can see
// what is open and what it closes, and the ballot itself asks you to sign in.
// Nothing is remembered for you, because there is nowhere to remember it.
const listTypedBallots = async ({ debate_id, viewer_user_id = null }, db = client) => {
    const { rows: dbt } = await db.query(
        `SELECT id, format, vote_window_hours FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = dbt[0];
    if (!debate) throw httpError(404, "debate not found");
    if (debate.format !== "typed") return { debate_id, ballots: [] };

    // Released rounds only, and only matches with two answers in them — the two
    // conditions ensureTypedMatchVote checks one at a time.
    const { rows } = await db.query(
        `SELECT p.bracket_side, p.bracket_round, p.bracket_position, p.response_deadline
         FROM prompts p
         WHERE p.debate_id = $1
           AND p.bracket_round IS NOT NULL
           AND p.response_deadline <= NOW()
           AND (SELECT COUNT(*) FROM match_responses r
                 WHERE r.prompt_id = p.id AND r.removed_at IS NULL) >= 2
         ORDER BY p.bracket_round DESC, p.bracket_side, p.bracket_position`,
        [debate_id]
    );

    const ballots = [];
    for (const row of rows) {
        const key = slotKey(row.bracket_side, row.bracket_round, row.bracket_position);
        const b = await ensureTypedMatchVote({ debate_id, key, viewer_user_id }, db);
        // Decided and closed matches are dropped: a ballot you cannot cast is
        // not a ballot, and listing it would make the panel's count a lie.
        if (b.match && (b.votable || b.my_vote)) ballots.push({ ...b, key });
    }
    return { debate_id, ballots };
};

module.exports = { listConversations, ensureTypedMatchVote, listTypedBallots, voteWindowEnd };
