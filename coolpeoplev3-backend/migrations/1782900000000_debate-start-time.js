/* debates.start_at + debates.start_timezone — the debate now IS a scheduled
 * livestream, so "when does it start" needs an exact instant AND the wall-clock
 * zone the sponsor chose.
 *
 * WHY TWO COLUMNS, NOT ONE. A timestamptz is an instant; it does not remember
 * the zone it was written in — Postgres stores UTC and renders in the session's
 * zone. That is right for ordering and for "has it started yet", and useless for
 * display: "8pm ET" and "5pm PT" are the same instant, and the sponsor scheduled
 * exactly one of them. The zone the human picked is separate information, so it
 * is stored separately, as an IANA name ('America/New_York'), never as an
 * abbreviation — "EST" is ambiguous across countries and silently wrong for half
 * the year.
 *
 * WHY NOT REUSE concluding_stream_at. It holds the same instant today, but it is
 * named for the concluding broadcast; start_at is the debate's start. Keeping the
 * name honest costs one column and stops the next reader from guessing.
 *
 * start_date (DATE) STAYS. The feed, the deadline filters and the admin table all
 * read it, and it is what a calendar cell wants. It is now a derived shadow of
 * start_at: every write path sets both, computing the day IN start_timezone so a
 * 9pm-ET debate does not file itself under tomorrow (9pm ET is 01:00 UTC).
 */

exports.up = (pgm) => {
    pgm.addColumns('debates', {
        // the exact instant the debate begins
        start_at: { type: 'timestamptz' },
        // IANA zone the sponsor scheduled in, for display ('America/New_York')
        start_timezone: { type: 'text' },
    });

    /* Backfill. concluding_stream_at is the real scheduled instant wherever a
     * sponsor submitted through the application form, so prefer it. Older rows
     * only ever had a day: read it as midnight in the platform's default zone —
     * which is a guess, and is exactly why the column now exists.
     *
     * debates_prize_shape_chk is dropped and re-added around the UPDATE, with the
     * SAME definition and still NOT VALID. It has to be: the constraint was added
     * NOT VALID, so rows predating it were never checked, and Postgres re-checks a
     * row on ANY update — a backfill that touches nothing but start_at would be
     * rejected by a prize field it never looked at. Dropping it for the length of
     * one UPDATE leaves the table in exactly the state it was in, rather than
     * skipping those rows and leaving them with no start time. */
    pgm.sql(`ALTER TABLE debates DROP CONSTRAINT IF EXISTS debates_prize_shape_chk;`);
    pgm.sql(`
        UPDATE debates
        SET start_at = COALESCE(
                concluding_stream_at,
                (start_date::timestamp AT TIME ZONE 'America/New_York')
            ),
            start_timezone = 'America/New_York'
        WHERE start_at IS NULL
          AND (concluding_stream_at IS NOT NULL OR start_date IS NOT NULL);
    `);
    pgm.sql(`
        ALTER TABLE debates ADD CONSTRAINT debates_prize_shape_chk CHECK (
            (prize_type = 'cash' AND COALESCE(sponsor_contribution_cents, 0::bigint) > 0)
            OR (prize_type = 'non_cash' AND prize_description IS NOT NULL
                AND length(btrim(prize_description)) > 0)
            OR (prize_type = 'both' AND COALESCE(sponsor_contribution_cents, 0::bigint) > 0
                AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
        ) NOT VALID;
    `);

    pgm.createIndex('debates', 'start_at');
};

exports.down = (pgm) => {
    pgm.dropIndex('debates', 'start_at');
    pgm.dropColumns('debates', ['start_at', 'start_timezone']);
};
