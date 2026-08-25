/*
 * Prize type, entry limits, and the sponsor's prize agreement.
 *
 * THREE THINGS, one migration because they all come off the same form change:
 *
 * 1. CASH VS NON-CASH PRIZE. sponsor_contribution_cents assumed every prize was
 *    money. A sponsor may be offering an internship, equipment, a feature slot —
 *    so prize_is_cash says which kind, and prize_description holds the free-text
 *    one. The CHECK makes the pair coherent: cash needs an amount, non-cash needs
 *    words. Nothing derives a prize pool from a non-cash prize.
 *
 * 2. MAX CONTESTANTS. A hard cap on how many people can compete, chosen in
 *    steps of two so a bracket always halves cleanly. The CHECK enforces the
 *    evenness the UI's step=2 implies — a client that posts 7 is rejected rather
 *    than quietly creating an unpairable field.
 *
 *    NOT the same as debates.entry_cap (the host tier's VIDEO capacity). One is
 *    "how many people may compete", the other is "how many videos you paid to
 *    store". Both can bind; the tighter one wins.
 *
 * 3. sponsor_prize_agreements — the signed promise to actually deliver a cash
 *    prize. This is the platform's liability shield: a contest that takes entries
 *    for money the sponsor never pays is the platform's problem unless there is a
 *    record of who promised what, when, and from which IP.
 *
 *    APPEND-ONLY, like user_consents and user_criteria_acknowledgments. Re-signing
 *    writes a NEW row; nothing updates an existing one, because the value of the
 *    record is that it cannot be edited after a dispute starts. The amount is
 *    frozen on the row: if the sponsor later edits the prize, the old signature
 *    still says exactly what it covered.
 */

exports.up = (pgm) => {
    pgm.addColumns('debates', {
        // true = a cash prize (sponsor_contribution_cents); false = prize_description
        prize_is_cash: { type: 'boolean', notNull: true, default: true },
        // what the non-cash prize is, in the sponsor's own words
        prize_description: { type: 'text' },
        // hard cap on competitors; even, so a bracket halves cleanly
        max_contestants: {
            type: 'integer',
            check: 'max_contestants IS NULL OR (max_contestants >= 2 AND max_contestants % 2 = 0)',
        },
    });

    // Coherence between the two prize shapes. A table CHECK rather than two
    // column CHECKs because it is a rule ABOUT THE PAIR.
    //
    // NOT VALID, deliberately. Debates created before this migration have a
    // prize of 0 and no description — they predate the idea that a debate must
    // declare a prize at all, and they are not wrong, just older. NOT VALID
    // enforces the rule on every future INSERT and UPDATE while leaving those
    // rows alone. Backfilling them with an invented prize would be worse: it
    // would put numbers in the record that nobody ever agreed to.
    //
    // To enforce it retroactively later: fix the old rows, then
    //   ALTER TABLE debates VALIDATE CONSTRAINT debates_prize_shape_chk;
    pgm.sql(`
        ALTER TABLE debates ADD CONSTRAINT debates_prize_shape_chk CHECK (
            (prize_is_cash = true  AND COALESCE(sponsor_contribution_cents, 0) > 0)
            OR
            (prize_is_cash = false AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
        ) NOT VALID;
    `);

    /* TABLE: sponsor_prize_agreements
     * WHY: a cash prize is a promise to pay a stranger. This is the evidence of
     *      that promise — who signed, what they typed as a signature, which
     *      version of the terms they saw, the amount at the time, and the request
     *      context. Append-only.
     */
    pgm.createTable('sponsor_prize_agreements', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // the human who signed (the sponsor's account)
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // what they typed into the signature box, verbatim
        signature_name: { type: 'text', notNull: true },
        // which revision of the terms they were shown; bump when the text changes
        agreement_version: { type: 'text', notNull: true },
        // SHA-256 of the exact terms text rendered to them. Proves WHICH words
        // were on screen even if the versioned copy is later edited by mistake.
        terms_hash: { type: 'text', notNull: true },
        // the prize amount at signing time, frozen
        prize_cents: { type: 'bigint', notNull: true, check: 'prize_cents > 0' },
        signed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        ip_address: { type: 'inet' },
        user_agent: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // "has this debate been signed for" — the approval gate's query.
    pgm.createIndex('sponsor_prize_agreements', ['debate_id', 'signed_at'], {
        name: 'idx_prize_agreements_debate',
    });
    pgm.createIndex('sponsor_prize_agreements', 'user_id', {
        name: 'idx_prize_agreements_user',
    });
};

exports.down = (pgm) => {
    pgm.dropTable('sponsor_prize_agreements');
    pgm.sql(`ALTER TABLE debates DROP CONSTRAINT IF EXISTS debates_prize_shape_chk;`);
    pgm.dropColumns('debates', ['prize_is_cash', 'prize_description', 'max_contestants']);
};
