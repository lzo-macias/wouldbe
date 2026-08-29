/* Typed vs live debates, and a prompt for every bracket match.
 *
 * THE CHANGE: a debate now declares HOW it is argued, at creation.
 *
 *   'live'   — the existing shape. A Twitch stream, contestants argue on camera,
 *              the host puts each match to a vote as it happens.
 *   'typed'  — no stream. Every MATCH in the bracket carries its own written
 *              prompt; the two contestants answer it in text and the room scores
 *              the answers.
 *
 * WHY A PROMPT PER MATCH, and why it is bound to bracket GEOMETRY rather than
 * just ordered: in a typed debate the prompt IS the match. Two people are
 * answering one specific question against each other, and which question that is
 * has to survive a page refresh, a re-seed, and the same person appearing in
 * three rounds. debate_matches is already keyed on (round, side, position) —
 * the coordinate the client computes from the seeding and the server stores — so
 * prompts use the SAME key. Anything else needs a join table to answer "what is
 * this match about".
 *
 * The columns are NULLABLE and the unique index is PARTIAL because live debates
 * still have plain ordered prompts with no bracket slot at all, and every prompt
 * written before today is one of those.
 *
 * category_prompt_templates is the "AI assist" bank. It is a TABLE, not a
 * constant in a JS file, for the same reason category_judging_criteria is one:
 * an admin extends the vocabulary with an INSERT, not a deploy. Nothing here
 * calls a model — the assist picks from published, reviewed text, which is also
 * what makes it safe to put a sponsor's name behind.
 */

