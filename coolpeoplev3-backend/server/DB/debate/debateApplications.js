const { client, withTransaction } = require("../index.js");
const { WIN_TYPES, CONTRIBUTION_TYPES, PARTICIPATION_TYPES } = require("./debates.js");
const { PROMPT_KINDS } = require("./prompts.js");
const { applyCategoryCriteria } = require("./categoryCriteria.js");
const { validateJudgePanel, addJudgePanel } = require("./debateJudges.js");
const { normalizeStart } = require("./debateStart");
const { scheduleDebateStream, normalizeTwitchChannel } = require("./debateStreams.js");

// ============================================================================
// Debate applications — the SPONSOR-FACING create path.
//
// Every other debate/prompt write route is requireAdmin(), which left a sponsor
// no way to submit their own debate. This module is that path: one authenticated
// call takes the whole draft (debate fields + the ordered prompt list) and lands
// it as status='draft' for an admin to review and publish.
//
// Three things make it a separate module rather than a loosened admin route:
//
//   1. ATOMICITY. A debate with half its prompts is worse than no debate. The
//      sponsor row, the debate row, and every prompt insert share ONE
//      transaction — any failure rolls the whole submission back.
//   2. DERIVED SCHEDULING. The form never stores prompt order or dates; it sends
//      an ordered array plus an interval, and release_at/response_deadline are
//      computed here from array position. Position IS the schedule.
//   3. INPUT SHAPE. The form speaks dollars, booleans and day-counts. The DB
//      speaks cents, nullable text and timestamps. That translation belongs in
//      one place, not spread across the client.
//
// Admins receive submissions through listDebateApplications / getDebateApplication.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// The DB caps prize_pool_cents at 500000 ($5,000) — above that a sweepstakes
// needs state registration. Checked here too so the sponsor gets a specific
// message instead of the generic "violates a check constraint" 23514.
const PRIZE_POOL_CAP_CENTS = 500000;

const DAY_MS = 24 * 60 * 60 * 1000;

// A hybrid debate must declare a crowd weight (debates_hybrid_weight_chk). The
// form doesn't ask, so a hybrid submission with no weight gets an even split
// rather than a 400 the sponsor can't act on.
const DEFAULT_HYBRID_CROWD_WEIGHT_PCT = 50;

// Casual sponsors don't fill out a sponsor profile before applying, so the first
// application creates one. 'corporate' carries heavier KYC and is never implied.
const DEFAULT_SPONSOR_TYPE = "casual";

// toCents — the form sends free text ("$5,000", "5000", ""). Strip everything
// that isn't a digit or a decimal point, then convert dollars → cents. Returns
// null for blank/unparseable so the column stays NULL rather than becoming 0
// (null entry fee means "free debate"; 0 would mean "a fee of zero").
const toCents = (value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
    const cleaned = String(value).replace(/[^0-9.]/g, "");
    if (cleaned === "" || cleaned === ".") return null;
    const dollars = Number(cleaned);
    if (!Number.isFinite(dollars) || dollars < 0) return null;
    return Math.round(dollars * 100);
};

