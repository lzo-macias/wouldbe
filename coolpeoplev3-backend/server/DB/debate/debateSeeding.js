const { client, withTransaction } = require("../index.js");
const { bracketSlots, slotKey, nextPowerOfTwo } = require("./bracketSlots");
const { scheduleTypedRounds } = require("./matchResponses");
const { sendEmail, APP_URL } = require("../../services/notify");

// ============================================================================
// SEEDING DAY — the sponsor turns a field of entrants into a bracket.
//
// THE SHAPE OF IT
//   approval ──7 days minimum──▶ start ──▶ field finalised ──▶ sponsor seeds
//                                                                  │
//                                                          lock ◀───┘
//                                            matches written · prompts frozen
//                                            contestants notified · clock runs
//
// WHY THE SEVEN DAYS IS COUNTED FROM APPROVAL. A debate is invisible until an
// admin approves it, so nobody can nominate into it before then. Counting from
// submission would let a sponsor satisfy the rule with a one-day nomination
// window: submit thirteen days out, get approved on day twelve. The floor
// exists to guarantee a week of NOMINATING, so it starts when nominating can.
//
// WHY A DRAFT/LOCK SPLIT rather than one save. Seeding is a series of judgement
// calls — who plays whom, which question each match gets — and the sponsor will
// move things around. Every one of those edits is cheap and reversible right up
// to the moment it isn't: locking writes debate_matches, freezes the prompts,
// tells fourteen people what they are answering, and starts a clock. Those two
// need different verbs.
//
// WHAT LOCKING MEANS FOR PROMPTS. Assigning them here — after the field is
// known — is a deliberate choice with a cost worth naming: a sponsor can see
// who is in a match before writing its question. The mitigations are that the
// bank is pre-published, that the default is a random draw nobody chose, and
// that the assignment is frozen and shown to everyone at lock. If aimed
// questions ever become a real complaint, the fix is to require the prompts at
// application time (the form already collects them) and let seeding only
// reorder — the data model supports that without a migration.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// The floor between a debate going live and its start. Seven days of nominating
// is the product rule; it lives here as a constant because two call sites
// enforce it (approval, and the schedule preview) and a literal 7 in both is how
// they drift apart.
const MIN_LEAD_DAYS = 7;

// ---------------------------------------------------------------------------
// the default pairing
// ---------------------------------------------------------------------------

// standardSeedOrder — the classic bracket pairing, as an array of seed numbers
// in slot order: 1 plays the last seed, 2 plays the second-last, and the two
// halves are arranged so the top two seeds can only meet in the final.
//
// This is the "most nominations against least" the product asks for, done
// properly. Naively pairing 1v8, 2v7, 3v6, 4v5 down a column does give the top
// seed the weakest opponent in round ONE — and then puts seeds 1 and 2 in the
// same half, so they meet in the semifinal and the final is seeds 1 and 3. The
// recursive construction below is what keeps a seed's strength meaningful for
// the whole bracket rather than only its first match.
//
//   size 2 -> [1, 2]
//   size 4 -> [1, 4, 3, 2]
//   size 8 -> [1, 8, 5, 4, 3, 6, 7, 2]
const standardSeedOrder = (size) => {
    let order = [1, 2];
    while (order.length < size) {
        const round = order.length * 2 + 1;
        const next = [];
        for (const seed of order) {
            next.push(seed, round - seed);
        }
        order = next;
    }
    return order;
};

