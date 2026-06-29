/*
================================================================================
 CoolPeople v3 / Would Be — natural-key UNIQUE constraints (dedup + upsert safety)
================================================================================
 Two tables shipped without the uniqueness their semantics imply, so duplicate
 rows were insertable and a "row already exists" handler / upsert could never
 actually rely on a constraint:

   contest_winners → a contestant should appear at most once per debate's winner
                     set. Without this, two placement rows for the same contestant
                     (or a double-submit) silently create duplicates and corrupt
                     prize/1099 accounting. UNIQUE (debate_id, contestant_id).
                     (NOT keyed on placement — ties may legitimately share one.)

   tax_records     → one record per (recipient, tax_year, form_type). This is what
                     makes upsertTaxRecord race-safe: it can now INSERT ... ON
                     CONFLICT instead of the SELECT-FOR-UPDATE-then-insert pattern,
                     which double-inserted when the row didn't exist yet (nothing
                     to lock). UNIQUE (recipient_user_id, tax_year, form_type).

 Safe to apply: these tables are empty pre-launch (no contests concluded / no tax
 forms generated). If duplicates ever existed, dedupe before migrating.
================================================================================
*/

exports.up = (pgm) => {
    pgm.addConstraint("contest_winners", "contest_winners_debate_contestant_uniq", {
        unique: ["debate_id", "contestant_id"],
    });
    pgm.addConstraint("tax_records", "tax_records_recipient_year_form_uniq", {
        unique: ["recipient_user_id", "tax_year", "form_type"],
    });
};

exports.down = (pgm) => {
    pgm.dropConstraint("contest_winners", "contest_winners_debate_contestant_uniq", { ifExists: true });
    pgm.dropConstraint("tax_records", "tax_records_recipient_year_form_uniq", { ifExists: true });
};
