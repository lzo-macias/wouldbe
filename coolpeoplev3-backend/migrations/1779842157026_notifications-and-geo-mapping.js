/*
================================================================================
 CoolPeople v3 / Would Be — Notifications + Geo Mapping
================================================================================
 Adds what the WouldBe-notification feature needs to run *defensibly*:

   1. A user -> jurisdiction mapping (populated by geocodio) so we can match a
      user to relevant/nearby races, with a same-state fallback.
   2. Stable external keys on jurisdiction (OCD division id, FIPS) so geocodio
      output — and, later, office jurisdictions pulled from OpenStates/Census —
      resolve deterministically instead of by fuzzy name matching.
   3. A versioned, frozen record of the notification *criteria* ("pre-established
      objective criteria", 11 CFR 110.13) plus an append-only log of every
      notification with the objective inputs that fired it. Together these are
      the evidence that every candidate ran through the same neutral formula —
      the defense against an in-kind-contribution / favoritism claim.

 Money is cents (BIGINT). Append-only for legally sensitive rows.
================================================================================
*/

exports.up = (pgm) => {
    // ============================================================
    // SECTION 20 — GEO RESOLUTION
    // ============================================================

    /* ALTER: users — store the raw geocodio result.
     * WHY: lat/long future-proofs true distance-based "nearby" without another
     *      migration; geocoded_at/accuracy let us re-geocode stale or low-
     *      confidence addresses. The user->jurisdiction rows live separately
     *      (a person belongs to several jurisdictions: city, county, state...).
     */
    pgm.addColumns('users', {
        // geocodio latitude  (-90..90)
        latitude: { type: 'numeric(9,6)' },
        // geocodio longitude (-180..180)
        longitude: { type: 'numeric(9,6)' },
        // when the address was last geocoded
        geocoded_at: { type: 'timestamptz' },
        // geocodio accuracy score (0.000–1.000); low scores => re-verify
        geocode_accuracy: { type: 'numeric(4,3)' },
    });

    /* ALTER: jurisdiction — stable external identifiers + centroid.
     * WHY: jurisdiction.name is free text ("New York City Council"), useless
     *      for deterministic matching. The Open Civic Data division id is the
     *      cross-source key shared by geocodio, OpenStates, Ballotpedia and
     *      Google Civic — it's how we'll later resolve which jurisdiction an
     *      office belongs to. FIPS/centroid support census + radius queries.
     */
    pgm.addColumns('jurisdiction', {
        // canonical OCD id, e.g. 'ocd-division/country:us/state:ny/place:new_york'
        ocd_division_id: { type: 'text' },
        // census FIPS / GEOID
        fips_code: { type: 'varchar(16)' },
        // centroid latitude  (for future distance-based "nearby")
        latitude: { type: 'numeric(9,6)' },
        // centroid longitude
        longitude: { type: 'numeric(9,6)' },
    });
    // unique where present — many jurisdictions may not have an OCD id yet
    pgm.createIndex('jurisdiction', 'ocd_division_id', {
        name: 'idx_jurisdiction_ocd_id',
        unique: true,
        where: 'ocd_division_id IS NOT NULL',
    });

    /* TABLE: user_jurisdictions
     * WHY: A user maps to MANY jurisdictions at once (municipal + county +
     *      state + congressional district). geocodio returns all of them, so
     *      this is a join table, not a single FK on users. Drives the tiered
     *      relevance match: exact jurisdiction -> same parent (county) -> same
     *      state. The jurisdiction_id index powers the notifier fan-out:
     *      "given this race's jurisdiction, who lives there?"
     */
    pgm.createTable('user_jurisdictions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // the user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // a jurisdiction they belong to (one row per level)
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // how this mapping was derived
        source: {
            type: 'text',
            notNull: true,
            default: 'geocodio',
            check: "source IN ('geocodio','self_reported','manual','imported')",
        },
        // geocodio accuracy for the match that produced this row (0.000–1.000)
        match_accuracy: { type: 'numeric(4,3)' },
        // when this mapping was last (re)geocoded
        geocoded_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // a user maps to a given jurisdiction at most once
        constraints: { unique: ['user_id', 'jurisdiction_id'] },
    });
    pgm.createIndex('user_jurisdictions', 'user_id', { name: 'idx_user_jurisdictions_user' });
    pgm.createIndex('user_jurisdictions', 'jurisdiction_id', { name: 'idx_user_jurisdictions_jurisdiction' });

    // ============================================================
    // SECTION 21 — NOTIFICATIONS (neutral-criteria evidence)
    // ============================================================

    /* TABLE: notification_criteria_versions
     * WHY: "Pre-established objective criteria" (11 CFR 110.13) is the legal
     *      safe harbor for candidate-facing automation. We freeze the algorithm
     *      parameters as DATA and version them, so for any notification we can
     *      prove WHICH objective formula was in effect when it fired. Mirrors
     *      jurisdiction_rules_versions. Append-only: supersede by inserting a
     *      new row and stamping effective_until on the old one.
     */
    pgm.createTable('notification_criteria_versions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which algorithm these criteria govern (versioned independently)
        algorithm_key: {
            type: 'text',
            notNull: true,
            check: "algorithm_key IN ('wouldbe_notification')",
        },
        // monotonic version number within an algorithm_key
        version: { type: 'integer', notNull: true },
        // human summary of what changed in this version
        description: { type: 'text' },
        // the full frozen parameter set: ideology tolerance, goal-progress
        // thresholds, geo-match tiers, contentiousness inputs, frequency caps.
        parameters: { type: 'jsonb', notNull: true },
        // when these criteria became active
        effective_from: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when superseded (null = current)
        effective_until: { type: 'timestamptz' },
        // who published this version
        created_by_user_id: { type: 'uuid', references: 'users(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // version numbers are unique per algorithm
        constraints: { unique: ['algorithm_key', 'version'] },
    });
    // at most one CURRENT (effective_until IS NULL) version per algorithm
    pgm.createIndex('notification_criteria_versions', 'algorithm_key', {
        name: 'idx_notif_criteria_current',
        unique: true,
        where: 'effective_until IS NULL',
    });

    /* TABLE: notifications
     * WHY: Append-only log of every notification. The decision columns
     *      (recipient, wouldbe, type, criteria_version_id, trigger_snapshot,
     *      consent_id) are WRITE-ONCE — they are the neutrality evidence and
     *      must never be edited. Only the delivery-lifecycle columns (status,
     *      sent_at, delivered_at, failed_at, error_message) are updated, and
     *      the timestamps are stamped once.
     */
    pgm.createTable('notifications', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who receives it
        recipient_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // the candidate campaign this is about (null for non-wouldbe notices)
        wouldbe_id: { type: 'uuid', references: 'wouldbe(id)' },
        // what event triggered it
        notification_type: {
            type: 'text',
            notNull: true,
            check: `notification_type IN (
                'wouldbe_launched','goal_progress','near_goal',
                'contentious_race','ideology_match'
            )`,
        },
        // delivery channel
        channel: {
            type: 'text',
            notNull: true,
            check: "channel IN ('email','sms','push','in_app')",
        },

        // ---- NEUTRALITY EVIDENCE (write-once; never edited after insert) ----
        // which frozen criteria version decided this send
        criteria_version_id: { type: 'uuid', references: 'notification_criteria_versions(id)' },
        // the objective inputs that fired the rule, e.g.
        // { ideology_delta, goal_progress_ratio, geo_match_tier, is_open_seat }.
        // Proof that every candidate ran through the same formula.
        trigger_snapshot: { type: 'jsonb', notNull: true },
        // the consent row that authorized this send (required for email/sms marketing)
        consent_id: { type: 'uuid', references: 'user_consents(id)' },

        // ---- DELIVERY LIFECYCLE (the only columns that get updated) ----
        status: {
            type: 'text',
            notNull: true,
            default: 'queued',
            check: "status IN ('queued','sent','delivered','failed','suppressed')",
        },
        // why a queued notification was not sent
        // (consent_revoked, frequency_cap, quiet_hours, ...)
        suppression_reason: { type: 'text' },
        // optional link to the system_jobs row that performed the send
        system_job_id: { type: 'uuid', references: 'system_jobs(id)' },
        // when we intend to send
        scheduled_for: { type: 'timestamptz' },
        // stamped once when actually sent
        sent_at: { type: 'timestamptz' },
        // stamped once on delivery confirmation
        delivered_at: { type: 'timestamptz' },
        // stamped once on failure
        failed_at: { type: 'timestamptz' },
        // provider error detail
        error_message: { type: 'text' },
        // audit timestamp — decision time (immutable)
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // per-user history + frequency-cap checks
    pgm.createIndex('notifications', ['recipient_user_id', 'created_at'], { name: 'idx_notifications_recipient' });
    // per-candidate audit: "did every candidate get treated the same?"
    pgm.createIndex('notifications', ['wouldbe_id', 'notification_type'], { name: 'idx_notifications_wouldbe_type' });
    // sender picks up queued work
    pgm.createIndex('notifications', 'scheduled_for', {
        name: 'idx_notifications_queue',
        where: "status = 'queued'",
    });
};

exports.down = (pgm) => {
    pgm.dropTable('notifications');
    pgm.dropTable('notification_criteria_versions');
    pgm.dropTable('user_jurisdictions');
    pgm.dropColumns('jurisdiction', ['ocd_division_id', 'fips_code', 'latitude', 'longitude']);
    pgm.dropColumns('users', ['latitude', 'longitude', 'geocoded_at', 'geocode_accuracy']);
};
