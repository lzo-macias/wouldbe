/*
================================================================================
 CoolPeople v3 / Would Be — WouldBe Update (most-specific product scope)
================================================================================
 Layers the schema the "Wouldbe Update" spec requires on top of:
   - 1779234282879_my-first-migration.js          (baseline)
   - 1779842157026_notifications-and-geo-mapping   (geo + notifications)
   - 1779852775288_retention-active-unique-index   (retention invariant)
   - 1780000000000_full-scope-prep                 (v2 clarifications)

 Every block is tagged with the section of the update spec it implements:
   [WB §1]  Starting a WouldBe — self-start or nomination
   [WB §2]  Approval — neutral, pre-established criteria (committee = launch gate)
   [WB §3]  Committee filing — registration portal, receipt fallback, treasurer
   [WB §4]  Goals — floor/ceiling, per-office recommended goal, increase requests
   [WB §5]  Pledges & contribution cap ($3,300/user/campaign + post-primary reset)
   [WB §6]  Deadlines — auto-scoped timeline from election-date anchors + offsets
   [WB §7]  Staged gating — stage = {milestone,deadline,sub_goal,proof,verify}
   [WB §8]  "Report a change" — admin review queue + filing-link health
   [WB §9]  Eligibility rules — displayed (informational), self-filed
   [WB §11] Scope notes — manual→automated maturity captured as data

 Conventions kept from the baseline: money is cents (BIGINT); legally sensitive
 rows are append-only; CHECK swaps use raw SQL with IF EXISTS so they survive
 node-pg-migrate's auto-generated constraint names. The $5K floor / $1M ceiling
 are 500000 / 100000000 cents respectively.

 NOTE: a user's street address is still NEVER persisted (see SECTION A of the
 full-scope-prep migration). Nothing here changes that.
================================================================================
*/

// $5,000 floor and $1,000,000 ceiling, in cents — the campaign-lifetime bounds.
const GOAL_FLOOR_CENTS = 500000;
const GOAL_CEILING_CENTS = 100000000;
// Default per-user-per-campaign pledge cap ($3,300) in cents. [WB §5]
const PLEDGE_CAP_CENTS = 330000;

