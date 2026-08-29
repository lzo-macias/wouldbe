const { client } = require("../index.js");

// ============================================================================
// THE PUBLIC PROFILE — identity, standing, and everything this person has
// argued, in one read.
//
// TWO GENUINELY DIFFERENT OBJECTS COME OUT OF HERE, and that is the whole
// reason it is not a SELECT with a few nulls:
//
//   a public viewer   a hidden field is ABSENT. Not null, not flagged, not
//                     rendered greyed out — absent. A null in a JSON response
//                     is a fact about the account, and a reader who diffs two
//                     responses learns exactly what the setting was meant to
//                     hide.
//   the owner         the field is present with `private: true` beside it, so
//                     they can see what the world is not seeing.
//
// THE FEED IS REDDIT-SHAPED because a profile here answers "what has this
// person argued", and an argument only means something with its question
// attached. So each row carries the debate it was in, the round, the prompt
// they were answering, their answer, and how it went — the prompt quoted rather
// than paraphrased, because it is somebody else's words.
//
// Only RELEASED answers appear. A response written ahead for a round that has
// not closed is still sealed, and a profile is not a side door into it.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// The columns a profile reads. Kept as one string so the two queries below
// cannot drift into disagreeing about what a user is.
const PROFILE_SELECT = `
    u.id, u.username, u.first_name, u.last_name, u.profile_photo_url, u.bio,
    u.state, u.city, u.trophy_count, u.created_at,
    u.hide_real_name, u.hide_state,
    u.social_x, u.social_instagram, u.social_twitch, u.social_website
`;

// buildIdentity — apply the privacy rules, producing the right shape for who
// is asking.
//
// The `private` flags only ever appear on the owner's own copy. A public
// payload has no key at all for a hidden field, which is the difference between
// "this person has no state on file" and "this person is hiding their state" —
// and the whole point of the setting is that a stranger cannot tell.
const buildIdentity = (row, isSelf) => {
    const handle = row.username ? `@${row.username}` : null;
    const realName = [row.first_name, row.last_name].filter(Boolean).join(" ");

    const out = {
        id: row.id,
        username: row.username,
        handle,
        profile_photo_url: row.profile_photo_url,
        bio: row.bio,
        trophy_count: row.trophy_count,
        joined_at: row.created_at,
        is_self: isSelf,
        socials: {
            x: row.social_x || null,
            instagram: row.social_instagram || null,
            twitch: row.social_twitch || null,
            website: row.social_website || null,
        },
        // The name that is safe to render as the heading, whoever is looking.
        // A hidden name falls back to the handle, which the CHECK constraint
        // guarantees exists.
        display_name: row.hide_real_name ? handle || "Someone" : realName || handle || "Someone",
    };

    if (!row.hide_real_name) {
        out.name = realName;
    } else if (isSelf) {
        out.name = realName;
        out.name_private = true;
    }

    if (!row.hide_state) {
        if (row.state) out.state = row.state;
    } else if (isSelf) {
        out.state = row.state;
        out.state_private = true;
    }

    return out;
};

