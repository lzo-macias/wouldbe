const { client } = require("../index.js");
const { bracketSlots, slotKey } = require("./bracketSlots");

// ============================================================================
// Typed debates: the round clock, the answers, and the room's reaction.
//
// THE CLOCK. Round 0 opens when the debate starts. Each round gives its
// contestants `round_grace_hours` to answer, and the moment that window shuts,
// EVERY answer in the round is released at once and the next round opens.
//
//   start_at ──grace──> R0 closes / R0 answers public / R1 opens ──grace──> …
//
// Answers release TOGETHER on the deadline, never on submit: publishing the
// first answer immediately would mean the second person writes a rebuttal while
// their opponent wrote an opening, which is not the same contest. The deadline
// IS the release — there is no separate published flag that could disagree with
// it, and `now() >= response_deadline` is the only visibility test anywhere.
//
// WHAT IS VISIBLE, AND WHEN:
//   before release_at        the PUBLIC sees nothing. Contestants see every
//                            prompt on their own path from the moment the
//                            bracket is locked — see getMyPrompts.
//   between open and close   the prompt is public; nobody sees anybody's
//                            answer, including their opponent's
//   after response_deadline  prompt and both answers public, comments open
//
// CONTESTANTS ANSWER AHEAD. A contestant is given the whole list — one prompt
// per round along the path their seed takes through the bracket — and may write
// and rewrite any of them until that round's deadline. They are not made to
// wait for a round to open before they can start on it.
//
// This is a schedule for READING, not a drip-feed for writing: the deadline is
// still what publishes a round and still what both answers are released on, so
// nobody ever writes having read their opponent. What it removes is the person
// who had a free Sunday, no prompt to work on, and a Wednesday deadline they
// were at work for.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

const MAX_BODY = 8000;
const MAX_COMMENT = 4000;
// How many replies come down with a thread before "see more replies". Two is
// enough to show a conversation is happening without paying for one that isn't
// being read.
const REPLY_PREVIEW = 2;
const HOUR_MS = 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// the clock
// ----------------------------------------------------------------------------