exports.up = (pgm) => {
    // ============================================================
    // SECTION A — WouldBe entry path + launch/approval lifecycle
    //   [WB §1] Two entry paths: self-start vs nomination.
    //   [WB §2] The sole gate to go live and collect pledges is a successfully
    //           filed fundraising committee. Approval is criteria-based, not
    //           discretionary; process maturity is manual review → automated.
    // ============================================================
    pgm.addColumns('wouldbe', {
        // [WB §1] how this campaign came to exist. A nomination-originated
        // WouldBe is linked back via wouldbe_recommendations.resulting_wouldbe_id.
        entry_path: {
            type: 'text',
            notNull: true,
            default: 'self_start',
            check: "entry_path IN ('self_start','nomination')",
        },
        // [WB §2] launch lifecycle. 'draft' until a committee is filed; only an
        // 'active' campaign collects pledges. Distinct from the existing
        // `retired` boolean (soft-archive) which we leave untouched.
        launch_status: {
            type: 'text',
            notNull: true,
            default: 'draft',
            check: `launch_status IN (
                'draft','pending_committee','pending_review','active','suspended','failed'
            )`,
        },
        // [WB §2] whether this campaign's gate decisions were made by a human or
        // the automated criteria engine. Manual at launch → automated as we
        // accumulate regulatory data.
        approval_method: {
            type: 'text',
            notNull: true,
            default: 'manual',
            check: "approval_method IN ('manual','automated')",
        },
        // [WB §7] poller join key: candidate→contest identity (FEC candidate ID,
        // or aggregator/AP race+candidate IDs) captured at onboarding so the
        // authority-polling job can find this campaign's finance/ballot status.
        contest_external_ids: { type: 'jsonb' },
    });

    // ============================================================
    // SECTION B — filing_authorities  [WB §3, §8]
    //   The per-jurisdiction/office committee-registration portal the platform
    //   links candidates to, plus the how-to-file guide, treasurer guidance, and
    //   the link-health status that the §8 "report a change" / link-check job
    //   maintains. The owner flagged this as a gap with no dedicated table.
    // ============================================================
    pgm.createTable('filing_authorities', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which jurisdiction's authority this is
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // optional narrowing to a specific office (null = applies jurisdiction-wide)
        applies_to_office_id: { type: 'uuid', references: 'office(id)' },
        // human name of the filing authority ("FEC", "NYC CFB", "NY State BOE")
        authority_name: { type: 'text', notNull: true },
        // federal/state/local tier
        authority_level: {
            type: 'text',
            notNull: true,
            check: "authority_level IN ('federal','state','county','municipal')",
        },
        // [WB §3] the link to the correct committee-registration portal
        registration_portal_url: { type: 'text', notNull: true },
        // [WB §3] how-to-file guide (inline content and/or external link)
        how_to_file_url: { type: 'text' },
        how_to_file_guide: { type: 'text' },
        // [WB §3] explanation of the committee-treasurer role (single largest barrier)
        treasurer_guide: { type: 'text' },
        // [WB §3] per-jurisdiction flag: may the candidate serve as their own
        // treasurer here? null = not yet encoded (show "confirm with your authority").
        candidate_may_self_treasure: { type: 'boolean' },
        // hint shown to the candidate about the committee-ID format they'll receive
        committee_id_format: { type: 'text' },
        // [WB §8] automated link-health check result (links go dead / change)
        link_status: {
            type: 'text',
            notNull: true,
            default: 'unknown',
            check: "link_status IN ('healthy','broken','redirected','unknown')",
        },
        link_last_checked_at: { type: 'timestamptz' },
        // soft-toggle so we can retire a stale authority without breaking FKs
        is_active: { type: 'boolean', notNull: true, default: true },
        // provenance of this record (audit / report-a-change reconciliation)
        source_url: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('filing_authorities', 'jurisdiction_id', { name: 'idx_filing_authorities_jurisdiction' });
    pgm.createIndex('filing_authorities', 'link_status', {
        name: 'idx_filing_authorities_unhealthy',
        where: "link_status IN ('broken','redirected')",
    });

    // ============================================================
    // SECTION C — candidate_committees: receipt fallback + treasurer  [WB §3]
    //   Verification of filing requires the committee ID (the join key). When the
    //   ID lags the filing (slow authorities), accept a filing receipt
    //   provisionally and upgrade to confirmed once the ID/authority record
    //   appears. Also capture the treasurer (single largest barrier to filing).
    // ============================================================
    pgm.addColumns('candidate_committees', {
        // link to the authority/portal this committee filed with
        filing_authority_id: { type: 'uuid', references: 'filing_authorities(id)' },
        // [WB §3] who is the committee treasurer
        treasurer_name: { type: 'text' },
        // [WB §3] treasurer guidance buckets (~70% spouse/family/friend, ~20%
        // bookkeeping volunteer, ~10% paid compliance pro), plus self.
        treasurer_relationship: {
            type: 'text',
            check: "treasurer_relationship IN ('self','spouse_family_friend','volunteer','paid_professional')",
        },
        // [WB §3] candidate serving as their own treasurer (allowed for federal +
        // most states; per-jurisdiction flag lives on filing_authorities)
        is_self_treasurer: { type: 'boolean' },
        // [WB §3] provisional-on-receipt fallback while the committee ID is located
        filing_receipt_url: { type: 'text' },
        filing_receipt_number: { type: 'text' },
        filed_at: { type: 'timestamptz' },
        // [WB §3] is the external_committee_id provisional (from a receipt) or
        // confirmed (authority record appeared)? null until a filing exists.
        committee_id_status: {
            type: 'text',
            check: "committee_id_status IN ('provisional','confirmed')",
        },
    });
    // [WB §3] add the provisional-on-receipt verification state.
    pgm.sql(`
        ALTER TABLE candidate_committees DROP CONSTRAINT IF EXISTS candidate_committees_registration_status_check;
        ALTER TABLE candidate_committees ADD CONSTRAINT candidate_committees_registration_status_check CHECK (
            registration_status IN (
                'verified_active','verified_terminated','pending_verification','failed_verification',
                -- [WB §3] receipt accepted provisionally; upgraded once the ID confirms:
                'provisional_on_receipt'
            )
        );
    `);

    // ============================================================
    // SECTION D — Goals: floor/ceiling, recommended goal, increase requests [WB §4]
    // ============================================================

    /* [WB §4] enforce the campaign-lifetime floor ($5K) and ceiling ($1M). The
     * baseline only required goal_cents > 0. Safe to tighten: WouldBe/pledge DB
     * layers are unbuilt and seeding begins after this migration. */
    pgm.sql(`
        ALTER TABLE wouldbe DROP CONSTRAINT IF EXISTS wouldbe_goal_cents_check;
        ALTER TABLE wouldbe ADD CONSTRAINT wouldbe_goal_cents_check CHECK (
            goal_cents BETWEEN ${GOAL_FLOOR_CENTS} AND ${GOAL_CEILING_CENTS}
        );
    `);

    /* [WB §4] per-office recommended goal. If no row exists for an office, the UI
     * shows "No recommended goal amount for this office" (absence = null). The
     * $5K/$1M bounds still apply. NOTE: the update's table list called this
     * "wouldbe_recommendations (recommended-goal table)", but that name is
     * already the nominate-someone table — so this lives as its own table. */
    pgm.createTable('office_recommended_goals', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // one recommended goal per office (null amount = explicitly "none for this office")
        office_id: { type: 'uuid', notNull: true, unique: true, references: 'office(id)' },
        recommended_goal_cents: {
            type: 'bigint',
            check: `recommended_goal_cents IS NULL OR recommended_goal_cents BETWEEN ${GOAL_FLOOR_CENTS} AND ${GOAL_CEILING_CENTS}`,
        },
        // why this number (e.g., "median winning spend for State House")
        rationale: { type: 'text' },
        source_url: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    /* [WB §4] once a goal is reached the candidate may request a raise (up to the
     * $1M ceiling) with a submitted reason. Manual review at launch → automated. */
    pgm.createTable('goal_increase_requests', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        requested_by_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
        // snapshot of the goal at request time
        current_goal_cents: { type: 'bigint', notNull: true },
        // requested new goal — still bounded by the lifetime ceiling
        requested_goal_cents: {
            type: 'bigint',
            notNull: true,
            check: `requested_goal_cents BETWEEN ${GOAL_FLOOR_CENTS} AND ${GOAL_CEILING_CENTS}`,
        },
        // [WB §4] the submitted reason is required
        reason: { type: 'text', notNull: true },
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','approved','rejected')",
        },
        // [WB §2/§11] manual now, automated later
        review_method: {
            type: 'text',
            notNull: true,
            default: 'manual',
            check: "review_method IN ('manual','automated')",
        },
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
        reviewed_at: { type: 'timestamptz' },
        review_notes: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('goal_increase_requests', 'wouldbe_id', { name: 'idx_goal_increase_wouldbe' });
    pgm.createIndex('goal_increase_requests', 'status', {
        name: 'idx_goal_increase_pending',
        where: "status = 'pending'",
    });

    // ============================================================
    // SECTION E — Pledge contribution cap + post-primary reset  [WB §5]
    //   Default cap $3,300 per user per campaign (strict 1:1). The cap resets to
    //   another $3,300 once it's CONFIRMED the candidate advanced past the primary
    //   and is continuing to run. Full pledge history is retained — the reset adds
    //   headroom (a new "cap window"); prior pledges are preserved, not erased.
    // ============================================================
    pgm.addColumns('wouldbe', {
        // per-user base cap for THIS campaign (default $3,300; a default, not a
        // compliance guarantee — see spec)
        pledge_cap_cents: { type: 'bigint', notNull: true, default: PLEDGE_CAP_CENTS, check: 'pledge_cap_cents > 0' },
        // how many times the cap has reset (each confirmed primary-advance += 1).
        // Effective per-user cap = pledge_cap_cents * (cap_reset_count + 1).
        cap_reset_count: { type: 'integer', notNull: true, default: 0 },
        // when the candidate was confirmed to have advanced past the primary
        primary_advanced_at: { type: 'timestamptz' },
    });
    pgm.addColumns('pledges', {
        // which cap window this pledge counts against (0 = pre-primary window).
        // Lets us preserve history while giving each window its own $3,300 of room.
        cap_window: { type: 'integer', notNull: true, default: 0 },
    });

    /* [WB §5] audit trail of each cap reset. Append-only: one row per confirmed
     * advancement event. Ties the reset to the proof that confirmed it. */
    pgm.createTable('wouldbe_cap_resets', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        // 1 for the first reset, 2 for the second, ... (== resulting cap_window)
        reset_number: { type: 'integer', notNull: true },
        // why the cap reset (currently only post-primary advancement)
        reason: {
            type: 'text',
            notNull: true,
            default: 'primary_advanced',
            check: "reason IN ('primary_advanced')",
        },
        // headroom added by this reset (another $3,300 by default)
        additional_cap_cents: { type: 'bigint', notNull: true, default: PLEDGE_CAP_CENTS },
        // how the advancement was confirmed (mirrors the §7 proof tiers)
        confirmed_by: {
            type: 'text',
            notNull: true,
            check: "confirmed_by IN ('system','admin_review','authority_pull')",
        },
        // pointer to the certified-canvass / stage proof that confirmed it
        proof_reference: { type: 'text' },
        confirmed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['wouldbe_id', 'reset_number'] },
    });

    // ============================================================
    // SECTION F — Election-date anchors + per-jurisdiction offset rules  [WB §6]
    //   Deadlines differ in both timing AND existence by office. Most items are
    //   OFFSETS from anchor dates (election dates). Store (a) an election-date
    //   calendar and (b) a per-jurisdiction offset-rule table with effective
    //   dates, and compute the rest. The owner flagged these as missing tables.
    // ============================================================

    /* [WB §6] the calendar anchors (items 3, 12–15 — no candidate proof needed):
     * primary / general / runoff dates and the early-voting window. Keyed per
     * jurisdiction + cycle so a single set of anchors feeds many offices. */
    pgm.createTable('election_date_anchors', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        election_cycle: { type: 'integer', notNull: true },
        anchor_type: {
            type: 'text',
            notNull: true,
            check: `anchor_type IN (
                'primary','general','runoff','early_voting_start','early_voting_end'
            )`,
        },
        anchor_date: { type: 'date', notNull: true },
        source_url: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: { unique: ['jurisdiction_id', 'election_cycle', 'anchor_type'] },
    });

    /* [WB §6] the per-jurisdiction offset-rule table WITH effective dates. The
     * engine computes a concrete deadline = anchor_date + offset_days, or uses a
     * fixed_date when the rule isn't anchor-relative (e.g., a statutory calendar
     * date). 'threshold_crossing' models "within 15 days of crossing $5K". */
    pgm.createTable('deadline_offset_rules', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        jurisdiction_id: { type: 'uuid', notNull: true, references: 'jurisdiction(id)' },
        // optional narrowing to a specific office (offsets can vary by office)
        applies_to_office_id: { type: 'uuid', references: 'office(id)' },
        // which deadline this rule produces (same vocabulary as election_deadlines)
        deadline_type: { type: 'text', notNull: true },
        // what the offset is measured from
        anchor_type: {
            type: 'text',
            check: `anchor_type IN (
                'primary','general','runoff','early_voting_start','early_voting_end','threshold_crossing'
            )`,
        },
        // signed days from the anchor (e.g., -15 = 15 days before). Null if fixed.
        offset_days: { type: 'integer' },
        // a concrete statutory date when the deadline is not anchor-relative
        fixed_date: { type: 'date' },
        is_fixed_date: { type: 'boolean', notNull: true, default: false },
        // [WB §6] effective dating so rule changes are versioned (null = current)
        effective_from: { type: 'date', notNull: true },
        effective_until: { type: 'date' },
        source_url: { type: 'text' },
        notes: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('deadline_offset_rules', ['jurisdiction_id', 'deadline_type'], {
        name: 'idx_offset_rules_jurisdiction_type',
    });

    /* [WB §6] connect the computed/encoded election_deadlines rows back to the
     * anchor + rule that produced them, scope to an office, and let the UI show
     * "TBD" where data isn't encoded yet. is_calendar_anchor marks the
     * no-proof-needed items (3, 12–15). */
    pgm.addColumns('election_deadlines', {
        applies_to_office_id: { type: 'uuid', references: 'office(id)' },
        anchor_type: { type: 'text' },
        offset_rule_id: { type: 'uuid', references: 'deadline_offset_rules(id)' },
        // [WB §6] display "TBD" where not yet encoded; manual approval covers gaps
        is_tbd: { type: 'boolean', notNull: true, default: false },
        // calendar anchor (no candidate proof) vs a candidate-action deadline
        is_calendar_anchor: { type: 'boolean', notNull: true, default: false },
    });

    // ============================================================
    // SECTION G — Staged gating: stages, proofs, transition audit  [WB §7]
    //   The auto-scoped timeline advances stage-by-stage. Because no money moves,
    //   gating controls whether the candidate can keep collecting pledges for the
    //   next deadline — not fund release.
    //     stage = { milestone, deadline, sub_goal, proof_rule, verify_method }
    //   We extend plan_timeline_components into a stage, add the proof records,
    //   and an APPEND-ONLY audit row on every gate transition (who/what/when/src).
    // ============================================================

    /* [WB §7] widen the milestone vocabulary so a stage can hang off any of the
     * §6 deadline kinds, then add the stage fields. */
    pgm.sql(`
        ALTER TABLE plan_timeline_components DROP CONSTRAINT IF EXISTS plan_timeline_components_timeline_category_check;
        ALTER TABLE plan_timeline_components ADD CONSTRAINT plan_timeline_components_timeline_category_check CHECK (
            timeline_category IN (
                'filing_deadline','primary_election','runoff_election',
                'general_election','post_election_report',
                -- [WB §7] additional milestone kinds the staged timeline needs:
                'committee_filing','statement_of_candidacy','petition_deadline',
                'ballot_certification','challenge_deadline','finance_report'
            )
        );
    `);
    pgm.addColumns('plan_timeline_components', {
        // [WB §7] stage ordering on the timeline (1,2,3,...). event_date is the
        // stage's DEADLINE; pledging for stage N is open until then.
        stage_number: { type: 'integer' },
        // [WB §7] the per-deadline fundraising sub-goal for this stage (cents)
        sub_goal_cents: { type: 'bigint', check: 'sub_goal_cents IS NULL OR sub_goal_cents >= 0' },
        // [WB §7] the gate state machine. locked → open (pledging) → cleared
        // (verified proof, advance) OR failed (deadline passed w/o proof → lock N+1)
        gate_state: {
            type: 'text',
            notNull: true,
            default: 'locked',
            check: "gate_state IN ('locked','open','cleared','failed')",
        },
        // [WB §7] proof tier preferred for this stage (authority pull preferred)
        proof_tier: {
            type: 'text',
            check: "proof_tier IN ('authority_pull','document_upload','signed_attestation')",
        },
        // [WB §7] how the proof is obtained/verified (fec_api, state_portal,
        // city_boe, ap_elections, certified_canvass, manual_review, ...)
        verify_method: { type: 'text' },
        // what milestone the proof attests (finance_report, ballot_certification,
        // passed_primary, survived_challenge, ...)
        milestone_type: { type: 'text' },
        // current proof state for this stage; 'tbd' where data isn't encoded yet
        proof_status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "proof_status IN ('pending','verified','rejected','tbd')",
        },
        // the election_deadlines row driving this stage's deadline (if any)
        election_deadline_id: { type: 'uuid', references: 'election_deadlines(id)' },
    });

    /* [WB §7] proof records. Tier 1 authority pull (preferred, no candidate
     * action); Tier 2 document upload + cross-check; Tier 3 signed attestation
     * (backstop only). One stage may accumulate several proof attempts. */
    pgm.createTable('stage_proofs', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        plan_timeline_component_id: { type: 'uuid', notNull: true, references: 'plan_timeline_components(id)' },
        // denormalized for per-campaign queries / fairness audit
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        proof_tier: {
            type: 'text',
            notNull: true,
            check: "proof_tier IN ('authority_pull','document_upload','signed_attestation')",
        },
        verify_method: { type: 'text' },
        milestone_type: { type: 'text', notNull: true },
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','verified','rejected')",
        },
        // where the proof came from
        source: {
            type: 'text',
            check: `source IN (
                'fec_api','state_portal','city_boe','ap_elections','certified_canvass',
                'candidate_upload','attestation'
            )`,
        },
        // Tier 1 — raw authority response
        authority_payload: { type: 'jsonb' },
        // Tier 2 — uploaded document + extracted fields (name/office/date/receipt#)
        uploaded_document_url: { type: 'text' },
        extracted_fields: { type: 'jsonb' },
        cross_check_result: {
            type: 'text',
            check: "cross_check_result IN ('match','mismatch','not_found','not_attempted')",
        },
        // Tier 3 — signed attestation (logged; affects pledge-scope only, not funds)
        attestation_user_id: { type: 'uuid', references: 'users(id)' },
        attestation_statement: { type: 'text' },
        submitted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        verified_at: { type: 'timestamptz' },
        verified_by: {
            type: 'text',
            check: "verified_by IN ('system','admin_review','authority')",
        },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('stage_proofs', 'plan_timeline_component_id', { name: 'idx_stage_proofs_component' });
    pgm.createIndex('stage_proofs', 'wouldbe_id', { name: 'idx_stage_proofs_wouldbe' });

    /* [WB §7] APPEND-ONLY audit trail on every gate transition. This is the
     * evidence that gating ran on the same objective rules for every candidate
     * (who/what/when/source). Never UPDATE these rows. */
    pgm.createTable('stage_gate_transitions', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        plan_timeline_component_id: { type: 'uuid', notNull: true, references: 'plan_timeline_components(id)' },
        wouldbe_id: { type: 'uuid', notNull: true, references: 'wouldbe(id)' },
        from_state: { type: 'text', check: "from_state IN ('locked','open','cleared','failed')" },
        to_state: {
            type: 'text',
            notNull: true,
            check: "to_state IN ('locked','open','cleared','failed')",
        },
        // what caused the transition
        triggered_by: {
            type: 'text',
            notNull: true,
            check: "triggered_by IN ('system','admin_review','authority_pull','candidate','deadline_passed')",
        },
        // free-text source detail (e.g., "FEC API", "NYC BOE certified canvass")
        source: { type: 'text' },
        // the proof that justified the transition, if any
        stage_proof_id: { type: 'uuid', references: 'stage_proofs(id)' },
        notes: { type: 'text' },
        transitioned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('stage_gate_transitions', 'plan_timeline_component_id', { name: 'idx_gate_transitions_component' });
    pgm.createIndex('stage_gate_transitions', ['wouldbe_id', 'transitioned_at'], { name: 'idx_gate_transitions_wouldbe' });

    /* [WB §7] per-jurisdiction advancement / runoff rules (has-runoff, threshold,
     * majority/plurality/top-two/RCV). NYC primaries use ranked-choice (no
     * runoff); top-two/jungle states: "passed" = top-two. These drive whether a
     * "passed primary" gate clears (and the §5 cap reset). */
    pgm.addColumns('jurisdiction_rules_versions', {
        has_runoff: { type: 'boolean' },
        advancement_rule: {
            type: 'text',
            check: "advancement_rule IN ('top_two','majority_or_runoff','plurality','ranked_choice')",
        },
        // threshold for advancement where applicable (e.g., 0.50 for majority)
        advancement_threshold: { type: 'decimal' },
    });

    // ============================================================
    // SECTION H — "Report a change" admin review queue  [WB §8]
    //   Every deadline display and committee-registration link carries a "this
    //   looks wrong" link. Submissions land here for admin review; a verified
    //   change updates the underlying reference row for ALL affected WouldBes.
    //   Pledge amounts are never affected (we don't transact).
    // ============================================================
    pgm.createTable('change_reports', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // who reported it (nullable — could be an unauthenticated viewer)
        reporter_user_id: { type: 'uuid', references: 'users(id)' },
        // what the report is about (the reference data, never a pledge)
        target_type: {
            type: 'text',
            notNull: true,
            check: `target_type IN (
                'election_deadline','filing_authority','deadline_offset_rule',
                'office_eligibility','office_recommended_goal','other'
            )`,
        },
        // id of the offending row (null for 'other')
        target_id: { type: 'uuid' },
        // [WB §8] what's wrong, the proposed correct value, and a source link
        field_name: { type: 'text' },
        current_value: { type: 'text' },
        proposed_value: { type: 'text' },
        source_url: { type: 'text' },
        description: { type: 'text', notNull: true },
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','under_review','verified_applied','rejected','duplicate')",
        },
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
        reviewed_at: { type: 'timestamptz' },
        // when the verified correction was written to the reference row
        applied_at: { type: 'timestamptz' },
        resolution_notes: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('change_reports', 'status', {
        name: 'idx_change_reports_open',
        where: "status IN ('pending','under_review')",
    });
    pgm.createIndex('change_reports', ['target_type', 'target_id'], { name: 'idx_change_reports_target' });

    // ============================================================
    // SECTION I — Office eligibility (displayed, informational)  [WB §9]
    //   We DISPLAY age/residency/citizenship requirements; the candidate files
    //   eligibility documents themselves (not platform-enforced at committee
    //   filing). Federal rows are fixed nationwide; state/local vary — where not
    //   encoded, the UI shows generic guidance + a "confirm with your authority"
    //   disclaimer (eligibility_is_encoded = false). min_age already exists.
    // ============================================================
    pgm.addColumns('office', {
        // e.g., 'us_citizen'; nullable where not encoded
        citizenship_requirement: { type: 'text' },
        // years of citizenship required (US House 7, US Senate 9)
        citizenship_years_required: { type: 'integer' },
        // e.g., 'inhabitant_of_state','district_resident','registered_voter_of_district'
        residency_requirement: { type: 'text' },
        // free-text duration ("6 mo–1 yr", "30 days") — varies by jurisdiction
        residency_duration: { type: 'text' },
        // false → show generic guidance + "confirm with your authority" disclaimer
        eligibility_is_encoded: { type: 'boolean', notNull: true, default: false },
        eligibility_source_url: { type: 'text' },
        eligibility_notes: { type: 'text' },
    });

    // ============================================================
    // SECTION J — system_jobs: pollers for §6/§7/§8 automation  [WB §6,§7,§8,§11]
    //   Seeding of regulatory data begins right after this migration; manual →
    //   automated is the standing maturity path. Add the recurring job kinds the
    //   new tables imply so the cron layer has a vocabulary to schedule against.
    // ============================================================
    pgm.sql(`
        ALTER TABLE system_jobs DROP CONSTRAINT IF EXISTS system_jobs_job_type_check;
        ALTER TABLE system_jobs ADD CONSTRAINT system_jobs_job_type_check CHECK (
            job_type IN (
                'moderation_scan','csam_check','dsr_deletion','retention_purge',
                'fec_committee_verify','winner_payout','tax_form_generate','email_send',
                -- [WB §6] sync election-date anchors / recompute deadlines from offsets
                'election_calendar_sync',
                -- [WB §8] link-health check for filing-authority registration URLs
                'authority_link_health',
                -- [WB §7] evaluate stage gates (authority pull → advance/lock)
                'stage_gate_evaluate'
            )
        );
    `);
};

