/*
================================================================================
 CoolPeople v3 / Would Be — Place council-coverage + pending local resolution
================================================================================
 Layers on top of 1780100000000_wouldbe-update.

 WHY: a user's "no city-council district" status is ambiguous from coordinates
 alone — they might be unincorporated/rural (no council at all), in an at-large
 city (council exists but isn't districted), or in a districted city we just
 haven't loaded boundaries for yet. Following the same "absence is ambiguous,
 store an explicit positive fact" rule used for the citizen attestation, we
 record the council STRUCTURE on the place jurisdiction (one fact per place, not
 per user), and track the users we still owe a council district in an explicit,
 self-cleaning queue.

 Resolution branches (in the resolver, see server/DB/userJurisdictions.js):
   geocode returns no incorporated place        -> no council owed
   place.council_structure = 'none'             -> no council owed
                           = 'at_large'         -> match via the place layer (no PIP)
                           = 'districted' + loaded   -> point-in-polygon now
                           = 'districted' + !loaded   -> enqueue pending
                           = NULL (unknown structure) -> enqueue pending
================================================================================
*/

exports.up = (pgm) => {
    // ----- place-level council metadata (meaningful for municipal/place rows) -----
    pgm.addColumns('jurisdiction', {
        // how this place elects its council. NULL = not yet encoded (unknown).
        council_structure: {
            type: 'text',
            check: "council_structure IN ('districted','at_large','none')",
        },
        // for a 'districted' place: have we loaded its council-district GeoJSON
        // (the point-in-polygon boundaries) yet?
        boundaries_loaded: { type: 'boolean', notNull: true, default: false },
        boundaries_loaded_at: { type: 'timestamptz' },
        // where the boundary file lives (R2/source URL) for the PIP run
        boundary_source_url: { type: 'text' },
    });
    pgm.sql(`
        COMMENT ON COLUMN jurisdiction.council_structure IS
        'Council election structure for a place (municipal) row: districted | at_large | none. NULL = unknown/not encoded. One fact per place; a user''s no-council status derives from this, never hand-entered per user. [WB place-coverage]';
    `);

    /* pending_local_resolution — the explicit, self-cleaning worklist of users we
     * still owe a sub-municipal (PIP) district. A row exists ONLY while the user
     * is genuinely awaiting backfill; the backfill job DELETES the row once the
     * district is assigned, so an empty queue for a place means "fully caught up."
     * Absence here is NOT used to infer anything — unincorporated/at-large users
     * simply never get a row. */
    pgm.createTable('pending_local_resolution', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // one pending entry per user (a user awaits at most one place's boundaries)
        user_id: { type: 'uuid', notNull: true, unique: true, references: 'users(id)' },
        // the place jurisdiction whose council boundaries we're waiting on
        place_jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // why this user is pending (drives whether ops must encode structure or load boundaries)
        reason: {
            type: 'text',
            notNull: true,
            check: "reason IN ('boundaries_not_loaded','place_structure_unknown')",
        },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // worklist by place: "who in place X are we still owing a council district?"
    pgm.createIndex('pending_local_resolution', 'place_jurisdiction_id', {
        name: 'idx_pending_local_place',
    });
};

exports.down = (pgm) => {
    pgm.dropTable('pending_local_resolution');
    pgm.sql(`COMMENT ON COLUMN jurisdiction.council_structure IS NULL;`);
    pgm.dropColumns('jurisdiction', [
        'council_structure', 'boundaries_loaded', 'boundaries_loaded_at', 'boundary_source_url',
    ]);
};
