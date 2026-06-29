/*
================================================================================
 CoolPeople v3 / Would Be — Full-Scope Preparation
================================================================================
 Layers the schema needed to support the fully-scoped MVP workflows on top of:
   - 1779234282879_my-first-migration.js          (baseline)
   - 1779842157026_notifications-and-geo-mapping  (geo + notifications)
   - 1779852775288_retention-active-unique-index  (retention invariant)

 Every block is tagged with WHERE the requirement came from so it can be traced:
   [CLARIFICATION] — the 2026-05-29 product clarifications (pasted by the owner)
   [CHANGES.md]    — CoolPeople_API_Doc_Changes.md (criteria-ack + data-sale)
   [ADDITIONS.md]  — CoolPeople_API_Doc_Additions.md (geo + notifications)
   [CORRECTION]    — a bug / contradiction in the as-built schema being fixed

 Conventions kept from the baseline: money is cents (BIGINT); legally sensitive
 rows are append-only; CHECK swaps use raw SQL with IF EXISTS so they are robust
 to node-pg-migrate's auto-generated constraint names.

 NOTE ON ADDRESS (read once, applies throughout): a user's street address is
 NEVER persisted. It is geocoded in request memory, the resulting jurisdiction
 OCD-IDs are written to user_jurisdictions, and the address string is discarded.
 It must not be logged and must not reach backups. See SECTION A.
================================================================================
*/

