/*
================================================================================
 CoolPeople v3 / Would Be — jurisdiction search indexes (name / state)
================================================================================
 Users query jurisdictions three ways: by NAME (fuzzy), STATE, or ID. ID is the
 PK (already indexed). This adds:
   - a trigram GIN index on name so `name ILIKE '%...%'` stays fast as the table
     grows (plain ILIKE can't use a btree index for a leading-wildcard match).
   - a btree on state_code for the state filter.
================================================================================
*/

exports.up = (pgm) => {
    pgm.createExtension("pg_trgm", { ifNotExists: true });
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jurisdiction_name_trgm
             ON jurisdiction USING gin (name gin_trgm_ops);`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_jurisdiction_state_code
             ON jurisdiction (state_code);`);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS idx_jurisdiction_state_code;`);
    pgm.sql(`DROP INDEX IF EXISTS idx_jurisdiction_name_trgm;`);
    // leave the pg_trgm extension in place — other features may rely on it.
};