// getUserProfile — the whole page.
const getUserProfile = async ({ user_id, viewer_user_id = null }, db = client) => {
    if (!user_id) throw httpError(400, "user_id is required");

    const { rows } = await db.query(
        `SELECT ${PROFILE_SELECT} FROM users u WHERE u.id = $1 AND u.is_active = TRUE`,
        [user_id]
    );
    if (!rows.length) throw httpError(404, "user not found");
    const isSelf = !!viewer_user_id && viewer_user_id === user_id;

    // THE FEED. One row per released answer, newest first.
    //
    // The result is derived from the match rather than stored on the response:
    // a match that has closed with a winner says won or lost, one still running
    // says open. Storing it on the answer would be a second copy of a fact the
    // bracket already owns and would go stale the moment a backdoor changed a
    // seat.
    const { rows: feed } = await db.query(
        `SELECT r.id, r.body, r.submitted_at,
                d.id AS debate_id, d.title AS debate_title, d.is_for_fun,
                p.body AS prompt, p.bracket_round, p.bracket_side, p.bracket_position,
                p.response_deadline,
                COALESCE(e.like_count, 0)    AS like_count,
                COALESCE(e.comment_count, 0) AS comment_count,
                m.winner_contestant_id,
                m.voting_state,
                -- Who they were arguing against. NULL for an open response,
                -- which is correct: an outsider answered the prompt, not a person.
                opp_u.first_name AS opponent_first_name,
                opp_u.last_name  AS opponent_last_name,
                opp_u.username   AS opponent_username,
                -- Did THIS person win it? Compared on the contestant row, since
                -- a user can hold one per debate.
                (m.winner_contestant_id IS NOT NULL
                 AND m.winner_contestant_id = r.contestant_id) AS won
           FROM match_responses r
           JOIN debates d ON d.id = r.debate_id
           JOIN prompts p ON p.id = r.prompt_id
           LEFT JOIN response_engagement e ON e.response_id = r.id
           LEFT JOIN debate_matches m
                  ON m.debate_id = r.debate_id
                 AND m.round = p.bracket_round
                 AND m.side = p.bracket_side
                 AND m.position = p.bracket_position
           LEFT JOIN contestants opp
                  ON opp.id = CASE WHEN m.contestant_a_id = r.contestant_id
                                   THEN m.contestant_b_id ELSE m.contestant_a_id END
           LEFT JOIN users opp_u ON opp_u.id = opp.user_id
          WHERE r.user_id = $1
            AND r.removed_at IS NULL
            -- RELEASED ONLY. A sealed round is sealed from here too; a profile
            -- is not a side door into an answer nobody is meant to have read.
            AND p.response_deadline IS NOT NULL
            AND p.response_deadline <= NOW()
          ORDER BY r.submitted_at DESC
          LIMIT 60`,
        [user_id]
    );

    // The counts the tabs carry. Derived from the same rows the tabs will show,
    // so a badge can never say 4 over a list of 3.
    const debatesArgued = new Set(feed.map((f) => f.debate_id)).size;

    // Their campaigns. `pledged_total_cents` is maintained on the row, so this
    // does not re-sum the pledge ledger on every profile view — but the backer
    // COUNT has no such column and is counted, scoped to pledges that are still
    // standing.
    const { rows: wouldbes } = await db.query(
        `SELECT w.id, w.title, w.goal_cents, w.pledged_total_cents,
                w.launch_status, w.deadline, w.created_at, w.retired,
                o.office_name,
                (SELECT COUNT(DISTINCT p2.pledger_user_id)::int
                   FROM pledges p2
                  WHERE p2.wouldbe_id = w.id AND p2.status <> 'cancelled') AS backers
           FROM wouldbe w
           LEFT JOIN office o ON o.id = w.office_id
          WHERE w.user_id = $1
            AND w.retired = FALSE
            -- The owner sees their own drafts; nobody else does. A draft is a
            -- thing somebody has not decided to say yet.
            AND ($2::boolean = TRUE OR w.launch_status = 'active')
          ORDER BY w.created_at DESC`,
        [user_id, isSelf]
    );

    const { rows: trophies } = await db.query(
        `SELECT kind, COUNT(*)::int AS n FROM user_trophies
          WHERE user_id = $1 GROUP BY kind`,
        [user_id]
    );

    const totalLikes = feed.reduce((n, f) => n + Number(f.like_count || 0), 0);
    const wins = feed.filter((f) => f.won).length;

    return {
        user: buildIdentity(rows[0], isSelf),
        // The chips under the name. Computed rather than stored — every one of
        // them is a rollup of rows that change, and a cached copy is a number
        // that is wrong until something remembers to recompute it.
        stats: {
            debates: debatesArgued,
            wins,
            likes: totalLikes,
            arrows: rows[0].trophy_count,
            trophies_by_kind: Object.fromEntries(trophies.map((t) => [t.kind, t.n])),
            wouldbes: wouldbes.length,
        },
        feed: feed.map((f) => ({
            ...f,
            key: `${f.bracket_side}:${f.bracket_round}:${f.bracket_position}`,
            // 'won' | 'lost' | 'open' — what the row's badge says.
            result: f.winner_contestant_id ? (f.won ? "won" : "lost") : "open",
            opponent:
                [f.opponent_first_name, f.opponent_last_name].filter(Boolean).join(" ") ||
                f.opponent_username ||
                null,
        })),
        wouldbes,
    };
};

module.exports = { getUserProfile, buildIdentity };