// resolveSponsor — find this user's sponsor row, creating one on first
// application. Runs on the caller's tx so a failed debate insert doesn't leave
// an orphan sponsor behind. display_name falls back to the user's own name so a
// casual sponsor never has to invent a brand.
const resolveSponsor = async (tx, user_id, display_name) => {
    const existing = await tx.query(
        `SELECT * FROM sponsors WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [user_id]
    );
    if (existing.rows.length) return existing.rows[0];

    let name = display_name && String(display_name).trim();
    if (!name) {
        const { rows } = await tx.query(
            `SELECT username, first_name, last_name FROM users WHERE id = $1`,
            [user_id]
        );
        const u = rows[0];
        if (!u) throw httpError(404, "user not found");
        name = u.username || [u.first_name, u.last_name].filter(Boolean).join(" ") || "Sponsor";
    }

    const created = await tx.query(
        `INSERT INTO sponsors (user_id, type, display_name)
         VALUES ($1, $2, $3)
         RETURNING *;`,
        [user_id, DEFAULT_SPONSOR_TYPE, name]
    );
    return created.rows[0];
};

// validatePrompts — reject the whole submission before we open a transaction.
// Returns the normalised list (trimmed strings, empty → null) in submitted order.
const validatePrompts = (prompts) => {
    if (!Array.isArray(prompts) || prompts.length === 0) {
        throw httpError(400, "at least one prompt is required");
    }
    return prompts.map((p, i) => {
        const position = i + 1;
        if (!p || typeof p !== "object") throw httpError(400, `prompt ${position} is malformed`);
        const prompt_type = p.prompt_type || "response";
        if (!PROMPT_KINDS.includes(prompt_type)) {
            throw httpError(400, `prompt ${position}: prompt_type must be one of: ${PROMPT_KINDS.join(", ")}`);
        }
        const body = p.body != null ? String(p.body).trim() : "";
        if (!body) throw httpError(400, `prompt ${position}: body is required`);
        // TEXT ONLY. A prompt used to carry a title, an example video and its own
        // release/deadline window; it is now just the question, released with no
        // per-prompt schedule. Anything else in the body is ignored rather than
        // rejected, so an older client doesn't 400 — it just stops mattering.
        return { prompt_order: position, prompt_type, body };
    });
};

// validateStream — the debate's ONE scheduled event: the concluding Twitch
// broadcast. This replaced the prompt calendar, so it is what "when is this
// debate" now means.
//
// THE DATE IS REQUIRED, THE CHANNEL IS NOT. The application form asks for the
// start date; connecting a Twitch channel is a separate step AFTER submission,
// because it involves an OAuth round-trip that has no business blocking a draft
// from being saved. A stream row with no channel is a scheduled broadcast with
// no destination yet — which is exactly the state between those two screens.
const validateStream = (stream) => {
    if (!stream || typeof stream !== "object") {
        throw httpError(400, "a start date is required — it's when the debate streams");
    }

    // The sponsor picks a date AND an hour, in their own zone. normalizeStart
    // turns that wall-clock choice into a UTC instant, keeps the IANA zone for
    // display, and hands back the calendar day IN THAT ZONE — a 9pm-ET debate is
    // 01:00 UTC the next day, and the day is what the DATE columns want.
    const { start_at, start_timezone, start_day } = normalizeStart({
        scheduled_at: stream.scheduled_at,
        timezone: stream.timezone,
    });

    // Compared as an INSTANT now, not by day: the sponsor named an hour, so
    // "today at 9am" really is in the past by lunchtime and there is no longer any
    // ambiguity to be generous about.
    if (new Date(start_at).getTime() < Date.now()) {
        throw httpError(400, "the start time is in the past");
    }

    // Seats on the broadcast are NOT a separate question. They are the debate's
    // max_contestants — the same number, asked once. It is passed in by the
    // caller rather than read from `stream`, so the two can never disagree.
    let invite_slots = null;
    if (stream.invite_slots != null && stream.invite_slots !== "") {
        invite_slots = Number(stream.invite_slots);
        if (!Number.isInteger(invite_slots) || invite_slots < 1 || invite_slots > 100) {
            throw httpError(400, "invite_slots must be a whole number between 1 and 100");
        }
    }

    return {
        scheduled_at: start_at,
        // the zone the human chose, carried through to debates.start_timezone
        timezone: start_timezone,
        // the calendar day in that zone, for the DATE columns
        start_day,
        // null until the connect-channel step; never blocks submission.
        twitch_channel: stream.twitch_channel ? normalizeTwitchChannel(stream.twitch_channel) : null,
        // 'embed' = Twitch hosts and we iframe it, which is the default posture.
        // 'hybrid_record' additionally keeps our own R2 copy and is an admin
        // decision, not something an application should be able to opt into.
        method: "embed",
        invite_slots,
    };
};

// submitDebateApplication — the whole draft in one atomic call.
//
// user_id MUST come from the authed token at the route layer, never the body.
//
// THE SCHEDULE IS THE STREAM. Prompts no longer carry release/deadline windows —
// they are text, released without a per-prompt calendar. The one dated thing a
// sponsor schedules is the concluding Twitch broadcast, so `stream` is required
// and debates.start_date is derived from it (the feed and the deadline filters
// still read that column).
const submitDebateApplication = async ({
    user_id,
    // debate
    title,
    category,
    custom_category,
    description = null,
    win_type,
    hybrid_crowd_weight_pct = null,
    contribution_type = "closed",
    participation_type = "open",
    prize_amount,
    // 'cash' | 'non_cash' | 'both'. prize_is_cash is a GENERATED column derived
    // from this, so it is never sent — it would be rejected as a write to a
    // generated column.
    prize_type = "cash",
    prize_description = null,
    // hard cap on competitors; even numbers only (the form steps by two).
    max_contestants = null,
    entry_amount,
    free_entry = true,
    // The concluding Twitch broadcast: { scheduled_at, twitch_channel, invite_slots }.
    // Required — this is the debate's schedule now.
    stream = null,
    concluding_stream_at = null,
    min_age_required = null,
    excluded_states = null,
    prize_distribution_rules = null,
    scoring_methodology = null,
    // sponsor
    sponsor_display_name = null,
    // prompts
    prompts,
    // judges — required for a hybrid debate (a panel picks the winner), ignored
    // otherwise. [{ email, qualification, links: [] }]
    judges = null,
}) => {
    if (!user_id) throw httpError(401, "authentication required");

    const cleanTitle = title != null ? String(title).trim() : "";
    if (!cleanTitle) throw httpError(400, "title is required");
    if (cleanTitle.length > 256) throw httpError(400, "title must be 256 characters or fewer");

    if (!WIN_TYPES.includes(win_type)) {
        throw httpError(400, `win_type must be one of: ${WIN_TYPES.join(", ")}`);
    }
    if (!CONTRIBUTION_TYPES.includes(contribution_type)) {
        throw httpError(400, `contribution_type must be one of: ${CONTRIBUTION_TYPES.join(", ")}`);
    }
    if (!PARTICIPATION_TYPES.includes(participation_type)) {
        throw httpError(400, `participation_type must be one of: ${PARTICIPATION_TYPES.join(", ")}`);
    }

    // "other" means the free-text box holds the real answer.
    const resolvedCategory =
        category === "other" ? (custom_category != null ? String(custom_category).trim() || null : null)
        : category ? String(category).trim()
        : null;

    // A prize is cash, something else, or both — and whichever it is has to be
    // filled in. The DB enforces the same shape (debates_prize_shape_chk); this
    // is here so the sponsor gets a sentence instead of a constraint name.
    const PRIZE_TYPES = ["cash", "non_cash", "both"];
    if (!PRIZE_TYPES.includes(prize_type)) {
        throw httpError(400, `prize_type must be one of: ${PRIZE_TYPES.join(", ")}`);
    }
    const wantsCash = prize_type === "cash" || prize_type === "both";
    const wantsOther = prize_type === "non_cash" || prize_type === "both";

    const cleanPrizeDescription =
        prize_description != null ? String(prize_description).trim() : "";
    const sponsor_contribution_cents = wantsCash ? toCents(prize_amount) ?? 0 : 0;

    if (wantsCash) {
        if (!(sponsor_contribution_cents > 0)) {
            throw httpError(400, "enter the cash prize amount");
        }
        if (sponsor_contribution_cents > PRIZE_POOL_CAP_CENTS) {
            throw httpError(
                400,
                `the prize pool is capped at $${(PRIZE_POOL_CAP_CENTS / 100).toLocaleString()} — contests above that require state registration`
            );
        }
    }
    if (wantsOther) {
        if (!cleanPrizeDescription) {
            throw httpError(400, "describe what the winner receives");
        }
        if (cleanPrizeDescription.length > 500) {
            throw httpError(400, "the prize description must be 500 characters or fewer");
        }
    }

    // Even numbers only — the form steps by two, and a bracket that can't halve
    // is a scheduling problem nobody wants at the semi-final.
    let maxContestants = null;
    if (max_contestants != null && max_contestants !== "") {
        maxContestants = Number(max_contestants);
        if (!Number.isInteger(maxContestants) || maxContestants < 2 || maxContestants % 2 !== 0) {
            throw httpError(400, "max contestants must be an even number, 2 or more");
        }
    }
    // null = a free debate. 0 would claim "there is a fee, and it is nothing".
    const sponsor_entry_fee_cents = toCents(entry_amount);

    const rounds = validatePrompts(prompts);
    // max_contestants IS the broadcast's seat count — one number, asked once on
    // the form. Injected here so validateStream sees it as invite_slots and the
    // two can never drift apart. The DB caps invite_slots at 100; a bigger field
    // than that simply doesn't put everyone on the stream.
    const broadcast = validateStream({
        ...(stream || {}),
        invite_slots: maxContestants != null ? Math.min(maxContestants, 100) : null,
    });

    // A hybrid debate is decided by a panel, so it cannot be submitted without
    // one — an admin has to review WHO judges and WHY before approving, and a
    // hybrid debate with no panel has nobody to pick the winner. Validated
    // before the transaction opens so a bad email costs no DB work.
    // Non-hybrid debates simply carry no panel; anything sent is ignored.
    const panel = win_type === "hybrid" ? validateJudgePanel(judges || []) : [];
    if (win_type === "hybrid" && panel.length === 0) {
        throw httpError(400, "a hybrid debate needs at least one judge — add their email and why they're qualified");
    }

    // The broadcast date IS the debate's date. Both DATE columns are sent as
    // 'YYYY-MM-DD' STRINGS, never as a Date: pg serialises a Date using the
    // server's local timezone, and west of UTC that turns a midnight-UTC instant
    // into the previous evening, which the DATE cast then truncates to the day
    // BEFORE the one we meant. (Same trap the old prompt schedule hit.)
    //
    // The day comes from normalizeStart, computed in the SPONSOR'S zone — NOT by
    // slicing the ISO instant, which is a UTC date: an 8pm-ET debate is 00:00 UTC
    // the following day, so slicing filed it one day late.
    //
    // start_date and end_date are the same day: there is one event now, not a
    // window of prompt deadlines.
    const streamDay = broadcast.start_day;
    const start_date = streamDay;
    const end_date = streamDay;

    const weight =
        win_type === "hybrid"
            ? hybrid_crowd_weight_pct ?? DEFAULT_HYBRID_CROWD_WEIGHT_PCT
            : hybrid_crowd_weight_pct;

    try {
        return await withTransaction(async (tx) => {
            const sponsor = await resolveSponsor(tx, user_id, sponsor_display_name);

            const debateResult = await tx.query(
                `INSERT INTO debates (
                    sponsor_id, title, category, description, win_type, hybrid_crowd_weight_pct,
                    contribution_type, participation_type, sponsor_contribution_cents,
                    sponsor_entry_fee_cents, free_entry_method, prize_distribution_rules,
                    scoring_methodology, status, start_date, end_date, concluding_stream_at,
                    min_age_required, excluded_states,
                    prize_type, prize_description, max_contestants,
                    start_at, start_timezone
                 )
                 VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9,
                    $10, $11, $12,
                    $13, 'draft', $14, $15, $16,
                    COALESCE($17, 18), COALESCE($18::text[], '{}'),
                    $19, $20, $21,
                    $22, $23
                 )
                 RETURNING *;`,
                [
                    sponsor.id, cleanTitle, resolvedCategory, description, win_type, weight,
                    contribution_type, participation_type, sponsor_contribution_cents,
                    sponsor_entry_fee_cents,
                    // free_entry_method documents the alternate means of entry that keeps a
                    // paid-entry contest legal. The form's toggle is "may someone else
                    // nominate me in for free", so that IS the alternate method.
                    free_entry ? "nomination" : null,
                    prize_distribution_rules,
                    scoring_methodology, start_date || null, end_date, concluding_stream_at,
                    min_age_required, excluded_states,
                    prize_type, wantsOther ? cleanPrizeDescription : null, maxContestants,
                    // start_at is the instant; start_timezone is the zone the
                    // sponsor picked it in, which the instant cannot remember.
                    broadcast.scheduled_at, broadcast.timezone,
                ]
            );
            const debate = debateResult.rows[0];

            // Prompts are text + position. No title, no example video, and no
            // release_at/response_deadline — those columns stay NULL, which is
            // what "released with no per-prompt schedule" looks like in the DB.
            const created = [];
            for (const r of rounds) {
                const { rows } = await tx.query(
                    `INSERT INTO prompts (debate_id, prompt_order, prompt_type, body)
                     VALUES ($1, $2, $3, $4)
                     RETURNING *;`,
                    [debate.id, r.prompt_order, r.prompt_type, r.body]
                );
                created.push(rows[0]);
            }

            // Pre-disclosed judging criteria. Copied from the category catalog
            // INSIDE this transaction so a debate can never exist without the
            // rubric it published — the requirement is that entrants see what
            // they're judged on before they enter, and a failure here rolls the
            // whole submission back rather than leaving an unjudgeable debate.
            //
            // A free-text ("other") category matches no rubric and applies zero
            // criteria; that is not an error, and an admin fills them in through
            // POST /api/debates/:id/criteria.
            const rubric = await applyCategoryCriteria(
                { debate_id: debate.id, category: resolvedCategory },
                tx
            );
            debate.criteria_version = rubric.criteria_version;

            // Same transaction as the debate: a hybrid debate never exists
            // without the panel that decides it.
            const judgePanel = panel.length
                ? await addJudgePanel({ debate_id: debate.id, judges }, tx)
                : [];

            // The scheduled broadcast, in the SAME transaction as the debate.
            // The stream is the debate's only date, so a debate that exists
            // without one has no schedule at all — this must not be a follow-up
            // call that can fail on its own.
            //
            // host_user_id is the sponsor: they own the channel they just named.
            // embed_parent_domains is left empty for an admin to fill at approval
            // — it has to list the domains the iframe is embedded on, and getting
            // it wrong is the single most common cause of a black Twitch embed,
            // so it is not something to guess from an application.
            const streamRow = await scheduleDebateStream(
                {
                    debate_id: debate.id,
                    method: broadcast.method,
                    host_user_id: user_id,
                    twitch_channel: broadcast.twitch_channel,
                    scheduled_at: broadcast.scheduled_at,
                    invite_slots: broadcast.invite_slots,
                },
                tx
            );

            return {
                debate,
                sponsor,
                prompts: created,
                criteria: rubric.criteria,
                judges: judgePanel,
                stream: streamRow,
            };
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "this submission duplicates an existing prompt order");
        if (err.code === "23514") throw httpError(400, "a debate or prompt field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "a referenced row does not exist");
        if (err.code === "22P02" || err.code === "22007") throw httpError(400, "a uuid, date or array field is malformed");
        console.error(err);
        throw err;
    }
};

// listDebateApplications — the admin review queue. Defaults to status='draft',
// i.e. everything submitted and not yet acted on. Carries the sponsor's name and
// a prompt count so the queue is readable without a per-row fetch.
const listDebateApplications = async ({ status = "draft", limit = 100 } = {}) => {
    try {
        const SQL = `
            SELECT
                d.*,
                s.display_name  AS sponsor_display_name,
                s.type          AS sponsor_type,
                s.user_id       AS sponsor_user_id,
                s.verified_at   AS sponsor_verified_at,
                COUNT(p.id)::int AS prompt_count,
                -- the host tier the sponsor bought. t.display_name is what the
                -- inbox shows; tier_price_cents on the debate is what they
                -- actually paid, which can differ if the catalog price moved.
                t.display_name  AS tier_name,
                -- "paid" / "picked a tier, didn't pay" / "hasn't started" as one
                -- sortable column, so the inbox doesn't have to derive it.
                CASE
                    WHEN d.tier_refunded_at IS NOT NULL THEN 'refunded'
                    WHEN d.tier_paid_at IS NOT NULL THEN 'paid'
                    WHEN d.tier_key IS NOT NULL THEN 'unpaid'
                    ELSE 'not_started'
                END AS tier_status,
                (SELECT COUNT(*)::int FROM debate_judges j
                  WHERE j.debate_id = d.id AND j.recused_at IS NULL) AS judge_count
            FROM debates d
            JOIN sponsors s ON s.id = d.sponsor_id
            LEFT JOIN prompts p ON p.debate_id = d.id
            LEFT JOIN debate_host_tiers t ON t.tier_key = d.tier_key
            WHERE d.retired = false
              AND ($1::text IS NULL OR d.status = $1)
            GROUP BY d.id, s.display_name, s.type, s.user_id, s.verified_at, t.display_name
            ORDER BY d.created_at DESC
            LIMIT $2;
        `;
        // status='all' → every debate regardless of lifecycle state.
        const statusFilter = status === "all" ? null : status;
        const { rows } = await client.query(SQL, [statusFilter, Math.min(Number(limit) || 100, 500)]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// getDebateApplication — one submission in full: the debate, its sponsor, and
// every prompt in order (including unreleased ones — this is the admin view).
const getDebateApplication = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    try {
        const { rows } = await client.query(
            `SELECT d.*,
                    s.display_name AS sponsor_display_name,
                    s.type         AS sponsor_type,
                    s.user_id      AS sponsor_user_id,
                    s.verified_at  AS sponsor_verified_at
             FROM debates d
             JOIN sponsors s ON s.id = d.sponsor_id
             WHERE d.id = $1`,
            [debate_id]
        );
        const debate = rows[0];
        if (!debate) throw httpError(404, "debate application not found");

        const prompts = await client.query(
            `SELECT * FROM prompts WHERE debate_id = $1 ORDER BY prompt_order ASC`,
            [debate_id]
        );
        // The criteria this debate actually published (its own snapshot, not the
        // live catalog) — the admin reviewing the submission sees exactly what
        // the entrants will be judged on.
        const criteria = await client.query(
            `SELECT * FROM debate_judging_criteria
             WHERE debate_id = $1
             ORDER BY display_order, created_at`,
            [debate_id]
        );
        // The nominated panel, INCLUDING external_email — this is the admin
        // review view, and deciding whether to approve means being able to
        // contact and check the judges. The public projection in
        // debateJudges.getDebateJudges deliberately omits the address.
        const judges = await client.query(
            `SELECT * FROM debate_judges WHERE debate_id = $1 ORDER BY disclosed_at`,
            [debate_id]
        );
        // The scheduled broadcast — the debate's only date, so the admin
        // reviewing the application needs it in the same payload.
        const stream = await client.query(
            `SELECT * FROM debate_streams WHERE debate_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [debate_id]
        );
        return {
            debate,
            prompts: prompts.rows,
            criteria: criteria.rows,
            judges: judges.rows,
            stream: stream.rows[0] || null,
        };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed");
        console.error(err);
        throw err;
    }
};

// listMyDebateApplications — what the calling sponsor has submitted, so the form
// can show "your submissions" without an admin gate.
const listMyDebateApplications = async ({ user_id }) => {
    if (!user_id) throw httpError(401, "authentication required");
    try {
        const { rows } = await client.query(
            `SELECT d.*, COUNT(p.id)::int AS prompt_count
             FROM debates d
             JOIN sponsors s ON s.id = d.sponsor_id
             LEFT JOIN prompts p ON p.debate_id = d.id
             WHERE s.user_id = $1 AND d.retired = false
             GROUP BY d.id
             ORDER BY d.created_at DESC`,
            [user_id]
        );
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = {
    PRIZE_POOL_CAP_CENTS,
    toCents,
    submitDebateApplication,
    listDebateApplications,
    getDebateApplication,
    listMyDebateApplications,
};