// firstRoundPairs — who meets whom in round 0, as [seedA, seedB] pairs in the
// order bracketSlots lists round-0 slots (left before right, position ascending).
//
// A field that is not a power of two is padded, and a padded seat is a BYE: the
// seed opposite it advances without playing. A bye is not a match — there is
// nobody to argue against and nothing to vote on — so it produces no row.
const firstRoundPairs = (fieldSize) => {
    const size = nextPowerOfTwo(fieldSize);
    const order = standardSeedOrder(size);
    const pairs = [];
    for (let i = 0; i < order.length; i += 2) {
        const a = order[i] <= fieldSize ? order[i] : null;
        const b = order[i + 1] <= fieldSize ? order[i + 1] : null;
        pairs.push([a, b]);
    }
    return pairs;
};

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const _loadDebate = async (debate_id, db = client) => {
    const { rows } = await db.query(
        `SELECT d.id, d.title, d.status, d.format, d.category, d.participation_type,
                d.max_contestants, d.start_at, d.start_timezone, d.approved_at,
                d.round_grace_hours, d.vote_window_hours,
                d.seeding_notified_at, d.seeding_locked_at,
                s.user_id AS sponsor_user_id, s.display_name AS sponsor_name
           FROM debates d
           JOIN sponsors s ON s.id = d.sponsor_id
          WHERE d.id = $1`,
        [debate_id]
    );
    if (!rows.length) throw httpError(404, "debate not found");
    return rows[0];
};

// The caller must be this debate's sponsor, or an admin. Seeding decides who
// competes for a prize, so it is not a thing a stranger gets to look at.
const _assertSeeder = (debate, user_id, is_admin) => {
    if (is_admin) return;
    if (!user_id || debate.sponsor_user_id !== user_id) {
        throw httpError(403, "only this debate's sponsor can seed it");
    }
};

// leadDaysOk — the seven-day floor, as a fact rather than a throw, because both
// callers want to REPORT it as well as enforce it.
const leadCheck = (approved_at, start_at) => {
    if (!start_at) return { ok: false, days: null, reason: "this debate has no start time" };
    const from = approved_at ? new Date(approved_at).getTime() : Date.now();
    const days = (new Date(start_at).getTime() - from) / DAY_MS;
    return {
        ok: days >= MIN_LEAD_DAYS,
        days: Math.floor(days * 10) / 10,
        required_days: MIN_LEAD_DAYS,
        reason:
            days >= MIN_LEAD_DAYS
                ? null
                : `a debate must be open for nominations for at least ${MIN_LEAD_DAYS} days before it starts — this one has ${Math.max(0, Math.floor(days * 10) / 10)}`,
    };
};

// roundWindows — the whole calendar, derived from start_at and the two windows.
// Round i opens when round i-1's VOTE closes, so the pitch is write + read.
// Returned by the seeding page so a sponsor can see the end date before they
// commit to it — a 32-field at 96h is five weeks and should not be a surprise.
const roundWindows = ({ start_at, max_contestants, round_grace_hours, vote_window_hours }) => {
    if (!start_at) return [];
    const slots = bracketSlots(max_contestants);
    const rounds = [...new Set(slots.map((s) => s.round))].sort((a, b) => a - b);
    const write = Number(round_grace_hours) * HOUR_MS;
    const read = Number(vote_window_hours) * HOUR_MS;
    const start = new Date(start_at).getTime();
    return rounds.map((round, i) => {
        const opens = start + i * (write + read);
        return {
            round,
            release_at: new Date(opens).toISOString(),
            response_deadline: new Date(opens + write).toISOString(),
            vote_closes_at: new Date(opens + write + read).toISOString(),
        };
    });
};

