/* An 'abandoned' status for fund pledges.
 *
 * THE PROBLEM IT SOLVES. A row is written when the backer clicks "Continue to
 * payment" — before any money moves — because the PaymentIntent has to carry a
 * fund_pledge_id and because an email captured is worth keeping even if the
 * card is never entered. That is the right order (a charge with no record is
 * unreconcilable), but it meant every closed tab left a 'pending' row, and the
 * admin board counted all of them under "needs attention". Nineteen abandoned
 * checkouts read as nineteen problems.
 *
 * 'pending' now means only what it should: an intent exists and we are waiting.
 * A row whose PaymentIntent Stripe says was never paid, and which is old enough
 * that nobody is still typing, becomes 'abandoned' — a normal outcome, not a
 * fault, and excluded from the attention count.
 *
 * Deliberately NOT 'failed'. Failed means the card was declined, which is
 * something you might email somebody about. Abandoned means they changed their
 * mind, which is not.
 */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE fund_pledges DROP CONSTRAINT IF EXISTS fund_pledges_status_check;`);
    pgm.sql(`
        ALTER TABLE fund_pledges ADD CONSTRAINT fund_pledges_status_check CHECK (
            status IN ('pending','succeeded','failed','refunded','disputed','abandoned')
        );
    `);
};

exports.down = (pgm) => {
    // Fold abandoned back into failed so the old CHECK can hold.
    pgm.sql(`UPDATE fund_pledges SET status = 'failed' WHERE status = 'abandoned';`);
    pgm.sql(`ALTER TABLE fund_pledges DROP CONSTRAINT IF EXISTS fund_pledges_status_check;`);
    pgm.sql(`
        ALTER TABLE fund_pledges ADD CONSTRAINT fund_pledges_status_check CHECK (
            status IN ('pending','succeeded','failed','refunded','disputed')
        );
    `);
};
