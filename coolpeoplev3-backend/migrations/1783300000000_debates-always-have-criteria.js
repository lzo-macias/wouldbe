/* Backfill: every debate has judging criteria.
 *
 * WHY THIS EXISTS: applyCategoryCriteria copies the catalog rubric for a
 * debate's category, and applies ZERO rows when that category has no rubric —
 * "other", or free text like local_government. Nothing filled the gap, so a
 * debate could exist with no published criteria at all. That debate cannot be
 * entered honestly (an entrant doesn't know what they're judged on), cannot be
 * voted on (the ballot IS the criteria list), and cannot be defended afterwards
 * (there is no rubric to point at).
 *
 * The runtime guarantee now lives in ensureDebateCriteria() and is called on the
 * creation path. This migration is the one-time catch-up for rows created before
 * it existed. The rubric below MUST stay in step with DEFAULT_DEBATE_RUBRIC in
 * server/DB/debate/debateCriteria.js — same keys, same weights, summing to 1.000.
 *
 * IDEMPOTENT AND NARROW: only debates with NO criteria at all are touched. A
 * debate that published its own rubric — or copied a category one — is left
 * exactly as it is; overwriting a published rubric would rewrite the terms
 * people already entered under.
 */

exports.up = (pgm) => {
    pgm.sql(`
        INSERT INTO debate_judging_criteria
            (debate_id, criterion_key, display_name, description, weight, display_order)
        SELECT d.id, r.criterion_key, r.display_name, r.description, r.weight, r.display_order
        FROM debates d
        CROSS JOIN (VALUES
            ('argument', 'Argument', 'How well the case was made — reasoning, structure, and whether it answered the question asked.', 0.300, 1),
            ('evidence', 'Evidence', 'Facts, sources and examples used to support the case, and whether they held up.',              0.250, 2),
            ('clarity',  'Clarity',  'How clearly and directly the position was communicated to the room.',                          0.250, 3),
            ('conduct',  'Conduct',  'Engaging with the opponent''s actual point, and debating in good faith.',                      0.200, 4)
        ) AS r(criterion_key, display_name, description, weight, display_order)
        WHERE NOT EXISTS (
            SELECT 1 FROM debate_judging_criteria c WHERE c.debate_id = d.id
        )
        ON CONFLICT (debate_id, criterion_key) DO NOTHING;
    `);
};

exports.down = () => {
    // Deliberately a no-op. Deleting these would strip the rubric off debates
    // that have since been entered, voted on and scored against it — rows in
    // debate_vote_scores and debate_match_vote_scores point straight at them.
    // A backfill of missing data is not something a rollback should undo.
};