exports.up = (pgm) => {
    // ============================================================
    // SECTION A — users: account scope, sessions, address policy
    //   [CLARIFICATION] account = username, password, email, state,
    //   political_lean. [CLARIFICATION] after 3 sessions, prompt for address.
    //   [CORRECTION] address must be transient, not a NOT NULL column.
    // ============================================================

    /* [CORRECTION] users.address was `notNull: true`. The agreed architecture
     * resolves an address to jurisdiction IDs in memory and DISCARDS it, so a
     * NOT NULL address column forces persistence of PII we promised never to
     * keep. Drop the NOT NULL. (We keep the column nullable rather than DROP it
     * outright to avoid breaking the signup/edit code paths mid-flight — but it
     * should stay empty in production. Dropping it entirely is the recommended
     * follow-up once the geocode-in-memory flow lands; see v2 doc Section 1.) */
    pgm.alterColumn('users', 'address', { notNull: false });
    pgm.sql(`
        COMMENT ON COLUMN users.address IS
        'TRANSIENT ONLY. Do not persist real addresses here. Geocode in memory, write user_jurisdictions, discard. Never log, never back up. [CLARIFICATION 2026-05-29]';
    `);

    /* [CLARIFICATION] "After three separate sessions of use ... ask for address."
     * Counts distinct app sessions so the onboarding prompt can fire on #3.
     * Incremented by the login/session-start handler (updateUserLastLogin). */
    pgm.addColumns('users', {
        session_count: { type: 'integer', notNull: true, default: 0 },
    });

    /* [CLARIFICATION] user_prompt_log — cadence/deferral state for the soft
     * asks the product makes repeatedly: PWA-push consent (debate + wouldbe),
     * the SMS fallback when push is declined, and the post-3-sessions address
     * request. Consent itself is recorded in user_consents; THIS table only
     * tracks "did we ask, what did they say, when may we ask again" so a
     * decline becomes "ask later" instead of "never ask." */
    pgm.createTable('user_prompt_log', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which soft ask this row is about
        prompt_type: {
            type: 'text',
            notNull: true,
            check: `prompt_type IN (
                'push_debate','push_wouldbe','sms_fallback','address_collection',
                'citizen_attestation','wouldbe_nomination'
            )`,
        },
        // session number at which we asked (for the "after 3 sessions" rule)
        session_number: { type: 'integer' },
        // what the user did
        response: {
            type: 'text',
            notNull: true,
            check: "response IN ('accepted','declined','dismissed','deferred')",
        },
        // when we may surface this prompt again (null = don't re-ask)
        next_eligible_at: { type: 'timestamptz' },
        responded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_prompt_log', ['user_id', 'prompt_type'], { name: 'idx_user_prompt_log_user_type' });

    // ============================================================
    // SECTION B — push_subscriptions (PWA Web Push transport)
    //   [CLARIFICATION] users consent to "PWA push notifications". The Web Push
    //   protocol needs a per-device endpoint + keys; notifications.channel
    //   already allows 'push' but there was nowhere to store the subscription.
    // ============================================================
    pgm.createTable('push_subscriptions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // Web Push endpoint URL (unique per browser/device install)
        endpoint: { type: 'text', notNull: true, unique: true },
        // VAPID subscription keys
        p256dh_key: { type: 'text', notNull: true },
        auth_key: { type: 'text', notNull: true },
        // device/browser hint for the user's "manage devices" screen
        user_agent: { type: 'text' },
        // the consent row that authorized push for this user (FEC/TCPA-style audit link)
        consent_id: { type: 'uuid', references: 'user_consents(id)' },
        last_used_at: { type: 'timestamptz' },
        // soft-revoke (browser unsubscribed / consent withdrawn) — keep the row for audit
        revoked_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('push_subscriptions', 'user_id', {
        name: 'idx_push_subscriptions_user',
        where: 'revoked_at IS NULL',
    });

    // ============================================================
    // SECTION C — user_consents.consent_type: add PWA-push types
    //   [CLARIFICATION] two distinct push asks: debate-participation push and
    //   wouldbe-participation push. SMS fallback rides existing sms_marketing /
    //   sms_transactional. [CHANGES.md] data_sale + sensitive_data_processing
    //   were already added to this check in the baseline — kept here for clarity.
    // ============================================================
    pgm.sql(`
        ALTER TABLE user_consents DROP CONSTRAINT IF EXISTS user_consents_consent_type_check;
        ALTER TABLE user_consents ADD CONSTRAINT user_consents_consent_type_check CHECK (
            consent_type IN (
                'tos','privacy_policy','marketing_email','sms_marketing',
                'sms_transactional','data_processing','third_party_sharing',
                'data_sale','sensitive_data_processing',
                -- [CLARIFICATION 2026-05-29] PWA push consents:
                'push_debate','push_wouldbe'
            )
        );
    `);

    // ============================================================
    // SECTION D — Criteria-ack reconciliation
    //   [CHANGES.md] criteria ack moves to once-per-(user,debate,context) and the
    //   per-vote / per-endorsement ack columns go away. The baseline already
    //   shipped `user_criteria_acknowledgments` doing this job, but with a
    //   different shape than CHANGES.md's proposed `debate_criteria_acks`.
    //   We RECONCILE the as-built table to the CHANGES.md intent rather than
    //   create a duplicate. (Open question for owner: rename the table to
    //   debate_criteria_acks and retire the legacy ack_type vocabulary?)
    // ============================================================

    /* [CHANGES.md] add the legal-defense fields the proposed table specified and
     * the as-built one lacked: ip + user_agent at ack time, and an INTEGER
     * rules_version_seen (the as-built `criteria_version` is text; we keep it for
     * back-compat and treat rules_version_seen as the canonical snapshot). */
    pgm.addColumns('user_criteria_acknowledgments', {
        ip_address: { type: 'inet' },
        user_agent: { type: 'text' },
        rules_version_seen: { type: 'integer' },
    });

    /* [CHANGES.md] broaden the context vocabulary to the proposed
     * 'landing_page' / 'final_round' while keeping the legacy values so existing
     * rows stay valid. Mapping: endorsement≈landing_page, final_round_voting≈final_round. */
    pgm.sql(`
        ALTER TABLE user_criteria_acknowledgments DROP CONSTRAINT IF EXISTS user_criteria_acknowledgments_ack_type_check;
        ALTER TABLE user_criteria_acknowledgments ADD CONSTRAINT user_criteria_acknowledgments_ack_type_check CHECK (
            ack_type IN ('endorsement','final_round_voting','landing_page','final_round')
        );
    `);

    /* [CHANGES.md] "the acknowledged_criteria / criteria_ack columns on
     * post_endorsements and debate_votes are gone — middleware reads the ack
     * table instead." post_endorsements already has no such column (no-op).
     * debate_votes still carries the per-vote ack trio — drop it. */
    pgm.dropColumns('debate_votes', ['acknowledged_criteria', 'acknowledged_at', 'rules_version_seen']);

    // ============================================================
    // SECTION E — Pledge eligibility attestation (store positive only)
    //   [CLARIFICATION] pledge attest = "I am a US citizen or a lawfully admitted
    //   permanent resident." NEVER store the negative inference: store only a
    //   positive eligible flag for those who attest, and store NOTHING for
    //   everyone else. Absence is ambiguous; a negative flag is incriminating.
    // ============================================================

    /* Add the combined citizen-or-LPR attestation type used by the pledge flow.
     * (Office-running nominees attest plain 'us_citizen' — that type already
     * exists and is unchanged.) */
    pgm.sql(`
        ALTER TABLE user_attestations DROP CONSTRAINT IF EXISTS user_attestations_attestation_type_check;
        ALTER TABLE user_attestations ADD CONSTRAINT user_attestations_attestation_type_check CHECK (
            attestation_type IN (
                'age_18','age_13','age_35_under','us_citizen','district_resident',
                'own_funds','not_foreign_national','not_federal_contractor',
                -- [CLARIFICATION 2026-05-29] pledge eligibility (citizen OR lawful permanent resident):
                'us_citizen_or_lpr'
            )
        );
    `);

    /* [CLARIFICATION] DB-level enforcement of "positive only": a
     * 'us_citizen_or_lpr' attestation row may ONLY exist with attested_value =
     * 'true'. The handler must INSERT nothing when the user says no — and even if
     * a bug tried to, this CHECK rejects it. Absence therefore stays ambiguous
     * by construction; there is no place to write a "not eligible" signal. */
    pgm.sql(`
        ALTER TABLE user_attestations ADD CONSTRAINT chk_pledge_eligibility_positive_only CHECK (
            attestation_type <> 'us_citizen_or_lpr' OR attested_value = 'true'
        );
    `);

    // ============================================================
    // SECTION F — WouldBe nomination: nominee-side response
    //   [CLARIFICATION] a user in a debate can be nominated for a WouldBe. The
    //   nominator picks an office in the nominee's state (or a general nomination).
    //   The nominee later opens the app, inputs their address to see offices they
    //   actually qualify for, attests "I am a US citizen", and the address is used
    //   to resolve jurisdictions then DELETED.
    //
    //   The nominator side already exists as `wouldbe_recommendations`
    //   (recommendation_type 'race_specific' | 'general', optional office_id).
    //   What was missing is the nominee's RESPONSE — add it here.
    // ============================================================
    pgm.addColumns('wouldbe_recommendations', {
        // nominee's disposition toward this nomination
        target_response: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "target_response IN ('pending','viewed','accepted','declined')",
        },
        // when the nominee acted
        responded_at: { type: 'timestamptz' },
        // if accepting led them to launch a campaign, link it
        resulting_wouldbe_id: { type: 'uuid', references: 'wouldbe(id)' },
    });
    pgm.createIndex('wouldbe_recommendations', ['target_user_id', 'target_response'], {
        name: 'idx_wbrec_target_response',
    });

    // ============================================================
    // SECTION G — Jurisdiction layers + office resolution method
    //   [CLARIFICATION] congressional / state senate / state house / county /
    //   city council / school district are INDEPENDENT OVERLAPPING layers, not a
    //   nesting hierarchy. Matching is OCD-ID set intersection (user_jurisdictions
    //   ∩ office), NOT the parent tree. We widen jurisdiction.type to name the
    //   layers and tag each office with HOW a user is matched to it.
    // ============================================================

    /* Widen jurisdiction.type. parent_jurisdiction_id is retained for display/
     * grouping ONLY — do not treat it as authoritative containment. */
    pgm.sql(`
        ALTER TABLE jurisdiction DROP CONSTRAINT IF EXISTS jurisdiction_type_check;
        ALTER TABLE jurisdiction ADD CONSTRAINT jurisdiction_type_check CHECK (
            type IN (
                'federal','state','county','municipal',
                -- [CLARIFICATION 2026-05-29] independent overlapping layers:
                'congressional_district','state_leg_upper','state_leg_lower',
                'county_district','city_council_district',
                'school_district','school_board_district'
            )
        );
        COMMENT ON COLUMN jurisdiction.parent_jurisdiction_id IS
        'Display/grouping only. Layers overlap and do NOT strictly nest; match users to offices by OCD-ID intersection (user_jurisdictions), not this tree. [CLARIFICATION 2026-05-29]';
    `);

    /* [CLARIFICATION] resolution_method answers the Open TODO in ADDITIONS.md
     * (resolveOfficeJurisdiction): it tells the matcher HOW to relate a user to
     * this office —
     *   national          → everyone (President); no resolution
     *   statewide          → users.state field; no geocoding (US Senate, Governor, AG…)
     *   geocodio_district  → user_jurisdictions from geocodio (US House, state leg, county, school district)
     *   point_in_polygon   → needs our GeoJSON boundary + PIP (city council, trustee-area school board) */
    pgm.addColumns('office', {
        resolution_method: {
            type: 'text',
            check: "resolution_method IN ('national','statewide','geocodio_district','point_in_polygon')",
        },
    });

    // ============================================================
    // SECTION H — notifications.notification_type taxonomy expansion
    //   [ADDITIONS.md Part C] the notifier table must also carry the events that
    //   currently fire ad-hoc sends (pledges goal, messages, payouts, tax, etc.)
    //   so every send is a logged, consent-checked row.
    // ============================================================
    pgm.sql(`
        ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
        ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check CHECK (
            notification_type IN (
                -- candidate/marketing (criteria-governed) — original set:
                'wouldbe_launched','goal_progress','near_goal',
                'contentious_race','ideology_match',
                -- [ADDITIONS.md Part C] event/transactional types:
                'pledge_goal_reached','new_message','contest_won','payout_sent',
                'tax_form_ready','filing_deadline','payment_receipt'
            )
        );
    `);

    // ============================================================
    // SECTION I — Payouts: ITIN + decoupled cash-out onboarding
    //   [CLARIFICATION] undocumented people CAN win (personal-use). Pay via
    //   ITIN + a payout processor; never hold the money ourselves. DECOUPLE
    //   participation from payout — everyone competes anonymously; only a winner
    //   who cashes out goes through identity/tax onboarding.
    // ============================================================

    /* payout_accounts — the cash-out onboarding record, created ONLY when a
     * winner elects to withdraw. We never store a full TIN; the processor
     * (Stripe Connect / payout partner) holds KYC + tax identity. We keep the
     * minimum: which processor, their account handle, the tax-id TYPE (drives
     * 1099 vs 1042-S handling), and verification state. */
    pgm.createTable('payout_accounts', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, unique: true, references: 'users(id)' },
        // who actually custodies the money + KYC (we do not hold funds)
        processor: {
            type: 'text',
            notNull: true,
            check: "processor IN ('stripe_connect','payout_partner')",
        },
        // the processor's account/recipient id (NOT a bank account or TIN)
        processor_account_id: { type: 'text' },
        // tax identity TYPE only — never the number itself
        tax_id_type: { type: 'text', check: "tax_id_type IN ('ssn','itin','ein','foreign_none')" },
        onboarding_status: {
            type: 'text',
            notNull: true,
            default: 'not_started',
            check: "onboarding_status IN ('not_started','pending','verified','rejected')",
        },
        identity_verified_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* Link a disbursement to the payout account it paid out through, and record
     * the tax-id type used (ITIN winners are valid recipients). */
    pgm.addColumns('prize_distributions', {
        payout_account_id: { type: 'uuid', references: 'payout_accounts(id)' },
    });
    pgm.addColumns('tax_records', {
        // [CLARIFICATION] ITIN winners are first-class; type drives form handling
        tax_id_type: { type: 'text', check: "tax_id_type IN ('ssn','itin','ein','foreign_none')" },
    });
    /* tax_records.form_type previously allowed only US-person forms; ITIN/foreign
     * winners may need 1042-S. Widen the check. */
    pgm.sql(`
        ALTER TABLE tax_records DROP CONSTRAINT IF EXISTS tax_records_form_type_check;
        ALTER TABLE tax_records ADD CONSTRAINT tax_records_form_type_check CHECK (
            form_type IN ('1099-MISC','1099-NEC','1099-K','W-2','1042-S')
        );
    `);
};

exports.down = (pgm) => {
    // SECTION I
    pgm.sql(`
        ALTER TABLE tax_records DROP CONSTRAINT IF EXISTS tax_records_form_type_check;
        ALTER TABLE tax_records ADD CONSTRAINT tax_records_form_type_check CHECK (
            form_type IN ('1099-MISC','1099-NEC','1099-K','W-2')
        );
    `);
    pgm.dropColumns('tax_records', ['tax_id_type']);
    pgm.dropColumns('prize_distributions', ['payout_account_id']);
    pgm.dropTable('payout_accounts');

    // SECTION H
    pgm.sql(`
        ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
        ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check CHECK (
            notification_type IN (
                'wouldbe_launched','goal_progress','near_goal',
                'contentious_race','ideology_match'
            )
        );
    `);

    // SECTION G
    pgm.dropColumns('office', ['resolution_method']);
    pgm.sql(`
        ALTER TABLE jurisdiction DROP CONSTRAINT IF EXISTS jurisdiction_type_check;
        ALTER TABLE jurisdiction ADD CONSTRAINT jurisdiction_type_check CHECK (
            type IN ('federal','state','county','municipal')
        );
    `);

    // SECTION F
    pgm.dropIndex('wouldbe_recommendations', ['target_user_id', 'target_response'], {
        name: 'idx_wbrec_target_response',
    });
    pgm.dropColumns('wouldbe_recommendations', ['target_response', 'responded_at', 'resulting_wouldbe_id']);

    // SECTION E
    pgm.sql(`ALTER TABLE user_attestations DROP CONSTRAINT IF EXISTS chk_pledge_eligibility_positive_only;`);
    pgm.sql(`
        ALTER TABLE user_attestations DROP CONSTRAINT IF EXISTS user_attestations_attestation_type_check;
        ALTER TABLE user_attestations ADD CONSTRAINT user_attestations_attestation_type_check CHECK (
            attestation_type IN (
                'age_18','age_13','age_35_under','us_citizen','district_resident',
                'own_funds','not_foreign_national','not_federal_contractor'
            )
        );
    `);

    // SECTION D
    // NOTE: re-adding dropped debate_votes columns as nullable; original values are not recoverable.
    pgm.addColumns('debate_votes', {
        acknowledged_criteria: { type: 'boolean' },
        acknowledged_at: { type: 'timestamptz' },
        rules_version_seen: { type: 'text' },
    });
    pgm.sql(`
        ALTER TABLE user_criteria_acknowledgments DROP CONSTRAINT IF EXISTS user_criteria_acknowledgments_ack_type_check;
        ALTER TABLE user_criteria_acknowledgments ADD CONSTRAINT user_criteria_acknowledgments_ack_type_check CHECK (
            ack_type IN ('endorsement','final_round_voting')
        );
    `);
    pgm.dropColumns('user_criteria_acknowledgments', ['ip_address', 'user_agent', 'rules_version_seen']);

    // SECTION C
    pgm.sql(`
        ALTER TABLE user_consents DROP CONSTRAINT IF EXISTS user_consents_consent_type_check;
        ALTER TABLE user_consents ADD CONSTRAINT user_consents_consent_type_check CHECK (
            consent_type IN (
                'tos','privacy_policy','marketing_email','sms_marketing',
                'sms_transactional','data_processing','third_party_sharing',
                'data_sale','sensitive_data_processing'
            )
        );
    `);

    // SECTION B
    pgm.dropTable('push_subscriptions');

    // SECTION A
    pgm.dropTable('user_prompt_log');
    pgm.dropColumns('users', ['session_count']);
    pgm.sql(`COMMENT ON COLUMN users.address IS NULL;`);
    pgm.alterColumn('users', 'address', { notNull: true });
};
