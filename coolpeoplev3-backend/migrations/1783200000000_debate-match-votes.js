/* Bracket-match crowd voting — the "vote screen" a host puts up mid-debate.
 *
 * WHAT THIS IS FOR: while a debate is live, the host pushes ONE head-to-head
 * match to the room and everyone scores both contestants 1–5 on each published
 * criterion. The ballot decides who advances in the bracket.
 *
 * WHY NEW TABLES rather than reusing debate_votes: debate_votes is UNIQUE on
 * (debate_id, voter_user_id) — one vote per person for the WHOLE debate, which
 * is the final-round ballot. A bracket needs one ballot per person PER MATCH,
 * so the uniqueness key is different and the two cannot share a table without
 * dropping the constraint that makes the final vote honest.
 *
 * DECISIONS worth stating:
 *  - debate_matches is keyed on the bracket GEOMETRY (round, side, position),
 *    not on the pair of contestants. The bracket UI derives its own layout from
 *    the seeding, so geometry is the stable identity both sides agree on; the
 *    contestants in a slot are whatever the upstream rounds produced.
 *  - ONE open ballot per debate, enforced by a partial unique index rather than
 *    by application code. Two vote screens up at once is not a state the room
 *    can act on, and a race between two host tabs would otherwise create it.
 *  - winner_contestant_id is nullable and separate from voting_state: a closed
 *    match with no winner is a TIE the host still has to break, which is a real
 *    outcome and not the same as "not decided yet".
 *  - votes carry the winner the ballot IMPLIED (contestant_id), derived from the
 *    scores server-side. Nullable, because a ballot that scores both sides
 *    identically is a genuine draw and forcing a pick would fabricate a
 *    preference the voter didn't express.
 *  - scores reference debate_judging_criteria, the per-debate SNAPSHOT, so the
 *    rubric a vote was cast against can never be edited out from under it.
 */

exports.up = (pgm) => {
    // ---- the matches themselves --------------------------------------------
    pgm.createTable('debate_matches', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)', onDelete: 'CASCADE' },
        // Bracket coordinates. round is 0-based (0 = the first column of pairs);
        // side is which half of the mirrored bracket, 'final' for the middle.
        round: { type: 'integer', notNull: true, check: 'round >= 0' },
        side: { type: 'text', notNull: true, check: "side IN ('left','right','final')" },
        position: { type: 'integer', notNull: true, check: 'position >= 0' },
        // The two people on screen. Both required: a bye has nobody to vote on,
        // so it never becomes a match row.
        contestant_a_id: { type: 'uuid', notNull: true, references: 'contestants(id)', onDelete: 'CASCADE' },
        contestant_b_id: { type: 'uuid', notNull: true, references: 'contestants(id)', onDelete: 'CASCADE' },
        // pending → open (vote screen up) → closed (decided)
        voting_state: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "voting_state IN ('pending','open','closed')",
        },
        opened_at: { type: 'timestamptz' },
        closed_at: { type: 'timestamptz' },
        // who put the screen up — the host, recorded because it is a decision
        // that moves someone out of a prize bracket
        opened_by_user_id: { type: 'uuid', references: 'users(id)' },
        // null while undecided AND when a closed match tied
        winner_contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // set when the host breaks a tie by hand rather than the count deciding
        decided_by_host: { type: 'boolean', notNull: true, default: false },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.addConstraint('debate_matches', 'debate_matches_slot_uniq',
        'UNIQUE (debate_id, round, side, position)');
    pgm.addConstraint('debate_matches', 'debate_matches_distinct_pair_chk',
        'CHECK (contestant_a_id <> contestant_b_id)');
    // A winner has to be one of the two people who played.
    pgm.addConstraint('debate_matches', 'debate_matches_winner_in_match_chk',
        `CHECK (winner_contestant_id IS NULL
                OR winner_contestant_id = contestant_a_id
                OR winner_contestant_id = contestant_b_id)`);

    // ONE open ballot per debate. The partial index is the enforcement; the
    // route's 409 is only the polite version of this error.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_debate_matches_one_open
            ON debate_matches (debate_id)
            WHERE voting_state = 'open';
    `);
    pgm.createIndex('debate_matches', ['debate_id', 'round'], { name: 'idx_debate_matches_debate' });

    // ---- ballots ------------------------------------------------------------
    pgm.createTable('debate_match_votes', {
        vote_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        match_id: { type: 'uuid', notNull: true, references: 'debate_matches(id)', onDelete: 'CASCADE' },
        // Denormalised so "every ballot in this debate" is one index scan and a
        // fraud sweep doesn't have to join through the bracket.
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)', onDelete: 'CASCADE' },
        voter_user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        // Who the scores said won. NULL = the ballot scored both sides equally.
        contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // the small optional description the ballot offers
        comment: { type: 'text', check: 'comment IS NULL OR length(comment) <= 500' },
        // legal-defence trail, same shape as debate_votes
        acknowledged_criteria: { type: 'boolean', notNull: true, default: true },
        acknowledged_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        rules_version_seen: { type: 'text' },
        // anti-fraud trust score; only coordinated-behaviour detection lowers it
        weight: { type: 'numeric(4,3)', notNull: true, default: 1.000 },
        voter_ip: { type: 'inet' },
        voter_device_fingerprint: { type: 'text' },
        invalidated_at: { type: 'timestamptz' },
        invalidation_reason: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // one ballot per person per match — the whole reason these tables exist
        constraints: { unique: ['match_id', 'voter_user_id'] },
    });

    pgm.createIndex('debate_match_votes', ['match_id', 'contestant_id'], {
        name: 'idx_match_votes_tally',
    });
    pgm.createIndex('debate_match_votes', ['debate_id', 'voter_user_id'], {
        name: 'idx_match_votes_voter',
    });

    // ---- the 1–5s -----------------------------------------------------------
    pgm.createTable('debate_match_vote_scores', {
        score_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        vote_id: { type: 'uuid', notNull: true, references: 'debate_match_votes(vote_id)', onDelete: 'CASCADE' },
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)', onDelete: 'CASCADE' },
        criterion_id: { type: 'uuid', notNull: true, references: 'debate_judging_criteria(criterion_id)', onDelete: 'CASCADE' },
        score: { type: 'integer', notNull: true, check: 'score BETWEEN 1 AND 5' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['vote_id', 'contestant_id', 'criterion_id'] },
    });

    pgm.createIndex('debate_match_vote_scores', ['vote_id'], { name: 'idx_match_vote_scores_vote' });
};

exports.down = (pgm) => {
    pgm.dropTable('debate_match_vote_scores');
    pgm.dropTable('debate_match_votes');
    pgm.sql(`DROP INDEX IF EXISTS idx_debate_matches_one_open;`);
    pgm.dropTable('debate_matches');
};
