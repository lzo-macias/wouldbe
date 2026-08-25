/* Drop the ORIGINAL user_reports target CHECK, which 1782600000000 failed to
 * remove because it guessed the constraint name.
 *
 * The real name is `user_reports_chck` (note the spelling — not `_check`), so the
 * DROP IF EXISTS in that migration was a silent no-op and BOTH constraints ended
 * up on the table. Postgres ANDs every CHECK, so the narrower one still applied
 * and a report targeting only a review would have been rejected — exactly the case
 * the previous migration existed to enable.
 *
 * Corrective migration rather than editing 1782600000000, which has already run.
 */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE user_reports DROP CONSTRAINT IF EXISTS user_reports_chck;`);
};

exports.down = (pgm) => {
    // Restoring it would invalidate any review-only report written in between, so
    // clear those first — same shape as 1782600000000's own down().
    pgm.sql(`DELETE FROM user_reports WHERE reported_review_id IS NOT NULL
               AND reported_content_id IS NULL AND reported_user_id IS NULL;`);
    pgm.sql(`
        ALTER TABLE user_reports ADD CONSTRAINT user_reports_chck CHECK (
            reported_content_id IS NOT NULL OR reported_user_id IS NOT NULL
        );
    `);
};
