/*
 * A committee belongs to a CANDIDACY, not to a jurisdiction.
 *
 * THE BUG: hasActiveVerifiedCommittee matched on (user_id, jurisdiction_id,
 * cycle_year). For congressional districts that happens to behave correctly,
 * because each district is its own jurisdiction row — LA-1 and LA-2 have
 * different jurisdiction_ids, so a committee for one does not unlock the other.
 *
 * It breaks wherever ONE jurisdiction contains MORE THAN ONE office. City
 * Council Seat A and Seat B share a municipal jurisdiction, so a committee filed
 * for Seat A satisfied the launch gate for Seat B — two separate candidacies,
 * one filing. Under FEC rules (and every state equivalent) a candidate has one
 * principal campaign committee PER CANDIDACY; running for two offices is two
 * candidacies and two committees.
 *
 * office_sought already existed but is FREE TEXT — a label, not a key. These are
 * the keys:
 *   office_id — the office this committee was filed for
 *   race_id   — the specific contest, which pins the cycle too
 *
 * BOTH NULLABLE, and the old jurisdiction+cycle match is kept as a fallback for
 * rows that predate this. A committee filed before we asked for an office is not
 * wrong, just less precise, and invalidating those would lock candidates out of
 * campaigns they legitimately filed for.
 */

exports.up = (pgm) => {
    pgm.addColumns('candidate_committees', {
        // the office this committee was filed for
        office_id: { type: 'uuid', references: 'office(id)' },
        // the specific contest; implies the office AND the cycle
        race_id: { type: 'uuid', references: 'races(id)' },
    });

    // The gate's lookup, most-precise first.
    pgm.createIndex('candidate_committees', ['user_id', 'race_id'], {
        name: 'idx_committees_user_race',
    });
    pgm.createIndex('candidate_committees', ['user_id', 'office_id', 'cycle_year'], {
        name: 'idx_committees_user_office_cycle',
    });

    // Backfill what can be inferred. A committee whose jurisdiction contains
    // EXACTLY ONE office in that cycle is unambiguous — bind it. Anything
    // ambiguous is left alone rather than guessed at: a wrong binding would
    // silently block a candidate from a campaign they did file for.
    pgm.sql(`
        UPDATE candidate_committees cc
        SET office_id = sub.office_id
        FROM (
            -- one row per jurisdiction that holds exactly ONE office.
            -- min(uuid) doesn't exist in Postgres, so the single id is picked
            -- with an aggregate that does: array_agg + [1].
            SELECT o.jurisdiction_id, (array_agg(o.id))[1] AS office_id
            FROM office o
            GROUP BY o.jurisdiction_id
            HAVING COUNT(*) = 1
        ) sub
        WHERE cc.jurisdiction_id = sub.jurisdiction_id
          AND cc.office_id IS NULL;
    `);
};

exports.down = (pgm) => {
    pgm.dropIndex('candidate_committees', ['user_id', 'office_id', 'cycle_year'], {
        name: 'idx_committees_user_office_cycle',
    });
    pgm.dropIndex('candidate_committees', ['user_id', 'race_id'], {
        name: 'idx_committees_user_race',
    });
    pgm.dropColumns('candidate_committees', ['office_id', 'race_id']);
};
