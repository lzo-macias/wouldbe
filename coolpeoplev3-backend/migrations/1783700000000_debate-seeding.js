/* Seeding day: the seven-day floor, the sponsor's bracket, and the lock.
 *
 * THE FLOW THIS EXISTS FOR
 *   1. an admin approves a debate            → it goes live for nominations
 *   2. AT LEAST SEVEN DAYS later it starts   → this migration's floor
 *   3. on start day the field is finalised   → invitees, or the top nominees
 *   4. the sponsor is notified and seeds it  → pairings + a prompt per match
 *   5. they lock it                          → matches are written, contestants
 *                                              are told their prompt, the clock
 *                                              starts, and nothing moves again
 *
 * WHY SEVEN DAYS IS MEASURED FROM APPROVAL, not from submission. A debate is
 * invisible until an admin approves it, so nobody can nominate into it before
 * then. Measured from submission, a sponsor could submit thirteen days out, get
 * approved on day twelve, and open a one-day nomination window while satisfying
 * the rule. approved_at is therefore a real column and not derivable: `status`
 * tells you a debate IS approved, never WHEN.
 *
 * WHY THE SEED LIVES ON THE CONTESTANT. A seed is a property of a person in a
 * field — "you are the 3rd seed" — and the bracket position falls out of it by
 * arithmetic the client already does. A separate seeding table would be a second
 * place claiming to know the running order, and would have to be kept in step
 * with contestants through withdrawals and disqualifications.
 *
 * WHY THE LOCK IS A TIMESTAMP, not a boolean. "When were the pairings frozen"
 * is a question a disputed result has to be able to answer, and a boolean throws
 * that away. Everything downstream reads `seeding_locked_at IS NOT NULL`.
 */

exports.up = (pgm) => {
    pgm.addColumns('debates', {
        // When an admin approved it — the instant it became nominatable, and the
        // anchor for the seven-day floor.
        approved_at: { type: 'timestamptz' },

        // How long the room gets to READ and VOTE on a round's answers, after
        // they are released and before the next round opens.
        //
        // This column is the fix for a scheduling contradiction, not a new knob:
        // round N+1 used to open at round N's response_deadline, while round N's
        // vote ran for another grace period after that. So round N+1's writing
        // window closed at the same instant its contestants became known —
        // nobody could write in it. A round is now WRITE then READ, and the next
        // round opens when the reading window shuts.
        vote_window_hours: {
            type: 'integer',
            notNull: true,
            default: 24,
            check: 'vote_window_hours BETWEEN 1 AND 168',
        },

        // Seeding day. Nullable because both are events, and their absence is
        // the "not yet" the sponsor's page renders.
        seeding_notified_at: { type: 'timestamptz' },
        seeding_locked_at: { type: 'timestamptz' },
    });

    pgm.createIndex('debates', ['approved_at'], { name: 'idx_debates_approved_at' });

    // Backfill: every already-approved debate gets an approval instant so the
    // floor and the seeding page have something to read. updated_at is the
    // closest honest proxy we hold — it is when the row last changed, and for an
    // approved-and-untouched debate that IS the approval. Marked as an estimate
    // by the fact that it can be later than start_at, which a real approval
    // never is.
    pgm.sql(`
        UPDATE debates
           SET approved_at = updated_at
         WHERE approved_at IS NULL
           AND status <> 'draft';
    `);

    // ---- the seed ----------------------------------------------------------
    // 1-based. NULL until the field is finalised, which is also what makes
    // "has this been seeded" answerable without a second table.
    pgm.addColumns('contestants', {
        seed: { type: 'integer', check: 'seed IS NULL OR seed >= 1' },
    });
    // No two contestants share a seed in one debate. PARTIAL, so the many
    // unseeded rows (seed IS NULL) do not all collide with each other — a plain
    // UNIQUE would allow only one unseeded contestant per debate.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_contestants_seed_uniq
            ON contestants (debate_id, seed)
            WHERE seed IS NOT NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql('DROP INDEX IF EXISTS idx_contestants_seed_uniq;');
    pgm.dropColumns('contestants', ['seed']);
    pgm.dropIndex('debates', ['approved_at'], { name: 'idx_debates_approved_at' });
    pgm.dropColumns('debates', [
        'approved_at',
        'vote_window_hours',
        'seeding_notified_at',
        'seeding_locked_at',
    ]);
};
