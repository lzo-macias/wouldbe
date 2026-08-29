const { client } = require("../index.js");
const { bracketSlots, slotKey } = require("./bracketSlots");

// ============================================================================
// Typed debates: one prompt per bracket match.
//
// A typed debate has no stream. The bracket is played in writing, and each match
// is a question the two contestants answer against each other — so the prompt is
// not "content attached to the debate", it IS the match. That is why these rows
// carry the same (round, side, position) coordinate debate_matches uses rather
// than a bare prompt_order: the pairing is computed from the seeding at render
// time, and geometry is the only key both ends can name the same way.
//
// THE SET IS COMPLETE OR THE DEBATE IS NOT VALID. A 16-person typed bracket
// needs 15 prompts. A missing one is a match two people are told to argue with
// no question in front of them, which cannot be fixed while it is happening —
// so the completeness check runs at submission, not at match time.
//
// The assist is a BANK, not a model: category_prompt_templates holds reviewed
// text an admin curates. Nothing here calls out to anything, which is what makes
// it free, deterministic, and safe to publish under a sponsor's name.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// prompts.prompt_type is a CHECK-constrained vocabulary; a match prompt is the
// thing contestants respond to, so 'response' is the honest value.
const MATCH_PROMPT_TYPE = "response";
const MAX_BODY = 2000;
// Reserved category in the template bank: the set used when a category has no
// bank of its own, so the assist button always returns something.
const FALLBACK_CATEGORY = "_default";

// ----------------------------------------------------------------------------
// the bank
// ----------------------------------------------------------------------------

// _bankFor — active templates for a category, bucketed by round_hint. Falls back
// to '_default' for a free-text category ("other", local_government) exactly the
// way ensureDebateCriteria falls back to the platform rubric.
const _bankFor = async (category, db = client) => {
    const { rows } = await db.query(
        `SELECT category, round_hint, body, display_order
         FROM category_prompt_templates
         WHERE is_active = true
           AND (LOWER(category) = LOWER($1) OR category = $2)
         ORDER BY display_order, body`,
        [String(category || "").trim(), FALLBACK_CATEGORY]
    );

    const own = rows.filter((r) => r.category !== FALLBACK_CATEGORY);
    const use = own.length ? own : rows;

    const byHint = { early: [], middle: [], final: [], any: [] };
    for (const r of use) byHint[r.round_hint]?.push(r.body);
    return byHint;
};

// suggestMatchPrompts — a full set of prompts for a field of this size.
//
// DETERMINISTIC AND NON-REPEATING WITHIN A BUCKET: slot i of a bucket takes
// template i (mod bucket size), so a 15-match bracket gets a spread rather than
// the same question fifteen times, and pressing the button twice gives the same
// answer. `offset` is what "give me different ones" costs — the form passes an
// incrementing number so a sponsor can shuffle without the server holding state.
//
// Buckets fall back to 'any' then to whatever is non-empty: a bank with no
// 'final' rows should still produce a final prompt rather than a blank one.
const suggestMatchPrompts = async ({ category, field_size, offset = 0 }, db = client) => {
    const slots = bracketSlots(field_size);
    if (!slots.length) throw httpError(400, "field_size must be at least 2");

    const bank = await _bankFor(category, db);
    const nonEmpty = ["early", "middle", "final", "any"].filter((k) => bank[k].length);
    if (!nonEmpty.length) throw httpError(409, "no prompt templates are available");

    const seen = {};
    return slots.map((slot) => {
        const bucket = bank[slot.round_hint]?.length
            ? bank[slot.round_hint]
            : bank.any.length
              ? bank.any
              : bank[nonEmpty[0]];
        const i = (seen[slot.round_hint] = (seen[slot.round_hint] ?? -1) + 1);
        return { ...slot, body: bucket[(i + Number(offset || 0)) % bucket.length] };
    });
};

// ----------------------------------------------------------------------------
// reads
// ----------------------------------------------------------------------------

// getMatchPrompts — the slot list for a debate's field size with whatever the
// sponsor has written attached. ALWAYS RETURNS EVERY SLOT, filled or not: the
// form and the admin view both need to see the holes, and a query that returned
// only the written ones would make a half-finished bracket look complete.
const getMatchPrompts = async ({ debate_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows: dbt } = await db.query(
        `SELECT id, format, category, max_contestants FROM debates WHERE id = $1`,
        [debate_id]
    );
    const debate = dbt[0];
    if (!debate) throw httpError(404, "debate not found");

    const { rows: written } = await db.query(
        `SELECT id, prompt_order, prompt_type, body,
                bracket_round, bracket_side, bracket_position
         FROM prompts
         WHERE debate_id = $1 AND bracket_round IS NOT NULL
         ORDER BY bracket_round, bracket_side, bracket_position`,
        [debate_id]
    );
    const byKey = new Map(
        written.map((p) => [slotKey(p.bracket_side, p.bracket_round, p.bracket_position), p])
    );

    const slots = bracketSlots(debate.max_contestants).map((slot) => {
        const p = byKey.get(slot.key);
        return { ...slot, prompt_id: p?.id ?? null, body: p?.body ?? null };
    });

    return {
        debate_id,
        format: debate.format,
        category: debate.category,
        field_size: debate.max_contestants,
        required: slots.length,
        filled: slots.filter((s) => s.body).length,
        slots,
        // Prompts with no bracket slot — a live debate's ordered list. Always
        // fetched, not only when the slotted set is empty: a debate switched
        // from live to typed keeps both, and the admin view is the place that
        // has to show what is actually in the table.
        unslotted: await _unslotted(debate_id, db),
    };
};