// scheduleTypedRounds — stamp release_at / response_deadline on every match
// prompt, derived from the debate's start and its grace period.
//
// WRITTEN, not computed per read. Two reasons: a sponsor editing the grace
// period after a round has opened must not retroactively move a deadline people
// already answered against, and the round windows have to be queryable ("what
// closes in the next hour") by the job that releases them.
//
// Idempotent: re-running with the same inputs writes the same timestamps.
const scheduleTypedRounds = async ({ debate_id }, db = client) => {
    const { rows } = await db.query(
        `SELECT id, format, start_at, round_grace_hours, vote_window_hours, max_contestants
         FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = rows[0];
    if (!debate) throw httpError(404, "debate not found");
    if (debate.format !== "typed") return { scheduled: 0, rounds: [] };
    if (!debate.start_at) throw httpError(409, "this debate has no start time to schedule from");

    const slots = bracketSlots(debate.max_contestants);
    const rounds = [...new Set(slots.map((s) => s.round))].sort((a, b) => a - b);
    const write = Number(debate.round_grace_hours) * HOUR_MS;
    const read = Number(debate.vote_window_hours) * HOUR_MS;
    const start = new Date(debate.start_at).getTime();

    // A ROUND IS WRITE THEN READ, and the next one opens when the reading window
    // shuts. This used to be `start + i * grace` — rounds butted straight up
    // against each other — which was a contradiction rather than a tight
    // schedule: voting on round N ran for a grace period AFTER its answers were
    // released (see voteWindowEnd in matchConversations.js), so round N's winner
    // was not known until start + (N+2) * grace. Round N+1's writing window
    // closed at that same instant. Nobody could write in a window that expired
    // the moment they learned they were in it.
    const pitch = write + read;
    const windows = rounds.map((round, i) => {
        const opens = start + i * pitch;
        return {
            round,
            release_at: new Date(opens).toISOString(),
            response_deadline: new Date(opens + write).toISOString(),
        };
    });

    for (const w of windows) {
        await db.query(
            `UPDATE prompts
             SET release_at = $2, response_deadline = $3, updated_at = NOW()
             WHERE debate_id = $1 AND bracket_round = $4`,
            [debate_id, w.release_at, w.response_deadline, w.round]
        );
    }
    return { scheduled: windows.length, rounds: windows };
};

// roundStateOf — the one place that decides what a round is doing right now.
// Every visibility rule in this file reads it, so "open" cannot mean one thing
// to the read path and another to the write path.
const roundStateOf = (prompt, now = Date.now()) => {
    if (!prompt?.release_at) return "unscheduled";
    const opens = new Date(prompt.release_at).getTime();
    const closes = new Date(prompt.response_deadline).getTime();
    if (now < opens) return "pending";   // not yet visible to anyone
    if (now < closes) return "open";     // contestants writing, answers sealed
    return "released";                   // answers public, comments open
};

// getRoundSchedule — the whole clock for a debate, one row per round, with the
// state each is in and what is written in it. This is what the page shows.
const getRoundSchedule = async ({ debate_id }, db = client) => {
    const { rows: dbt } = await db.query(
        `SELECT id, format, start_at, round_grace_hours, vote_window_hours, max_contestants
         FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = dbt[0];
    if (!debate) throw httpError(404, "debate not found");

    const { rows: prompts } = await db.query(
        `SELECT p.id, p.body, p.bracket_round, p.bracket_side, p.bracket_position,
                p.release_at, p.response_deadline,
                (SELECT COUNT(*)::int FROM match_responses r
                  WHERE r.prompt_id = p.id AND r.removed_at IS NULL) AS response_count
         FROM prompts p
         WHERE p.debate_id = $1 AND p.bracket_round IS NOT NULL
         ORDER BY p.bracket_round, p.bracket_side, p.bracket_position`,
        [debate_id]
    );

    const byRound = new Map();
    for (const p of prompts) {
        if (!byRound.has(p.bracket_round)) {
            byRound.set(p.bracket_round, {
                round: p.bracket_round,
                release_at: p.release_at,
                response_deadline: p.response_deadline,
                state: roundStateOf(p),
                matches: [],
            });
        }
        const r = byRound.get(p.bracket_round);
        r.matches.push({
            prompt_id: p.id,
            key: slotKey(p.bracket_side, p.bracket_round, p.bracket_position),
            side: p.bracket_side,
            position: p.bracket_position,
            // The prompt text itself is withheld until the round opens: a
            // question everyone can read a week early is a question everyone
            // has already workshopped an answer to.
            body: roundStateOf(p) === "pending" ? null : p.body,
            response_count: p.response_count,
            state: roundStateOf(p),
        });
    }

    return {
        debate_id,
        format: debate.format,
        grace_hours: debate.round_grace_hours,
        start_at: debate.start_at,
        rounds: [...byRound.values()].sort((a, b) => a.round - b.round),
    };
};

// ----------------------------------------------------------------------------
// answering
// ----------------------------------------------------------------------------

// _loadPromptForAnswer — the prompt, its window, and whether this user is one of
// the two people entitled to answer it.
const _loadPromptForAnswer = async ({ prompt_id, user_id }, db = client) => {
    const { rows } = await db.query(
        `SELECT p.id, p.debate_id, p.body, p.release_at, p.response_deadline,
                p.bracket_round, p.bracket_side, p.bracket_position,
                d.format, d.status AS debate_status,
                c.id AS contestant_id
         FROM prompts p
         JOIN debates d ON d.id = p.debate_id
         LEFT JOIN contestants c
                ON c.debate_id = p.debate_id AND c.user_id = $2
               AND c.withdrew_at IS NULL AND c.status <> 'disqualified'
         WHERE p.id = $1`,
        [prompt_id, user_id]
    );
    if (!rows.length) throw httpError(404, "prompt not found");
    return rows[0];
};

// submitResponse — a contestant answers a prompt on their path.
//
// THE DEADLINE IS THE WHOLE RULE, and only the deadline. A contestant may write
// and rewrite any round's answer from the moment the bracket is locked right up
// until that round closes; after it closes the answers are already public and a
// late edit would be rewriting a published argument having read the other one.
//
// The "has this round opened yet" gate is deliberately NOT here. It used to be,
// and it meant a contestant could only work on the round they were already in —
// which turned a written contest into an availability contest, and made a
// deadline you happened to be asleep for unrecoverable.
const submitResponse = async ({ prompt_id, user_id, body }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    const p = await _loadPromptForAnswer({ prompt_id, user_id }, db);

    if (p.format !== "typed") throw httpError(409, "only a typed debate is answered in writing");
    if (!p.bracket_round && p.bracket_round !== 0) {
        throw httpError(409, "this prompt is not attached to a match");
    }

    // TWO KINDS OF ANSWER. A contestant answers their own match. Anybody holding
    // OPEN_RESPONSE_THRESHOLD standing arrows may answer ANY typed match that
    // already has answers in it — that is what a hundred arrows buys, and it is
    // the door the backdoor is named for.
    //
    // The "already has answers" condition is not decoration: an open response
    // posted before either contestant has written would be the first thing in
    // the match, which is not commentary on a debate, it is a queue-jump.
    const openResponder = !p.contestant_id;
    if (openResponder) {
        // THREE WAYS IN — enough standing arrows for THIS debate's door, a
        // responder subscription, or a pass bought for this one prompt.
        // mayRespond checks them in that order, so somebody who qualifies is
        // never shown a price and a subscriber is never charged for something
        // they already have.
        const { mayRespond } = require("./responseAccess");
        const gate = await mayRespond(
            { user_id, debate_id: p.debate_id, prompt_id },
            db
        );
        if (!gate.allowed) {
            const err = httpError(
                403,
                `answering a match you are not in takes ${gate.threshold} standing arrows — you have ${gate.trophy_count}. You can also buy a pass for this one, or subscribe.`
            );
            // The gate travels with the refusal so the client can render the
            // paywall from the same numbers that refused it, rather than
            // fetching them again and possibly getting a different answer.
            err.gate = gate;
            throw err;
        }
        const { rows: any } = await db.query(
            `SELECT 1 FROM match_responses
              WHERE prompt_id = $1 AND contestant_id IS NOT NULL AND removed_at IS NULL
              LIMIT 1`,
            [prompt_id]
        );
        if (!any.length) {
            throw httpError(409, "nobody in this match has answered yet");
        }
    }

    const state = roundStateOf(p);
    if (state === "unscheduled") throw httpError(409, "this round has not been scheduled yet");
    // "pending" is allowed on purpose — writing ahead is the point. Only a
    // CLOSED round is refused.
    if (state === "released") throw httpError(409, "the deadline for this round has passed");

    // IS THIS PERSON ACTUALLY IN THIS MATCH? The prompt names a slot; the slot
    // names two contestants, and which two is decided by the bracket. Until the
    // match row exists (the pairing is only settled once the previous round is),
    // the honest answer is that this match has no seats yet.
    if (!openResponder) {
        const { rows: match } = await db.query(
            `SELECT contestant_a_id, contestant_b_id FROM debate_matches
             WHERE debate_id = $1 AND round = $2 AND side = $3 AND position = $4`,
            [p.debate_id, p.bracket_round, p.bracket_side, p.bracket_position]
        );
        // A contestant in the debate but not in THIS match is writing ahead for
        // a round they may reach — allowed, and gated at publication instead.
        // Only a match whose seats are settled can say otherwise.
        if (match.length) {
            const seats = [match[0].contestant_a_id, match[0].contestant_b_id];
            const onPath = seats.includes(p.contestant_id);
            const decided = !!match[0].contestant_a_id && !!match[0].contestant_b_id;
            if (decided && !onPath && p.bracket_round === 0) {
                throw httpError(403, "you are not in this match");
            }
        }
    }

    const text = String(body || "").trim();
    if (!text) throw httpError(400, "an answer cannot be empty");
    if (text.length > MAX_BODY) {
        throw httpError(400, `an answer must be ${MAX_BODY} characters or fewer`);
    }

    // TWO UPSERT TARGETS, because the two kinds of answer are unique on
    // different things: a contestant's is one per (prompt, contestant), an
    // outsider's one per (prompt, user) — they have no contestant row to be
    // unique on. Postgres cannot infer one index from a NULL, so the target is
    // chosen here rather than guessed at.
    const { rows } = await db.query(
        openResponder
            ? `INSERT INTO match_responses (debate_id, prompt_id, contestant_id, user_id, body)
               VALUES ($1,$2,NULL,$4,$5)
               ON CONFLICT (prompt_id, user_id) WHERE contestant_id IS NULL
               DO UPDATE SET body = EXCLUDED.body, edited_at = NOW(), updated_at = NOW()
               RETURNING *`
            : `INSERT INTO match_responses (debate_id, prompt_id, contestant_id, user_id, body)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (prompt_id, contestant_id)
               DO UPDATE SET body = EXCLUDED.body, edited_at = NOW(), updated_at = NOW()
               RETURNING *`,
        [p.debate_id, prompt_id, p.contestant_id, user_id, text]
    );
    const response = rows[0];

    // The counter row exists from the moment the answer does, so every read can
    // join it without a LEFT JOIN's null handling.
    await db.query(
        `INSERT INTO response_engagement (response_id) VALUES ($1)
         ON CONFLICT (response_id) DO NOTHING`,
        [response.id]
    );
    return response;
};

// ----------------------------------------------------------------------------
// answering ahead: the contestant's whole path
// ----------------------------------------------------------------------------

// pathFromSlot — every slot one contestant can reach, given where they start.
//
// A bracket is a funnel and the route through it is arithmetic, not a draw: the
// winner of (side, round, position) plays at (side, round + 1, floor(position / 2)),
// and the two side winners meet in the final. So a contestant's entire possible
// path is known the moment their first-round seat is — which is why they can be
// handed every prompt they might answer without anybody knowing who wins.
//
// It is a PATH, not a prediction. Answering round 2's prompt does not say you
// will reach round 2; it says that if you do, the answer is already written.
const pathFromSlot = ({ side, position }, sideRounds) => {
    const path = [];
    let pos = position;
    for (let round = 0; round < sideRounds; round++) {
        path.push({ side, round, position: pos, key: slotKey(side, round, pos) });
        pos = Math.floor(pos / 2);
    }
    path.push({ side: "final", round: sideRounds, position: 0, key: slotKey("final", sideRounds, 0) });
    return path;
};

// getMyPrompts — what a contestant sees when they sit down to write: one prompt
// per round on their path, in round order, each with its deadline, its state and
// whatever they have already written.
//
// This is the whole answering surface for a typed debate. Before it, a
// contestant had to find the match page for the round they happened to be in,
// and there was nowhere at all to see what was coming.
//
// A non-contestant gets a 403 rather than an empty list: "you have no prompts"
// and "you are not in this debate" are different facts and reading one as the
// other is how somebody concludes the page is broken.
const getMyPrompts = async ({ debate_id, user_id }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");

    const { rows: dbt } = await db.query(
        `SELECT id, format, status, start_at, start_timezone, max_contestants,
                round_grace_hours, vote_window_hours, seeding_locked_at
           FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = dbt[0];
    if (!debate) throw httpError(404, "debate not found");
    if (debate.format !== "typed") throw httpError(409, "only a typed debate is answered in writing");

    const { rows: me } = await db.query(
        `SELECT id, seed FROM contestants
          WHERE debate_id = $1 AND user_id = $2
            AND withdrew_at IS NULL AND status <> 'disqualified'`,
        [debate_id, user_id]
    );
    if (!me.length) throw httpError(403, "you are not a contestant in this debate");
    const contestant = me[0];

    // Before the sponsor locks the bracket there is no seat, so there is no path
    // and no honest list to hand over. Answered as a state, not an error — the
    // page renders "your prompts land when the bracket is set".
    if (!debate.seeding_locked_at || contestant.seed == null) {
        return { debate_id, locked: false, seed: contestant.seed, rounds: [] };
    }

    // Which first-round seat this seed sits in. firstRoundPairs is the same
    // function the seeding page pairs with, so the seat here and the pairing the
    // sponsor locked cannot disagree.
    const { firstRoundPairs } = require("./debateSeeding");
    const field = (
        await db.query(
            `SELECT COUNT(*)::int AS n FROM contestants
              WHERE debate_id = $1 AND withdrew_at IS NULL
                AND status <> 'disqualified' AND seed IS NOT NULL`,
            [debate_id]
        )
    ).rows[0].n;

    const slots = bracketSlots(field);
    const round0 = slots.filter((s) => s.round === 0);
    const sideRounds = Math.max(...slots.map((s) => s.round));
    const pairIndex = firstRoundPairs(field).findIndex(
        ([a, b]) => a === contestant.seed || b === contestant.seed
    );
    if (pairIndex === -1 || !round0[pairIndex]) {
        // A seed outside the pairing — a field that shrank after the lock, say.
        // Reported rather than guessed at.
        return { debate_id, locked: true, seed: contestant.seed, rounds: [] };
    }
    const path = pathFromSlot(round0[pairIndex], sideRounds);
    const wanted = new Set(path.map((p) => p.key));

    const { rows: prompts } = await db.query(
        `SELECT p.id, p.body, p.bracket_round, p.bracket_side, p.bracket_position,
                p.release_at, p.response_deadline,
                r.id AS response_id, r.body AS my_answer,
                r.submitted_at, r.edited_at
           FROM prompts p
           LEFT JOIN match_responses r
                  ON r.prompt_id = p.id AND r.contestant_id = $2 AND r.removed_at IS NULL
          WHERE p.debate_id = $1 AND p.bracket_round IS NOT NULL`,
        [debate_id, contestant.id]
    );

    const byKey = new Map(
        prompts.map((p) => [slotKey(p.bracket_side, p.bracket_round, p.bracket_position), p])
    );

    const rounds = path
        .filter((step) => wanted.has(step.key))
        .map((step) => {
            const p = byKey.get(step.key) || null;
            const label = slots.find((s) => s.key === step.key)?.label ?? null;
            return {
                round: step.round,
                slot_key: step.key,
                label,
                prompt_id: p?.id ?? null,
                prompt: p?.body ?? null,
                release_at: p?.release_at ?? null,
                response_deadline: p?.response_deadline ?? null,
                // 'pending' here means "not public yet", NOT "you cannot write
                // it" — the write path allows every state except released.
                state: p ? roundStateOf(p) : "unscheduled",
                answered: !!p?.response_id,
                my_answer: p?.my_answer ?? "",
                submitted_at: p?.submitted_at ?? null,
                edited_at: p?.edited_at ?? null,
            };
        })
        .sort((a, b) => a.round - b.round);

    return {
        debate_id,
        locked: true,
        seed: contestant.seed,
        contestant_id: contestant.id,
        start_timezone: debate.start_timezone,
        round_grace_hours: debate.round_grace_hours,
        vote_window_hours: debate.vote_window_hours,
        rounds,
    };
};

// submitResponses — save several rounds' answers in one request.
//
// ONE CALL, because the contestant is looking at one page with several boxes on
// it and pressed one button. Sent as separate requests, a network blip halfway
// leaves them with three of five saved and no way to tell which — so each
// answer reports its own outcome and a bad one (an empty body, a round that
// closed while they were typing) does not discard the others.
const submitResponses = async ({ debate_id, user_id, answers = [] }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    if (!Array.isArray(answers) || !answers.length) {
        throw httpError(400, "nothing to save");
    }
    const results = [];
    for (const a of answers) {
        if (!a?.prompt_id) continue;
        try {
            const saved = await submitResponse(
                { prompt_id: a.prompt_id, user_id, body: a.body },
                db
            );
            results.push({ prompt_id: a.prompt_id, saved: true, response_id: saved.id });
        } catch (err) {
            results.push({
                prompt_id: a.prompt_id,
                saved: false,
                error: err.message || "could not save",
            });
        }
    }
    return {
        saved: results.filter((r) => r.saved).length,
        failed: results.filter((r) => !r.saved).length,
        results,
    };
};

// ----------------------------------------------------------------------------
// what is public
// ----------------------------------------------------------------------------

// TWO CONDITIONS, BOTH REQUIRED. A response is public when
//
//   1. its round's deadline has passed, AND
//   2. its author is one of the two people actually in that match.
//
// The second is not a refinement of the first, it is a separate rule that only
// exists because contestants write ahead. Someone can answer round three
// tonight and lose in round one on Friday; the deadline alone would then
// publish an argument by a person who was never in that match, against an
// opponent they never faced. Their words are kept — they wrote them — they are
// simply never shown to the room.
//
// WHY WRITES ARE NOT BLOCKED ON ELIMINATION, only publication. It costs nothing
// to let an eliminated contestant keep editing an answer nobody will see, and
// it leaves the door open for a rule that brings somebody back into a round
// they had already written for. Gating the write instead would mean a revived
// contestant has a blank page.
//
// BEFORE A ROUND IS DECIDED the match row does not exist yet, so nobody is in
// it and nothing publishes. That is the safe direction to fail: a pairing that
// has not been settled cannot leak.
const IS_IN_MATCH = `
    EXISTS (
        SELECT 1 FROM debate_matches m
         WHERE m.debate_id  = p.debate_id
           AND m.round      = p.bracket_round
           AND m.side       = p.bracket_side
           AND m.position   = p.bracket_position
           AND r.contestant_id IN (m.contestant_a_id, m.contestant_b_id)
    )
`;

// getMatchThread — everything one match's page shows: the prompt, its window,
// both answers once they are released, and the comment count on each.
//
// viewer_user_id only ever WIDENS: a contestant sees their own answer inside
// the window (it is theirs), and their like state comes back with it.
const getMatchThread = async ({ debate_id, key, viewer_user_id = null }, db = client) => {
    const [side, round, position] = String(key || "").split(":");
    const { rows: prompts } = await db.query(
        `SELECT p.*, d.format, d.title AS debate_title, d.status AS debate_status
         FROM prompts p JOIN debates d ON d.id = p.debate_id
         WHERE p.debate_id = $1 AND p.bracket_side = $2
           AND p.bracket_round = $3 AND p.bracket_position = $4`,
        [debate_id, side, Number(round), Number(position)]
    );
    const prompt = prompts[0];
    if (!prompt) throw httpError(404, "no prompt for that match");

    const state = roundStateOf(prompt);

    const { rows: responses } = await db.query(
        `SELECT r.id, r.body, r.submitted_at, r.edited_at, r.contestant_id, r.user_id,
                u.first_name, u.last_name, u.username, u.profile_photo_url,
                COALESCE(e.comment_count, 0) AS comment_count,
                COALESCE(e.like_count, 0)    AS like_count,
                COALESCE(e.score, 0)         AS score,
                EXISTS (SELECT 1 FROM response_likes l
                         WHERE l.response_id = r.id AND l.user_id = $2) AS liked_by_me
         FROM match_responses r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN response_engagement e ON e.response_id = r.id
         WHERE r.prompt_id = $1 AND r.removed_at IS NULL
         ORDER BY r.submitted_at`,
        [prompt.id, viewer_user_id]
    );

    // WHO IS ACTUALLY IN THIS MATCH. Empty until the previous round decides —
    // and empty is the right answer then, not a reason to fall back to showing
    // everything.
    const { rows: match } = await db.query(
        `SELECT contestant_a_id, contestant_b_id FROM debate_matches
          WHERE debate_id = $1 AND round = $2 AND side = $3 AND position = $4`,
        [debate_id, Number(round), side, Number(position)]
    );
    const seats = match.length ? [match[0].contestant_a_id, match[0].contestant_b_id] : [];
    const contenders = responses.filter((r) => seats.includes(r.contestant_id));

    // SEALED UNTIL THE DEADLINE, and then only for the two people who reached
    // this match. Everyone else's written-ahead answer for this slot stays
    // private forever — see IS_IN_MATCH above.
    let visible =
        state === "released"
            ? contenders
            : contenders
                  .filter((r) => viewer_user_id && r.user_id === viewer_user_id)
                  .map((r) => ({ ...r, only_you: true }));

    // Your own words, always. Somebody who wrote this round ahead and then went
    // out in an earlier one must still see what they wrote — vanishing it reads
    // as a lost submission, and it is the one thing on this page that is
    // unambiguously theirs.
    if (viewer_user_id && !visible.some((r) => r.user_id === viewer_user_id)) {
        const mine = responses.find((r) => r.user_id === viewer_user_id);
        if (mine) visible = [...visible, { ...mine, only_you: true, not_in_match: true }];
    }

    // THE OUTSIDERS — the "more responses" rail. Answers from people who are not
    // in this match, written on a hundred standing arrows. They are a separate
    // list rather than more entries in `responses` because they are a different
    // thing: the two contestants are arguing, everyone else is weighing in, and
    // flattening the two would make a match look like it had five people in it.
    //
    // Ordered by likes, because likes are what promotes one of them into the
    // bracket — the rail is the standings for that.
    const openResponses =
        state === "released"
            ? responses
                  .filter((r) => !seats.includes(r.contestant_id) && r.user_id !== viewer_user_id)
                  .sort((a, b) => Number(b.like_count) - Number(a.like_count))
            : [];

    // Has one of them already out-liked a contestant? Reported so the page can
    // caption it before the bracket does.
    const lowestSeated = contenders.length
        ? Math.min(...contenders.map((r) => Number(r.like_count)))
        : null;
    const backdoorLeader =
        lowestSeated != null && openResponses.length && Number(openResponses[0].like_count) > lowestSeated
            ? openResponses[0]
            : null;

    return {
        debate_id,
        debate_title: prompt.debate_title,
        key: slotKey(prompt.bracket_side, prompt.bracket_round, prompt.bracket_position),
        open_responses: openResponses,
        backdoor_leader: backdoorLeader,
        round: prompt.bracket_round,
        side: prompt.bracket_side,
        position: prompt.bracket_position,
        state,
        release_at: prompt.release_at,
        response_deadline: prompt.response_deadline,
        prompt: state === "pending" ? null : prompt.body,
        responses: visible,
        // How many of THIS MATCH'S two answers are in, without saying what they
        // are. Counting every response on the prompt would include people who
        // wrote this round ahead and did not reach it, and report "2 of 2 in"
        // for a match where one seat has written nothing.
        submitted_count: contenders.length,
    };
};

// ----------------------------------------------------------------------------
// comments
// ----------------------------------------------------------------------------

// A comment carries its author's face and name, because that is what the thread
// renders and a second request per comment to get it would be absurd.
const COMMENT_SELECT = `
    SELECT c.id, c.response_id, c.parent_comment_id, c.body, c.created_at,
           c.moderation_status, c.author_user_id,
           u.first_name, u.last_name, u.username, u.profile_photo_url
    FROM comments c
    JOIN users u ON u.id = c.author_user_id
`;

// getResponseComments — top-level comments, newest-relevant first, each with its
// first couple of replies and a total so the UI can offer "see more replies".
//
// TWO QUERIES, NOT N+1: one for the parents, one for every reply belonging to
// them. The trimming to REPLY_PREVIEW happens in memory, which is cheaper than
// a lateral per parent and far cheaper than a query per comment.
const getResponseComments = async ({ response_id, limit = 20, offset = 0 }, db = client) => {
    const { rows: parents } = await db.query(
        `${COMMENT_SELECT}
         WHERE c.response_id = $1 AND c.parent_comment_id IS NULL AND c.removed_at IS NULL
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [response_id, Math.min(Number(limit) || 20, 100), Number(offset) || 0]
    );
    if (!parents.length) return { comments: [], total_top_level: 0 };

    const ids = parents.map((p) => p.id);
    const { rows: replies } = await db.query(
        `${COMMENT_SELECT}
         WHERE c.parent_comment_id = ANY($1::uuid[]) AND c.removed_at IS NULL
         ORDER BY c.created_at ASC`,
        [ids]
    );

    const byParent = new Map();
    for (const r of replies) {
        if (!byParent.has(r.parent_comment_id)) byParent.set(r.parent_comment_id, []);
        byParent.get(r.parent_comment_id).push(r);
    }

    const { rows: counted } = await db.query(
        `SELECT COUNT(*)::int AS n FROM comments
         WHERE response_id = $1 AND parent_comment_id IS NULL AND removed_at IS NULL`,
        [response_id]
    );

    return {
        total_top_level: counted[0].n,
        comments: parents.map((p) => {
            const kids = byParent.get(p.id) || [];
            return {
                ...p,
                replies: kids.slice(0, REPLY_PREVIEW),
                reply_count: kids.length,
                // The UI shows "see 4 more replies" off this, and asks for them
                // with getCommentReplies rather than re-reading the thread.
                more_replies: Math.max(0, kids.length - REPLY_PREVIEW),
            };
        }),
    };
};

// getCommentReplies — the rest of one thread, for "see more replies".
const getCommentReplies = async ({ parent_comment_id, limit = 50, offset = 0 }, db = client) => {
    const { rows } = await db.query(
        `${COMMENT_SELECT}
         WHERE c.parent_comment_id = $1 AND c.removed_at IS NULL
         ORDER BY c.created_at ASC
         LIMIT $2 OFFSET $3`,
        [parent_comment_id, Math.min(Number(limit) || 50, 200), Number(offset) || 0]
    );
    return rows;
};

// commentOnResponse — one level of threading, same as posts.
//
// COMMENTS OPEN WHEN THE ANSWERS DO. Before the deadline the only people who can
// see an answer are the two who wrote them, so a comment then would either be
// invisible or a leak.
const commentOnResponse = async ({ response_id, author_user_id, parent_comment_id = null, body }, db = client) => {
    if (!author_user_id) throw httpError(401, "must be signed in to comment");
    const text = String(body || "").trim();
    if (!text) throw httpError(400, "a comment cannot be empty");
    if (text.length > MAX_COMMENT) {
        throw httpError(400, `a comment must be ${MAX_COMMENT} characters or fewer`);
    }

    const { rows } = await db.query(
        `SELECT r.id, p.release_at, p.response_deadline
         FROM match_responses r JOIN prompts p ON p.id = r.prompt_id
         WHERE r.id = $1 AND r.removed_at IS NULL`,
        [response_id]
    );
    const target = rows[0];
    if (!target) throw httpError(404, "response not found");
    if (roundStateOf(target) !== "released") {
        throw httpError(409, "this round's answers are not public yet");
    }

    // One level of threading. A reply to a reply is stored against the same
    // parent, so a thread cannot grow a fourth indent nobody can read on a
    // phone — the same rule posts follow.
    let parent = null;
    if (parent_comment_id) {
        const { rows: p } = await db.query(
            `SELECT id, parent_comment_id, response_id FROM comments
             WHERE id = $1 AND removed_at IS NULL`,
            [parent_comment_id]
        );
        if (!p.length) throw httpError(404, "the comment being replied to does not exist");
        if (p[0].response_id !== response_id) {
            throw httpError(400, "that comment belongs to a different response");
        }
        parent = p[0].parent_comment_id || p[0].id;
    }

    const { rows: made } = await db.query(
        `INSERT INTO comments (response_id, author_user_id, parent_comment_id, body)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [response_id, author_user_id, parent, text]
    );

    await db.query(
        `INSERT INTO response_engagement (response_id, comment_count)
         VALUES ($1, 1)
         ON CONFLICT (response_id) DO UPDATE
            SET comment_count = response_engagement.comment_count + 1,
                updated_at = NOW()`,
        [response_id]
    );

    return made[0];
};

// ----------------------------------------------------------------------------
// engagement
// ----------------------------------------------------------------------------

// toggleResponseLike — like or unlike. Returns the new state and count, so the
// caller never has to guess which way the toggle went.
const toggleResponseLike = async ({ response_id, user_id }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    const { rowCount: removed } = await db.query(
        `DELETE FROM response_likes WHERE response_id = $1 AND user_id = $2`,
        [response_id, user_id]
    );
    if (!removed) {
        await db.query(
            `INSERT INTO response_likes (response_id, user_id) VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [response_id, user_id]
        );
    }
    const { rows } = await db.query(
        `INSERT INTO response_engagement (response_id, like_count)
         VALUES ($1, (SELECT COUNT(*) FROM response_likes WHERE response_id = $1))
         ON CONFLICT (response_id) DO UPDATE
            SET like_count = (SELECT COUNT(*) FROM response_likes WHERE response_id = $1),
                updated_at = NOW()
         RETURNING like_count`,
        [response_id]
    );
    // A LIKE CAN MOVE TWO THINGS BESIDES A COUNTER, and both are checked here
    // because here is where the count changed:
    //
    //   a for-fun lead — whoever is top gets their arrow the moment they take
    //     the lead, which is what makes "anyone who dethrones them gets one too"
    //     true without storing a history of who led when.
    //
    //   a backdoor — an outsider's answer passing a contestant's takes their
    //     seat, and the seat has to change when the likes do, not on a nightly
    //     sweep that leaves the bracket wrong all evening.
    //
    // Both are best-effort: a like is a like, and neither an award nor a seat
    // change failing should hand the user an error for having pressed a heart.
    let side_effects = null;
    try {
        side_effects = await afterLike({ response_id }, db);
    } catch (err) {
        console.error("[like] side effects failed", err);
    }

    return { liked: !removed, like_count: rows[0].like_count, ...side_effects };
};

