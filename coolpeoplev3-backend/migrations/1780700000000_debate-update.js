/*
================================================================================
 CoolPeople v3 / Would Be — Debate Update (livestream + sponsor-fee business model)
================================================================================
 Layers the schema the "WouldBe New Debate Update" spec requires on top of:
   - 1779234282879_my-first-migration.js          (baseline)
   - 1779842157026_notifications-and-geo-mapping   (geo + notifications)
   - 1779852775288_retention-active-unique-index   (retention invariant)
   - 1780000000000_full-scope-prep                 (v2 clarifications)
   - 1780100000000_wouldbe-update                  (WouldBe scope)
   - 1780200000000 … 1780600000000                 (council/auth/source-key/deadlines/indexes)

 What this update changes (tagged [DB §N]):
   [DB §1] WouldBe — $5 creation fee; external contribution processor (ActBlue/
           WinRed) link surfaced when the campaign goal or a deadline-attached
           micro-pledge-goal is met. (Platform revenue is the existing `tips`.)
   [DB §2] Debate sponsor economics — casual sponsor pays a FLAT FEE to post a
           debate (on top of the cash prize) and sets a per-entry fee; the entrant
           price is that fee + a processing markup. Free entry via nomination is
           unchanged (debates.free_entry_method / debate_entries.entry_method).
   [DB §3] Payouts — entry fees pay OUT to the sponsor, the prize pays out to the
           winner (existing prize_distributions), both once the contest concludes.
   [DB §4] Twitch livestream — per-streamer OAuth connection + consent, EventSub
           (stream.online/offline) subscription + signed-webhook log, the debate's
           scheduled/live stream, and (Method 2 hybrid) an own R2-hosted recording
           with its own moderation lifecycle + auto-delete window.
   [DB §5] Consent & legal — per-participant hosting/replay license, marketing/
           likeness release, group-stream (Guest Star) consent, minor handling;
           sponsor + debater marketing consent.

 Conventions kept from the baseline: money is cents (BIGINT); legally sensitive /
 consent rows are append-only and carry ip/user_agent; CHECK swaps use raw SQL
 with IF EXISTS so they survive node-pg-migrate's auto-generated constraint names.
 Twitch OAuth tokens are stored here as text — encrypt at rest (app-level / KMS)
 before production; this migration only reserves the columns.

 NOTE: a user's street address is still NEVER persisted. Nothing here changes that.
================================================================================
*/

// $5 WouldBe creation fee and $6/$5-style debate entry are dollar amounts the app
// sets per-record; only the WouldBe creation-fee DEFAULT is encoded here.
const WOULDBE_CREATION_FEE_CENTS = 500; // $5.00

