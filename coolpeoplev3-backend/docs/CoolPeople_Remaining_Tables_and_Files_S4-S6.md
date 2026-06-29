# CoolPeople — Remaining §4/§5/§6 backend: tables & files reference

For the functions/routes you're building next. Each row shows the **tables** it
touches (**R** = reads, **W** = writes) and the **file** it lives in. Shared
reference tables (`jurisdiction`, `office`, `races`, `users`) are read by many for
joins/keys. **`[DB]`** marks rows added by the Debate Update (migration `1780700000000`).

> Conventions: DB logic in `server/DB/<feature>.js`, routes in
> `server/API/<feature>Routes.js`, each fn takes a single `{ ... }` object and
> returns rows. `requireAuth` (A) / `requireAdmin` (AD) / `recordAdminAction` (ADA)
> / `requireAttestation` (ATT) / `requireAgeGate` (AGE) / `requireCriteriaAck` (ACK)
> / `captureRequestContext` (CTX) / `requireInternal` (internal) live in `server/middleware`.
> **Status:** ✅ built · 🔲 to build.

---

# §4 — FEC / Election-Law Compliance Gates — *none built*

The legal layer that decides whether a WouldBe may go live and solicit. Nothing
here transacts money; it gates `launch_status` and records why.

## 1. Candidate committees

**Route file:** `server/API/candidateCommitteesRoutes.js` · **DB file:** `server/DB/candidateCommittees.js` *(new)*
**Tables in play:** `candidate_committees` (+ `filing_authorities`, `jurisdiction`, `office`, `users` for joins)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/committees` | `createCandidateCommittee` *(treasurer fields + filing receipt → `registration_status='provisional_on_receipt'`)* | `candidate_committees` **W** · `filing_authorities` **R** | A, ATT | 🔲 |
| GET `/committees/me` | `getUserCommittees` | `candidate_committees` **R** | A | 🔲 |
| GET `/committees/:id` | `getCommitteeById` | `candidate_committees` **R** | A | 🔲 |
| POST `/committees/:id/verify` | `verifyCommitteeViaAPI` · `confirmCommittee` *(provisional → `verified_active`; sets `verified_via_api`/`last_verified_at`)* | `candidate_committees` **R/W** | A | 🔲 |
| PATCH `/committees/:id` | `updateCommittee` | `candidate_committees` **W** | A | 🔲 |
| *(launch gate)* | `hasActiveVerifiedCommittee(userId, raceId)` *(accepts `provisional_on_receipt`)* | `candidate_committees` **R** | — | 🔲 |

**This is the launch gate** — §5's `createWouldbe`/`updateWouldbe` can only flip `launch_status` to `active` once `hasActiveVerifiedCommittee` passes.

**Column cheat-sheet**
- `candidate_committees`: id, user_id, jurisdiction_id, committee_name, committee_type, external_committee_id, external_candidate_id, office_sought, office_district, cycle_year, registration_status, verified_via_api, verification_response, last_verified_at, registration_date, termination_date, filing_authority_id, treasurer_name, treasurer_relationship, is_self_treasurer, filing_receipt_url, filing_receipt_number, filed_at, committee_id_status, created_at

## 2. Compliance checks

**Route file:** `server/API/complianceChecksRoutes.js` · **DB file:** `server/DB/complianceChecks.js` *(new)*
**Tables in play:** `compliance_checks` (+ `jurisdiction_rules_versions`, `user_jurisdictions`, `wouldbe`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/compliance-checks/run` | `runComplianceCheck` *(auto-resolves jurisdiction via `user_jurisdictions`; stamps `jurisdiction_rules_version`)* | `compliance_checks` **W** · `jurisdiction_rules_versions` **R** · `user_jurisdictions` **R** | A | 🔲 |
| GET `/compliance-checks/me` | `getChecksForUser` | `compliance_checks` **R** | A | 🔲 |
| GET `/wouldbes/:id/compliance` | `getChecksForWouldbe` · `getLatestCheckResult` | `compliance_checks` **R** | A | 🔲 |