// getSeedingBoard — everything the sponsor's seeding page renders, in one read.
//
// The field, ranked. Nomination counts come from the same query the public
// tally uses, so the order the sponsor sees is the order the room saw.
const getSeedingBoard = async ({ debate_id, user_id = null, is_admin = false }) => {
    const debate = await _loadDebate(debate_id);
    _assertSeeder(debate, user_id, is_admin);

    // The field: active contestants only. A withdrawal or a disqualification
    // between entry close and seeding day has to remove someone from the
    // bracket, not leave a ghost seat that nobody can fill.
    const { rows: field } = await client.query(
        `SELECT c.id, c.user_id, c.seed, c.joined_at,
                u.first_name, u.last_name, u.username, u.profile_photo_url,
                COALESCE(n.nomination_count, 0)::int AS nomination_count,
                EXISTS (
                    SELECT 1 FROM nomination_invites i
                     WHERE i.debate_id = c.debate_id AND i.invitee_user_id = c.user_id
                ) AS invited
           FROM contestants c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN (
                SELECT nominee_user_id, COUNT(DISTINCT nominator_user_id)::int AS nomination_count
                  FROM nominations
                 WHERE debate_id = $1
                 GROUP BY nominee_user_id
           ) n ON n.nominee_user_id = c.user_id
          WHERE c.debate_id = $1
            AND c.withdrew_at IS NULL
            AND c.status <> 'disqualified'
          -- Seeded order when it exists, otherwise the ranking the default
          -- pairing would use: most nominations first, earliest entry breaking
          -- a tie (arbitrary, but stable and visible).
          ORDER BY c.seed NULLS LAST, n.nomination_count DESC NULLS LAST, c.joined_at ASC`,
        [debate_id]
    );

    // Every match slot, with whatever prompt is already attached. A typed debate
    // collected these on the application form, so most slots arrive filled; a
    // live debate's are empty until the sponsor assigns or shuffles them.
    const { rows: prompts } = await client.query(
        `SELECT id, body, bracket_round, bracket_side, bracket_position
           FROM prompts
          WHERE debate_id = $1 AND bracket_round IS NOT NULL`,
        [debate_id]
    );
    const promptBySlot = new Map(
        prompts.map((p) => [slotKey(p.bracket_side, p.bracket_round, p.bracket_position), p])
    );

    const slots = bracketSlots(debate.max_contestants).map((s) => {
        const p = promptBySlot.get(s.key) || null;
        return { ...s, prompt_id: p?.id ?? null, prompt: p?.body ?? "" };
    });

    // The round-0 pairing implied by the CURRENT seeds. Derived, never stored:
    // the seed is the fact, and the pairing is arithmetic on it, so dragging one
    // contestant can't leave a pairing that disagrees with the seeds.
    const seeded = field.filter((c) => c.seed != null);
    const bySeed = new Map(seeded.map((c) => [c.seed, c]));
    const pairs = firstRoundPairs(field.length).map(([a, b], i) => {
        const slot = bracketSlots(field.length).filter((s) => s.round === 0)[i] || null;
        return {
            slot_key: slot?.key ?? null,
            label: slot?.label ?? null,
            a: a != null ? bySeed.get(a) ?? null : null,
            b: b != null ? bySeed.get(b) ?? null : null,
            // A padded seat. The other side advances without arguing, so this
            // produces no match row and no prompt is spent on it.
            bye: a == null || b == null,
        };
    });

    const lead = leadCheck(debate.approved_at, debate.start_at);
    const windows = roundWindows(debate);

    return {
        debate: {
            id: debate.id,
            title: debate.title,
            status: debate.status,
            format: debate.format,
            category: debate.category,
            participation_type: debate.participation_type,
            max_contestants: debate.max_contestants,
            start_at: debate.start_at,
            start_timezone: debate.start_timezone,
            approved_at: debate.approved_at,
            round_grace_hours: debate.round_grace_hours,
            vote_window_hours: debate.vote_window_hours,
            seeding_notified_at: debate.seeding_notified_at,
            seeding_locked_at: debate.seeding_locked_at,
        },
        lead,
        field,
        slots,
        pairs,
        windows,
        // What still stands between the sponsor and locking. The page renders
        // this directly rather than re-deriving the same rules in JSX.
        blockers: seedingBlockers({ debate, field, slots }),
        locked: !!debate.seeding_locked_at,
    };
};

// seedingBlockers — every reason this bracket cannot be locked yet, as a list
// rather than the first one found. A sponsor fixing four things one refusal at a
// time is the experience the apply form's summary rail exists to avoid.
const seedingBlockers = ({ debate, field, slots }) => {
    const out = [];
    if (debate.seeding_locked_at) out.push("This bracket is already locked.");
    if (field.length < 2) {
        out.push("A bracket needs at least two contestants.");
    }
    const unseeded = field.filter((c) => c.seed == null);
    if (unseeded.length) {
        out.push(`${unseeded.length} contestant${unseeded.length === 1 ? " has" : "s have"} no seed yet.`);
    }
    // Duplicate seeds are refused by a unique index too; this is the readable
    // version of that error.
    const seeds = field.map((c) => c.seed).filter((s) => s != null);
    if (new Set(seeds).size !== seeds.length) out.push("Two contestants share a seed.");

    const emptyPrompts = slots.filter((s) => !String(s.prompt || "").trim());
    if (emptyPrompts.length) {
        out.push(
            `${emptyPrompts.length} match${emptyPrompts.length === 1 ? "" : "es"} still ${
                emptyPrompts.length === 1 ? "has" : "have"
            } no prompt.`
        );
    }
    return out;
};

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