exports.down = (pgm) => {
    // SECTION J
    pgm.sql(`
        ALTER TABLE system_jobs DROP CONSTRAINT IF EXISTS system_jobs_job_type_check;
        ALTER TABLE system_jobs ADD CONSTRAINT system_jobs_job_type_check CHECK (
            job_type IN (
                'moderation_scan','csam_check','dsr_deletion','retention_purge',
                'fec_committee_verify','winner_payout','tax_form_generate','email_send'
            )
        );
    `);

    // SECTION I
    pgm.dropColumns('office', [
        'citizenship_requirement', 'citizenship_years_required',
        'residency_requirement', 'residency_duration',
        'eligibility_is_encoded', 'eligibility_source_url', 'eligibility_notes',
    ]);

    // SECTION H
    pgm.dropTable('change_reports');

    // SECTION G
    pgm.dropColumns('jurisdiction_rules_versions', ['has_runoff', 'advancement_rule', 'advancement_threshold']);
    pgm.dropTable('stage_gate_transitions');
    pgm.dropTable('stage_proofs');
    pgm.dropColumns('plan_timeline_components', [
        'stage_number', 'sub_goal_cents', 'gate_state', 'proof_tier',
        'verify_method', 'milestone_type', 'proof_status', 'election_deadline_id',
    ]);
    pgm.sql(`
        ALTER TABLE plan_timeline_components DROP CONSTRAINT IF EXISTS plan_timeline_components_timeline_category_check;
        ALTER TABLE plan_timeline_components ADD CONSTRAINT plan_timeline_components_timeline_category_check CHECK (
            timeline_category IN (
                'filing_deadline','primary_election','runoff_election',
                'general_election','post_election_report'
            )
        );
    `);

    // SECTION F
    pgm.dropColumns('election_deadlines', [
        'applies_to_office_id', 'anchor_type', 'offset_rule_id', 'is_tbd', 'is_calendar_anchor',
    ]);
    pgm.dropTable('deadline_offset_rules');
    pgm.dropTable('election_date_anchors');

    // SECTION E
    pgm.dropTable('wouldbe_cap_resets');
    pgm.dropColumns('pledges', ['cap_window']);
    pgm.dropColumns('wouldbe', ['pledge_cap_cents', 'cap_reset_count', 'primary_advanced_at']);

    // SECTION D
    pgm.dropTable('goal_increase_requests');
    pgm.dropTable('office_recommended_goals');
    pgm.sql(`
        ALTER TABLE wouldbe DROP CONSTRAINT IF EXISTS wouldbe_goal_cents_check;
        ALTER TABLE wouldbe ADD CONSTRAINT wouldbe_goal_cents_check CHECK (goal_cents > 0);
    `);

    // SECTION C
    pgm.sql(`
        ALTER TABLE candidate_committees DROP CONSTRAINT IF EXISTS candidate_committees_registration_status_check;
        ALTER TABLE candidate_committees ADD CONSTRAINT candidate_committees_registration_status_check CHECK (
            registration_status IN (
                'verified_active','verified_terminated','pending_verification','failed_verification'
            )
        );
    `);
    pgm.dropColumns('candidate_committees', [
        'filing_authority_id', 'treasurer_name', 'treasurer_relationship',
        'is_self_treasurer', 'filing_receipt_url', 'filing_receipt_number',
        'filed_at', 'committee_id_status',
    ]);

    // SECTION B
    pgm.dropTable('filing_authorities');

    // SECTION A
    pgm.dropColumns('wouldbe', ['entry_path', 'launch_status', 'approval_method', 'contest_external_ids']);
};