exports.up = (pgm) => {
    // ---- how the debate is argued -----------------------------------------
    // Defaults to 'live': every debate that exists today is a streamed one, and
    // a NOT NULL column with no default could not be added to a live table.
    pgm.addColumns('debates', {
        format: {
            type: 'text',
            notNull: true,
            default: 'live',
            check: "format IN ('typed','live')",
        },
    });
    pgm.createIndex('debates', ['format', 'status'], { name: 'idx_debates_format' });

    // ---- a prompt's place in the bracket ----------------------------------
    pgm.addColumns('prompts', {
        // 0-based, matching debate_matches.round and the client's roundIndex.
        bracket_round: { type: 'integer', check: 'bracket_round IS NULL OR bracket_round >= 0' },
        bracket_side: {
            type: 'text',
            check: "bracket_side IS NULL OR bracket_side IN ('left','right','final')",
        },
        bracket_position: { type: 'integer', check: 'bracket_position IS NULL OR bracket_position >= 0' },
    });

    // All three or none. A prompt half-attached to a slot is a prompt nobody can
    // find: two of the three coordinates identify nothing on their own.
    pgm.addConstraint('prompts', 'prompts_bracket_slot_complete_chk', `CHECK (
        (bracket_round IS NULL AND bracket_side IS NULL AND bracket_position IS NULL)
        OR (bracket_round IS NOT NULL AND bracket_side IS NOT NULL AND bracket_position IS NOT NULL)
    )`);

    // One prompt per match. PARTIAL, so the live debates' unslotted prompts —
    // where all three columns are NULL — are not all colliding with each other.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_prompts_bracket_slot
            ON prompts (debate_id, bracket_round, bracket_side, bracket_position)
            WHERE bracket_round IS NOT NULL;
    `);

    // ---- the assist bank ---------------------------------------------------
    pgm.createTable('category_prompt_templates', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // Matches debates.category, compared case-insensitively — that column is
        // free text (the form's "other"), same as category_judging_criteria.
        // The reserved value '_default' is the bank used when a category has
        // none of its own, so the assist button always returns something.
        category: { type: 'text', notNull: true },
        // Where in the bracket this question belongs. A first-round question and
        // a final are not interchangeable: the early rounds are wide (many
        // matches, contestants nobody has read yet), the final is narrow and
        // pointed. 'any' fits anywhere.
        round_hint: {
            type: 'text',
            notNull: true,
            default: 'any',
            check: "round_hint IN ('early','middle','final','any')",
        },
        body: { type: 'text', notNull: true },
        display_order: { type: 'integer', notNull: true, default: 0 },
        is_active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('category_prompt_templates', 'category_prompt_templates_uniq',
        'UNIQUE (category, body)');
    pgm.createIndex('category_prompt_templates', ['category', 'round_hint', 'display_order'], {
        name: 'idx_prompt_templates_lookup',
    });

    // The starting bank. Deliberately written as QUESTIONS TWO PEOPLE CAN
    // DISAGREE ABOUT — a prompt with one defensible answer produces two
    // identical responses and an unscoreable match.
    const bank = [
        // ---- the fallback, used by any category with no bank of its own -----
        ['_default', 'early',  'What is the single change you would make first, and who pays for it?'],
        ['_default', 'early',  'What does the other side get right? Start there, then say where it breaks.'],
        ['_default', 'early',  'Name the trade-off you are willing to accept. Not the upside — the cost.'],
        ['_default', 'early',  'What would have to be true for you to change your mind?'],
        ['_default', 'early',  'Who is worst affected by the status quo, and what does your answer do for them specifically?'],
        ['_default', 'early',  'What is the strongest evidence against your own position?'],
        ['_default', 'middle', 'Your opponent has now argued the opposite. Which part of their case is the hardest to answer, and answer it.'],
        ['_default', 'middle', 'Give one concrete example where your approach has actually worked. Say what it cost.'],
        ['_default', 'middle', 'If you are wrong, what breaks first — and how quickly would anyone notice?'],
        ['_default', 'middle', 'What are you not saying because it is unpopular? Say it.'],
        ['_default', 'final',  'This is the last word. Make the case in the terms someone who disagrees with you would accept.'],
        ['_default', 'final',  'What is the one sentence you want the room deciding on?'],
        ['_default', 'final',  'Both of you have been right about something. Say what your opponent won, and why you still win.'],

        // ---- Politics --------------------------------------------------------
        ['Politics', 'early',  'What is the first thing you would fund, and what are you cutting to pay for it?'],
        ['Politics', 'early',  'Name a policy from the other party you would keep. Explain why it works.'],
        ['Politics', 'early',  'Who in this district is currently unrepresented, and what would they notice within a year of your winning?'],
        ['Politics', 'early',  'What is a promise you refuse to make, even though it would help you win?'],
        ['Politics', 'early',  'Where does your position cost your own side something?'],
        ['Politics', 'early',  'What has your side been wrong about for the last ten years?'],
        ['Politics', 'middle', 'Your opponent just described a real cost of your position. Answer it without changing the subject.'],
        ['Politics', 'middle', 'You are outvoted on this in your first month. What do you do next?'],
        ['Politics', 'middle', 'Point to a place that already tried this. What happened, including the parts that went badly?'],
        ['Politics', 'middle', 'Who funds the opposition to this, and what is their strongest non-financial argument?'],
        ['Politics', 'final',  'One term. One thing. What is it, and how would a voter check whether you did it?'],
        ['Politics', 'final',  'Say the case for your opponent as well as they would — then say why the room should still pick you.'],
        ['Politics', 'final',  'What would make you resign?'],

        // ---- Business --------------------------------------------------------
        ['Business', 'early',  'What is the problem, who has it, and what are they doing about it today?'],
        ['Business', 'early',  'What would have to be true for this to be a bad business? Argue that case first.'],
        ['Business', 'early',  'Where does the money actually come from, and how soon?'],
        ['Business', 'early',  'What are you deliberately not building, and why?'],
        ['Business', 'early',  'Name the competitor you respect most and what they would do to you.'],
        ['Business', 'early',  'What does this cost the customer beyond the price?'],
        ['Business', 'middle', 'Your opponent has a cheaper answer. Justify the difference or beat it.'],
        ['Business', 'middle', 'Growth stops for a year. What survives, and what do you cut on the first day?'],
        ['Business', 'middle', 'What is the number that tells you this is working — and what is it today?'],
        ['Business', 'middle', 'Who gets hurt if you succeed?'],
        ['Business', 'final',  'Pitch it in the terms your harshest customer would use.'],
        ['Business', 'final',  'What is the one bet the whole thing rests on? Defend it.'],
        ['Business', 'final',  'Why you, and not the person across from you?'],

        // ---- Fashion ---------------------------------------------------------
        ['Fashion',  'early',  'What is the piece everyone is wearing that should be retired, and what replaces it?'],
        ['Fashion',  'early',  'Whose taste are you actually arguing for — and who is excluded by it?'],
        ['Fashion',  'early',  'Where is the line between a reference and a rip-off? Put it somewhere specific.'],
        ['Fashion',  'early',  'What does this cost to make, and does the price say so honestly?'],
        ['Fashion',  'early',  'Name a trend you were wrong about.'],
        ['Fashion',  'early',  'What still looks right ten years later, and what makes it survive?'],
        ['Fashion',  'middle', 'Your opponent calls this derivative. Defend the reference or admit the theft.'],
        ['Fashion',  'middle', 'Make the case for the version of this a person on an average wage can actually buy.'],
        ['Fashion',  'middle', 'What is the difference between styling and design here? Be concrete.'],
        ['Fashion',  'middle', 'Who is this for at 8am on a Tuesday?'],
        ['Fashion',  'final',  'One look. Describe it, and say what it argues for.'],
        ['Fashion',  'final',  'What will this look like in five years — dated, or early?'],
        ['Fashion',  'final',  'Say what your opponent got right, then close.'],
    ];

    // One statement, literals escaped by doubling the quote — node-pg-migrate's
    // sql() takes no bind parameters, and a loop of 52 round trips to seed a
    // lookup table is 52 chances for half a bank to land.
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
    const values = bank
        .map(([category, hint, body], i) => `(${lit(category)}, ${lit(hint)}, ${lit(body)}, ${i})`)
        .join(',\n            ');

    pgm.sql(`
        INSERT INTO category_prompt_templates (category, round_hint, body, display_order)
        VALUES ${values}
        ON CONFLICT (category, body) DO NOTHING;
    `);
};

exports.down = (pgm) => {
    pgm.dropTable('category_prompt_templates');
    pgm.sql(`DROP INDEX IF EXISTS idx_prompts_bracket_slot;`);
    pgm.dropConstraint('prompts', 'prompts_bracket_slot_complete_chk');
    pgm.dropColumns('prompts', ['bracket_round', 'bracket_side', 'bracket_position']);
    pgm.dropIndex('debates', ['format', 'status'], { name: 'idx_debates_format' });
    pgm.dropColumns('debates', ['format']);
};
