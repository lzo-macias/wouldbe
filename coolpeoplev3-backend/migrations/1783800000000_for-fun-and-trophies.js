/* For-fun debates, standing arrow trophies, and the backdoor.
 *
 * THREE FEATURES, ONE MIGRATION, because each one is load-bearing for the next:
 * a for-fun debate is where the second kind of trophy is earned, trophies are
 * what buy the right to answer somebody else's match, and answering somebody
 * else's match is what makes the backdoor possible.
 *
 * ── FOR FUN ────────────────────────────────────────────────────────────────
 * A debate with no prize and no gate. Typed only and open to everyone, both
 * enforced by a CHECK rather than by the form: "for fun" is not a UI mode, it
 * is a set of rules the row itself has to keep true. Nomination still works —
 * you may put someone forward — it is simply not required to enter.
 *
 * THE PROMPT IS THE TITLE. A for-fun debate is one question, so storing the
 * question twice would let the two disagree. `title` remains the column every
 * listing reads; for a for-fun debate it IS the prompt, and the application
 * writes both from one field.
 *
 * ── STANDING ARROWS ────────────────────────────────────────────────────────
 * Two ways to earn one, and they are deliberately different in kind:
 *   winning a debate         — one per debate won, streamed or written
 *   topping a for-fun prompt — most likes after a month, and anyone who
 *                              dethrones the leader earns one too
 *
 * The dethroning rule is why this is a TABLE of awards rather than a counter.
 * "Whoever is top after a month" is a single winner; "anyone who was ever top"
 * is a set, and the set is what is being rewarded — so each award is a row, and
 * the cap (one per user per for-fun debate) is a unique index rather than a
 * number somebody has to remember to check.
 *
 * users.trophy_count is maintained by a TRIGGER, not by the award function. The
 * count gates a permission that is checked on every open response, so it has to
 * be a column rather than a COUNT(*) — and a denormalised count that any writer
 * can forget to bump is a permission that drifts.
 *
 * ── THE BACKDOOR ───────────────────────────────────────────────────────────
 * A user with enough trophies may answer any match with written responses, even
 * one they are not in. If their answer out-likes a contestant's, they take that
 * contestant's seat.
 *
 * THEY BECOME A CONTESTANT WHEN THAT HAPPENS. The alternative — a match seat
 * that points at a user instead of a contestant — would mean every query that
 * reads a bracket, counts a vote, or crowns a champion needs a second code path
 * for a person who arrived sideways. Creating the contestants row instead means
 * the rest of the system never learns there was a backdoor at all; only these
 * columns remember, and they are what the bracket captions.
 */