// afterLike — the two consequences a like can have, in one place so the like
// path stays readable and both can be triggered from a backfill.
const afterLike = async ({ response_id }, db = client) => {
    const { rows } = await db.query(
        `SELECT r.debate_id, r.prompt_id, d.is_for_fun, d.format,
                p.bracket_round, p.bracket_side, p.bracket_position
           FROM match_responses r
           JOIN debates d ON d.id = r.debate_id
           JOIN prompts p ON p.id = r.prompt_id
          WHERE r.id = $1`,
        [response_id]
    );
    if (!rows.length) return null;
    const r = rows[0];
    const { recordForFunLead, evaluateBackdoor } = require("./trophies");

    if (r.is_for_fun) {
        const lead = await recordForFunLead({ debate_id: r.debate_id }, db);
        return { for_fun_lead: lead.leader?.user_id ?? null, arrow_awarded: lead.awarded };
    }

    if (r.format === "typed" && r.bracket_round != null) {
        const { rows: m } = await db.query(
            `SELECT id FROM debate_matches
              WHERE debate_id = $1 AND round = $2 AND side = $3 AND position = $4`,
            [r.debate_id, r.bracket_round, r.bracket_side, r.bracket_position]
        );
        if (m.length) {
            const out = await evaluateBackdoor({ match_id: m[0].id }, db);
            if (out.displaced) return { backdoor: out };
        }
    }
    return null;
};

