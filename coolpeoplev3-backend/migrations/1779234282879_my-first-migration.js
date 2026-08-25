/*
================================================================================
 CoolPeople v3 / Would Be — Initial Schema Migration
================================================================================
 Mirrors db2.js but in node-pg-migrate form. Money is always cents (BIGINT).
 Append-only patterns for legally sensitive tables. Soft delete for PII-bearing
 rows; hard delete reserved for ephemeral data.
================================================================================
*/

exports.up = (pgm) => {
    // Extensions
    pgm.createExtension('uuid-ossp', { ifNotExists: true });
    pgm.createExtension('citext', { ifNotExists: true });

    // ============================================================
    // SECTION 1 — USERS & IDENTITY
    // ============================================================

    /* TABLE: users
     * WHY: Every interaction on the platform — pledging, debating, voting,
     *      endorsing, messaging — is attributed to a user row. We capture
     *      state/city/zip because (a) election law eligibility is location-
     *      based and (b) the WouldBe recommendation algorithm needs it.
     * HOW: One row per signup. age_band is derived from DOB at verification
     *      time and stored so feature gates don't have to recompute every
     *      request. political_lean is the 1–10 conservative→progressive
     *      slider from the build guide; nullable because users can opt out.
     */
    pgm.createTable('users', {
        // surrogate primary key; UUID so it's globally unique across shards/services
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // legal/display given name
        first_name: { type: 'varchar(64)', notNull: true },
        // legal/display family name
        last_name: { type: 'varchar(64)', notNull: true },
        // optional handle; CITEXT so "Alice" and "alice" collide
        username: { type: 'citext', unique: true },
        // exact DOB — never displayed publicly; used for age_band derivation
        date_of_birth: { type: 'date', notNull: true },
        // bcrypt hash of the password (NEVER the plaintext). 255 is ample for bcrypt's 60-char output.
        // [CORRECTION 2026-05-29] was `type: "VARACHAR(124"` — a misspelled, unclosed type literal that
        // made this migration un-runnable (Postgres would reject the DDL). Fixed in place.
        password: { type: 'varchar(255)', notNull: true },
        // 2-letter postal state code — drives FEC residency & contest eligibility
        state: { type: 'varchar(2)' },
        // city of residence — used in recommendation algo
        city: { type: 'varchar(64)' },
        // postal zip — needed for redistricting lookups
        zip_code: { type: 'varchar(10)' },
        // address geocodio will help find offices they can run for
        address: {type: 'varchar(128)', notNull: true},
        // E.164 phone — UNIQUE so a number can't be reused across accounts
        phone_number: { type: 'varchar(32)', unique: true },
        // primary contact; CITEXT + UNIQUE for case-insensitive identity
        email: { type: 'citext', notNull: true, unique: true },
        // 1–10 conservative→progressive slider; nullable so users can opt out
        political_lean: { type: 'smallint', check: 'political_lean BETWEEN 1 AND 10' },
        // R2/S3 url to the avatar (Postgres never stores image bytes)
        profile_photo_url: { type: 'text' },
        // free-text user bio
        bio: { type: 'text' },
        // false means soft-deactivated; we don't hard-delete users
        is_active: { type: 'boolean', notNull: true, default: true },
        // most recent successful login — used for "inactive user" retention sweeps
        last_login_at: { type: 'timestamptz' },
        // audit: when the row was created
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit: when the row last changed
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('users', ['state', 'city'], { name: 'idx_users_state_city' });
    pgm.createIndex('users', 'political_lean', { name: 'idx_users_political_lean' });

    // ============================================================
    // SECTION 2 — POLITICAL REFERENCE DATA
    //   What offices exist, who holds them, when are the deadlines.
    //   Synced from FEC / OpenStates / Ballotpedia.
    // ============================================================

    /* TABLE: jurisdiction
     * WHY: A WouldBe campaign is anchored to a place that has power to run
     *      an election. "Council District 3" means different things in NYC
     *      vs Atlanta — jurisdictions disambiguate.
     * HOW: Self-referencing tree (state -> county -> municipal).
     */
    pgm.createTable('jurisdiction', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // human-readable name ("New York City Council")
        name: { type: 'varchar(256)', notNull: true },
        // tier in the federal hierarchy
        type: { type: 'text', notNull: true, check: "type IN ('federal', 'state', 'county', 'municipal')" },
        // self-reference for the tree (state -> county -> city)
        parent_jurisdiction_id: { type: 'uuid', references: 'jurisdiction(id)' },
        // 2-letter state — denormalized for fast filtering
        state_code: { type: 'char(2)' },
        // name of the body that actually administers elections here
        election_authority_name: { type: 'varchar(256)' },
        // where to send a candidate to file paperwork
        election_authority_url: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: office
     * WHY: The seat a candidate runs for. Each office has its own min_age,
     *      term_length, partisan-or-not — and the compliance engine checks
     *      these BEFORE letting a user launch a WouldBe.
     */
    pgm.createTable('office', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which jurisdiction this office belongs to
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // display name ("US Senator from NY")
        office_name: { type: 'varchar(256)', notNull: true },
        // branch of government — drives campaign rules
        office_type: { type: 'text', check: "office_type IN ('executive', 'legislative', 'judicial')" },
        // for bicameral legislatures
        chamber: { type: 'text', check: "chamber IN ('upper', 'lower', 'single')" },
        // shorthand code ("CD-12")
        district_identifier: { type: 'varchar(64)' },
        // full name ("12th Congressional District")
        district_name: { type: 'varchar(256)', notNull: true },
        // years per term
        term_length: { type: 'integer', notNull: true },
        // statutory term-limit cap (null = no limit)
        max_terms: { type: 'integer' },
        // non-partisan offices skip party-affiliation rules
        is_partisan: { type: 'boolean', notNull: true, default: true },
        // statutory minimum age to hold this office
        min_age: { type: 'integer', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: politicians
     * WHY: Sitting / past politicians. So users can see who currently holds
     *      a seat and so a politician can claim their profile via
     *      linked_user_id and run their own WouldBe.
     */
    pgm.createTable('politicians', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // legal/display given name
        first_name: { type: 'varchar(128)', notNull: true },
        // legal/display family name
        last_name: { type: 'varchar(128)', notNull: true },
        // current party affiliation
        party: { type: 'text', check: "party IN ('Republican', 'Democrat', 'Independent', 'Other')" },
        // FEC candidate identifier for federal candidates
        fec_candidate_id: { type: 'varchar(64)' },
        // "Jr.", "III", etc.
        suffix: { type: 'varchar(32)' },
        // DOB (used to compute age-eligibility for offices)
        date_of_birth: { type: 'date' },
        // congress.gov bioguide ID for federal politicians
        bioguide_id: { type: 'varchar(64)' },
        // OpenStates ID for state-level politicians
        openstates_id: { type: 'varchar(64)' },
        // Ballotpedia profile URL
        ballotpedia_url: { type: 'text' },
        // Wikipedia article URL
        wikipedia_url: { type: 'text' },
        // headshot URL
        photo_url: { type: 'text' },
        // campaign or office homepage
        official_website: { type: 'text' },
        // X/Twitter handle without the @
        twitter_handle: { type: 'varchar(64)' },
        // NULL until the politician claims their profile by signing up
        linked_user_id: { type: 'uuid', references: 'users(id)' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: races
     * WHY: A specific election for a specific office in a specific cycle.
     *      Drives whether we host WouldBe campaigns for it via
     *      is_approved_on_platform.
     */
    pgm.createTable('races', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which office is being contested
        office_id: { type: 'uuid', notNull: true, references: 'office(id)' },
        // election year (2026, 2028, ...)
        election_cycle: { type: 'integer', notNull: true },
        // type of election
        election_type: { type: 'text', check: "election_type IN ('regular', 'special', 'runoff', 'recall')" },
        // primary date — nullable; some races (specials) skip primaries
        primary_date: { type: 'date' },
        // general election date
        general_date: { type: 'date', notNull: true },
        // last day a candidate can file paperwork; drives whether a new WouldBe can start
        filing_deadline: { type: 'date', notNull: true },
        // true if no incumbent is running — important for the recommendation algo
        is_open_seat: { type: 'boolean' },
        // gate: only races we've approved get WouldBe campaigns
        is_approved_on_platform: { type: 'boolean', notNull: true, default: false },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: terms
     * WHY: One row per term a politician serves. Tells us if an incumbent
     *      is up for re-election and whether a seat is open.
     */
    pgm.createTable('terms', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who held the office
        politician_id: { type: 'uuid', notNull: true, references: 'politicians(id)' },
        // which office
        office_id: { type: 'uuid', notNull: true, references: 'office(id)' },
        // start of the term
        term_start: { type: 'date', notNull: true },
        // planned end of term (per office.term_length)
        term_end_date: { type: 'date', notNull: true },
        // status, in case the term ends early
        status: { type: 'text', check: "status IN ('active', 'completed', 'resigned', 'died', 'expelled', 'recalled')" },
        // actual end date if it differs from planned (resign/die/recall)
        actual_end_date: { type: 'date' },
        // is this politician running again?
        seeking_reelection: { type: 'boolean' },
        // common "Rep runs for Senate" — creates an open seat in the current office
        seeking_other_office_id: { type: 'uuid', references: 'office(id)' },
        // date they publicly announced retirement
        retirement_announced_date: { type: 'date' },
        // which race they won to earn this term
        won_election_in_race_id: { type: 'uuid', references: 'races(id)' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: election_deadlines
     * WHY: Catch-all calendar table for filing windows, FEC reports, voter
     *      registration cutoffs — anything date-keyed the candidate
     *      onboarding wizard needs to surface.
     */
    pgm.createTable('election_deadlines', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which jurisdiction this deadline applies to
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // election cycle this deadline is for (nullable for recurring ones)
        election_cycle: { type: 'integer' },
        // the kind of deadline — drives UI grouping and reminder logic
        deadline_type: {
            type: 'text',
            notNull: true,
            check: `deadline_type IN (
                'filing_open','filing_close','petition_circulation_start','petition_filing_deadline',
                'ballot_certification','voter_registration_close','mail_in_ballot_request_close',
                'mail_in_ballot_return','early_voting_open','early_voting_close','primary_date',
                'runoff_date','general_date','fec_quarterly_q1','fec_quarterly_q2','fec_quarterly_q3',
                'fec_year_end','fec_pre_primary_report','fec_pre_general_report','fec_post_general_report',
                'state_pre_primary_disclosure','state_pre_general_disclosure','state_post_election_disclosure'
            )`,
        },
        // the actual date
        deadline_date: { type: 'date' },
        // time-of-day cutoff if statutorily defined
        deadline_time: { type: 'time' },
        // scopes the deadline to a specific office type when needed
        applies_to_office_type: { type: 'text' },
        // human-readable explanation
        description: { type: 'text' },
        // source URL we pulled this from (for audit)
        source_url: { type: 'text' },
        // whether this deadline repeats every cycle
        is_recurring_per_cycle: { type: 'boolean' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 3 — WOULD-BE CAMPAIGNS
    // ============================================================

    /* TABLE: wouldbe
     * WHY: The crowdfunded-pledge campaign itself. Holds the goal, deadline,
     *      and link to the office/race. Required before any pledge.
     */
    pgm.createTable('wouldbe', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user-facing campaign title
        title: { type: 'varchar(256)', notNull: true },
        // long pitch shown on the campaign page
        description: { type: 'text', notNull: true },
        // who launched it (the potential candidate)
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // optional office anchor
        office_id: { type: 'uuid', references: 'office(id)' },
        // optional race anchor (specific election cycle)
        race_id: { type: 'uuid', references: 'races(id)' },
        // pledge goal in cents — must be positive
        goal_cents: { type: 'bigint', notNull: true, check: 'goal_cents > 0' },
        // running total of pledged dollars (denormalized for fast list rendering)
        pledged_total_cents: { type: 'bigint', notNull: true, default: 0 },
        // last day to hit the goal
        deadline: { type: 'date', notNull: true },
        // gates the $5 video-post wall
        can_post_videos: { type: 'boolean', notNull: true, default: false },
        // soft-archive (pledge history must remain for audit, so we don't delete)
        retired: { type: 'boolean', notNull: true, default: false },
        // when the campaign was retired
        retired_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('wouldbe', 'user_id', { name: 'idx_wouldbe_user' });
    pgm.createIndex('wouldbe', 'race_id', { name: 'idx_wouldbe_race' });

    // ============================================================
    // SECTION 4 — PLANS (a WouldBe's policy platform)
    // ============================================================

    /* TABLE: plan
     * WHY: Wraps the set of policy positions + timeline for a WouldBe.
     *      Separated so candidates can iterate without rewriting the
     *      campaign row.
     */
    pgm.createTable('plan', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which wouldbe campaign this plan belongs to
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        // owning candidate user (denormalized for query convenience)
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // office anchor (denormalized off wouldbe)
        office_id: { type: 'uuid', references: 'office(id)' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: plan_component_categories
     * WHY: Fixed taxonomy of policy areas. In a table (not enum) so ops can
     *      add/retire without migrations.
     */
    pgm.createTable('plan_component_categories', {
        // stable slug — used as FK in plan_components
        category_key: { type: 'text', primaryKey: true },
        // human-readable name shown in UI
        display_name: { type: 'text', notNull: true },
        // grouping bucket for UI rollups ("economic", "social", "civic")
        category_group: { type: 'text', notNull: true },
        // longer description for tooltips/help text
        description: { type: 'text' },
        // icon slug for the UI
        icon: { type: 'text' },
        // controls display order in the picker
        sort_order: { type: 'integer' },
        // soft-toggle for retiring without breaking historic FKs
        is_active: { type: 'boolean', notNull: true, default: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: plan_components
     * WHY: The actual "here's my position on housing" entry for a given
     *      plan + category.
     */
    pgm.createTable('plan_components', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent plan
        plan_id: { type: 'uuid', notNull: true, references: 'plan(id)' },
        // which category this position addresses
        category_key: { type: 'text', notNull: true, references: 'plan_component_categories(category_key)' },
        // headline of the position
        title: { type: 'text', notNull: true },
        // long-form description
        description: { type: 'text', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: plan_timeline
     * WHY: Wraps the candidate's campaign calendar. Decoupled from
     *      plan_components so platform and calendar can be edited independently.
     */
    pgm.createTable('plan_timeline', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent plan
        plan_id: { type: 'uuid', notNull: true, references: 'plan(id)' },
        // optional office anchor (denormalized)
        office_id: { type: 'uuid', references: 'office(id)' },
        // optional race anchor (denormalized)
        race_id: { type: 'uuid', references: 'races(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: plan_timeline_components
     * WHY: Individual milestones on the candidate's calendar.
     */
    pgm.createTable('plan_timeline_components', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent timeline
        plan_timeline_id: { type: 'uuid', notNull: true, references: 'plan_timeline(id)' },
        // when this milestone happens
        event_date: { type: 'date', notNull: true },
        // milestone kind — drives icon and grouping
        timeline_category: {
            type: 'text',
            notNull: true,
            check: `timeline_category IN (
                'filing_deadline','primary_election','runoff_election',
                'general_election','post_election_report'
            )`,
        },
        // user must self-mark — we have no way to know they actually filed paperwork
        completed: { type: 'boolean', notNull: true, default: false },
        // when they marked it complete
        completed_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 5 — PLEDGES & FOLLOWS
    // ============================================================

    /* TABLE: pledges
     * WHY: Non-binding "I'll donate $X if this WouldBe hits its goal." Not
     *      money yet — when the goal is hit, we email pledgers a link to
     *      the candidate's real donation processor (ActBlue/WinRed/etc.).
     */
    pgm.createTable('pledges', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who pledged
        pledger_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which campaign
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        // promised amount in cents — must be positive
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // pledge lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','goal_reached','converted','expired','withdrawn')",
        },
        // when we redirected the pledger to ActBlue (we don't track actual payment there)
        converted_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('pledges', 'wouldbe_id', { name: 'idx_pledges_wouldbe' });
    pgm.createIndex('pledges', 'pledger_user_id', { name: 'idx_pledges_pledger' });

    /* TABLE: follows
     * WHY: Generic follow graph for both users and debates. Drives home feed
     *      and notification routing.
     */
    pgm.createTable('follows', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who is following
        follower_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // target id (polymorphic — depends on follow_type)
        followed_id: { type: 'uuid', notNull: true },
        // discriminator for the target's table
        follow_type: { type: 'text', notNull: true, check: "follow_type IN ('User','Debate','Wouldbe')" },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['follower_id', 'followed_id', 'follow_type'] },
    });

    // ============================================================
    // SECTION 6 — SPONSORS & DEBATES
    // ============================================================

    /* TABLE: sponsors
     * WHY: Whoever throws the debate — a user (casual) or corporation/PAC
     *      (corporate). Corporate get a separate display profile + verification.
     */
    pgm.createTable('sponsors', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user who controls this sponsor account
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // sponsor kind — drives KYC requirements
        type: { type: 'text', notNull: true, check: "type IN ('corporate', 'casual')" },
        // display name for the sponsor (may differ from user's name)
        display_name: { type: 'text', notNull: true },
        // R2 url to logo
        logo_url: { type: 'text' },
        // when sponsor's identity was verified (null = pending)
        verified_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: debates
     * WHY: The sweepstakes container. win_type, prize pool, eligibility,
     *      lifecycle. prize_pool_cents is GENERATED so it can never drift
     *      from its inputs. $5,000 cap enforced at the DB because contests
     *      above that trigger state registration.
     */
    pgm.createTable('debates', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who's throwing this debate
        sponsor_id: { type: 'uuid', notNull: true, references: 'sponsors(id)' },
        // display title
        title: { type: 'varchar(256)', notNull: true },
        // marketing description
        description: { type: 'text' },
        // how the winner is determined
        win_type: { type: 'text', notNull: true, check: "win_type IN ('sponsor_decision','general_vote','hybrid')" },
        // for hybrid debates: what % weight the crowd vote has (0–100)
        hybrid_crowd_weight_pct: { type: 'integer', check: 'hybrid_crowd_weight_pct BETWEEN 0 AND 100' },
        // who can contribute to the prize pool
        contribution_type: {
            type: 'text',
            notNull: true,
            check: "contribution_type IN ('closed','open_platform_only','open_pre_debate_only')",
        },
        // who can enter as a contestant
        participation_type: {
            type: 'text',
            notNull: true,
            check: "participation_type IN ('open','invitation_only','closed')",
        },
        // sponsor's contribution to the prize pool, in cents
        sponsor_contribution_cents: { type: 'bigint', notNull: true, default: 0 },
        // platform's seed contribution, in cents
        platform_top_up_cents: { type: 'bigint', notNull: true, default: 0 },
        // sum of user voluntary contributions, in cents
        user_contributions_cents: { type: 'bigint', notNull: true, default: 0 },
        // total prize pool — added below as GENERATED ALWAYS AS (...) STORED
        // pricing_rules narrative for distribution
        prize_distribution_rules: { type: 'text' },
        // how winners are scored (narrative)
        scoring_methodology: { type: 'text' },
        // lifecycle state
        status: {
            type: 'text',
            notNull: true,
            default: 'draft',
            check: "status IN ('draft','open_entry','live','no_posting','closed','cancelled')",
        },
        // date the debate runs (start)
        start_date: { type: 'date' },
        // date it concludes (end)
        end_date: { type: 'date' },
        // when results will be revealed
        results_announce_at: { type: 'timestamptz' },
        // min age for entrants — DB-enforced floor of 13
        min_age_required: { type: 'integer', notNull: true, default: 18, check: 'min_age_required >= 13' },
        // states excluded from entry (sweepstakes law)
        excluded_states: { type: 'text[]', notNull: true, default: '{}' },
        // alternate means of entry — required when paid-entry would otherwise be illegal
        free_entry_method: { type: 'text' },
        // soft-archive
        retired: { type: 'boolean', notNull: true, default: false },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // Generated total prize-pool column (must be added after the inputs exist)
    pgm.sql(`
        ALTER TABLE debates
            ADD COLUMN prize_pool_cents BIGINT GENERATED ALWAYS AS (
                sponsor_contribution_cents + platform_top_up_cents + user_contributions_cents
            ) STORED;
    `);
    // Cap on prize-pool size (sweepstakes registration threshold)
    pgm.sql(`ALTER TABLE debates ADD CONSTRAINT debates_prize_pool_cap_chk CHECK (prize_pool_cents <= 500000);`);
    // Hybrid debates must declare a crowd weight at creation
    pgm.sql(`ALTER TABLE debates ADD CONSTRAINT debates_hybrid_weight_chk CHECK (win_type != 'hybrid' OR hybrid_crowd_weight_pct IS NOT NULL);`);
    pgm.createIndex('debates', 'status', { name: 'idx_debates_status' });
    pgm.createIndex('debates', 'sponsor_id', { name: 'idx_debates_sponsor' });

    // ============================================================
    // SECTION 7 — CONTESTANTS, POSTS, ENDORSEMENTS, COMMENTS
    // ============================================================

    /* TABLE: contestants
     * WHY: A user entered into a specific debate. Snapshots of state/city/age
     *      at entry so later moves don't retroactively change eligibility.
     */
    pgm.createTable('contestants', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // which user is entering
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // SNAPSHOT of the entrant's state at entry time (sweepstakes eligibility lock)
        state_at_entry: { type: 'varchar(2)', notNull: true },
        // SNAPSHOT of the entrant's city at entry time
        city_at_entry: { type: 'varchar(64)' },
        // SNAPSHOT of the entrant's age at entry time
        age_at_entry: { type: 'integer', notNull: true },
        // entry lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'active',
            check: "status IN ('active','withdrawn','disqualified','winner','runner_up','finalist')",
        },
        // free-text DQ reason if applicable
        disqualification_reason: { type: 'text' },
        // when they entered
        joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when they withdrew (if applicable)
        withdrew_at: { type: 'timestamptz' },
    }, {
        constraints: { unique: ['debate_id', 'user_id'] },
    });
    pgm.createIndex('contestants', 'debate_id', { name: 'idx_contestants_debate' });

    /* TABLE: prompts
     * WHY: Debates have one or more prompts contestants respond to. Built
     *      flexible so sponsors can adjust mid-debate.
     */
    pgm.createTable('prompts', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // sequence within the debate
        prompt_order: { type: 'integer', notNull: true },
        // prompt kind — drives expected response shape
        prompt_type: {
            type: 'text',
            notNull: true,
            check: "prompt_type IN ('intro','response','rebuttal','final_statement')",
        },
        // optional headline
        title: { type: 'text' },
        // the actual question/prompt body
        body: { type: 'text', notNull: true },
        // optional illustration
        image_url: { type: 'text' },
        // optional sponsor-provided example video
        example_video_url: { type: 'text' },
        // when this prompt becomes visible (for drip-released multi-round debates)
        release_at: { type: 'timestamptz' },
        // cutoff for contestant responses
        response_deadline: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['debate_id', 'prompt_order'] },
    });

    /* TABLE: posts
     * WHY: The unit of UGC. Two flavors: 'wouldbe_campaign' and
     *      'debate_response'. Single table so moderation pipeline only has
     *      to know about one content surface.
     */
    pgm.createTable('posts', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who posted
        author_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // post kind — drives required parent FK
        post_type: { type: 'text', notNull: true, check: "post_type IN ('wouldbe_campaign','debate_response')" },
        // populated when this is a wouldbe campaign video
        wouldbe_id: { type: 'uuid', references: 'wouldbe(id)' },
        // populated when this is a debate response
        contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // populated when this is a debate response — which prompt
        prompt_id: { type: 'uuid', references: 'prompts(id)' },
        // user-supplied caption text
        caption: { type: 'text' },
        // R2 url for the video
        video_url: { type: 'text' },
        // R2 url for the thumbnail
        thumbnail_url: { type: 'text' },
        // video duration (seconds)
        duration_seconds: { type: 'integer' },
        // moderation pipeline state — only 'approved' renders publicly
        moderation_status: {
            type: 'text',
            notNull: true,
            default: 'pending_upload',
            check: `moderation_status IN (
                'pending_upload','pending_moderation','approved','flagged',
                'rejected','pending_human_review','removed'
            )`,
        },
        // visibility scope
        visibility: {
            type: 'text',
            notNull: true,
            default: 'public',
            check: "visibility IN ('public','unlisted','private','restricted')",
        },
        // when the post became public
        published_at: { type: 'timestamptz' },
        // soft-delete timestamp (preserves thread continuity)
        removed_at: { type: 'timestamptz' },
        // why it was removed
        removed_reason: { type: 'text' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // ensure a post has exactly one parent (campaign OR debate response)
        constraints: {
            check: `(
                (post_type = 'wouldbe_campaign' AND wouldbe_id IS NOT NULL AND contestant_id IS NULL)
                OR
                (post_type = 'debate_response' AND contestant_id IS NOT NULL AND prompt_id IS NOT NULL)
            )`,
        },
    });
    pgm.createIndex('posts', 'wouldbe_id', { name: 'idx_posts_wouldbe', where: 'wouldbe_id IS NOT NULL' });
    pgm.createIndex('posts', 'contestant_id', { name: 'idx_posts_contestant', where: 'contestant_id IS NOT NULL' });
    pgm.createIndex('posts', 'moderation_status', { name: 'idx_posts_moderation' });

    /* TABLE: post_endorsements
     * WHY: The 3-second-hold "I endorse this video" interaction. Single most
     *      important signal for the general-vote winner multiplier.
     */
    pgm.createTable('post_endorsements', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // the post being endorsed
        post_id: { type: 'uuid', references: 'posts(id)' },
        // who endorsed
        endorser_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        //prompt_id if the post that was endorse belonged to a debate what was the id of 
        prompt_id: {type: 'uuid', references: 'prompts(id)' },
        //debate_id the endorsement belongs to
        debate_id: {type: 'uuid', references: 'debates(id)'},
        //type some endorsements can come from would be posts, some endorsements can come from debate posts some can be general endorsements not related to any posts
        endorsement_type: {
            type: 'text',
            notNull: true,
            check: "endorsement_type IN ('general', 'debates', 'wouldbe')",
        },
        // who received the endorsement (wouldbe post target, or general endorsee)
        endorsed_user_id: { type: 'uuid', references: 'users(id)' },
        // contestant the endorsement applies to (if a debate response)
        contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // how long they held — enforces "actually watched" (>=3s)
        hold_seconds: { type: 'numeric(4,1)', notNull: true, check: 'hold_seconds >= 3' },
        // how many seconds of the video they actually watched
        video_seconds_watched: { type: 'integer' },
        // optional text endorsement
        endorsement_text: { type: 'text' },
        // optional criterion they're endorsing on (for per-criterion mode)
        criterion_id: { type: 'uuid' },
        // 1–5 rating when per-criterion mode is active
        criterion_rating: { type: 'integer', check: 'criterion_rating BETWEEN 1 AND 5' },
        // A/B test bucket — which experiment variant generated this endorsement
        experiment_variant: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('post_endorsements', 'contestant_id', { name: 'idx_endorse_contestant' });
    pgm.createIndex('post_endorsements', 'endorser_user_id', { name: 'idx_endorse_user' });
    pgm.createIndex('post_endorsements', 'endorsed_user_id', { name: 'idx_endorse_endorsed_user' });
    // Debate/wouldbe endorsements: one endorser can only endorse a given post once.
    pgm.createIndex('post_endorsements', ['post_id', 'endorser_user_id'], {
        name: 'uniq_endorse_per_post',
        unique: true,
        where: "endorsement_type IN ('debates', 'wouldbe')",
    });
    // General endorsements: one endorser can only endorse a given user once.
    pgm.createIndex('post_endorsements', ['endorser_user_id', 'endorsed_user_id'], {
        name: 'uniq_endorse_general',
        unique: true,
        where: "endorsement_type = 'general'",
    });

    /* TABLE: user_criteria_acknowledgments
     * WHY: Regulatory-compliance record that a user saw endorsement/voting
     *      criteria before participating in a debate. One ack per (user,
     *      ack_type, debate) — the user does not re-acknowledge per post or
     *      per endorsement. Endorsements/votes are valid as long as a matching
     *      ack row exists for the debate they belong to.
     */
    pgm.createTable('user_criteria_acknowledgments', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // Which flow they acknowledged criteria for
        ack_type: {
            type: 'text',
            notNull: true,
            check: "ack_type IN ('endorsement', 'final_round_voting')",
        },
        // The debate this acknowledgment is scoped to
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // Version of the criteria text the user saw (bump when wording changes)
        criteria_version: { type: 'text', notNull: true },
        acknowledged_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // One ack per (user, ack_type, debate) — re-acking is a no-op
        constraints: { unique: ['user_id', 'ack_type', 'debate_id'] },
    });
    pgm.createIndex('user_criteria_acknowledgments', ['user_id', 'debate_id'], { name: 'idx_ack_user_debate' });

    /* TABLE: comments
     * WHY: Free-text replies on any post. Threaded one level deep via
     *      parent_comment_id. Same moderation pipeline as posts.
     */
    pgm.createTable('comments', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // post being commented on
        post_id: { type: 'uuid', notNull: true, references: 'posts(id)' },
        // who wrote the comment
        author_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // parent comment for one-level threading
        parent_comment_id: { type: 'uuid', references: 'comments(id)' },
        // body text
        body: { type: 'text', notNull: true },
        // moderation pipeline state
        moderation_status: {
            type: 'text',
            notNull: true,
            default: 'pending_moderation',
            check: "moderation_status IN ('pending_moderation','approved','flagged','rejected','removed')",
        },
        // soft-delete timestamp (preserves reply-chain UI)
        removed_at: { type: 'timestamptz' },
        // why it was removed
        removed_reason: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('comments', 'post_id', { name: 'idx_comments_post' });

    // ============================================================
    // SECTION 8 — NOMINATIONS & WOULDBE RECOMMENDATIONS
    // ============================================================

    /* TABLE: nominations
     * WHY: User A nominates user B for a debate — B can enter free. Also a
     *      popularity signal, but NOT used in the final-winner math.
     */
    pgm.createTable('nominations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate the nomination is for
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // who's nominating
        nominator_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // who's being nominated
        nominee_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: {
            unique: ['debate_id', 'nominator_user_id', 'nominee_user_id'],
            // can't nominate yourself
            check: 'nominator_user_id != nominee_user_id',
        },
    });
    pgm.createIndex('nominations', 'nominee_user_id', { name: 'idx_nominations_nominee' });

    /* TABLE: wouldbe_recommendations
     * WHY: The ranking-page button "I think this person should run for X."
     *      Feeds the recommendation algorithm.
     */
    pgm.createTable('wouldbe_recommendations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who's recommending
        recommender_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // who's being recommended
        target_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // optional office anchor
        office_id: { type: 'uuid', references: 'office(id)' },
        // optional race anchor
        race_id: { type: 'uuid', references: 'races(id)' },
        // the debate that surfaced this recommendation (if any)
        source_debate_id: { type: 'uuid', references: 'debates(id)' },
        // race-specific vs general "should run for something"
        recommendation_type: { type: 'text', notNull: true, check: "recommendation_type IN ('race_specific','general')" },
        // optional free-text justification
        reason_text: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // can't recommend yourself
        constraints: { check: 'recommender_user_id != target_user_id' },
    });
    pgm.createIndex('wouldbe_recommendations', 'target_user_id', { name: 'idx_wbrec_target' });

    // ============================================================
    // SECTION 9 — DEBATE RULES, CRITERIA, JUDGES
    // ============================================================

    /* TABLE: debate_official_rules
     * WHY: Versioned, immutable snapshot of the rules text. Required for
     *      legal defense of any contest with a cash prize.
     */
    pgm.createTable('debate_official_rules', {
        // surrogate primary key (named rules_id to match domain references)
        rules_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate these rules apply to
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // version label
        version: { type: 'text', notNull: true },
        // inline copy of the rules
        rules_text: { type: 'text', notNull: true },
        // canonical URL of the frozen rules artifact
        rules_url: { type: 'text' },
        // SHA-256 of body for integrity verification
        body_hash: { type: 'text' },
        // when this version becomes the active one
        effective_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when this version was superseded by a newer one (null = current)
        superseded_at: { type: 'timestamptz' },
        // minimum age allowed to compete in this debate (default: adults only)
        age_eligibility_min: { type: 'integer', notNull: true, default: 18 },
        // maximum age allowed to compete (CoolPeople contestant cap)
        age_eligibility_max: { type: 'integer', notNull: true, default: 100 },
        // whether 13-17 minors may compete in this debate at all (opt-in)
        minor_entry_allowed: { type: 'boolean', notNull: true, default: false },
        // which entry methods minors may use — data-driven so the
        // nomination-only vs self-nomination policy can change without a migration
        minor_entry_methods: { type: 'jsonb', notNull: true, default: pgm.func(`'["nominated"]'::jsonb`) },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: debate_judging_criteria
     * WHY: The published criteria voters/judges score on. Required to be
     *      declared in advance and shown at vote time.
     */
    pgm.createTable('debate_judging_criteria', {
        // surrogate primary key (named criterion_id to match cross-references)
        criterion_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // stable slug
        criterion_key: { type: 'text', notNull: true },
        // human-readable label
        display_name: { type: 'text', notNull: true },
        // full description shown to voters/judges
        description: { type: 'text', notNull: true },
        // weight in final score; app/trigger enforces sum ≈ 1.0 per debate
        weight: { type: 'numeric(4,3)', notNull: true, check: 'weight > 0 AND weight <= 1' },
        // ordering in the voter UI
        display_order: { type: 'integer', notNull: true, default: 0 },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['debate_id', 'criterion_key'] },
    });

    /* TABLE: debate_judges
     * WHY: For sponsor-decision / judge-panel debates, the humans doing
     *      the judging. Required to defend skill-contest legal posture.
     */
    pgm.createTable('debate_judges', {
        // surrogate primary key (named judge_id for clarity in FK references)
        judge_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate they judge
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // if the judge is on-platform, their user id
        user_id: { type: 'uuid', references: 'users(id)' },
        // for off-platform judges, display name
        external_name: { type: 'text' },
        // bio shown publicly for off-platform judges
        external_bio: { type: 'text' },
        // role in the panel
        role: { type: 'text', notNull: true, check: "role IN ('lead','panel','tiebreaker','advisor')" },
        // when the judge was publicly disclosed (transparency requirement)
        disclosed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when they recused (null = active)
        recused_at: { type: 'timestamptz' },
        // reason for recusal
        recusal_reason: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // must have either an on-platform user_id or an external_name
        constraints: { check: 'user_id IS NOT NULL OR external_name IS NOT NULL' },
    });
    pgm.createIndex('debate_judges', 'debate_id', {
        name: 'idx_judges_debate_active',
        where: 'recused_at IS NULL',
    });

    /* TABLE: debate_judge_scores
     * WHY: Per-judge, per-contestant, per-criterion scores. Locking so
     *      judges can't change scores after announcement.
     */
    pgm.createTable('debate_judge_scores', {
        // surrogate primary key
        score_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // which judge cast this score
        judge_id: { type: 'uuid', notNull: true, references: 'debate_judges(judge_id)' },
        // which contestant is being scored
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)' },
        // which criterion
        criterion_id: { type: 'uuid', notNull: true, references: 'debate_judging_criteria(criterion_id)' },
        // the score (1–5)
        score: { type: 'numeric(4,2)', notNull: true, check: 'score BETWEEN 1 AND 5' },
        // optional judge notes
        notes: { type: 'text' },
        // when the score was locked (judge submitted) — app-layer rejects updates after
        locked_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['judge_id', 'contestant_id', 'criterion_id'] },
    });

    // ============================================================
    // SECTION 10 — DEBATE ENTRY & VOTING
    // ============================================================

    /* TABLE: debate_payments
     * WHY: The $5 per-debate entry charge. Separated from tips and subs
     *      because refund/reporting logic differs. Mirrors Stripe's shape.
     */
    pgm.createTable('debate_payments', {
        // surrogate primary key (named payment_id for clarity in FK references)
        payment_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who paid
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which debate the payment is for
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // one-off entry vs draw from active subscription
        payment_type: { type: 'text', notNull: true, check: "payment_type IN ('debate_entry_one_off','subscription_credit')" },
        // gross amount in cents
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // Stripe customer id (cu_...)
        stripe_customer_id: { type: 'text' },
        // Stripe PaymentIntent id (pi_...) — UNIQUE to prevent duplicate processing
        stripe_payment_intent_id: { type: 'text', unique: true },
        // Stripe Charge id (ch_...) — UNIQUE for the same reason
        stripe_charge_id: { type: 'text', unique: true },
        // Stripe Balance Transaction id (txn_...)
        stripe_balance_txn_id: { type: 'text' },
        // Stripe processing fee in cents
        fee_amount_cents: { type: 'bigint' },
        // net to us after Stripe fee
        net_amount_cents: { type: 'bigint' },
        // card brand for analytics
        card_brand: { type: 'text' },
        // card last 4 for support lookups
        card_last4: { type: 'char(4)' },
        // wallet variant (analytics)
        wallet_type: { type: 'text', check: "wallet_type IN ('apple_pay','google_pay','link')" },
        // lifecycle state
        status: { type: 'text', notNull: true, check: "status IN ('pending','succeeded','failed','refunded','disputed')" },
        // failure code/message from Stripe
        failure_reason: { type: 'text' },
        // when the charge succeeded
        charged_at: { type: 'timestamptz' },
        // when refund completed
        refunded_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: debate_entries
     * WHY: Legal entry record — captures attestations the entrant signed.
     *      Distinct from contestants: this is the immutable legal artifact.
     */
    pgm.createTable('debate_entries', {
        // surrogate primary key (named entry_id for clarity)
        entry_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // who entered
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // link to contestants row (the runtime identity)
        contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // how they got in (paid, nominated, AMOE, free self-entry, etc.)
        entry_method: { type: 'text', notNull: true, check: "entry_method IN ('nominated','paid_per_debate','subscription','amoe','free_self_entry')" },
        // who nominated them (if applicable)
        nominator_id: { type: 'uuid', references: 'users(id)' },
        // AMOE text submission, if entry_method='amoe'
        amoe_submission_text: { type: 'text' },
        // link to payment row if paid entry
        entry_payment_id: { type: 'uuid', references: 'debate_payments(payment_id)' },
        // "I am 18+" attestation — true for adult entrants; null/false for minors
        attestation_age_18: { type: 'boolean' },
        // true when this is a 13-17 minor entry (guardian-consented path)
        is_minor_entry: { type: 'boolean', notNull: true, default: false },
        // verified age of the entrant at entry time
        age_at_entry: { type: 'integer' },
        // link to the entrant's child_safety_records row (FK added after that table exists)
        guardian_consent_id: { type: 'uuid' },
        // when the parent/guardian consented to THIS entry + its rules (minor gate)
        guardian_consent_at: { type: 'timestamptz' },
        // state user attested as residence at entry
        attestation_state: { type: 'char(2)', notNull: true },
        // "I have read the rules" attestation
        attestation_rules_seen: { type: 'boolean', notNull: true, default: false },
        // which rules version they saw (versioned snapshot)
        rules_version_seen: { type: 'text' },
        // when they acknowledged the rules
        acknowledged_rules_at: { type: 'timestamptz', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // if they later withdrew
        withdrew_at: { type: 'timestamptz' },
        // if later disqualified
        disqualified_at: { type: 'timestamptz' },
        // DQ reason (free text)
        disqualification_reason: { type: 'text' },
    }, {
        constraints: {
            unique: ['debate_id', 'user_id'],
            // eligibility: either an adult who attested 18+, or a minor with guardian consent on this entry
            check: `
                (is_minor_entry = false AND attestation_age_18 = true)
                OR (is_minor_entry = true AND guardian_consent_at IS NOT NULL AND attestation_age_18 IS DISTINCT FROM true)
            `,
        },
    });

    /* TABLE: debate_votes
     * WHY: One-vote-per-user general vote. UNIQUE constraint enforces it.
     */
    pgm.createTable('debate_votes', {
        // surrogate primary key (named vote_id)
        vote_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // voter
        voter_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // contestant being voted for
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)' },
        // legal-defense checkbox: saw criteria
        acknowledged_criteria: { type: 'boolean', notNull: true },
        // when they checked it
        acknowledged_at: { type: 'timestamptz', notNull: true },
        // versioned rules they agreed to
        rules_version_seen: { type: 'text', notNull: true },
        // anti-fraud: how long they watched
        view_minutes_logged: { type: 'integer', notNull: true, default: 0 },
        // 1.0 default; coordinated-behavior detection can reduce
        weight: { type: 'numeric(4,3)', notNull: true, default: 1.000 },
        // fraud/forensics: voter ip
        voter_ip: { type: 'inet' },
        // fraud/forensics: device fingerprint
        voter_device_fingerprint: { type: 'text' },
        // when this vote was invalidated (null = counts)
        invalidated_at: { type: 'timestamptz' },
        // reason for invalidation
        invalidation_reason: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['debate_id', 'voter_user_id'] },
    });

    /* TABLE: debate_vote_scores
     * WHY: When voters score per-criterion (the 1–5 mode), scores live here
     *      keyed to the parent vote row.
     */
    pgm.createTable('debate_vote_scores', {
        // surrogate primary key
        score_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent vote row
        vote_id: { type: 'uuid', notNull: true, references: 'debate_votes(vote_id)' },
        // contestant being scored
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)' },
        // criterion being scored
        criterion_id: { type: 'uuid', notNull: true, references: 'debate_judging_criteria(criterion_id)' },
        // 1–5 score
        score: { type: 'integer', notNull: true, check: 'score BETWEEN 1 AND 5' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['vote_id', 'contestant_id', 'criterion_id'] },
    });

    /* TABLE: debate_final_round_ranked_votes
     * WHY: Last round forces ranked-choice. Voters pick an ORDER instead of
     *      a single contestant.
     */
    pgm.createTable('debate_final_round_ranked_votes', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // voter
        voter_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // contestant at this rank
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)' },
        // rank (1 = first choice)
        rank: { type: 'integer', notNull: true, check: 'rank >= 1' },
        // legal-defense checkbox
        acknowledged_criteria: { type: 'boolean', notNull: true },
        // when checked
        acknowledged_at: { type: 'timestamptz', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    // each (voter, contestant) appears once and each rank appears once per ballot
    pgm.addConstraint('debate_final_round_ranked_votes', 'ranked_votes_unique_contestant', {
        unique: ['debate_id', 'voter_user_id', 'contestant_id'],
    });
    pgm.addConstraint('debate_final_round_ranked_votes', 'ranked_votes_unique_rank', {
        unique: ['debate_id', 'voter_user_id', 'rank'],
    });

    // ============================================================
    // SECTION 11 — DEBATE RESULTS, PRIZE POOL, PAYOUTS
    // ============================================================

    /* TABLE: debate_results
     * WHY: Final, locked, announced outcome. Captures exact math used to
     *      pick the winner — required for defending against contestant
     *      disputes.
     */
    pgm.createTable('debate_results', {
        // surrogate primary key (named result_id)
        result_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate — UNIQUE so each debate has at most one result row
        debate_id: { type: 'uuid', notNull: true, unique: true, references: 'debates(id)' },
        // winning contestant (null for no_contest / voided)
        winner_contestant_id: { type: 'uuid', references: 'contestants(id)' },
        // outcome kind
        result_type: {
            type: 'text',
            notNull: true,
            check: "result_type IN ('sponsor_decision','general_vote','hybrid','no_contest','voided')",
        },
        // frozen crowd-vote breakdown
        crowd_score_data: { type: 'jsonb' },
        // frozen judge-score breakdown
        judge_score_data: { type: 'jsonb' },
        // frozen endorsement multiplier breakdown
        endorsement_multiplier: { type: 'jsonb' },
        // frozen final calc — the canonical math
        final_calculation: { type: 'jsonb', notNull: true },
        // when result was locked (no more updates)
        locked_at: { type: 'timestamptz', notNull: true },
        // when result was announced publicly
        announced_at: { type: 'timestamptz', notNull: true },
        // dispute window cutoff (7–14 days after announce)
        dispute_window_ends_at: { type: 'timestamptz', notNull: true },
        // free-text notes
        notes: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: prize_pool_contributions
     * WHY: Every dollar in a debate's prize pool. Per-contribution rows
     *      make refunds and accounting traceable.
     */
    pgm.createTable('prize_pool_contributions', {
        // surrogate primary key (named contribution_id)
        contribution_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // contributor (null for platform top-ups)
        contributor_user_id: { type: 'uuid', references: 'users(id)' },
        // where the money came from
        contribution_source: {
            type: 'text',
            notNull: true,
            check: "contribution_source IN ('sponsor','platform_top_up','user_voluntary','sponsor_match')",
        },
        // how the contributor is displayed on the leaderboard
        contributor_display_name: { type: 'text' },
        // amount in cents
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // Stripe PaymentIntent for idempotency
        stripe_payment_intent_id: { type: 'text', unique: true },
        // point after which contribution can't be pulled back
        locked_at: { type: 'timestamptz', notNull: true },
        // refund window cutoff
        refundable_until: { type: 'timestamptz' },
        // when refunded (if applicable)
        refunded_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: prize_distributions
     * WHY: Actual disbursement to a winner. Holds W-9 / 1099 lifecycle —
     *      required for any winner receiving > $600/yr.
     */
    pgm.createTable('prize_distributions', {
        // surrogate primary key (named distribution_id)
        distribution_id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // recipient (the user being paid)
        recipient_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // place finish (1=winner, 2=runner-up, ...)
        placement: { type: 'integer', notNull: true, check: 'placement >= 1' },
        // amount paid in cents
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // when W-9 was received (required before disbursing for taxable amounts)
        w9_received_at: { type: 'timestamptz' },
        // url to W-9 doc
        w9_document_url: { type: 'text' },
        // when we filed the 1099 with IRS
        form_1099_filed_at: { type: 'timestamptz' },
        // Stripe Transfer id (tr_...) — UNIQUE prevents double-payout
        stripe_transfer_id: { type: 'text', unique: true },
        // method we paid by
        disbursement_method: { type: 'text' },
        // when funds left the platform
        disbursed_at: { type: 'timestamptz' },
        // when winner disputed the disbursement
        disputed_at: { type: 'timestamptz' },
        // when dispute was resolved
        dispute_resolved_at: { type: 'timestamptz' },
        // dispute resolution narrative
        dispute_resolution_notes: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 12 — MESSAGING
    // ============================================================

    /* TABLE: conversations
     * WHY: The thread itself. Type distinguishes DMs from group chats
     *      from system threads. last_message_at denormalized for inbox sort.
     */
    pgm.createTable('conversations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // thread kind — direct (1:1), group, or system (platform notices)
        type: { type: 'text', notNull: true, check: "type IN ('direct','group','system')" },
        // optional thread title
        title: { type: 'text' },
        // who created the thread (null for system threads)
        created_by_user_id: { type: 'uuid', references: 'users(id)' },
        // denormalized — when the most recent message arrived
        last_message_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: conversation_participants
     * WHY: Membership in a conversation. last_read_at drives unread badges;
     *      left_at is soft-removal so the thread renders for everyone else.
     */
    pgm.createTable('conversation_participants', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which thread
        conversation_id: { type: 'uuid', notNull: true, references: 'conversations(id)' },
        // which user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // member vs admin (admins can add/remove others in group chats)
        role: { type: 'text', notNull: true, default: 'member', check: "role IN ('member','admin')" },
        // when they joined
        joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // last time they read messages — drives unread count
        last_read_at: { type: 'timestamptz' },
        // soft-leave (preserves UI for remaining participants)
        left_at: { type: 'timestamptz' },
    }, {
        constraints: { unique: ['conversation_id', 'user_id'] },
    });

    /* TABLE: messages
     * WHY: Individual chat messages.
     */
    pgm.createTable('messages', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which thread
        conversation_id: { type: 'uuid', notNull: true, references: 'conversations(id)' },
        // sender (null for system messages)
        sender_user_id: { type: 'uuid', references: 'users(id)' },
        // user vs system-generated event message
        message_type: { type: 'text', notNull: true, default: 'user', check: "message_type IN ('user','system')" },
        // message text
        body: { type: 'text' },
        // optional R2 attachment url
        attachment_url: { type: 'text' },
        // self-reference for inline replies
        reply_to_message_id: { type: 'uuid', references: 'messages(id)' },
        // moderation pipeline state
        moderation_status: {
            type: 'text',
            notNull: true,
            default: 'approved',
            check: "moderation_status IN ('pending_moderation','approved','flagged','removed')",
        },
        // soft-delete (preserves thread position)
        deleted_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('messages', ['conversation_id', 'created_at'], { name: 'idx_messages_convo' });

    // ============================================================
    // SECTION 13 — PAYMENTS (TIPS, SUBSCRIPTIONS, WEBHOOKS)
    // ============================================================

    /* TABLE: tips
     * WHY: Platform-fee charge at pledge moment (once they leave for ActBlue
     *      they're gone). Each tip is a real Stripe charge.
     */
    pgm.createTable('tips', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who paid the tip
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which pledge it accompanied (nullable for standalone tips)
        pledge_id: { type: 'uuid', references: 'pledges(id)' },
        // gross tip amount in cents
        tip_amount_cents: { type: 'bigint', notNull: true, check: 'tip_amount_cents > 0' },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // Stripe customer id
        stripe_customer_id: { type: 'text' },
        // Stripe PaymentIntent (unique to prevent dup processing)
        stripe_payment_intent_id: { type: 'text', unique: true },
        // Stripe Charge id (unique)
        stripe_charge_id: { type: 'text', unique: true },
        // Stripe Balance Transaction id
        stripe_balance_txn_id: { type: 'text' },
        // Stripe processing fee in cents
        fee_amount_cents: { type: 'bigint' },
        // net to platform after fees
        net_amount_cents: { type: 'bigint' },
        // card brand (analytics)
        card_brand: { type: 'text' },
        // card last 4 (support lookups)
        card_last4: { type: 'char(4)' },
        // wallet variant
        wallet_type: { type: 'text', check: "wallet_type IN ('apple_pay','google_pay','link')" },
        // lifecycle state
        status: { type: 'text', notNull: true, check: "status IN ('pending','succeeded','failed','refunded','disputed')" },
        // Stripe failure code/message
        failure_reason: { type: 'text' },
        // when the charge succeeded
        charged_at: { type: 'timestamptz' },
        // when refund completed
        refunded_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: post_payments
     * WHY: $5 flat fee to post videos on a WouldBe. Separate from tips for
     *      clean revenue reporting.
     */
    pgm.createTable('post_payments', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who paid
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which campaign this unlocks video posting for
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        // gross amount in cents
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // Stripe customer id
        stripe_customer_id: { type: 'text' },
        // Stripe PaymentIntent (unique)
        stripe_payment_intent_id: { type: 'text', unique: true },
        // Stripe Charge (unique)
        stripe_charge_id: { type: 'text', unique: true },
        // Stripe processing fee in cents
        fee_amount_cents: { type: 'bigint' },
        // net to platform
        net_amount_cents: { type: 'bigint' },
        // lifecycle state
        status: { type: 'text', notNull: true, check: "status IN ('pending','succeeded','failed','refunded')" },
        // when charge succeeded
        charged_at: { type: 'timestamptz' },
        // when refunded
        refunded_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: subscriptions
     * WHY: Recurring monthly memberships ($5/$15 tier). The AGREEMENT only;
     *      per-month charges live in subscription_payments.
     */
    pgm.createTable('subscriptions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // subscriber
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // tier name
        tier: { type: 'text', notNull: true },
        // monthly price in cents
        monthly_amount_cents: { type: 'bigint', notNull: true, check: 'monthly_amount_cents > 0' },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // Stripe customer id
        stripe_customer_id: { type: 'text' },
        // Stripe Subscription id (unique)
        stripe_subscription_id: { type: 'text', unique: true },
        // Stripe Price id (the catalog entry)
        stripe_price_id: { type: 'text' },
        // lifecycle state
        status: {
            type: 'text',
            notNull: true,
            check: "status IN ('trialing','active','past_due','cancelled','paused','incomplete')",
        },
        // current billing period start
        current_period_start: { type: 'timestamptz' },
        // current billing period end
        current_period_end: { type: 'timestamptz' },
        // user has requested cancellation at end of period
        cancel_at_period_end: { type: 'boolean', notNull: true, default: false },
        // trial expiration (null if no trial)
        trial_end: { type: 'timestamptz' },
        // when user cancelled
        cancelled_at: { type: 'timestamptz' },
        // when subscription fully ended
        ended_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // audit timestamp — last update
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('subscriptions', 'user_id', {
        name: 'idx_subscription_one_active_per_user',
        unique: true,
        where: "status = 'active'",
    });

    /* TABLE: subscription_payments
     * WHY: Every monthly charge generated by a subscription. Essential for
     *      revenue, disputes, refund tracking.
     */
    pgm.createTable('subscription_payments', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // parent subscription
        subscription_id: { type: 'uuid', notNull: true, references: 'subscriptions(id)' },
        // denormalized owner for easier querying
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // amount charged in cents
        amount_cents: { type: 'bigint', notNull: true, check: 'amount_cents > 0' },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // Stripe processing fee
        fee_amount_cents: { type: 'bigint' },
        // net to platform
        net_amount_cents: { type: 'bigint' },
        // Stripe Invoice id (unique)
        stripe_invoice_id: { type: 'text', unique: true },
        // Stripe Charge id
        stripe_charge_id: { type: 'text' },
        // Stripe PaymentIntent id
        stripe_payment_intent_id: { type: 'text' },
        // billing period start
        period_start: { type: 'timestamptz' },
        // billing period end
        period_end: { type: 'timestamptz' },
        // lifecycle state
        status: { type: 'text', notNull: true, check: "status IN ('paid','failed','pending','refunded')" },
        // when payment cleared
        paid_at: { type: 'timestamptz' },
        // when payment failed
        failed_at: { type: 'timestamptz' },
        // Stripe failure reason
        failure_reason: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: stripe_webhook_events
     * WHY: Stripe retries webhooks during outages. Without idempotency you
     *      WILL double-charge. UNIQUE(stripe_event_id) makes redelivery a no-op.
     */
    pgm.createTable('stripe_webhook_events', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // Stripe event id (evt_...) — the idempotency key
        stripe_event_id: { type: 'text', unique: true, notNull: true },
        // event name (charge.succeeded, etc.)
        event_type: { type: 'text', notNull: true },
        // raw webhook payload for audit
        payload: { type: 'jsonb', notNull: true },
        // true=production stripe key, false=test
        livemode: { type: 'boolean', notNull: true },
        // when we received the webhook
        received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when we finished processing
        processed_at: { type: 'timestamptz' },
        // pipeline state
        processing_status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "processing_status IN ('pending','processing','succeeded','failed','ignored')",
        },
        // retry counter
        processing_attempts: { type: 'integer', notNull: true, default: 0 },
        // last error message
        error_message: { type: 'text' },
        // which tip row this event affected
        affected_tip_id: { type: 'uuid', references: 'tips(id)' },
        // which subscription this event affected
        affected_subscription_id: { type: 'uuid', references: 'subscriptions(id)' },
        // which subscription_payment this event affected
        affected_subscription_payment_id: { type: 'uuid', references: 'subscription_payments(id)' },
        // which post_payment this event affected
        affected_post_payment_id: { type: 'uuid', references: 'post_payments(id)' },
        // which debate_payment this event affected
        affected_debate_payment_id: { type: 'uuid', references: 'debate_payments(payment_id)' },
    });

    // ============================================================
    // SECTION 14 — CONSENT & ATTESTATION (Moderation Pillar #1)
    // ============================================================

    /* TABLE: legal_documents
     * WHY: Immutable, hashed snapshots of every ToS, privacy policy, SMS
     *      consent doc, contest rules. When a 2026 consent is disputed in
     *      2029, we produce the exact bytes they agreed to.
     */
    pgm.createTable('legal_documents', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // doc kind
        doc_type: {
            type: 'text',
            notNull: true,
            check: `doc_type IN (
                'tos','privacy_policy','sms_consent','marketing',
                'contest_rules','pledge_disclosure','debate_judging_criteria'
            )`,
        },
        // version label
        version: { type: 'text', notNull: true },
        // when this version went live
        effective_date: { type: 'timestamptz', notNull: true },
        // SHA-256 of body bytes (integrity check)
        body_hash: { type: 'text', notNull: true },
        // R2 url where the frozen doc lives
        body_storage_url: { type: 'text', notNull: true },
        // jurisdictions this version applies to
        jurisdiction_scope: { type: 'jsonb' },
        // pointer to the newer doc that replaced this one
        superseded_by_id: { type: 'uuid', references: 'legal_documents(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: user_consents
     * WHY: Append-only log of every consent. TCPA penalties are $500–$1500
     *      per unauthorized SMS — this table is the shield. To "revoke" a
     *      consent, INSERT a new row with withdrawn_at set; never UPDATE.
     */
    pgm.createTable('user_consents', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who consented
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which document version they consented to
        legal_document_id: { type: 'uuid', notNull: true, references: 'legal_documents(id)' },
        // consent type
        consent_type: {
            type: 'text',
            notNull: true,
            check: `consent_type IN (
                'tos','privacy_policy','marketing_email','sms_marketing',
                'sms_transactional','data_processing','third_party_sharing',
                'data_sale','sensitive_data_processing'
            )`,
        },
        // when they consented
        consented_at: { type: 'timestamptz', notNull: true },
        // TCPA defense: IP at consent time
        ip_address: { type: 'inet' },
        // TCPA defense: user agent at consent time
        user_agent: { type: 'text' },
        // how they consented
        consent_method: {
            type: 'text',
            notNull: true,
            check: "consent_method IN ('checkbox','double_optin_email','double_optin_sms','signed_form','api')",
        },
        // when they withdrew (null = still active)
        withdrawn_at: { type: 'timestamptz' },
        // how they withdrew
        withdrawal_method: { type: 'text' },
        // freeform context about WHERE on the site they consented
        context: { type: 'jsonb' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_consents', ['user_id', 'consent_type'], { name: 'idx_user_consents_user' });

    /* TABLE: user_attestations
     * WHY: Different from consent — a FACTUAL CLAIM the user makes ("I am
     *      18+"). Required for FEC compliance; shifts legal liability to user.
     */
    pgm.createTable('user_attestations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who attested
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // what kind of claim
        attestation_type: {
            type: 'text',
            notNull: true,
            check: `attestation_type IN (
                'age_18','age_13','age_35_under','us_citizen','district_resident',
                'own_funds','not_foreign_national','not_federal_contractor'
            )`,
        },
        // the asserted answer
        attested_value: { type: 'text', notNull: true },
        // attestation language version
        attestation_version: { type: 'text', notNull: true },
        // when they attested
        attested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // IP at attestation (audit)
        ip_address: { type: 'inet' },
        // where in the flow this happened
        context: { type: 'text', notNull: true, check: "context IN ('signup','pledge_flow','debate_entry','candidate_onboarding')" },
        // when this attestation needs renewing
        expires_at: { type: 'timestamptz' },
        // pointer to a newer attestation that replaced this one
        superseded_by_id: { type: 'uuid', references: 'user_attestations(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('user_attestations', ['user_id', 'attestation_type'], { name: 'idx_attestations_user_type' });

    // ============================================================
    // SECTION 15 — CONTENT MODERATION (Moderation Pillar #2)
    // ============================================================

    /* TABLE: content_items
     * WHY: Unified registry for ALL moderatable content so the pipeline has
     *      a single surface to monitor.
     */
    pgm.createTable('content_items', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who uploaded
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // polymorphic parent kind
        parent_type: {
            type: 'text',
            notNull: true,
            check: `parent_type IN (
                'profile','wouldbe_post','debate_response','comment',
                'review','message','prompt_response'
            )`,
        },
        // id in the parent table
        parent_id: { type: 'uuid', notNull: true },
        // media kind
        content_type: { type: 'text', notNull: true, check: "content_type IN ('video','image','text','audio')" },
        // R2 url for the file
        storage_url: { type: 'text' },
        // inline text content (for text-only items)
        text_content: { type: 'text' },
        // R2 url for thumbnail
        thumbnail_url: { type: 'text' },
        // duration for video/audio
        duration_seconds: { type: 'integer' },
        // bytes (for storage planning)
        file_size_bytes: { type: 'bigint' },
        // MIME type
        mime_type: { type: 'text' },
        // moderation pipeline state — only 'approved' renders publicly
        moderation_status: {
            type: 'text',
            notNull: true,
            default: 'pending_upload',
            check: `moderation_status IN (
                'pending_upload','pending_moderation','approved','flagged',
                'rejected','pending_human_review','removed'
            )`,
        },
        // visibility scope (default private, must be promoted)
        visibility: {
            type: 'text',
            notNull: true,
            default: 'private',
            check: "visibility IN ('public','unlisted','private','restricted')",
        },
        // optional age gate
        age_restriction: { type: 'text', check: "age_restriction IN ('all','13plus','18plus')" },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when it was made public
        published_at: { type: 'timestamptz' },
        // when removed
        removed_at: { type: 'timestamptz' },
        // coded removal reason
        removed_reason: {
            type: 'text',
            check: `removed_reason IN (
                'csam','dmca','defamation','harassment','tos_violation',
                'user_request','admin_action'
            )`,
        },
    });
    pgm.createIndex('content_items', ['parent_type', 'parent_id'], { name: 'idx_content_items_parent' });
    pgm.createIndex('content_items', 'moderation_status', { name: 'idx_content_items_status' });
    pgm.createIndex('content_items', 'user_id', { name: 'idx_content_items_user' });

    /* TABLE: moderation_events
     * WHY: Every automated AND manual scan creates a row. If CSAM is
     *      detected, this is the evidence chain we hand to NCMEC.
     */
    pgm.createTable('moderation_events', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // content scanned
        content_item_id: { type: 'uuid', notNull: true, references: 'content_items(id)' },
        // which provider did the scan
        provider: {
            type: 'text',
            notNull: true,
            check: `provider IN (
                'hive','openai_moderation','openai_vision','photodna',
                'thorn_safer','perspective','aws_rekognition','manual'
            )`,
        },
        // provider's model/version
        provider_version: { type: 'text' },
        // scan verdict
        result: { type: 'text', notNull: true, check: "result IN ('clean','flagged','rejected','inconclusive','error')" },
        // confidence 0–1
        confidence_score: { type: 'decimal(5,4)' },
        // per-category scores (sexual, violence, hate, etc.)
        category_scores: { type: 'jsonb' },
        // raw API response — durable even if provider changes schema
        raw_response: { type: 'jsonb' },
        // when scan ran
        scanned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // scan duration (for budgeting and SLA)
        scan_duration_ms: { type: 'integer' },
        // cost in cents (for API budget tracking)
        cost_cents: { type: 'integer' },
        // for provider='manual', the moderator
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
    });
    pgm.createIndex('moderation_events', 'content_item_id', { name: 'idx_modevents_content' });

    /* TABLE: moderation_queue
     * WHY: Human-review queue. SLAs (e.g. CSAM = 24h) prove to regulators
     *      that flagged content is reviewed within defined windows.
     */
    pgm.createTable('moderation_queue', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // content in question
        content_item_id: { type: 'uuid', notNull: true, references: 'content_items(id)' },
        // what put it in the queue
        queue_type: {
            type: 'text',
            notNull: true,
            check: `queue_type IN (
                'auto_flagged','user_reported','appeal','csam_suspected',
                'dmca_claim','live_stream_review'
            )`,
        },
        // 1 (CSAM) – 5 (least urgent)
        priority: { type: 'integer', notNull: true, check: 'priority BETWEEN 1 AND 5' },
        // queue state
        status: { type: 'text', notNull: true, default: 'open', check: "status IN ('open','in_review','resolved','escalated')" },
        // moderator working on this item
        assigned_to_user_id: { type: 'uuid', references: 'users(id)' },
        // when it was claimed
        assigned_at: { type: 'timestamptz' },
        // computed deadline based on queue_type
        sla_deadline: { type: 'timestamptz', notNull: true },
        // outcome shorthand
        resolution: { type: 'text' },
        // free-text resolution notes
        resolution_notes: { type: 'text' },
        // when resolved
        resolved_at: { type: 'timestamptz' },
        // who resolved
        resolved_by_user_id: { type: 'uuid', references: 'users(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('moderation_queue', ['priority', 'created_at'], {
        name: 'idx_modqueue_open',
        where: "status IN ('open','in_review')",
    });

    /* TABLE: moderation_appeals
     * WHY: DSA / proposed US legislation require appeals on moderation
     *      decisions. Documented trail reduces 'censorship' lawsuit exposure.
     */
    pgm.createTable('moderation_appeals', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // content the user is appealing about
        content_item_id: { type: 'uuid', notNull: true, references: 'content_items(id)' },
        // the appealing user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // user's argument
        appeal_reason: { type: 'text', notNull: true },
        // appeal lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','under_review','granted','denied','abandoned')",
        },
        // when filed
        filed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when reviewed
        reviewed_at: { type: 'timestamptz' },
        // which admin reviewed
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // free-text decision rationale
        decision_notes: { type: 'text' },
        // snapshot of mod status before the appeal
        original_moderation_status: { type: 'text' },
        // final mod status after decision
        final_moderation_status: { type: 'text' },
    });

    /* TABLE: csam_reports
     * WHY: 18 USC 2258A requires platforms to report CSAM to NCMEC. DO NOT
     *      DELETE — federal law requires 90-day preservation.
     */
    pgm.createTable('csam_reports', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // content flagged
        content_item_id: { type: 'uuid', notNull: true, references: 'content_items(id)' },
        // user who uploaded (suspect)
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // what detected it
        detection_provider: {
            type: 'text',
            notNull: true,
            check: "detection_provider IN ('photodna','thorn_safer','hive_csam','manual_flag','user_report')",
        },
        // confidence 0–1
        detection_confidence: { type: 'decimal(5,4)' },
        // PhotoDNA perceptual hash
        photodna_hash: { type: 'text' },
        // NCMEC report id we received back
        ncmec_report_id: { type: 'text' },
        // when we filed to NCMEC
        ncmec_reported_at: { type: 'timestamptz' },
        // whether we also notified law enforcement
        law_enforcement_notified: { type: 'boolean', notNull: true, default: false },
        // action taken on suspect account
        user_account_action: { type: 'text', check: "user_account_action IN ('banned','locked','suspended')" },
        // legal-hold copy of the file (NOT public)
        content_preserved_url: { type: 'text' },
        // 90-day default per statute
        preservation_period_days: { type: 'integer', notNull: true, default: 90 },
        // moderator who handled the report
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: dmca_takedowns
     * WHY: DMCA safe harbor requires good-faith takedown processing and
     *      repeat-infringer policy. Without this you lose safe harbor.
     */
    pgm.createTable('dmca_takedowns', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // claimant identity
        claimant_name: { type: 'text', notNull: true },
        // claimant contact
        claimant_email: { type: 'text', notNull: true },
        // claimant mailing address
        claimant_address: { type: 'text', notNull: true },
        // description of allegedly infringed work
        claimed_work: { type: 'text', notNull: true },
        // affected content item
        affected_content_item_id: { type: 'uuid', references: 'content_items(id)' },
        // sworn good-faith statement (DMCA requires this)
        sworn_statement: { type: 'text', notNull: true },
        // when notice received
        received_at: { type: 'timestamptz', notNull: true },
        // takedown lifecycle
        action_taken: {
            type: 'text',
            check: "action_taken IN ('content_removed','counter_notice_received','restored','no_action')",
        },
        // when action was taken
        action_taken_at: { type: 'timestamptz' },
        // optional pointer to counter-notice
        counter_notice_id: { type: 'uuid' },
        // when content was restored after a counter-notice
        restoration_date: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: live_stream_moderation_events
     * WHY: Live streams need real-time mod. Frame sampling, transcripts,
     *      kill-switch actions all log here.
     */
    pgm.createTable('live_stream_moderation_events', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate's stream
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // stream URL at the time of the event
        stream_url: { type: 'text' },
        // what happened
        event_type: {
            type: 'text',
            notNull: true,
            check: `event_type IN (
                'frame_sampled','audio_transcribed','kill_switch_activated',
                'mod_intervention','viewer_report','technical_issue'
            )`,
        },
        // when it happened
        event_timestamp: { type: 'timestamptz', notNull: true },
        // broadcast delay at the time (kill-switch window)
        broadcast_delay_seconds: { type: 'integer', notNull: true, default: 15 },
        // moderator involved (if any)
        moderator_user_id: { type: 'uuid', references: 'users(id)' },
        // event payload — provider responses, etc.
        details: { type: 'jsonb' },
        // whether the event tripped the kill switch
        resulted_in_stream_stop: { type: 'boolean', notNull: true, default: false },
    });

    // ============================================================
    // SECTION 16 — TRUST & SAFETY (Moderation Pillar #3)
    // ============================================================

    /* TABLE: user_reports
     * WHY: Community reporting scales mod. false_report_flag defends against
     *      weaponized reporting.
     */
    pgm.createTable('user_reports', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who reported
        reporter_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // content being reported (one of these must be set)
        reported_content_id: { type: 'uuid', references: 'content_items(id)' },
        // user being reported (one of these must be set)
        reported_user_id: { type: 'uuid', references: 'users(id)' },
        // what kind of violation
        report_category: {
            type: 'text',
            notNull: true,
            check: `report_category IN (
                'harassment','hate_speech','threats','csam','dmca_violation',
                'impersonation','spam','doxxing','election_misinformation','other'
            )`,
        },
        // reporter's narrative
        description: { type: 'text' },
        // optional supporting urls
        evidence_urls: { type: 'jsonb' },
        // lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','under_review','resolved','dismissed','escalated')",
        },
        // auto-assigned from report_category
        priority: { type: 'integer' },
        // when resolved
        resolved_at: { type: 'timestamptz' },
        // outcome
        resolution: { type: 'text' },
        // flagged if reporter is abusing the system
        false_report_flag: { type: 'boolean', notNull: true, default: false },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // either content or user must be reported
        constraints: { check: 'reported_content_id IS NOT NULL OR reported_user_id IS NOT NULL' },
    });

    /* TABLE: user_strikes
     * WHY: Strike accumulation drives auto-escalation (3 warnings →
     *      suspension). Required for DMCA repeat-infringer policy.
     */
    pgm.createTable('user_strikes', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user being struck
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // strike kind
        strike_type: {
            type: 'text',
            notNull: true,
            check: `strike_type IN (
                'warning','temporary_suspension','permanent_ban',
                'content_removal','feature_restriction'
            )`,
        },
        // 1 (warning) – 5 (perma-ban)
        severity: { type: 'integer', notNull: true, check: 'severity BETWEEN 1 AND 5' },
        // narrative reason
        reason: { type: 'text', notNull: true },
        // additional details
        details: { type: 'text' },
        // related content (if from a removal)
        related_content_item_id: { type: 'uuid', references: 'content_items(id)' },
        // related user report (if from a report)
        related_report_id: { type: 'uuid', references: 'user_reports(id)' },
        // admin who issued (null = automated)
        issued_by_user_id: { type: 'uuid', references: 'users(id)' },
        // when issued
        issued_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when strike decays off the record
        expires_at: { type: 'timestamptz' },
        // whether the user appealed
        appealed: { type: 'boolean', notNull: true, default: false },
        // appeal outcome
        appeal_status: { type: 'text' },
    });

    /* TABLE: account_actions
     * WHY: Append-only audit log of every action taken on an account.
     *      Critical for defending against 'wrongful ban' lawsuits.
     */
    pgm.createTable('account_actions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user being acted on
        target_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // action kind
        action_type: {
            type: 'text',
            notNull: true,
            check: `action_type IN (
                'suspend','unsuspend','ban','unban','restrict_feature',
                'restore_feature','force_password_reset','force_logout'
            )`,
        },
        // coded reason
        reason_category: { type: 'text', notNull: true },
        // free-text rationale
        reason_details: { type: 'text' },
        // admin who acted (null if system)
        performed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // true for automated actions
        performed_by_system: { type: 'boolean', notNull: true, default: false },
        // duration (for temporary actions)
        duration_hours: { type: 'integer' },
        // when temp action expires
        effective_until: { type: 'timestamptz' },
        // when action was reversed (null = still in effect)
        reversed_at: { type: 'timestamptz' },
        // admin who reversed it
        reversed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // why it was reversed
        reversal_reason: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: user_blocks
     * WHY: User-to-user blocks (NOT admin actions). Filters feeds, hides
     *      comments, suppresses mentions.
     */
    pgm.createTable('user_blocks', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who's blocking
        blocker_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // who's blocked
        blocked_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // scope of the block
        block_scope: {
            type: 'text',
            notNull: true,
            default: 'full',
            check: "block_scope IN ('full','comments_only','messages_only','mentions_only')",
        },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // optional auto-expiry
        expires_at: { type: 'timestamptz' },
    }, {
        constraints: {
            unique: ['blocker_user_id', 'blocked_user_id'],
            // can't block yourself
            check: 'blocker_user_id != blocked_user_id',
        },
    });

    /* TABLE: rate_limit_violations
     * WHY: Spam/abuse prevention. High violation counts indicate bots or
     *      coordinated inauthentic behavior.
     */
    pgm.createTable('rate_limit_violations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user who tripped the limit (nullable for IP-only violations)
        user_id: { type: 'uuid', references: 'users(id)' },
        // which limit was tripped
        rate_limit_type: {
            type: 'text',
            notNull: true,
            check: `rate_limit_type IN (
                'comments_per_minute','signups_per_ip','pledges_per_hour',
                'reports_per_day','api_calls_per_minute','votes_per_hour'
            )`,
        },
        // configured limit value
        limit_value: { type: 'integer', notNull: true },
        // actual count observed
        actual_value: { type: 'integer', notNull: true },
        // IP at the time
        ip_address: { type: 'inet' },
        // response to violation
        action_taken: {
            type: 'text',
            notNull: true,
            check: "action_taken IN ('throttled','captcha_required','account_locked','escalated')",
        },
        // window start
        window_start: { type: 'timestamptz', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: coordinated_behavior_signals
     * WHY: Cash-prize debates WILL face coordinated voting attempts. This
     *      table records the detection signals and response.
     */
    pgm.createTable('coordinated_behavior_signals', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // what pattern was detected
        signal_type: {
            type: 'text',
            notNull: true,
            check: `signal_type IN (
                'ip_cluster','signup_burst','voting_pattern','content_similarity',
                'device_fingerprint_match','timing_correlation'
            )`,
        },
        // detector confidence 0–1
        confidence_score: { type: 'decimal(5,4)', notNull: true },
        // suspected account ids
        related_user_ids: { type: 'jsonb', notNull: true },
        // suspected content ids
        related_content_item_ids: { type: 'jsonb' },
        // related debate context
        related_debate_id: { type: 'uuid', references: 'debates(id)' },
        // raw detector output
        detection_details: { type: 'jsonb' },
        // lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'pending_review',
            check: "status IN ('pending_review','confirmed_inauthentic','false_positive','action_taken')",
        },
        // narrative of action taken
        action_taken: { type: 'text' },
        // who reviewed
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 17 — ELECTION LAW & PLEDGE COMPLIANCE
    // ============================================================

    /* TABLE: candidate_committees
     * WHY: Load-bearing legal gate. NO public pledge campaign launches
     *      without a verified_active row here.
     */
    pgm.createTable('candidate_committees', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // candidate user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // jurisdiction the committee filed with
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // legal committee name
        committee_name: { type: 'text', notNull: true },
        // committee type
        committee_type: {
            type: 'text',
            notNull: true,
            check: "committee_type IN ('principal','authorized','joint_fundraising','leadership_pac')",
        },
        // FEC C##### or state id
        external_committee_id: { type: 'text' },
        // FEC candidate id (P/H/S#####)
        external_candidate_id: { type: 'text' },
        // office sought as text label
        office_sought: { type: 'text', notNull: true },
        // district label
        office_district: { type: 'text' },
        // election cycle (2026, 2028)
        cycle_year: { type: 'integer', notNull: true },
        // verification status
        registration_status: {
            type: 'text',
            notNull: true,
            check: `registration_status IN (
                'verified_active','verified_terminated','pending_verification','failed_verification'
            )`,
        },
        // whether we verified via API vs manual
        verified_via_api: { type: 'boolean', notNull: true, default: false },
        // raw FEC/state response for audit
        verification_response: { type: 'jsonb' },
        // when we last verified
        last_verified_at: { type: 'timestamptz' },
        // committee registration date with the regulator
        registration_date: { type: 'date' },
        // when committee was terminated (if applicable)
        termination_date: { type: 'date' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: jurisdiction_rules_versions
     * WHY: Election finance rules change. Our compliance engine MUST version
     *      the rules so 2026 checks can be reconstructed in 2029.
     */
    pgm.createTable('jurisdiction_rules_versions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which jurisdiction
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // version label
        version: { type: 'text', notNull: true },
        // when this version becomes active
        effective_from: { type: 'date', notNull: true },
        // when superseded (null = current)
        effective_until: { type: 'date' },
        // what triggers candidacy under these rules
        candidacy_trigger_type: {
            type: 'text',
            check: "candidacy_trigger_type IN ('dollar_threshold','intent_based','filing_based')",
        },
        // the dollar amount or count value
        candidacy_trigger_value: { type: 'decimal' },
        // individual contribution cap for primary
        contribution_limit_individual_primary: { type: 'decimal' },
        // individual contribution cap for general
        contribution_limit_individual_general: { type: 'decimal' },
        // aggregate cap
        contribution_limit_aggregate: { type: 'decimal' },
        // does a committee have to exist before soliciting
        committee_required_before_solicitation: { type: 'boolean' },
        // off-session fundraising prohibited?
        off_session_fundraising_ban: { type: 'boolean' },
        // whether this jurisdiction has public matching
        matching_funds_program: { type: 'boolean' },
        // reference to matching funds rules
        matching_funds_rules_ref: { type: 'text' },
        // threshold above which a contest must register here
        contest_registration_threshold: { type: 'decimal' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // who encoded these rules
        created_by_user_id: { type: 'uuid', references: 'users(id)' },
        // urls of the source statutes / advisories
        source_documents: { type: 'jsonb' },
    });

    /* TABLE: compliance_checks
     * WHY: Append-only. Every compliance check we run. Reconstructs "what
     *      did your system know when it let user X do Y?"
     */
    pgm.createTable('compliance_checks', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user being checked
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // optional wouldbe being checked
        wouldbe_id: { type: 'uuid', references: 'wouldbe(id)' },
        // check kind
        check_type: {
            type: 'text',
            notNull: true,
            check: `check_type IN (
                'committee_verification','jurisdiction_eligibility',
                'fundraising_window','contribution_limit','age_eligibility'
            )`,
        },
        // jurisdiction being checked against
        jurisdiction_id: { type: 'uuid', references: 'jurisdiction(id)' },
        // version pinpoint — which rules were applied
        jurisdiction_rules_version: { type: 'text' },
        // outcome
        result: {
            type: 'text',
            notNull: true,
            check: "result IN ('passed','failed','warning','exception_granted')",
        },
        // narrative reason
        reason: { type: 'text' },
        // free-form details
        details: { type: 'jsonb' },
        // FEC/state response for audit
        external_verification_payload: { type: 'jsonb' },
        // when check ran
        performed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // who/what performed it
        performed_by: {
            type: 'text',
            notNull: true,
            check: "performed_by IN ('system','admin_review','user_self_attestation')",
        },
        // if performed by an admin, which one
        performed_by_user_id: { type: 'uuid', references: 'users(id)' },
    });

    /* TABLE: testing_the_waters_campaigns
     * WHY: FEC "testing the waters" rules let a potential candidate explore
     *      a run without registering a committee — under strict caps.
     */
    pgm.createTable('testing_the_waters_campaigns', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // exploring user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // office being explored
        office_being_explored: { type: 'text', notNull: true },
        // jurisdiction
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // lifecycle
        status: {
            type: 'text',
            notNull: true,
            check: "status IN ('active','expired','converted_to_committee','archived','terminated')",
        },
        // when exploration started
        start_date: { type: 'date', notNull: true },
        // exploration cap date (60-90 days under FEC)
        expiration_date: { type: 'date', notNull: true },
        // FEC soft cap on pledges in cents ($3K default)
        soft_pledge_cap_cents: { type: 'bigint', notNull: true, default: 300000 },
        // FEC hard cap on pledges in cents ($4.5K default)
        hard_pledge_cap_cents: { type: 'bigint', notNull: true, default: 450000 },
        // running pledge total in cents
        cumulative_pledges_cents: { type: 'bigint', notNull: true, default: 0 },
        // running unique pledger count
        unique_pledgers_count: { type: 'integer', notNull: true, default: 0 },
        // FEC requires non-public during testing-the-waters
        is_publicly_discoverable: { type: 'boolean', notNull: true, default: false },
        // whether pledgers saw the FEC disclosure
        disclosure_shown_to_pledgers: { type: 'boolean', notNull: true, default: false },
        // which version of the disclosure
        disclosure_version_id: { type: 'uuid', references: 'legal_documents(id)' },
        // if converted, the resulting committee
        converted_to_committee_id: { type: 'uuid', references: 'candidate_committees(id)' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when it expired
        expired_at: { type: 'timestamptz' },
    });

    /* TABLE: fundraising_eligibility_checks
     * WHY: Every time a user clicks "start fundraising" we run this and
     *      store the result, even if they proceed despite warnings.
     */
    pgm.createTable('fundraising_eligibility_checks', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user being checked
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // jurisdiction
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // office sought (text label)
        office_sought: { type: 'text', notNull: true },
        // election cycle
        election_cycle: { type: 'integer', notNull: true },
        // date of the check
        check_date: { type: 'date', notNull: true },
        // final go/no-go
        legal_status: {
            type: 'text',
            notNull: true,
            check: "legal_status IN ('can_fundraise','cannot_fundraise','can_with_committee_first','blocked_off_session')",
        },
        // does a committee need to exist first
        committee_required: { type: 'boolean', notNull: true },
        // filings the candidate still needs to make
        required_filings: { type: 'jsonb' },
        // statutory min lead days
        legal_minimum_lead_days: { type: 'integer' },
        // platform's recommended lead days
        recommended_lead_days: { type: 'integer' },
        // contribution cap that applies
        max_individual_contribution_cents: { type: 'bigint' },
        // soft warnings shown to the user
        warnings: { type: 'jsonb' },
        // overall check pass/fail
        check_passed: { type: 'boolean', notNull: true },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 18 — CONTEST / SWEEPSTAKES STATE COMPLIANCE
    // ============================================================

    /* TABLE: contest_state_registrations
     * WHY: For prizes over $5K in NY/FL/RI/AZ etc., contest must be
     *      registered with state agencies before launch.
     */
    pgm.createTable('contest_state_registrations', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // state code
        state_code: { type: 'char(2)', notNull: true },
        // whether registration is required here
        registration_required: { type: 'boolean', notNull: true },
        // registration status
        registration_status: {
            type: 'text',
            notNull: true,
            check: "registration_status IN ('not_required','pending','registered','bonded','exempt_under_threshold')",
        },
        // state-issued registration id
        registration_id_external: { type: 'text' },
        // bond amount in cents (NY etc.)
        bond_amount_cents: { type: 'bigint' },
        // bond surety company
        bond_provider: { type: 'text' },
        // when filed with the state
        filed_at: { type: 'timestamptz' },
        // when registration expires
        expires_at: { type: 'timestamptz' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['debate_id', 'state_code'] },
    });

    /* TABLE: contest_winners
     * WHY: Required audit record for tax reporting (1099-MISC > $600),
     *      winner verification, and dispute defense.
     */
    pgm.createTable('contest_winners', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)' },
        // winning contestant
        contestant_id: { type: 'uuid', notNull: true, references: 'contestants(id)' },
        // winning user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // place finish
        placement: { type: 'integer', notNull: true },
        // prize amount in cents
        prize_amount_cents: { type: 'bigint', notNull: true, check: 'prize_amount_cents > 0' },
        // how the winner was selected
        selection_method: { type: 'text', notNull: true, check: "selection_method IN ('public_vote','sponsor_decision','judge_panel')" },
        // raw vote count (if applicable)
        vote_count: { type: 'integer' },
        // when winner was selected
        selected_at: { type: 'timestamptz', notNull: true },
        // sponsor admin who selected (for sponsor_decision)
        selected_by_user_id: { type: 'uuid', references: 'users(id)' },
        // rationale (required for sponsor_decision)
        selection_rationale: { type: 'text' },
        // does this prize trigger 1099 reporting
        irs_1099_required: { type: 'boolean', notNull: true, default: false },
        // when W-9 was received
        w9_received_at: { type: 'timestamptz' },
        // when prize was paid
        prize_paid_at: { type: 'timestamptz' },
        // payment method
        prize_payment_method: { type: 'text', check: "prize_payment_method IN ('stripe','ach','check','in_kind')" },
        // payment reference (transfer/check #)
        prize_payment_reference: { type: 'text' },
    });

    // ============================================================
    // SECTION 19 — DATA PRIVACY & RIGHTS
    // ============================================================

    /* TABLE: data_subject_requests
     * WHY: GDPR Article 17 and CCPA 1798.105 have 30-day deadlines with
     *      monetary penalties for non-compliance.
     */
    pgm.createTable('data_subject_requests', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // requesting user
        user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // what they're asking for
        request_type: {
            type: 'text',
            notNull: true,
            check: `request_type IN (
                'deletion','access','portability','rectification',
                'restriction_of_processing','objection','opt_out_sale'
            )`,
        },
        // legal basis cited
        legal_basis: {
            type: 'text',
            notNull: true,
            check: `legal_basis IN (
                'gdpr_article_17','ccpa_1798_105','ccpa_1798_110',
                'ccpa_1798_120','coppa_parental'
            )`,
        },
        // lifecycle
        status: {
            type: 'text',
            notNull: true,
            check: `status IN (
                'received','verifying_identity','in_progress','completed',
                'partially_completed','denied','withdrawn'
            )`,
        },
        // how we verified identity
        verification_method: { type: 'text' },
        // when request was received
        received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // statutory deadline (30 days typically)
        statutory_deadline: { type: 'timestamptz', notN3ull: true },
        // when we finished
        completed_at: { type: 'timestamptz' },
        // why denied (if applicable)
        denial_reason: { type: 'text' },
        // url for an exported data archive (for access/portability)
        export_url: { type: 'text' },
        // which systems have been processed (Postgres, R2, PostHog, Stripe...)
        systems_processed: { type: 'jsonb' },
        // assigned operator
        assigned_to_user_id: { type: 'uuid', references: 'users(id)' },
    });

    /* TABLE: data_retention_policies
     * WHY: Encodes retention rules as DATA (not code) for consistent
     *      deletion logic — financial 7y, content soft-delete, IP logs hard-
     *      delete, etc.
     */
    pgm.createTable('data_retention_policies', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which data category this policy governs
        data_category: {
            type: 'text',
            notNull: true,
            check: `data_category IN (
                'user_account','content_item','pledge','tip','comment',
                'ip_log','moderation_event','financial_record','attestation','message'
            )`,
        },
        // how retention is measured
        retention_basis: {
            type: 'text',
            notNull: true,
            check: "retention_basis IN ('user_active','fixed_period','indefinite_audit','legal_hold')",
        },
        // how long to keep
        retention_period_days: { type: 'integer' },
        // statutory basis for the policy
        legal_basis: {
            type: 'text',
            notNull: true,
            check: `legal_basis IN (
                'tax_irs_7_years','dmca_safe_harbor','fec_3_years',
                'ccpa_minimum','gdpr_legitimate_interest'
            )`,
        },
        // how to delete (hard, anonymize, archive)
        deletion_method: {
            type: 'text',
            notNull: true,
            check: "deletion_method IN ('hard_delete','anonymize','archive_only')",
        },
        // when this policy becomes active
        active_from: { type: 'date', notNull: true },
        // when it ceases (null = current)
        active_until: { type: 'date' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: pii_access_log
     * WHY: GDPR/CCPA require knowing who accessed PII. Also the defense
     *      against insider abuse. Critical for SOC 2.
     */
    pgm.createTable('pii_access_log', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // whose PII was accessed
        accessed_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // who accessed
        accessor_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // accessor role (snapshot at access time)
        accessor_role: {
            type: 'text',
            notNull: true,
            check: "accessor_role IN ('support','moderator','engineer','executive','automated_system')",
        },
        // which PII fields were accessed
        fields_accessed: { type: 'jsonb', notNull: true },
        // coded reason
        access_reason: {
            type: 'text',
            notNull: true,
            check: `access_reason IN (
                'support_ticket','moderation_action','compliance_request',
                'debugging','dsr_processing'
            )`,
        },
        // surface used
        access_method: {
            type: 'text',
            check: "access_method IN ('admin_dashboard','database_query','api_call','automated_job')",
        },
        // when access happened
        accessed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // session id of the accessor
        session_id: { type: 'text' },
        // accessor ip
        ip_address: { type: 'inet' },
    });

    /* TABLE: child_safety_records
     * WHY: Platform allows users 13–35. Under 13 = COPPA requiring verified
     *      parental consent. This is the verifiable age-handling record.
     */
    pgm.createTable('child_safety_records', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // user — UNIQUE so each user has at most one record
        user_id: { type: 'uuid', notNull: true, unique: true, references: 'users(id)' },
        // how age was verified
        age_verification_method: {
            type: 'text',
            check: `age_verification_method IN (
                'self_attestation','government_id','parent_consent_form','third_party_age_verification'
            )`,
        },
        // verified age value (if available)
        age_verified_value: { type: 'integer' },
        // age band — first two gate safety/legal features; the rest are 5-year marketing segments
        age_band: { type: 'text', notNull: true, check: "age_band IN ('under_13','13_17','18_24','25_29','30_34','35_39','40_44','45_49','50_54','55_59','60_64','65_69','70_74','75_79','80_84','85_89','90_plus')" },
        // whether parental consent is required (under 13, COPPA data-collection consent)
        coppa_parental_consent_required: { type: 'boolean', notNull: true, default: false },
        // whether guardian consent is required for 13-17 contest participation
        // (distinct from COPPA: this gates debate entry/competition, not data collection)
        minor_participation_consent_required: { type: 'boolean', notNull: true, default: false },
        // how parental consent was collected
        parental_consent_method: {
            type: 'text',
            check: `parental_consent_method IN (
                'credit_card_verification','signed_form','video_consent','knowledge_based'
            )`,
        },
        // parent's contact email
        parental_email: { type: 'text' },
        // when parental consent was given
        parental_consent_at: { type: 'timestamptz' },
        // features restricted for this minor
        features_restricted: { type: 'jsonb' },
        // when the record was verified
        verified_at: { type: 'timestamptz' },
        // verifier
        verified_by: { type: 'text', check: "verified_by IN ('system','manual_review')" },
    });

    // FK from a minor's debate entry to their child_safety_records row.
    // Added here (not inline) because debate_entries is created before this table.
    pgm.addConstraint('debate_entries', 'fk_debate_entries_guardian_consent', {
        foreignKeys: {
            columns: 'guardian_consent_id',
            references: 'child_safety_records(id)',
        },
    });

    // ============================================================
    // SECTION 20 — FINANCIAL AUDIT & TAX
    // ============================================================

    /* TABLE: financial_audit_log
     * WHY: Tax, fraud, dispute defense all require complete financial event
     *      logs. Stripe holds its records but we need ours for reconciliation.
     */
    pgm.createTable('financial_audit_log', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // event kind
        event_category: {
            type: 'text',
            notNull: true,
            check: `event_category IN (
                'platform_fee_received','tip_charged','tip_refunded',
                'membership_charged','prize_paid','dispute_filed','post_payment',
                'debate_entry_charged','prize_pool_contribution','stripe_fee'
            )`,
        },
        // user involved (if applicable)
        user_id: { type: 'uuid', references: 'users(id)' },
        // SIGNED amount in cents (negative for refunds/payouts)
        amount_cents: { type: 'bigint', notNull: true },
        // ISO currency code
        currency: { type: 'text', notNull: true, default: 'usd' },
        // pointer to tip row
        related_tip_id: { type: 'uuid', references: 'tips(id)' },
        // pointer to subscription payment row
        related_subscription_payment_id: { type: 'uuid', references: 'subscription_payments(id)' },
        // pointer to prize distribution row
        related_prize_distribution_id: { type: 'uuid', references: 'prize_distributions(distribution_id)' },
        // pointer to post payment row
        related_post_payment_id: { type: 'uuid', references: 'post_payments(id)' },
        // pointer to debate payment row
        related_debate_payment_id: { type: 'uuid', references: 'debate_payments(payment_id)' },
        // Stripe charge id
        stripe_charge_id: { type: 'text' },
        // Stripe balance transaction id
        stripe_balance_transaction_id: { type: 'text' },
        // free-text description
        description: { type: 'text' },
        // when event occurred
        occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: tax_records
     * WHY: Prizes over $600 require 1099-MISC. Tax records have 7-yr
     *      retention — EXEMPT from CCPA/GDPR deletion.
     */
    pgm.createTable('tax_records', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // tax year
        tax_year: { type: 'integer', notNull: true },
        // recipient (who's getting the 1099)
        recipient_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // which form
        form_type: { type: 'text', notNull: true, check: "form_type IN ('1099-MISC','1099-NEC','1099-K','W-2')" },
        // gross paid in cents
        gross_amount_cents: { type: 'bigint', notNull: true, check: 'gross_amount_cents >= 0' },
        // whether we have a W-9 on file
        w9_received: { type: 'boolean', notNull: true, default: false },
        // R2 url to the W-9 doc
        w9_storage_url: { type: 'text' },
        // when form was generated
        form_generated_at: { type: 'timestamptz' },
        // when form was sent to recipient
        form_sent_at: { type: 'timestamptz' },
        // when form was filed with IRS
        form_filed_at: { type: 'timestamptz' },
        // IRS acknowledgment receipt id
        irs_acknowledgment: { type: 'text' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // ============================================================
    // SECTION 21 — ADMIN & OPERATIONAL
    // ============================================================

    /* TABLE: admin_users
     * WHY: Admins have elevated permissions and stricter audit. pii_access_
     *      granted enforces least-privilege.
     */
    pgm.createTable('admin_users', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // underlying user account — UNIQUE so one admin row per user
        user_id: { type: 'uuid', notNull: true, unique: true, references: 'users(id)' },
        // role label
        role: {
            type: 'text',
            notNull: true,
            check: "role IN ('super_admin','moderator','support','finance','engineer','read_only')",
        },
        // fine-grained permissions JSON
        permissions: { type: 'jsonb' },
        // status
        status: {
            type: 'text',
            notNull: true,
            default: 'active',
            check: "status IN ('active','suspended','terminated')",
        },
        // MFA required in production
        mfa_enabled: { type: 'boolean', notNull: true, default: false },
        // whether this admin can view PII (explicit grant)
        pii_access_granted: { type: 'boolean', notNull: true, default: false },
        // when PII access was granted
        pii_access_granted_at: { type: 'timestamptz' },
        // who granted it
        pii_access_granted_by: { type: 'uuid', references: 'users(id)' },
        // last admin action
        last_active_at: { type: 'timestamptz' },
        // audit timestamp — row creation
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when admin role was terminated
        terminated_at: { type: 'timestamptz' },
    });

    /* TABLE: admin_actions
     * WHY: Comprehensive admin audit trail. Required for SOC 2, defensible
     *      against insider abuse, useful for rollback.
     */
    pgm.createTable('admin_actions', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // acting admin
        admin_user_id: { type: 'uuid', notNull: true, references: 'admin_users(id)' },
        // action kind (free-text taxonomy)
        action_type: { type: 'text', notNull: true },
        // polymorphic target type
        target_resource_type: { type: 'text', notNull: true },
        // polymorphic target id
        target_resource_id: { type: 'uuid' },
        // pre-action snapshot
        before_state: { type: 'jsonb' },
        // post-action snapshot
        after_state: { type: 'jsonb' },
        // narrative reason (required)
        reason: { type: 'text', notNull: true },
        // ip at the time
        ip_address: { type: 'inet' },
        // user agent at the time
        user_agent: { type: 'text' },
        // whether MFA was verified for this action
        mfa_verified: { type: 'boolean', notNull: true, default: false },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* TABLE: system_jobs
     * WHY: Multi-step async work (DSR deletion across systems) needs
     *      visibility, retries, audit. BullMQ-style tracking.
     */
    pgm.createTable('system_jobs', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // job kind
        job_type: {
            type: 'text',
            notNull: true,
            check: `job_type IN (
                'moderation_scan','csam_check','dsr_deletion','retention_purge',
                'fec_committee_verify','winner_payout','tax_form_generate','email_send'
            )`,
        },
        // polymorphic target type
        target_resource_type: { type: 'text' },
        // polymorphic target id
        target_resource_id: { type: 'uuid' },
        // lifecycle
        status: {
            type: 'text',
            notNull: true,
            default: 'queued',
            check: "status IN ('queued','running','succeeded','failed','retrying')",
        },
        // retry counter
        attempt_count: { type: 'integer', notNull: true, default: 0 },
        // when the job should run
        scheduled_for: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        // when started
        started_at: { type: 'timestamptz' },
        // when finished
        completed_at: { type: 'timestamptz' },
        // last error
        error_message: { type: 'text' },
        // job output for inspection
        result_payload: { type: 'jsonb' },
        // audit timestamp
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('system_jobs', 'scheduled_for', {
        name: 'idx_system_jobs_due',
        where: "status IN ('queued','retrying')",
    });
};

exports.down = (pgm) => {};