exports.up = (pgm) => {
    // ---- for fun -----------------------------------------------------------
    pgm.addColumns('debates', {
        is_for_fun: { type: 'boolean', notNull: true, default: false },
    });

    // Typed and open, or not for fun. Enforced on the row because these are the
    // rules that DEFINE the mode — a for-fun debate that streams, or that only
    // takes invitees, is not a for-fun debate with a wrong setting, it is a
    // contradiction.
    pgm.addConstraint('debates', 'debates_for_fun_shape_chk', `CHECK (
        is_for_fun = false
        OR (format = 'typed' AND participation_type = 'open')
    )`);

    // The prize-shape check demands a prize of every debate. A for-fun debate
    // has none by definition, so it is exempted. Dropped and re-added rather
    // than amended in place — a CHECK cannot be altered.
    pgm.dropConstraint('debates', 'debates_prize_shape_chk', { ifExists: true });
    pgm.sql(`
        ALTER TABLE debates ADD CONSTRAINT debates_prize_shape_chk CHECK (
            is_for_fun = true
            OR (prize_type = 'cash'     AND COALESCE(sponsor_contribution_cents, 0) > 0)
            OR (prize_type = 'non_cash' AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
            OR (prize_type = 'both'     AND COALESCE(sponsor_contribution_cents, 0) > 0
                                        AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
        ) NOT VALID;
    `);

    pgm.createIndex('debates', ['is_for_fun', 'status'], { name: 'idx_debates_for_fun' });

    // ---- open responses ----------------------------------------------------
    // contestant_id becomes NULLABLE: an open response is written by somebody
    // who is not in the debate, so there is no contestant row to point at.
    // NULL is the marker — no second boolean that could disagree with it.
    pgm.alterColumn('match_responses', 'contestant_id', { notNull: false });

    // One open response per person per prompt. PARTIAL, because a contestant's
    // response has a NULL user-scoped slot in this index's terms and the
    // existing (prompt_id, contestant_id) constraint already covers them.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_match_responses_open_uniq
            ON match_responses (prompt_id, user_id)
            WHERE contestant_id IS NULL;
    `);

    // ---- trophies ----------------------------------------------------------
    pgm.createTable('user_trophies', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        kind: {
            type: 'text',
            notNull: true,
            check: "kind IN ('debate_win','for_fun_response')",
        },
        // Where it was earned. Both nullable because a trophy awarded by an
        // admin for anything else later should not have to invent a debate.
        debate_id: { type: 'uuid', references: 'debates(id)', onDelete: 'CASCADE' },
        response_id: { type: 'uuid', references: 'match_responses(id)', onDelete: 'SET NULL' },
        // What it says when someone hovers it on a profile.
        note: { type: 'text' },
        awarded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_trophies', ['user_id', 'awarded_at'], { name: 'idx_user_trophies_user' });

    // THE CAP, as an index rather than a rule somebody has to remember: one
    // trophy per user per debate per kind. A user who tops a for-fun prompt,
    // gets dethroned, and tops it again earns nothing the second time — the
    // award is for having been there, not for each time.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_user_trophies_once_per_debate
            ON user_trophies (user_id, debate_id, kind)
            WHERE debate_id IS NOT NULL;
    `);

    pgm.addColumns('users', {
        // Denormalised on purpose — see the header. Maintained by the trigger
        // below, never by hand.
        trophy_count: { type: 'integer', notNull: true, default: 0 },
    });
    pgm.createIndex('users', ['trophy_count'], { name: 'idx_users_trophy_count' });

    pgm.sql(`
        CREATE OR REPLACE FUNCTION sync_user_trophy_count() RETURNS trigger AS $$
        BEGIN
            IF (TG_OP = 'INSERT') THEN
                UPDATE users SET trophy_count = trophy_count + 1 WHERE id = NEW.user_id;
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE users SET trophy_count = GREATEST(0, trophy_count - 1) WHERE id = OLD.user_id;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_user_trophy_count
            AFTER INSERT OR DELETE ON user_trophies
            FOR EACH ROW EXECUTE FUNCTION sync_user_trophy_count();
    `);

    // ---- the backdoor ------------------------------------------------------
    // What happened, kept on the match it happened to. The seats themselves are
    // ordinary contestant ids — the displacer is given a contestants row — so
    // these columns are the only record that the bracket did not play out the
    // way it was drawn, and they are what the board captions "backdoor".
    pgm.addColumns('debate_matches', {
        backdoor_response_id: { type: 'uuid', references: 'match_responses(id)', onDelete: 'SET NULL' },
        backdoor_user_id: { type: 'uuid', references: 'users(id)' },
        displaced_contestant_id: { type: 'uuid', references: 'contestants(id)' },
        backdoor_at: { type: 'timestamptz' },
    });

    // A contestant can arrive by entering or by out-liking somebody. Recorded so
    // a roster can say which, and so a displaced contestant is distinguishable
    // from one who withdrew.
    pgm.addColumns('contestants', {
        entered_via_backdoor_at: { type: 'timestamptz' },
        displaced_at: { type: 'timestamptz' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('contestants', ['entered_via_backdoor_at', 'displaced_at']);
    pgm.dropColumns('debate_matches', [
        'backdoor_response_id', 'backdoor_user_id', 'displaced_contestant_id', 'backdoor_at',
    ]);
    pgm.sql('DROP TRIGGER IF EXISTS trg_user_trophy_count ON user_trophies;');
    pgm.sql('DROP FUNCTION IF EXISTS sync_user_trophy_count();');
    pgm.dropIndex('users', ['trophy_count'], { name: 'idx_users_trophy_count' });
    pgm.dropColumns('users', ['trophy_count']);
    pgm.sql('DROP INDEX IF EXISTS idx_user_trophies_once_per_debate;');
    pgm.dropTable('user_trophies');
    pgm.sql('DROP INDEX IF EXISTS idx_match_responses_open_uniq;');
    pgm.alterColumn('match_responses', 'contestant_id', { notNull: true });
    pgm.dropIndex('debates', ['is_for_fun', 'status'], { name: 'idx_debates_for_fun' });
    pgm.dropConstraint('debates', 'debates_for_fun_shape_chk');
    pgm.dropColumns('debates', ['is_for_fun']);
};