// recordEngagement — the soft signals: someone opened the author's profile from
// a response, expanded it, shared it.
//
// DEDUPED BY DAY, which is what makes this cheap enough to have at all. The
// insert is the dedup: if the row already exists the counter does not move, so
// forty clicks by one person on one day is one row and one increment. Signed-out
// clicks are simply not counted — there is no key to dedup them by, and a
// counter anyone can inflate is not a signal.
const ENGAGEMENT_KINDS = ["profile_click", "expand", "share"];

const recordEngagement = async ({ response_id, user_id, kind }, db = client) => {
    if (!ENGAGEMENT_KINDS.includes(kind)) {
        throw httpError(400, `kind must be one of: ${ENGAGEMENT_KINDS.join(", ")}`);
    }
    if (!user_id) return { counted: false };

    const { rowCount } = await db.query(
        `INSERT INTO response_engagement_events (response_id, user_id, kind)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [response_id, user_id, kind]
    );
    if (!rowCount) return { counted: false };

    // Only profile_click carries weight in the score today; the other two are
    // recorded so the question "is this worth weighting" can be answered later
    // from data rather than from a guess.
    if (kind === "profile_click") {
        await db.query(
            `INSERT INTO response_engagement (response_id, profile_click_count)
             VALUES ($1, 1)
             ON CONFLICT (response_id) DO UPDATE
                SET profile_click_count = response_engagement.profile_click_count + 1,
                    updated_at = NOW()`,
            [response_id]
        );
    }
    return { counted: true };
};

// getTopResponses — the most-engaged answers on the platform.
//
// Ranked by the STORED score column, so every caller ranks the same way and the
// weights live in one place (the generated column) rather than in each query.
// Only released rounds: an answer nobody can read has no business on a
// leaderboard, and its counters would all be zero anyway.
const getTopResponses = async ({ limit = 10, debate_id = null, since_days = null } = {}, db = client) => {
    const { rows } = await db.query(
        `SELECT r.id, r.body, r.submitted_at, r.debate_id,
                d.title AS debate_title, d.format,
                p.body AS prompt, p.bracket_round, p.bracket_side, p.bracket_position,
                u.id AS user_id, u.first_name, u.last_name, u.username, u.profile_photo_url,
                e.comment_count, e.like_count, e.profile_click_count, e.score
         FROM response_engagement e
         JOIN match_responses r ON r.id = e.response_id AND r.removed_at IS NULL
         JOIN prompts p  ON p.id = r.prompt_id
         JOIN debates d  ON d.id = r.debate_id
         JOIN users u    ON u.id = r.user_id
         WHERE p.response_deadline <= NOW()
           -- and the author actually reached this match. Without it, the
           -- "most talked about" shelf could feature an answer that was never
           -- published on its own match page.
           AND ${IS_IN_MATCH}
           AND ($2::uuid IS NULL OR r.debate_id = $2)
           AND ($3::int IS NULL OR r.submitted_at >= NOW() - ($3 || ' days')::interval)
           AND e.score > 0
         ORDER BY e.score DESC, r.submitted_at DESC
         LIMIT $1`,
        [Math.min(Number(limit) || 10, 50), debate_id, since_days ? Number(since_days) : null]
    );
    return rows.map((r) => ({
        ...r,
        key: slotKey(r.bracket_side, r.bracket_round, r.bracket_position),
    }));
};

module.exports = {
    ENGAGEMENT_KINDS,
    scheduleTypedRounds,
    roundStateOf,
    getRoundSchedule,
    submitResponse,
    submitResponses,
    getMyPrompts,
    pathFromSlot,
    getMatchThread,
    getResponseComments,
    getCommentReplies,
    commentOnResponse,
    toggleResponseLike,
    afterLike,
    recordEngagement,
    getTopResponses,
};