exports.up = (pgm) => {
    // ============================================================
    // SECTION A — WouldBe: creation fee + external contribution processor  [DB §1]
    //   $5 to create a WouldBe (gates going live alongside the committee filing).
    //   When the campaign goal — or an auto-created micro-pledge-goal attached to
    //   an election deadline — is met, pledgers are notified with a link to the
    //   campaign's contribution processor (ActBlue / WinRed).
    // ============================================================
    pgm.addColumns('wouldbe', {
        // the post-to-create fee; default $5. Paid via wouldbe_creation_payments.
        creation_fee_cents: {
            type: 'bigint',
            notNull: true,
            default: WOULDBE_CREATION_FEE_CENTS,
            check: 'creation_fee_cents >= 0',
        },
        // when the creation fee cleared (null = unpaid → cannot go live).
        creation_fee_paid_at: { type: 'timestamptz' },
        // external contribution processor the pledger is sent to when a goal hits.
        contribution_processor: {
            type: 'text',
            check: "contribution_processor IN ('actblue','winred')",
        },
        // the processor link surfaced to pledgers on goal completion.
        contribution_processor_url: { type: 'text' },
    });

    // wouldbe_creation_payments — the $5 creation-fee charge. Mirrors the tips /
    // debate_payments Stripe shape (one row per attempt; success gates launch).
    pgm.createTable('wouldbe_creation_payments', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        amount_cents: { type: 'bigint', notNull: true, default: WOULDBE_CREATION_FEE_CENTS, check: 'amount_cents > 0' },
        currency: { type: 'text', notNull: true, default: 'usd' },
        stripe_customer_id: { type: 'text' },
        stripe_payment_intent_id: { type: 'text', unique: true },
        stripe_charge_id: { type: 'text', unique: true },
        stripe_balance_txn_id: { type: 'text' },
        fee_amount_cents: { type: 'bigint' },
        net_amount_cents: { type: 'bigint' },
        status: { type: 'text', notNull: true, check: "status IN ('pending','succeeded','failed','refunded')" },
        failure_reason: { type: 'text' },
        charged_at: { type: 'timestamptz' },
        refunded_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // pledge_goal_notifications — append-only record that a goal (the campaign's
    // main goal, or a deadline-attached micro-goal = a plan_timeline_components
    // stage sub_goal) was reached and pledgers were sent the processor link.
    // One row per goal (idempotent fire); main goal = component_id NULL.
    pgm.createTable('pledge_goal_notifications', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        // null = the campaign's overall goal; set = a micro-goal tied to a deadline.
        plan_timeline_component_id: { type: 'uuid', references: 'plan_timeline_components(id)' },
        goal_kind: { type: 'text', notNull: true, check: "goal_kind IN ('campaign_goal','micro_goal')" },
        threshold_cents: { type: 'bigint', notNull: true, check: 'threshold_cents > 0' },
        reached_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        processor_url: { type: 'text' },
        pledgers_notified_count: { type: 'integer' },
        notified_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // fire once per micro-goal …
    pgm.createIndex('pledge_goal_notifications', ['wouldbe_id', 'plan_timeline_component_id'], {
        unique: true,
        name: 'pledge_goal_notifications_micro_uniq',
        where: 'plan_timeline_component_id IS NOT NULL',
    });
    // … and once for the campaign goal (component_id NULL — partial unique).
    pgm.createIndex('pledge_goal_notifications', ['wouldbe_id'], {
        unique: true,
        name: 'pledge_goal_notifications_campaign_uniq',
        where: 'plan_timeline_component_id IS NULL',
    });

    // ============================================================
    // SECTION B — Debate sponsor economics  [DB §2]
    //   Flat fee to post (platform revenue) + sponsor-set per-entry fee; the
    //   entrant pays that fee plus a processing markup. The cash prize stays in
    //   the existing sponsor_contribution_cents / prize pool.
    // ============================================================
    pgm.addColumns('debates', {
        // flat fee the casual sponsor pays to POST the debate (platform revenue),
        // separate from the cash prize they put up.
        sponsor_flat_fee_cents: { type: 'bigint', notNull: true, default: 0, check: 'sponsor_flat_fee_cents >= 0' },
        // the per-entry amount the sponsor receives; null = free debate.
        sponsor_entry_fee_cents: { type: 'bigint', check: 'sponsor_entry_fee_cents IS NULL OR sponsor_entry_fee_cents >= 0' },
        // total charged to an entrant = sponsor_entry_fee_cents + processing markup
        // (rounded up to the nearest dollar; markup covers Stripe + platform cut).
        entry_price_cents: { type: 'bigint', check: 'entry_price_cents IS NULL OR entry_price_cents >= 0' },
        // sponsor-listed date for the concluding livestream (the debate_streams row
        // is created from this).
        concluding_stream_at: { type: 'timestamptz' },
        // [DB §5] sponsor agrees to be featured in platform marketing.
        marketing_consent_at: { type: 'timestamptz' },
    });

    // sponsors — marketing consent (sponsor agrees to platform using them in marketing).
    pgm.addColumns('sponsors', {
        marketing_consent_at: { type: 'timestamptz' },
    });

    // contestants — debater opts in to all their debate content (incl. the
    // concluding livestream) being used in marketing.  [DB §5]
    pgm.addColumns('contestants', {
        marketing_release_at: { type: 'timestamptz' },
    });

    // debate_payments — add the sponsor flat-fee payment type and the entry split
    // allocations ($6 entry → $5 sponsor / ~$0.55 Stripe (fee_amount_cents) /
    // ~$0.45 platform). fee_amount_cents/net_amount_cents already exist.
    pgm.sql(`
        ALTER TABLE debate_payments DROP CONSTRAINT IF EXISTS debate_payments_payment_type_check;
        ALTER TABLE debate_payments ADD CONSTRAINT debate_payments_payment_type_check CHECK (
            payment_type IN ('debate_entry_one_off','subscription_credit','debate_sponsor_flat_fee')
        );
    `);
    pgm.addColumns('debate_payments', {
        // portion routed to the sponsor (entry payments).
        sponsor_amount_cents: { type: 'bigint', check: 'sponsor_amount_cents IS NULL OR sponsor_amount_cents >= 0' },
        // platform's cut after Stripe fee.
        platform_amount_cents: { type: 'bigint', check: 'platform_amount_cents IS NULL OR platform_amount_cents >= 0' },
    });

    // ============================================================
    // SECTION C — Sponsor payouts from entries  [DB §3]
    //   Winner payouts already exist (prize_distributions). This is the distinct
    //   "entry fees pay out to the sponsor once the contest concludes" flow.
    // ============================================================
    pgm.createTable('debate_sponsor_payouts', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        sponsor_id: { type: 'uuid', notNull: true, references: 'sponsors(id)' },
        recipient_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // gross entry fees collected (sum of sponsor_amount_cents for the debate).
        gross_entries_cents: { type: 'bigint', notNull: true, check: 'gross_entries_cents >= 0' },
        // platform fee withheld before transfer (if any beyond the per-entry split).
        platform_fee_cents: { type: 'bigint', notNull: true, default: 0 },
        // net transferred to the sponsor.
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents >= 0' },
        currency: { type: 'text', notNull: true, default: 'usd' },
        stripe_transfer_id: { type: 'text', unique: true },
        disbursement_method: { type: 'text' },
        status: { type: 'text', notNull: true, default: 'pending', check: "status IN ('pending','disbursed','failed','reversed')" },
        disbursed_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION D — Twitch livestream integration  [DB §4]
    // ============================================================

    // twitch_connections — per-user Twitch OAuth account link + the consent
    // captured at onboarding (Twitch Dev ToS + our license). One per user.
    pgm.createTable('twitch_connections', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // Twitch's stable user id + the channel login/display name.
        twitch_user_id: { type: 'text', notNull: true, unique: true },
        twitch_login: { type: 'text' },
        twitch_display_name: { type: 'text' },
        // OAuth material — ENCRYPT AT REST before production (text reserves the column).
        access_token: { type: 'text' },
        refresh_token: { type: 'text' },
        scopes: { type: 'text[]', notNull: true, default: '{}' },
        token_expires_at: { type: 'timestamptz' },
        // onboarding gates: accepted ToS/license; VOD storage verified via Get Videos.
        developer_tos_accepted_at: { type: 'timestamptz' },
        vod_storage_verified_at: { type: 'timestamptz' },
        connected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        disconnected_at: { type: 'timestamptz' },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['user_id'] },
    });

    // debate_streams — a debate's scheduled/live concluding stream. Method 1 =
    // 'embed' (Twitch bears the cost); Method 2 = 'hybrid_record' (we also keep a
    // copy — see stream_recordings). embed_parent_domains feeds the iframe `parent`
    // param (the #1 reason embeds black-box).
    pgm.createTable('debate_streams', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        twitch_connection_id: { type: 'uuid', references: 'twitch_connections(id)' },
        host_user_id: { type: 'uuid', references: 'users(id)' },
        method: { type: 'text', notNull: true, default: 'embed', check: "method IN ('embed','hybrid_record')" },
        twitch_channel: { type: 'text' },
        twitch_broadcaster_user_id: { type: 'text' },
        embed_parent_domains: { type: 'text[]', notNull: true, default: '{}' },
        scheduled_at: { type: 'timestamptz' },
        status: { type: 'text', notNull: true, default: 'scheduled', check: "status IN ('scheduled','live','offline','ended','cancelled')" },
        started_at: { type: 'timestamptz' },   // from stream.online
        ended_at: { type: 'timestamptz' },     // from stream.offline
        vod_video_id: { type: 'text' },        // Twitch VOD id (Get Videos)
        vod_url: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // twitch_eventsub_subscriptions — the stream.online / stream.offline EventSub
    // subscriptions we hold per broadcaster.
    pgm.createTable('twitch_eventsub_subscriptions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        twitch_connection_id: { type: 'uuid', references: 'twitch_connections(id)' },
        subscription_id: { type: 'text', notNull: true, unique: true }, // Twitch's id
        subscription_type: { type: 'text', notNull: true, check: "subscription_type IN ('stream.online','stream.offline')" },
        broadcaster_user_id: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true, default: 'pending' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // twitch_eventsub_events — raw inbound webhook log. message_id is unique for
    // idempotent replay handling; signature_verified records the HMAC check.
    pgm.createTable('twitch_eventsub_events', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        message_id: { type: 'text', notNull: true, unique: true }, // Twitch-Eventsub-Message-Id
        subscription_type: { type: 'text', notNull: true },
        broadcaster_user_id: { type: 'text' },
        debate_stream_id: { type: 'uuid', references: 'debate_streams(id)' },
        signature_verified: { type: 'boolean', notNull: true, default: false },
        event_payload: { type: 'jsonb' },
        received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // stream_recordings — Method 2's own copy on R2 (the decision-window source of
    // truth). Its own moderation lifecycle (FFmpeg keyframes → NudeNet →
    // PhotoDNA/NCMEC → Perspective: pending → published) and an auto-delete window
    // (1–2 weeks) that keeps storage bounded.
    pgm.createTable('stream_recordings', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_stream_id: { type: 'uuid', notNull: true, references: 'debate_streams(id)' },
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        source: { type: 'text', notNull: true, check: "source IN ('ingest_relay','streamer_upload','twitch_vod')" },
        r2_bucket: { type: 'text' },
        r2_object_key: { type: 'text' },
        playback_url: { type: 'text' },
        duration_seconds: { type: 'integer' },
        moderation_status: { type: 'text', notNull: true, default: 'pending', check: "moderation_status IN ('pending','clearing','published','rejected','removed')" },
        published_at: { type: 'timestamptz' },
        auto_delete_at: { type: 'timestamptz' }, // end of the decision window
        deleted_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION E — Stream consent & legal (per participant)  [DB §5]
    //   Append-only consent record per participant per stream: hosting/replay
    //   license, optional marketing/likeness release, group-stream (Guest Star)
    //   consent, and minor handling. Carries ip/user_agent like other consents.
    // ============================================================
    pgm.createTable('stream_participant_consents', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        debate_stream_id: { type: 'uuid', notNull: true, references: 'debate_streams(id)' },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        role: { type: 'text', notNull: true, check: "role IN ('host','debater','guest','sponsor')" },
        // right to store + replay their stream (required to host a copy).
        hosting_replay_license_at: { type: 'timestamptz' },
        // optional opt-in: likeness/content used in marketing/promo clips.
        marketing_release_at: { type: 'timestamptz' },
        // group-stream (Guest Star or any multi-party stream) consent form.
        group_stream_consent_at: { type: 'timestamptz' },
        // minor handling — guardian consent if under 18.
        is_minor: { type: 'boolean', notNull: true, default: false },
        guardian_consent_at: { type: 'timestamptz' },
        consent_document_version: { type: 'text' },
        ip_address: { type: 'text' },
        user_agent: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['debate_stream_id', 'user_id'] },
    });
};

exports.down = (pgm) => {
    // SECTION E
    pgm.dropTable('stream_participant_consents');

    // SECTION D — drop children before parents.
    pgm.dropTable('stream_recordings');
    pgm.dropTable('twitch_eventsub_events');
    pgm.dropTable('twitch_eventsub_subscriptions');
    pgm.dropTable('debate_streams');
    pgm.dropTable('twitch_connections');

    // SECTION C
    pgm.dropTable('debate_sponsor_payouts');

    // SECTION B
    pgm.dropColumns('debate_payments', ['sponsor_amount_cents', 'platform_amount_cents']);
    pgm.sql(`
        ALTER TABLE debate_payments DROP CONSTRAINT IF EXISTS debate_payments_payment_type_check;
        ALTER TABLE debate_payments ADD CONSTRAINT debate_payments_payment_type_check CHECK (
            payment_type IN ('debate_entry_one_off','subscription_credit')
        );
    `);
    pgm.dropColumns('contestants', ['marketing_release_at']);
    pgm.dropColumns('sponsors', ['marketing_consent_at']);
    pgm.dropColumns('debates', [
        'sponsor_flat_fee_cents', 'sponsor_entry_fee_cents', 'entry_price_cents',
        'concluding_stream_at', 'marketing_consent_at',
    ]);

    // SECTION A
    pgm.dropTable('pledge_goal_notifications');
    pgm.dropTable('wouldbe_creation_payments');
    pgm.dropColumns('wouldbe', [
        'creation_fee_cents', 'creation_fee_paid_at',
        'contribution_processor', 'contribution_processor_url',
    ]);
};
