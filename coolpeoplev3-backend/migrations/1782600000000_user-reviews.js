/* reviews — 1–5 stars + a written description, left BY one user ON another.
 *
 * Its own table rather than content_items: a review is structured data (a rating
 * you average, sort and count), not an uploaded artifact. content_items models
 * files awaiting a nudity scan; a star rating has nothing for that pipeline to do.
 *
 * REPORTING reuses user_reports rather than inventing a second queue. That table
 * already has the category vocabulary, priority mapping, status workflow,
 * false-report flag and admin triage list — all of which a review report needs and
 * none of which is review-specific. It only lacked a way to point AT a review,
 * which is what reported_review_id adds below.
 *
 * DECISIONS worth stating:
 *  - UNIQUE (reviewer, reviewed): one review per pair, edited rather than stacked.
 *    Without it, ten reviews from one person outweighs ten people, and the average
 *    stops meaning anything.
 *  - CHECK reviewer <> reviewed: nobody reviews themselves.
 *  - status, not a boolean: a review pulled during a dispute ('under_review') is
 *    not the same as one taken down ('removed'), and only 'visible' is public.
 *  - rating is a smallint 1–5 enforced in the DB. The API validates too, but the
 *    constraint is what makes a 7-star review impossible via any path.
 */

exports.up = (pgm) => {
    pgm.createTable('reviews', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who wrote it
        reviewer_user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        // whose profile it appears on
        reviewed_user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        // 1–5 stars
        rating: { type: 'smallint', notNull: true, check: 'rating BETWEEN 1 AND 5' },
        // the written description
        body: { type: 'text', notNull: true },
        // visibility lifecycle — only 'visible' is shown publicly or counted in the
        // average, so a removal silently corrects the score too
        status: {
            type: 'text',
            notNull: true,
            default: 'visible',
            check: "status IN ('visible','under_review','removed')",
        },
        // set when an admin takes it down
        removed_at: { type: 'timestamptz' },
        removed_reason: { type: 'text' },
        removed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // true once the author edits, so the UI can show "edited"
        edited_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.addConstraint('reviews', 'reviews_no_self_review_chk',
        'CHECK (reviewer_user_id <> reviewed_user_id)');
    pgm.addConstraint('reviews', 'reviews_one_per_pair_uniq',
        'UNIQUE (reviewer_user_id, reviewed_user_id)');

    // The profile query: "visible reviews for this user, newest first."
    pgm.createIndex('reviews', ['reviewed_user_id', 'status', 'created_at'], {
        name: 'idx_reviews_profile',
    });
    // "reviews I've written" / the has-this-user-already-reviewed check.
    pgm.createIndex('reviews', 'reviewer_user_id', { name: 'idx_reviews_reviewer' });

    // ---- reporting ---------------------------------------------------------
    // Point user_reports at a review. Nullable: existing rows target content or a
    // user, and most always will.
    pgm.addColumns('user_reports', {
        reported_review_id: { type: 'uuid', references: 'reviews(id)', onDelete: 'CASCADE' },
    });

    // The original CHECK required content or user. Widen it rather than drop it —
    // a report pointing at nothing is not a report.
    pgm.sql(`ALTER TABLE user_reports DROP CONSTRAINT IF EXISTS user_reports_target_chk;`);
    pgm.sql(`
        ALTER TABLE user_reports
          DROP CONSTRAINT IF EXISTS "user_reports_check";
    `);
    pgm.sql(`
        ALTER TABLE user_reports ADD CONSTRAINT user_reports_target_chk CHECK (
            reported_content_id IS NOT NULL
         OR reported_user_id   IS NOT NULL
         OR reported_review_id IS NOT NULL
        );
    `);

    // One open report per person per review — stops a single user filing the same
    // grievance repeatedly to inflate a review's apparent severity.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_user_reports_one_open_per_review
            ON user_reports (reporter_user_id, reported_review_id)
         WHERE reported_review_id IS NOT NULL AND status IN ('pending','under_review');
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS idx_user_reports_one_open_per_review;`);
    pgm.sql(`ALTER TABLE user_reports DROP CONSTRAINT IF EXISTS user_reports_target_chk;`);
    pgm.sql(`DELETE FROM user_reports WHERE reported_review_id IS NOT NULL
               AND reported_content_id IS NULL AND reported_user_id IS NULL;`);
    pgm.dropColumns('user_reports', ['reported_review_id']);
    pgm.sql(`
        ALTER TABLE user_reports ADD CONSTRAINT user_reports_check CHECK (
            reported_content_id IS NOT NULL OR reported_user_id IS NOT NULL
        );
    `);
    pgm.dropTable('reviews');
};