const _unslotted = async (debate_id, db = client) => {
    const { rows } = await db.query(
        `SELECT id, prompt_order, prompt_type, body FROM prompts
         WHERE debate_id = $1 AND bracket_round IS NULL
         ORDER BY prompt_order`,
        [debate_id]
    );
    return rows;
};

// ----------------------------------------------------------------------------
// writes
// ----------------------------------------------------------------------------

// validateMatchPrompts — check a submitted set against the geometry BEFORE
// anything is written. Returns rows ready to insert, in slot order.
//
// Callable without a debate row (the application path validates before the
// debate exists), which is why it takes field_size rather than a debate_id.
const validateMatchPrompts = ({ prompts, field_size }) => {
    const slots = bracketSlots(field_size);
    if (!slots.length) throw httpError(400, "a bracket needs at least 2 contestants");
    if (!Array.isArray(prompts)) throw httpError(400, "prompts must be an array");

    const byKey = new Map();
    for (const p of prompts) {
        if (!p || typeof p !== "object") throw httpError(400, "a prompt is malformed");
        // Accept either an explicit slot or the array's own order — the form
        // sends slots, an older or simpler client can send them in order.
        const key =
            p.bracket_side != null && p.bracket_round != null && p.bracket_position != null
                ? slotKey(p.bracket_side, p.bracket_round, p.bracket_position)
                : p.key;
        if (key) byKey.set(key, p);
    }
    const ordered = byKey.size ? slots.map((s) => byKey.get(s.key)) : slots.map((_, i) => prompts[i]);

    return slots.map((slot, i) => {
        const p = ordered[i];
        const body = p?.body != null ? String(p.body).trim() : "";
        if (!body) {
            throw httpError(400, `every match needs a prompt — "${slot.label}" is empty`);
        }
        if (body.length > MAX_BODY) {
            throw httpError(400, `"${slot.label}": a prompt must be ${MAX_BODY} characters or fewer`);
        }
        return {
            prompt_order: i + 1,
            prompt_type: MATCH_PROMPT_TYPE,
            body,
            bracket_round: slot.round,
            bracket_side: slot.side,
            bracket_position: slot.position,
        };
    });
};

// insertMatchPrompts — write a validated set. Runs on the CALLER'S executor so
// the application path can put the debate and its prompts in one transaction:
// a typed debate with half its prompts is worse than no debate.
const insertMatchPrompts = async ({ debate_id, rows }, db = client) => {
    const created = [];
    for (const r of rows) {
        const { rows: out } = await db.query(
            `INSERT INTO prompts
                (debate_id, prompt_order, prompt_type, body,
                 bracket_round, bracket_side, bracket_position)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (debate_id, bracket_round, bracket_side, bracket_position)
                 WHERE bracket_round IS NOT NULL
             DO UPDATE SET body = EXCLUDED.body,
                           prompt_order = EXCLUDED.prompt_order,
                           updated_at = NOW()
             RETURNING *`,
            [
                debate_id, r.prompt_order, r.prompt_type, r.body,
                r.bracket_round, r.bracket_side, r.bracket_position,
            ]
        );
        created.push(out[0]);
    }
    return created;
};

// setMatchPrompts — the sponsor rewriting their own set after submission.
// Ownership is checked here rather than in the route so no future caller can
// skip it. Upserts by slot, so editing one prompt does not renumber the rest.
const setMatchPrompts = async ({ debate_id, user_id, prompts }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    const { rows } = await db.query(
        `SELECT d.id, d.format, d.status, d.max_contestants, (s.user_id = $2) AS is_owner
         FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id, user_id]
    );
    const debate = rows[0];
    if (!debate) throw httpError(404, "debate not found");
    if (!debate.is_owner) throw httpError(403, "only the host of this debate can set its prompts");
    if (debate.format !== "typed") {
        throw httpError(409, "only a typed debate has match prompts");
    }
    // Once entry is open the prompts are part of what people entered under.
    // Editing them mid-contest changes the question after the answer.
    if (!["draft", "open_entry"].includes(debate.status)) {
        throw httpError(409, `this debate is ${debate.status} — its prompts are locked`);
    }

    const validated = validateMatchPrompts({ prompts, field_size: debate.max_contestants });
    return await insertMatchPrompts({ debate_id, rows: validated }, db);
};

module.exports = {
    MATCH_PROMPT_TYPE,
    suggestMatchPrompts,
    getMatchPrompts,
    validateMatchPrompts,
    insertMatchPrompts,
    setMatchPrompts,
};