**Column cheat-sheet**
- `compliance_checks`: id, user_id, wouldbe_id, check_type, jurisdiction_id, jurisdiction_rules_version, result, reason, details, external_verification_payload, performed_at, performed_by, performed_by_user_id

## 3. Jurisdiction rules (versioned law)

**Route file:** `server/API/jurisdictionRulesRoutes.js` · **DB file:** `server/DB/jurisdictionRules.js` *(new)*
**Tables in play:** `jurisdiction_rules_versions` (+ `jurisdiction`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| GET `/jurisdiction-rules/:jid/current` | `getCurrentRulesForJurisdiction` *(`effective_until IS NULL`)* | `jurisdiction_rules_versions` **R** | — | 🔲 |
| GET `/jurisdiction-rules/:jid/history` | `getRulesHistory` · `getRulesAtPointInTime` | `jurisdiction_rules_versions` **R** | — | 🔲 |
| POST `/admin/jurisdiction-rules` | `publishRulesVersion` *(closes prior: sets `effective_until`)* | `jurisdiction_rules_versions` **W** | AD, ADA | 🔲 |
| *(gate helper)* | `getAdvancementRule(jurisdictionId)` *(top-two / RCV / no-runoff via `advancement_rule`/`advancement_threshold`)* | `jurisdiction_rules_versions` **R** | — | 🔲 |

**Column cheat-sheet**
- `jurisdiction_rules_versions`: id, jurisdiction_id, version, effective_from, effective_until, candidacy_trigger_type, candidacy_trigger_value, contribution_limit_individual_primary, contribution_limit_individual_general, contribution_limit_aggregate, committee_required_before_solicitation, off_session_fundraising_ban, matching_funds_program, matching_funds_rules_ref, contest_registration_threshold, has_runoff, advancement_rule, advancement_threshold, source_documents, created_by_user_id, created_at

## 4. Testing the Waters

**Route file:** `server/API/testingTheWatersRoutes.js` · **DB file:** `server/DB/testingTheWaters.js` *(new)*
**Tables in play:** `testing_the_waters_campaigns` (+ `candidate_committees` on convert)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/ttw` | `startTestingTheWaters` | `testing_the_waters_campaigns` **W** | A, ATT | 🔲 |
| GET `/ttw/me` | `getUserTTW` | `testing_the_waters_campaigns` **R** | A | 🔲 |
| GET `/ttw/:id` | `getTTWById` | `testing_the_waters_campaigns` **R** | A | 🔲 |
| POST `/ttw/:id/convert` | `convertTTWToCommittee` *(sets `converted_to_committee_id`)* | `testing_the_waters_campaigns` **W** · `candidate_committees` **W** | A | 🔲 |
| POST `/ttw/:id/terminate` | `terminateTTW` | `testing_the_waters_campaigns` **W** | A | 🔲 |
| *(internal)* | `incrementTTWPledgeStats` · `checkTTWCaps` *(`cumulative_pledges_cents` vs `soft`/`hard_pledge_cap_cents`)* | `testing_the_waters_campaigns` **R/W** | internal | 🔲 |

**Column cheat-sheet**
- `testing_the_waters_campaigns`: id, user_id, office_being_explored, jurisdiction_id, status, start_date, expiration_date, soft_pledge_cap_cents, hard_pledge_cap_cents, cumulative_pledges_cents, unique_pledgers_count, is_publicly_discoverable, disclosure_shown_to_pledgers, disclosure_version_id, converted_to_committee_id, expired_at, created_at

## 5. Fundraising eligibility

**Route file:** `server/API/fundraisingEligibilityRoutes.js` · **DB file:** `server/DB/fundraisingEligibility.js` *(new)*
**Tables in play:** `fundraising_eligibility_checks` (+ `jurisdiction_rules_versions`, `user_jurisdictions`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/fundraising-eligibility/run` | `runFundraisingEligibilityCheck` | `fundraising_eligibility_checks` **W** · `jurisdiction_rules_versions` **R** | A | 🔲 |
| GET `/fundraising-eligibility/me` | `getUserFundraisingChecks` | `fundraising_eligibility_checks` **R** | A | 🔲 |
| GET `/fundraising-eligibility/:jid/latest` | `getLatestEligibilityForJurisdiction` | `fundraising_eligibility_checks` **R** | — | 🔲 |

**Column cheat-sheet**
- `fundraising_eligibility_checks`: id, user_id, jurisdiction_id, office_sought, election_cycle, check_date, legal_status, committee_required, required_filings, legal_minimum_lead_days, recommended_lead_days, max_individual_contribution_cents, warnings, check_passed, created_at

---

# §5 — WouldBe Campaigns, Plans, Pledges, Follows — *partially built*

`wouldbe.js` and the staged-timeline splitter (`planTimeline.js`) have built
functions (✅); plans/goals/pledges/follows are still to build.

## 6. WouldBe campaigns

**Route file:** `server/API/wouldbeRoutes.js` · **DB file:** `server/DB/wouldbe.js` *(partially built)*
**Tables in play:** `wouldbe` (+ `office`, `races`, `users`, `pledges`, `posts`; `[DB]` `wouldbe_creation_payments`, `pledge_goal_notifications`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/wouldbes` | `createWouldbeV2` *(`launch_status='draft'`; enforce $5K–$1M)* | `wouldbe` **W** | A, ATT | ✅ |
| `[DB]` POST `/wouldbes/:id/creation-payment` | `recordWouldbeCreationPayment` *($5 fee → stamps `creation_fee_paid_at`)* | `wouldbe_creation_payments` **W** · `wouldbe` **W** | A | ✅ |
| `[DB]` GET `/wouldbes/:id/creation-payment` | `getWouldbeCreationPayment` | `wouldbe_creation_payments` **R** | A | ✅ |
| GET `/wouldbes` | `listWouldbes` | `wouldbe` **R** | — | ✅ |
| GET `/wouldbes/:id` | `getWouldbeById` | `wouldbe` **R** | — | ✅ |
| PATCH `/wouldbes/:id` | `updateWouldbe` *(enforce $5K–$1M)* | `wouldbe` **W** | A | ✅ |
| `[DB]` PATCH `/wouldbes/:id/processor` | `setContributionProcessor` *(ActBlue/WinRed link)* | `wouldbe` **W** | A | ✅ |
| POST `/wouldbes/:id/retire` | `retireWouldbe` | `wouldbe` **W** | A | ✅ |
| GET `/wouldbes/:id/pledgers` | `getWouldbePledgers` | `pledges` **R** · `users` **R** | A | ✅ |
| GET `/wouldbes/:id/posts` | `getWouldbePosts` | `posts` **R** · `wouldbe` **R** | — | ✅ |
| GET `/wouldbes/:id/rankings` | `getWouldbeRankings` *(standing vs same race/office)* | `wouldbe` **R** | — | ✅ |
| GET `/wouldbes/recommended` | `getRecommendedWouldbes` *(reuse notifier criteria + `user_jurisdictions`)* | `wouldbe` **R** · `user_jurisdictions` **R** | A | 🔲 |
| `[DB]` *(internal)* | `recordGoalReached` *(goal/micro-goal met → processor link to pledgers; idempotent)* | `pledge_goal_notifications` **W** · `pledges` **R** | internal | ✅ |
| *(internal)* | `incrementPledgedTotal` · `checkWouldbeCanPostVideos` | `wouldbe` **R/W** · `pledges` **R** | internal | 🔲 |

**Column cheat-sheet**
- `wouldbe`: id, title, description, user_id, office_id, race_id, goal_cents, pledged_total_cents, deadline, can_post_videos, retired, retired_at, entry_path, launch_status, approval_method, contest_external_ids, pledge_cap_cents, cap_reset_count, primary_advanced_at, `[DB]` creation_fee_cents, creation_fee_paid_at, contribution_processor, contribution_processor_url, created_at, updated_at
- `[DB]` `wouldbe_creation_payments`: id, wouldbe_id, user_id, amount_cents, currency, stripe_customer_id, stripe_payment_intent_id, stripe_charge_id, stripe_balance_txn_id, fee_amount_cents, net_amount_cents, status, failure_reason, charged_at, refunded_at, created_at
- `[DB]` `pledge_goal_notifications`: id, wouldbe_id, plan_timeline_component_id, goal_kind, threshold_cents, reached_at, processor_url, pledgers_notified_count, notified_at, created_at
- `wouldbe_recommendations` *(nominate-someone; §8)*: id, recommender_user_id, target_user_id, office_id, race_id, source_debate_id, recommendation_type, reason_text, target_response, responded_at, resulting_wouldbe_id, created_at

## 7. Plans

**Route file:** `server/API/plansRoutes.js` · **DB file:** `server/DB/plans.js` *(new)*
**Tables in play:** `plan`, `plan_components`, `plan_component_categories` (+ `wouldbe`, `office`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/wouldbes/:id/plan` | `createPlan` | `plan` **W** | A | 🔲 |
| GET `/wouldbes/:id/plan` | `getPlanForWouldbe` | `plan` **R** · `plan_components` **R** | — | 🔲 |
| POST `/plans/:id/components` | `addPlanComponent` | `plan_components` **W** | A | 🔲 |
| PATCH `/plan-components/:id` | `updatePlanComponent` | `plan_components` **W** | A | 🔲 |
| DELETE `/plan-components/:id` | `deletePlanComponent` | `plan_components` **W** | A | 🔲 |
| GET `/plan-categories` | `listPlanCategories` | `plan_component_categories` **R** | — | 🔲 |
| POST `/admin/plan-categories` | `createPlanCategory` | `plan_component_categories` **W** | AD | 🔲 |

**Column cheat-sheet**
- `plan`: id, wouldbe_id, user_id, office_id, created_at, updated_at
- `plan_components`: id, plan_id, category_key, title, description, created_at
- `plan_component_categories`: category_key, display_name, category_group, description, icon, sort_order, is_active, created_at

## 8. Plan timeline + staged gating *(WB §7)*

**Route file:** `server/API/planTimelineRoutes.js` · **DB file:** `server/DB/planTimeline.js` *(partially built)*
**Tables in play:** `plan_timeline`, `plan_timeline_components`, `stage_proofs`, `stage_gate_transitions`, `election_deadlines`, `deadline_offset_rules`

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/plans/:id/timeline` | `createPlanTimeline` · `syncTimelineFromRace` | `plan_timeline` **W** · `races` **R** | A | 🔲 |
| GET `/plans/:id/timeline` | `getPlanTimeline` | `plan_timeline` **R** · `plan_timeline_components` **R** | — | 🔲 |
| POST `/timelines/:id/components` | `addTimelineComponent` | `plan_timeline_components` **W** | A | 🔲 |
| PATCH `/timeline-components/:id` | `updateTimelineComponent` | `plan_timeline_components` **W** | A | 🔲 |
| POST `/wouldbes/:id/build-stages` | `buildStagedTimeline(planTimelineId)` *(cumulative back-loaded split into per-deadline sub-goals)* | `plan_timeline_components` **W** · `election_deadlines` **R** · `wouldbe` **R** | A | ✅ |
| GET `/wouldbes/:id/stages` | `getStagedTimeline` · `getStage` | `plan_timeline_components` **R** · `election_deadlines` **R** | — | ✅ |
| *(prereq, internal)* | `computeDeadlinesForOffice` *(populates `election_deadlines` the splitter reads)* | `election_deadlines` **W** · `deadline_offset_rules` **R** | internal | ✅ |
| POST `/stages/:id/proof` | `submitStageProof` → `pullAuthorityProof` (T1) · `ingestProofDocument` + `crossCheckProof` (T2) · `recordStageAttestation` (T3) | `stage_proofs` **W** | A, CTX | 🔲 |
| *(internal/cron)* | `evaluateStageGate(componentId)` *(flips `gate_state`/`proof_status`; append-only audit)* · `getGateAuditTrail` | `plan_timeline_components` **W** · `stage_gate_transitions` **W** · `stage_proofs` **R** | internal | 🔲 |

**Column cheat-sheet**
- `plan_timeline`: id, plan_id, office_id, race_id, created_at
- `plan_timeline_components`: id, plan_timeline_id, event_date, timeline_category, completed, completed_at, stage_number, sub_goal_cents, gate_state, proof_tier, verify_method, milestone_type, proof_status, election_deadline_id, created_at
- `stage_proofs`: id, plan_timeline_component_id, wouldbe_id, proof_tier, verify_method, milestone_type, status, source, authority_payload, uploaded_document_url, extracted_fields, cross_check_result, attestation_user_id, attestation_statement, submitted_at, verified_at, verified_by, created_at
- `stage_gate_transitions`: id, plan_timeline_component_id, wouldbe_id, from_state, to_state, triggered_by, source, stage_proof_id, notes, transitioned_at

## 9. Goals *(WB §4)*

**Route file:** `server/API/goalsRoutes.js` · **DB file:** `server/DB/goals.js` *(new)*
**Tables in play:** `office_recommended_goals`, `goal_increase_requests` (+ `wouldbe`, `office`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| GET `/offices/:id/recommended-goal` | `getRecommendedGoalForOffice` *(cents, or null)* | `office_recommended_goals` **R** | — | 🔲 |
| POST `/wouldbes/:id/goal-increase` | `createGoalIncreaseRequest` *(reason required, ≤ $1M)* | `goal_increase_requests` **W** | A | 🔲 |
| GET `/admin/goal-increases` | `listPendingGoalIncreases` | `goal_increase_requests` **R** | AD | 🔲 |
| POST `/admin/goal-increases/:id/decide` | `decideGoalIncrease` *(on approve → update `wouldbe.goal_cents` + re-scope timeline)* | `goal_increase_requests` **W** · `wouldbe` **W** | AD, ADA | 🔲 |

**Column cheat-sheet**
- `office_recommended_goals`: id, office_id, recommended_goal_cents, rationale, source_url, created_at, updated_at
- `goal_increase_requests`: id, wouldbe_id, requested_by_user_id, current_goal_cents, requested_goal_cents, reason, status, review_method, reviewed_by_user_id, reviewed_at, review_notes, created_at

## 10. Pledges

**Route file:** `server/API/pledgesRoutes.js` · **DB file:** `server/DB/pledges.js` *(new)*
**Tables in play:** `pledges` (+ `wouldbe`, `plan_timeline_components`, `user_attestations`, `wouldbe_cap_resets`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/wouldbes/:id/pledges` | `isPledgeEligible` *(gate)* → `createPledge` *(stamps `plan_timeline_component_id` = open stage; rejects over-cap via `getRemainingPledgeCap`)* | `pledges` **W** · `user_attestations` **R** · `wouldbe` **R** · `wouldbe_cap_resets` **R** | A, ATT(`us_citizen_or_lpr`) | 🔲 |
| GET `/pledges/me` | `getUserPledges` | `pledges` **R** | A | 🔲 |
| POST `/pledges/:id/withdraw` | `withdrawPledge` | `pledges` **W** | A | 🔲 |
| GET `/wouldbes/:id/pledge-stats` | `getWouldbePledgeStats` | `pledges` **R** | — | 🔲 |
| *(lifecycle)* | `markPledgeConverted` · `markPledgesGoalReached` *(→ emit `pledge_goal_reached`; pairs with `[DB]` `recordGoalReached`)* · `resetPledgeCapForPrimaryAdvance` | `pledges` **W** · `wouldbe_cap_resets` **W** | internal | 🔲 |

**Note:** pledges are **promises** — they never transact on-platform. The contribution itself happens at the external processor (the `[DB]` ActBlue/WinRed link). Platform revenue is `tips` (§13).

**Column cheat-sheet**
- `pledges`: id, pledger_user_id, wouldbe_id, amount_cents, status, converted_at, cap_window, plan_timeline_component_id, created_at
- `wouldbe_cap_resets`: id, wouldbe_id, reset_number, reason, additional_cap_cents, confirmed_by, proof_reference, confirmed_at, created_at

## 11. Follows

**Route file:** `server/API/followsRoutes.js` · **DB file:** `server/DB/follows.js` *(new)*
**Tables in play:** `follows` (+ `users`, `wouldbe` for the feed)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/follows` | `createFollow` | `follows` **W** | A | 🔲 |
| DELETE `/follows/:id` | `deleteFollow` | `follows` **W** | A | 🔲 |
| GET `/users/:id/followers` | `getFollowers` | `follows` **R** · `users` **R** | — | 🔲 |
| GET `/users/:id/following` | `getFollowing` | `follows` **R** · `users` **R** | — | 🔲 |
| GET `/feed` | `getHomeFeed` | `follows` **R** · `wouldbe` **R** · `posts` **R** | A | 🔲 |

**Column cheat-sheet**
- `follows`: id, follower_id, followed_id, follow_type, created_at

---

# §6 — Sponsors, Debates, Rules, Criteria, Judges — *none built*

Plus the Debate Update's **livestream subsystem** and **sponsor-fee economics**.

## 12. Sponsors

**Route file:** `server/API/sponsorsRoutes.js` · **DB file:** `server/DB/sponsors.js` *(new)*
**Tables in play:** `sponsors` (+ `users`, `debates`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/sponsors` | `createSponsor` | `sponsors` **W** | A | 🔲 |
| GET `/sponsors/:id` | `getSponsorById` | `sponsors` **R** | — | 🔲 |
| PATCH `/sponsors/:id` | `updateSponsor` · `[DB]` `setSponsorMarketingConsent` *(`marketing_consent_at`)* | `sponsors` **W** | A | 🔲 |
| POST `/sponsors/:id/verify` | `verifySponsor` | `sponsors` **W** | AD | 🔲 |
| GET `/sponsors/:id/debates` | `getSponsorDebates` | `debates` **R** | — | 🔲 |

**Column cheat-sheet**
- `sponsors`: id, user_id, type, display_name, logo_url, verified_at, `[DB]` marketing_consent_at, created_at, updated_at

## 13. Debates *(incl. `[DB]` sponsor-fee economics)*

**Route file:** `server/API/debatesRoutes.js` · **DB file:** `server/DB/debates.js` *(new)*
**Tables in play:** `debates` (+ `sponsors`, `contestants`, `debate_votes`; `[DB]` `debate_payments` for the flat fee/entry split)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/debates` | `createDebate` · `[DB]` set `sponsor_flat_fee_cents` (post fee) + sponsor-set `sponsor_entry_fee_cents` → `entry_price_cents` (fee + processing markup); `concluding_stream_at` | `debates` **W** | A | 🔲 |
| GET `/debates` | `listDebates` | `debates` **R** | — | 🔲 |
| GET `/debates/:id` | `getDebateById` | `debates` **R** | — | 🔲 |
| PATCH `/debates/:id` | `updateDebate` · `[DB]` `setDebateMarketingConsent` | `debates` **W** | A | 🔲 |
| POST `/debates/:id/publish|start|close|cancel` | `publishDebate` · `startDebate` · `closeDebate` · `cancelDebate` | `debates` **W** | A | 🔲 |
| GET `/debates/:id/leaderboard` | `getDebateLeaderboard` | `debate_votes` **R** · `contestants` **R** | — | 🔲 |
| `[DB]` POST `/debates/:id/sponsor-fee` | `recordSponsorFlatFeePayment` *(`payment_type='debate_sponsor_flat_fee'`)* | `debate_payments` **W** | A | 🔲 |
| *(internal)* | `incrementDebateContributions` | `debates` **W** | internal | 🔲 |

**Column cheat-sheet**
- `debates`: id, sponsor_id, title, description, win_type, hybrid_crowd_weight_pct, contribution_type, participation_type, sponsor_contribution_cents, platform_top_up_cents, user_contributions_cents, prize_pool_cents, prize_distribution_rules, scoring_methodology, status, start_date, end_date, results_announce_at, min_age_required, excluded_states, free_entry_method, retired, `[DB]` sponsor_flat_fee_cents, sponsor_entry_fee_cents, entry_price_cents, concluding_stream_at, marketing_consent_at, created_at, updated_at
- `[DB]` `debate_payments` *(§13)*: payment_id, user_id, debate_id, payment_type *(+`debate_sponsor_flat_fee`)*, amount_cents, currency, fee_amount_cents, net_amount_cents, `[DB]` sponsor_amount_cents, platform_amount_cents, stripe_*, status, charged_at, refunded_at, created_at

## 14. Debate rules / criteria / judges

**Route files:** `server/API/debateRulesRoutes.js` · `debateCriteriaRoutes.js` · `debateJudgesRoutes.js` · **DB files:** `debateRules.js` · `debateCriteria.js` · `debateJudges.js` *(new)*
**Tables in play:** `debate_official_rules`, `debate_judging_criteria`, `debate_judges`, `debate_judge_scores` (+ `contestants`)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| POST `/admin/debates/:id/rules` | `publishDebateRules` *(versioned; closes prior)* | `debate_official_rules` **W** | AD | 🔲 |
| GET `/debates/:id/rules` | `getCurrentDebateRules` · `/rules/history` `getDebateRulesHistory` · `/rules/:version` `getRulesByVersion` | `debate_official_rules` **R** | — | 🔲 |
| POST `/debates/:id/criteria` | `addCriterion` then `validateCriteriaWeightsSum` | `debate_judging_criteria` **W** | AD | 🔲 |
| GET `/debates/:id/criteria` | `getDebateCriteria` · PATCH `updateCriterion` · DELETE `deleteCriterion` | `debate_judging_criteria` **R/W** | AD | 🔲 |
| POST `/debates/:id/judges` | `addJudge` · GET `getDebateJudges` · POST `/judges/:id/recuse` `recuseJudge` | `debate_judges` **W** | AD | 🔲 |
| POST `/judges/:id/scores` | `submitJudgeScores` then `lockJudgeScores` · GET `/debates/:id/judge-scores` `getDebateJudgeScores` | `debate_judge_scores` **W** · `contestants` **R** | A | 🔲 |

**Column cheat-sheet**
- `debate_official_rules`: rules_id, debate_id, version, rules_text, rules_url, body_hash, effective_at, superseded_at, age_eligibility_min, age_eligibility_max, minor_entry_allowed, minor_entry_methods, created_at
- `debate_judging_criteria`: criterion_id, debate_id, criterion_key, display_name, description, weight, display_order, created_at
- `debate_judges`: judge_id, debate_id, user_id, external_name, external_bio, role, disclosed_at, recused_at, recusal_reason, created_at
- `debate_judge_scores`: score_id, debate_id, judge_id, contestant_id, criterion_id, score, notes, locked_at, created_at, updated_at

## 15. `[DB]` Twitch livestream subsystem

**Route files:** `server/API/twitchRoutes.js` · `debateStreamsRoutes.js` · **DB files:** `twitch.js` · `debateStreams.js` *(new)*
**Tables in play:** `twitch_connections`, `debate_streams`, `twitch_eventsub_subscriptions`, `twitch_eventsub_events`, `stream_recordings`, `stream_participant_consents`

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| GET `/twitch/oauth/start` · `/callback` | `upsertTwitchConnection` *(capture channel + user id, store token, record consent)* | `twitch_connections` **W** | A | 🔲 |
| *(onboarding)* | `verifyVodStorage` *(Get Videos after first stream → `vod_storage_verified_at`)* | `twitch_connections` **W** | A | 🔲 |
| POST `/admin/twitch/eventsub` | `createEventSubSubscription` · `deleteEventSubSubscription` | `twitch_eventsub_subscriptions` **W** | AD | 🔲 |
| POST `/internal/twitch/eventsub` *(webhook)* | `handleEventSubWebhook` *(verify HMAC; dedupe `message_id`)* → `markStreamLive` / `markStreamOffline` | `twitch_eventsub_events` **W** · `debate_streams` **W** | internal | 🔲 |
| POST `/debates/:id/stream` | `scheduleDebateStream` *(method=embed\|hybrid_record; `embed_parent_domains`)* | `debate_streams` **W** | A/AD | 🔲 |
| GET `/debates/:id/stream` | `getDebateStream` | `debate_streams` **R** | — | 🔲 |
| *(Method 2, internal)* | `ingestStreamRecording` / `attachStreamerVod` · `setRecordingModerationStatus` · `publishRecording` · `purgeExpiredRecordings` *(auto-delete window)* | `stream_recordings` **W** | internal | 🔲 |
| POST `/debate-streams/:id/consent` | `recordStreamParticipantConsent` *(hosting/replay, marketing, group-stream, minor)* | `stream_participant_consents` **W** | A, CTX | 🔲 |

**Column cheat-sheet**
- `twitch_connections`: id, user_id, twitch_user_id, twitch_login, twitch_display_name, access_token, refresh_token, scopes, token_expires_at, developer_tos_accepted_at, vod_storage_verified_at, connected_at, disconnected_at, updated_at *(encrypt tokens at rest)*
- `debate_streams`: id, debate_id, twitch_connection_id, host_user_id, method, twitch_channel, twitch_broadcaster_user_id, embed_parent_domains, scheduled_at, status, started_at, ended_at, vod_video_id, vod_url, created_at, updated_at
- `twitch_eventsub_subscriptions`: id, twitch_connection_id, subscription_id, subscription_type, broadcaster_user_id, status, created_at, updated_at
- `twitch_eventsub_events`: id, message_id, subscription_type, broadcaster_user_id, debate_stream_id, signature_verified, event_payload, received_at
- `stream_recordings`: id, debate_stream_id, debate_id, source, r2_bucket, r2_object_key, playback_url, duration_seconds, moderation_status, published_at, auto_delete_at, deleted_at, created_at, updated_at
- `stream_participant_consents`: id, debate_stream_id, user_id, role, hosting_replay_license_at, marketing_release_at, group_stream_consent_at, is_minor, guardian_consent_at, consent_document_version, ip_address, user_agent, created_at

## 16. `[DB]` Sponsor payouts from entries

**Route file:** `server/API/debatePayoutsRoutes.js` · **DB file:** `server/DB/debatePayouts.js` *(new)*
**Tables in play:** `debate_sponsor_payouts` (+ `debate_payments` to sum entries; winner payout = `prize_distributions`, §9)

| Method / Path | Function | Tables (R/W) | MW | Status |
|---|---|---|---|---|
| *(on conclusion)* | `computeSponsorEntryPayout` *(sum `debate_payments.sponsor_amount_cents`)* → `disburseSponsorPayout` *(Stripe transfer)* | `debate_sponsor_payouts` **W** · `debate_payments` **R** | AD, ADA | 🔲 |
| GET `/debates/:id/sponsor-payouts` | `getSponsorPayouts` | `debate_sponsor_payouts` **R** | AD | 🔲 |

**Column cheat-sheet**
- `debate_sponsor_payouts`: id, debate_id, sponsor_id, recipient_user_id, gross_entries_cents, platform_fee_cents, amount_cents, currency, stripe_transfer_id, disbursement_method, status, disbursed_at, created_at, updated_at

---

## Quick mental model

- **§4 gates §5.** A WouldBe can't go `active` until `hasActiveVerifiedCommittee` (committee) passes; `compliance_checks` / `fundraising_eligibility_checks` read the versioned `jurisdiction_rules_versions` to decide. Money never moves here.
- **§5 producer chain.** `computeDeadlinesForOffice` → `election_deadlines` → `buildStagedTimeline` splits `wouldbe.goal_cents` into per-deadline **micro-goals** (`plan_timeline_components.sub_goal_cents`). Pledges attribute to the open stage; when a goal/micro-goal is met, `[DB]` `recordGoalReached` fans the **ActBlue/WinRed link** to pledgers. Pledges are promises — the contribution happens off-platform; platform revenue is `tips`.
- **§6 money.** Sponsor pays a **flat fee to post** (`sponsor_flat_fee_cents`, platform revenue) **+** the cash prize. Entries are `sponsor_entry_fee_cents` + processing markup = `entry_price_cents`; entry fees pay out to the **sponsor** (`debate_sponsor_payouts`), the prize to the **winner** (`prize_distributions`), both once the contest concludes.
- **§6 livestream.** Twitch OAuth per streamer (`twitch_connections`) → EventSub `stream.online/offline` (`twitch_eventsub_*`) flips `debate_streams.status` → Method 1 embeds; Method 2 also keeps an R2 copy (`stream_recordings`) it moderates then auto-deletes. Every participant signs `stream_participant_consents`.