// autoSeed — fill the seeds from the nomination ranking, most-nominated first.
//
// The pairing that falls out of this is "most nominations against least", which
// is what the product asks for: seed 1 is the most nominated, and
// standardSeedOrder puts seed 1 against the last seed in round one.
//
// Invitation-only debates get seeded by entry order instead, because nomination
// counts are meaningless there — nobody nominated anyone. The sponsor is
// expected to rearrange, and this only saves them from an empty board.
const autoSeed = async ({ debate_id, user_id = null, is_admin = false }) => {
    const debate = await _loadDebate(debate_id);
    _assertSeeder(debate, user_id, is_admin);
    if (debate.seeding_locked_at) throw httpError(409, "this bracket is locked");

    return withTransaction(async (tx) => {
        const { rows: field } = await tx.query(
            `SELECT c.id,
                    COALESCE(n.nomination_count, 0)::int AS nomination_count,
                    c.joined_at
               FROM contestants c
               LEFT JOIN (
                    SELECT nominee_user_id, COUNT(DISTINCT nominator_user_id)::int AS nomination_count
                      FROM nominations WHERE debate_id = $1 GROUP BY nominee_user_id
               ) n ON n.nominee_user_id = c.user_id
              WHERE c.debate_id = $1
                AND c.withdrew_at IS NULL
                AND c.status <> 'disqualified'
              ORDER BY n.nomination_count DESC NULLS LAST, c.joined_at ASC
             FOR UPDATE OF c`,
            [debate_id]
        );

        // Clear first. Seeds are unique per debate, so assigning 1..N over a
        // partially-seeded field would collide with whatever already holds a
        // number this pass is about to hand to someone else.
        await tx.query(
            `UPDATE contestants SET seed = NULL, updated_at = NOW() WHERE debate_id = $1`,
            [debate_id]
        );
        for (let i = 0; i < field.length; i++) {
            await tx.query(
                `UPDATE contestants SET seed = $2, updated_at = NOW() WHERE id = $1`,
                [field[i].id, i + 1]
            );
        }
        return { seeded: field.length };
    });
};

