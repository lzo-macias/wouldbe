/* Typed debates, part two: rounds open on a clock, answers land, the room talks.
 *
 * THE SHAPE OF A TYPED ROUND
 *   1. the round's prompts become visible          (prompts.release_at)
 *   2. its contestants have a GRACE PERIOD to answer  (→ response_deadline)
 *   3. the deadline passes and every answer in that round is released AT ONCE
 *   4. anyone can comment underneath, threaded
 *
 * WHY ANSWERS RELEASE TOGETHER, on the deadline rather than on submit: a typed
 * debate where the first answer is public immediately is not the same contest
 * for the second person — they would be writing a rebuttal while their opponent
 * wrote an opening. The deadline IS the release, so both are composed blind.
 * That is also why response_deadline is the only timestamp the read path
 * consults; there is no separate "published" flag to drift out of step with it.
 *
 * SCHEDULING REUSES prompts.release_at / prompts.response_deadline. Those two
 * columns have existed since the first migration and have been NULL on every row
 * since the prompt calendar was removed — they are exactly the pair this needs,
 * and inventing debate_round_windows next to them would leave two places
 * claiming to know when a round opens.
 *
 * COMMENTS REUSE THE comments TABLE rather than adding a second one. It already
 * has one-level threading (parent_comment_id), the moderation vocabulary, soft
 * delete that preserves reply chains, and a moderation queue that reads it. It
 * only lacked a way to point at a response, which is what response_id adds —
 * the same widening user_reports got for reviews.
 *
 * ENGAGEMENT IS COUNTED, NOT LOGGED. The ask was "if it's not too expensive to
 * track": a row per click is a table that grows without bound and is read by
 * nothing except a SUM. Instead there is ONE counter row per response, and the
 * only event rows are dedup keys — (response, user, kind, DAY) — so a person
 * clicking the same avatar forty times writes one row and moves the counter
 * once. Bounded by (responses × active users × kinds), not by clicks.
 */

exports.up = (pgm) => {
    // ---- the answers -------------------------------------------------------
    pgm.createTable('match_responses', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)', onDelete: 'CASCADE' },
        // The prompt answered. Carries the bracket slot, so the match a response
        // belongs to is a join away and never stored twice.
        prompt_id: { type: 'uuid', notNull: true, references: 'prompts(id)', onDelete: 'CASCADE' },
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)', onDelete: 'CASCADE' },
        // The author, denormalised off the contestant row: every engagement read
        // and every avatar join wants a user id, and going through contestants
        // for it on a leaderboard query is a join per row for a fact that cannot
        // change (a contestant row's user never moves).
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        body: { type: 'text', notNull: true },
        // Set on first submit and kept — "answered 3 minutes before the buzzer"
        // is a fact about the contest, so an edit must not overwrite it.
        submitted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        edited_at: { type: 'timestamptz' },
        // Moderation, same soft-delete posture as comments: removing an answer
        // must not delete the thread hanging off it.
        removed_at: { type: 'timestamptz' },
        removed_reason: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // One answer per contestant per prompt — editing, not stacking.
        constraints: { unique: ['prompt_id', 'contestant_id'] },
    });
    pgm.createIndex('match_responses', ['debate_id'], { name: 'idx_match_responses_debate' });
    pgm.createIndex('match_responses', ['user_id'], { name: 'idx_match_responses_user' });

    // ---- the round clock ---------------------------------------------------
    pgm.addColumns('debates', {
        // How long contestants get to answer each round, in hours. The grace
        // period, not the whole round: round N opens when round N-1 closes.
        round_grace_hours: {
            type: 'integer',
            notNull: true,
            default: 48,
            check: 'round_grace_hours BETWEEN 1 AND 720',
        },
    });

    // ---- comments point at a response --------------------------------------
    pgm.addColumns('comments', {
        response_id: { type: 'uuid', references: 'match_responses(id)', onDelete: 'CASCADE' },
    });
    // post_id was NOT NULL because a comment could only be on a post. It can now
    // be on either, so the column becomes nullable and a CHECK enforces exactly
    // one target — a comment attached to both, or to neither, is unreachable.
    pgm.alterColumn('comments', 'post_id', { notNull: false });
    pgm.addConstraint('comments', 'comments_one_target_chk',
        'CHECK ((post_id IS NOT NULL)::int + (response_id IS NOT NULL)::int = 1)');
    pgm.createIndex('comments', ['response_id', 'parent_comment_id', 'created_at'], {
        name: 'idx_comments_response_thread',
    });

    // ---- likes -------------------------------------------------------------
    // A like is a toggle with a holder, so it is a row per (response, user) —
    // that is the only way "have I liked this" is answerable, and it is what
    // makes unliking possible.
    pgm.createTable('response_likes', {
        response_id: { type: 'uuid', notNull: true, references: 'match_responses(id)', onDelete: 'CASCADE' },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('response_likes', 'response_likes_pkey', {
        primaryKey: ['response_id', 'user_id'],
    });

    // ---- softer signals, deduped by day ------------------------------------
    // NOT an event log. The unique key includes the DAY, so the fortieth click
    // on the same avatar by the same person on the same day is a no-op insert
    // and moves no counter. That bound is the entire reason this is affordable.
    pgm.createTable('response_engagement_events', {
        response_id: { type: 'uuid', notNull: true, references: 'match_responses(id)', onDelete: 'CASCADE' },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        kind: {
            type: 'text',
            notNull: true,
            check: "kind IN ('profile_click','expand','share')",
        },
        // DATE, deliberately: the dedup window is a calendar day, and storing an
        // instant here would make every click unique again.
        day: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.addConstraint('response_engagement_events', 'response_engagement_events_pkey', {
        primaryKey: ['response_id', 'user_id', 'kind', 'day'],
    });

    // ---- the counters the leaderboard actually reads ------------------------
    pgm.createTable('response_engagement', {
        response_id: {
            type: 'uuid', primaryKey: true,
            references: 'match_responses(id)', onDelete: 'CASCADE',
        },
        comment_count: { type: 'integer', notNull: true, default: 0 },
        like_count: { type: 'integer', notNull: true, default: 0 },
        profile_click_count: { type: 'integer', notNull: true, default: 0 },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // WEIGHTS, in one place, as a generated column so no query can rank by its
    // own private formula: a comment is worth more than a like because writing
    // one costs more, and a profile click is the weakest signal of the three —
    // it says someone wanted to know who this was.
    pgm.sql(`
        ALTER TABLE response_engagement
            ADD COLUMN score INTEGER GENERATED ALWAYS AS (
                comment_count * 3 + like_count * 2 + profile_click_count
            ) STORED;
    `);
    pgm.createIndex('response_engagement', ['score'], { name: 'idx_response_engagement_score' });
};

exports.down = (pgm) => {
    pgm.dropTable('response_engagement');
    pgm.dropTable('response_engagement_events');
    pgm.dropTable('response_likes');
    pgm.dropIndex('comments', ['response_id', 'parent_comment_id', 'created_at'], {
        name: 'idx_comments_response_thread',
    });
    pgm.dropConstraint('comments', 'comments_one_target_chk');
    pgm.dropColumns('comments', ['response_id']);
    // post_id goes back to NOT NULL only if nothing violates it; a response-only
    // comment would block this, which is the correct failure for a rollback that
    // would otherwise silently drop data.
    pgm.alterColumn('comments', 'post_id', { notNull: true });
    pgm.dropColumns('debates', ['round_grace_hours']);
    pgm.dropTable('match_responses');
};
