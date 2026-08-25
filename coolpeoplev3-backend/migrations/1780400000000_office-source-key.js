/*
================================================================================
 CoolPeople v3 / Would Be — office.source_key (idempotent scraper upserts)
================================================================================
 `office` had no natural unique key, so re-running the reference-data scraper
 would insert duplicate office rows. Add a STABLE external/source key (e.g.
 'fec:H8NY12345', an OCD office id, or 'openstates:...') and a partial UNIQUE
 index on it, so upsertOffice can ON CONFLICT (source_key) — DB-enforced
 idempotency keyed on the durable id, not the free-text office_name.

 Mirrors the existing pattern: jurisdiction.ocd_division_id (unique where
 present) and politicians.fec_candidate_id/bioguide_id/openstates_id. Partial
 (WHERE source_key IS NOT NULL) so hand-entered offices without a source id are
 still allowed and simply don't participate in the conflict target.
================================================================================
*/

exports.up = (pgm) => {
    pgm.addColumns('office', {
        // stable id from the source system; namespace it, e.g. 'fec:...', 'ocd:...'
        source_key: { type: 'text' },
    });
    pgm.createIndex('office', 'source_key', {
        name: 'idx_office_source_key',
        unique: true,
        where: 'source_key IS NOT NULL',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('office', 'source_key', { name: 'idx_office_source_key' });
    pgm.dropColumns('office', ['source_key']);
};