// saveSeeding — the sponsor's draft. Seeds and prompts, in one call, because
// they are edited on one screen and a half-saved board is a board that renders
// wrong on the next load.
//
// `seeds` is [{ contestant_id, seed }], `prompts` is { [slot_key]: body }.
// Either may be omitted — the page saves whichever half changed.
const saveSeeding = async ({ debate_id, user_id = null, is_admin = false, seeds = null, prompts = null }) => {
    const debate = await _loadDebate(debate_id);
    _assertSeeder(debate, user_id, is_admin);
    if (debate.seeding_locked_at) throw httpError(409, "this bracket is locked");

    return withTransaction(async (tx) => {
        if (Array.isArray(seeds)) {
            const wanted = seeds.filter((s) => s && s.contestant_id);
            const numbers = wanted.map((s) => Number(s.seed)).filter((n) => Number.isInteger(n));
            if (new Set(numbers).size !== numbers.length) {
                throw httpError(400, "two contestants were given the same seed");
            }
            // Every seed is cleared before any is set. The unique index is on
            // (debate_id, seed), so swapping two contestants by writing one and
            // then the other transiently duplicates a number and the first write
            // fails — even though the end state is perfectly valid.
            await tx.query(
                `UPDATE contestants SET seed = NULL, updated_at = NOW() WHERE debate_id = $1`,
                [debate_id]
            );
            for (const s of wanted) {
                const n = Number(s.seed);
                if (!Number.isInteger(n) || n < 1) continue;
                const { rowCount } = await tx.query(
                    `UPDATE contestants
                        SET seed = $3, updated_at = NOW()
                      WHERE id = $1 AND debate_id = $2`,
                    [s.contestant_id, debate_id, n]
                );
                if (!rowCount) throw httpError(400, "a seeded contestant is not in this debate");
            }
        }

        if (prompts && typeof prompts === "object") {
            const known = new Map(bracketSlots(debate.max_contestants).map((s) => [s.key, s]));
            for (const [key, body] of Object.entries(prompts)) {
                const slot = known.get(key);
                // A prompt for a slot this bracket does not have is a prompt
                // nobody will ever see — refuse it rather than store it.
                if (!slot) throw httpError(400, `"${key}" is not a match in this bracket`);
                const text = String(body ?? "").trim();
                await tx.query(
                    `INSERT INTO prompts
                        (debate_id, prompt_type, body, bracket_round, bracket_side, bracket_position)
                     VALUES ($1, 'response', $2, $3, $4, $5)
                     ON CONFLICT (debate_id, bracket_round, bracket_side, bracket_position)
                       WHERE bracket_round IS NOT NULL
                     DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
                    [debate_id, text, slot.round, slot.side, slot.position]
                );
            }
        }

        return { saved: true };
    });
};

// shufflePrompts — fill every empty slot from the published template bank.
//
// THE DEFAULT, and the reason a sponsor can lock without writing fourteen
// questions. Draws by round_hint, so an opener gets an opening question and the
// final gets a closing one, and never repeats a body inside one debate — the
// same question twice in a bracket is two matches the room cannot compare.
//
// `overwrite` replaces what is already there; without it, only empty slots are
// filled, so a sponsor who wrote three good ones does not lose them.
const shufflePrompts = async ({ debate_id, user_id = null, is_admin = false, overwrite = false }) => {
    const debate = await _loadDebate(debate_id);
    _assertSeeder(debate, user_id, is_admin);
    if (debate.seeding_locked_at) throw httpError(409, "this bracket is locked");

    const slots = bracketSlots(debate.max_contestants);

    // The bank, category-first with the shared '_default' set behind it, so a
    // category with a thin bank still fills every slot.
    const { rows: bank } = await client.query(
        `SELECT body, round_hint
           FROM category_prompt_templates
          WHERE is_active = TRUE
            AND (LOWER(category) = LOWER($1) OR category = '_default')
          ORDER BY (LOWER(category) = LOWER($1)) DESC, display_order, body`,
        [debate.category || "_default"]
    );
    if (!bank.length) throw httpError(409, "no prompt templates are available to draw from");

    const { rows: existing } = await client.query(
        `SELECT body, bracket_round, bracket_side, bracket_position
           FROM prompts WHERE debate_id = $1 AND bracket_round IS NOT NULL`,
        [debate_id]
    );
    const have = new Map(
        existing.map((p) => [slotKey(p.bracket_side, p.bracket_round, p.bracket_position), p.body])
    );

    // Used bodies start with whatever is already on the board (when keeping
    // them), so a shuffle cannot hand out a question the sponsor already wrote.
    const used = new Set(overwrite ? [] : [...have.values()].filter(Boolean));

    const pick = (hint) => {
        const tiers = [
            bank.filter((b) => b.round_hint === hint && !used.has(b.body)),
            bank.filter((b) => b.round_hint === "any" && !used.has(b.body)),
            bank.filter((b) => !used.has(b.body)),
            // Last resort: the bank is smaller than the bracket. Repeating is
            // better than leaving a match with no question at all.
            bank,
        ];
        const tier = tiers.find((t) => t.length) || bank;
        const choice = tier[Math.floor(Math.random() * tier.length)];
        used.add(choice.body);
        return choice.body;
    };

    const assigned = {};
    for (const s of slots) {
        const current = String(have.get(s.key) || "").trim();
        if (current && !overwrite) continue;
        assigned[s.key] = pick(s.round_hint);
    }

    if (Object.keys(assigned).length) {
        await saveSeeding({ debate_id, user_id, is_admin, prompts: assigned });
    }
    return { assigned: Object.keys(assigned).length, prompts: assigned };
};

// lockSeeding — the irreversible step.
//
// In ONE transaction: validate, write the round-0 matches, stamp the lock, and
// set the round clock. A bracket that is half-written is worse than one that is
// not written at all — the contestants would have been told a pairing the board
// does not agree with.
//
// Notifications are sent AFTER the transaction commits, deliberately. An email
// provider timing out must not roll back a lock the sponsor has been told
// succeeded, and a contestant told their prompt for a bracket that was then
// rolled back is the worse of the two failures by a distance.
const lockSeeding = async ({ debate_id, user_id = null, is_admin = false }) => {
    const debate = await _loadDebate(debate_id);
    _assertSeeder(debate, user_id, is_admin);
    if (debate.seeding_locked_at) throw httpError(409, "this bracket is already locked");

    const board = await getSeedingBoard({ debate_id, user_id, is_admin });
    if (board.blockers.length) {
        throw httpError(409, board.blockers.join(" "));
    }

    const result = await withTransaction(async (tx) => {
        const { rows: field } = await tx.query(
            `SELECT id, user_id, seed FROM contestants
              WHERE debate_id = $1 AND withdrew_at IS NULL AND status <> 'disqualified'
                AND seed IS NOT NULL
              ORDER BY seed
             FOR UPDATE`,
            [debate_id]
        );
        const bySeed = new Map(field.map((c) => [c.seed, c]));

        // ROUND ZERO ONLY. Later rounds have no contestants yet — they are
        // whoever wins — so writing them now would mean inventing pairings. Each
        // round's matches are created as the previous one decides.
        const round0 = bracketSlots(field.length).filter((s) => s.round === 0);
        const pairs = firstRoundPairs(field.length);

        let written = 0;
        const byes = [];
        for (let i = 0; i < round0.length; i++) {
            const [a, b] = pairs[i] || [];
            const ca = a != null ? bySeed.get(a) : null;
            const cb = b != null ? bySeed.get(b) : null;
            if (!ca || !cb) {
                // A bye. No match row: there is nobody to argue against and
                // nothing for the room to vote on.
                if (ca || cb) byes.push((ca || cb).id);
                continue;
            }
            await tx.query(
                `INSERT INTO debate_matches
                    (debate_id, round, side, position, contestant_a_id, contestant_b_id)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (debate_id, round, side, position) DO NOTHING`,
                [debate_id, round0[i].round, round0[i].side, round0[i].position, ca.id, cb.id]
            );
            written++;
        }

        const { rows: locked } = await tx.query(
            `UPDATE debates
                SET seeding_locked_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND seeding_locked_at IS NULL
              RETURNING id, format, start_at`,
            [debate_id]
        );
        // Somebody else locked it between the check and here. The unique-ish
        // guard is the WHERE clause; this is its readable error.
        if (!locked.length) throw httpError(409, "this bracket was locked by someone else");

        return { matches: written, byes };
    });

    // The clock. A typed debate's windows are stamped from start_at now that the
    // pairings are final; a live debate has no per-round deadlines to set.
    let rounds = null;
    if (debate.format === "typed") {
        rounds = await scheduleTypedRounds({ debate_id });
    }

    const notified = await notifyContestantsOfPrompts({ debate_id });

    return { locked: true, ...result, rounds, notified };
};

// notifyContestantsOfPrompts — tell each contestant who they are facing, what
// they are answering first, and when it is due.
//
// Sent once, at lock. The first prompt's body is IN the email rather than only
// behind a link, because the thing a contestant needs at 11pm is the question,
// and a link that asks them to sign in first is a question they read tomorrow.
//
// The link goes to /my-prompts, not to the debate: every round on their path is
// already written and answerable there, and the whole point of handing them the
// list is that they can start on any of it tonight.
const notifyContestantsOfPrompts = async ({ debate_id }) => {
    const { rows } = await client.query(
        `SELECT u.email, u.first_name,
                d.title, d.start_timezone,
                p.body AS prompt, p.response_deadline,
                opp.username AS opponent_username,
                opp.first_name AS opponent_first_name
           FROM debate_matches m
           JOIN debates d ON d.id = m.debate_id
           JOIN contestants c
             ON c.id IN (m.contestant_a_id, m.contestant_b_id)
           JOIN users u ON u.id = c.user_id
           JOIN contestants oc
             ON oc.id = CASE WHEN c.id = m.contestant_a_id
                             THEN m.contestant_b_id ELSE m.contestant_a_id END
           JOIN users opp ON opp.id = oc.user_id
           LEFT JOIN prompts p
             ON p.debate_id = m.debate_id
            AND p.bracket_round = m.round
            AND p.bracket_side = m.side
            AND p.bracket_position = m.position
          WHERE m.debate_id = $1 AND m.round = 0`,
        [debate_id]
    );

    let sent = 0;
    for (const r of rows) {
        if (!r.email) continue;
        const due = r.response_deadline
            ? new Date(r.response_deadline).toLocaleString("en-US", {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: r.start_timezone || "America/New_York",
              })
            : "when the round closes";
        try {
            await sendEmail({
                to: r.email,
                subject: `You're in: ${r.title}`,
                text: [
                    `${r.first_name ? `${r.first_name}, ` : ""}the bracket for "${r.title}" is set.`,
                    ``,
                    `You're up against ${r.opponent_first_name || r.opponent_username}.`,
                    ``,
                    `Your first prompt:`,
                    r.prompt || "(your host will post this shortly)",
                    ``,
                    `Due ${due} (${r.start_timezone || "America/New_York"}).`,
                    ``,
                    `Every round you could reach already has its question, and they are all on one page — you can write as far ahead as you like. Edit any of them as often as you want until that round's deadline. Nothing is public before a deadline passes, and then both answers in a match go up together.`,
                    ``,
                    `${APP_URL}/debate/${debate_id}/my-prompts`,
                ].join("\n"),
            });
            sent++;
        } catch (err) {
            // One bad address must not stop the other thirteen people being told
            // what they are answering.
            console.error("[seeding] contestant notification failed", err);
        }
    }
    return sent;
};

// notifySponsorToSeed — "your field is final, come build the bracket".
//
// Called by whatever starts the debate. Stamps seeding_notified_at so it is sent
// once, and so the sponsor's page can say when they were asked.
const notifySponsorToSeed = async ({ debate_id }) => {
    const { rows } = await client.query(
        `UPDATE debates
            SET seeding_notified_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND seeding_notified_at IS NULL
          RETURNING id, title`,
        [debate_id]
    );
    if (!rows.length) return { notified: false };

    const { rows: who } = await client.query(
        `SELECT u.email, u.first_name
           FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
           JOIN users u ON u.id = s.user_id
          WHERE d.id = $1`,
        [debate_id]
    );
    const sponsor = who[0];
    if (sponsor?.email) {
        try {
            await sendEmail({
                to: sponsor.email,
                subject: `Set the bracket for "${rows[0].title}"`,
                text: [
                    `${sponsor.first_name ? `${sponsor.first_name}, ` : ""}entry has closed for "${rows[0].title}" and your field is final.`,
                    ``,
                    `Next: set the first-round pairings and pick a prompt for each match. We've suggested both — most-nominated against least-nominated, and questions drawn from the published bank — so you can change what you want and leave the rest.`,
                    ``,
                    `Nothing goes out to the contestants until you lock it in.`,
                    ``,
                    `${APP_URL}/startadebate/${debate_id}/seed`,
                ].join("\n"),
            });
        } catch (err) {
            console.error("[seeding] sponsor notification failed", err);
        }
    }
    return { notified: true };
};

module.exports = {
    MIN_LEAD_DAYS,
    leadCheck,
    roundWindows,
    standardSeedOrder,
    firstRoundPairs,
    getSeedingBoard,
    seedingBlockers,
    autoSeed,
    saveSeeding,
    shufflePrompts,
    lockSeeding,
    notifySponsorToSeed,
    notifyContestantsOfPrompts,
};
