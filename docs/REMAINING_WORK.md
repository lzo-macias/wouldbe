# CoolPeople v3 / WouldBe — Remaining Work, in Detail

For every **unbuilt** section: the route file + DB file, each **route (method · path → function)**, and the **tables each function reads (R) / writes (W)**. All 102 tables are already migrated — this is the function + route layer only.

**Scope reconciled from:** MASTER (§1–§17 function lists) + S4–S6 PDF (Debate Update detail) + the real table inventory in `migrations/`.

**Conventions:** DB logic in `server/DB/<feature>.js`, routes in `server/API/<feature>Routes.js`, each fn takes one `{…}` object. Middleware: `requireAuth` (A) · `requireAdmin` (AD) · `recordAdminAction` (ADA) · `requireInternal` (INT) · `requireAttestation` (ATT) · `requireCriteriaAck` (ACK) · `captureRequestContext` (CTX). Shared reference tables read for joins: `users`, `wouldbe`, `office`, `races`, `jurisdiction`, `debates`, `contestants`, `sponsors`.

**Already-built helpers some of these depend on:** `getQualifyingOffices` (offices.js), `computeDeadlinesForOffice` (electionCalendar.js), `recordLinkHealth` (filingAuthorities.js), `evaluateStageGate` (planTimeline.js), `recordAdminAction` + `requireCriteriaAck` + `rateLimit` (middleware), admin-user CRUD (admins.js).

---

## §6 — Sponsors, Debates, Rules, Criteria, Judges  ⬜

### `sponsorsRoutes.js` + `sponsors.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createSponsor | POST /sponsors (A) | users | **sponsors** |
| getSponsorById | GET /sponsors/:id | sponsors | — |
| updateSponsor · setSponsorMarketingConsent | PATCH /sponsors/:id (A) | sponsors | **sponsors** (`marketing_consent_at`) |
| verifySponsor | POST /sponsors/:id/verify (AD) | sponsors | **sponsors** (`verified_at`) |
| getSponsorDebates | GET /sponsors/:id/debates | debates | — |

### `debatesRoutes.js` + `debates.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createDebate (sets `sponsor_flat_fee_cents`, `sponsor_entry_fee_cents`→`entry_price_cents`, `concluding_stream_at`) | POST /debates (A) | sponsors | **debates** |
| listDebates | GET /debates | debates | — |
| getDebateById | GET /debates/:id | debates | — |
| updateDebate · setDebateMarketingConsent | PATCH /debates/:id (A) | debates | **debates** |
| publishDebate · startDebate · closeDebate · cancelDebate | POST /debates/:id/{publish,start,close,cancel} (A) | debates | **debates** (`status`) |
| getDebateLeaderboard | GET /debates/:id/leaderboard | debate_votes, contestants | — |
| recordSponsorFlatFeePayment (`payment_type='debate_sponsor_flat_fee'`) | POST /debates/:id/sponsor-fee (A) | debates | **debate_payments** |
| incrementDebateContributions | (internal) | — | **debates** |

### `debateRulesRoutes.js` + `debateRules.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| publishDebateRules (versioned; closes prior) | POST /admin/debates/:id/rules (AD, ADA) | debate_official_rules | **debate_official_rules** |
| getCurrentDebateRules · getDebateRulesHistory · getRulesByVersion | GET /debates/:id/rules · /rules/history · /rules/:version | debate_official_rules | — |

### `debateCriteriaRoutes.js` + `debateCriteria.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| addCriterion → validateCriteriaWeightsSum | POST /debates/:id/criteria (AD) | debate_judging_criteria | **debate_judging_criteria** |
| getDebateCriteria · updateCriterion · deleteCriterion | GET/PATCH/DELETE /debates/:id/criteria · /criteria/:id (AD) | debate_judging_criteria | **debate_judging_criteria** |

### `debateJudgesRoutes.js` + `debateJudges.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| addJudge · getDebateJudges · recuseJudge | POST/GET /debates/:id/judges · POST /judges/:id/recuse (AD) | debate_judges | **debate_judges** |
| submitJudgeScores → lockJudgeScores · getDebateJudgeScores | POST /judges/:id/scores · GET /debates/:id/judge-scores (A) | contestants, debate_judging_criteria | **debate_judge_scores** |

---

## §7 — Debate Entry, Prompts, Contestants, Voting  ⬜

### `contestantsRoutes.js` + `contestants.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createContestant · getDebateContestants · getContestantById · withdrawContestant · disqualifyContestant | POST/GET /debates/:id/contestants · GET/POST /contestants/:id… (A / AD) | debates, users | **contestants** |

### `debateEntriesRoutes.js` + `debateEntries.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| enterDebate · getDebateEntries · getUserEntries · getEntryById | POST /debates/:id/enter · GET … (A, ATT `age_18`+`us_citizen`, ACK) | debates, contestants | **debate_entries** |

### `promptsRoutes.js` + `prompts.js` *(the `prompts` table — distinct from the built `user_prompt_log`)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createPrompt · getDebatePrompts · updatePrompt · deletePrompt | POST/GET/PATCH/DELETE /debates/:id/prompts · /prompts/:id (AD) | debates | **prompts** |

### `debateVotesRoutes.js` + `debateVotes.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| castDebateVote (verify `final_round` ack server-side) | POST /debates/:id/votes (A, ACK) | debates, contestants | **debate_votes** |
| addVoteScores | (internal/within cast) | — | **debate_vote_scores** |
| getMyVote · invalidateVote · getVoteTally | GET/POST /debates/:id/votes/… | debate_votes, debate_vote_scores | **debate_votes** |

### `rankedVotesRoutes.js` + `rankedVotes.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| submitRankedBallot (verify `final_round` ack) · getRankedChoiceResult | POST /debates/:id/ranked-ballot · GET …/ranked-result (A, ACK) | contestants | **debate_final_round_ranked_votes** |

### criteria acks → `user_criteria_acknowledgments` *(table + `requireCriteriaAck` middleware already exist)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordCriteriaAck · getUserCriteriaAcks · hasUserAckedCriteria | POST/GET /criteria-acks (A, CTX) | user_criteria_acknowledgments | **user_criteria_acknowledgments** |

---

## §8 — Posts, Endorsements, Comments, Nominations, Recommendations  ⬜

### `postsRoutes.js` + `posts.js`  *(external: Cloudflare R2 presigned upload)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| getUploadPresignedUrl | POST /posts/upload-url (A) | — | — (R2) |
| createPost · getPostById · updatePost · softDeletePost | POST/GET/PATCH/DELETE /posts · /posts/:id (A) | wouldbe, debates, contestants | **posts** |
| getPostsForWouldbe · getPostsForDebate · getUserPosts | GET /wouldbes/:id/posts · /debates/:id/posts · /users/:id/posts | posts | — |

### `postEndorsementsRoutes.js` + `postEndorsements.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createEndorsement (verify `landing_page` ack on debate posts) | POST /posts/:id/endorsements (A, ACK) | posts, contestants, user_criteria_acknowledgments | **post_endorsements** |
| removeEndorsement · getEndorsementsForPost · getEndorsementsForContestant · getEndorsementsGivenByUser · computeEndorsementMultiplier | DELETE/GET … | post_endorsements, contestants | **post_endorsements** |

### `commentsRoutes.js` + `comments.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createComment · getCommentsForPost · updateComment · softDeleteComment | POST/GET/PATCH/DELETE /posts/:id/comments · /comments/:id (A) | posts | **comments** |

### `nominationsRoutes.js` + `nominations.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createNomination · deleteNomination · getDebateNominationCounts · getNominationsReceived · hasUserBeenNominatedForDebate | POST/DELETE/GET /debates/:id/nominations · /users/:id/nominations (A) | debates, users | **nominations** |

### `wouldbeRecommendationsRoutes.js` + `wouldbeRecommendations.js`  *(nominate-someone entry path)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createRecommendation · deleteRecommendation · getRecommendationsReceived · getRecommendationsGiven | POST/DELETE/GET /recommendations … (A) | office, races, users | **wouldbe_recommendations** |
| respondToRecommendation ({id,response,resultingWouldbeId?}) | POST /recommendations/:id/respond (A) | wouldbe_recommendations | **wouldbe_recommendations**, **wouldbe** (on accept → `entry_path='nomination'`) |
| *(uses built `getQualifyingOffices`)* | GET /users/me/qualifying-offices | office, user_jurisdictions, users | — |

---

## §9 — Debate Results, Prize Pool, Payouts, Contest Compliance  ⬜

### `debateResultsRoutes.js` + `debateResults.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| calculateDebateResult · getDebateResult · announceDebateResult · voidDebateResult | POST/GET /debates/:id/result … (AD) | debate_votes, debate_vote_scores, debate_judge_scores, debate_final_round_ranked_votes, contestants | **debate_results** |

### `prizePoolRoutes.js` + `prizePool.js`  *(external: Stripe)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| addPrizePoolContribution · getPrizePool · refundContribution | POST/GET /debates/:id/prize-pool … (A) | debates | **prize_pool_contributions** |
| createPrizeDistribution · getPrizeDistributions · attachW9 · markDisbursed · openDistributionDispute | POST/GET /debates/:id/distributions … (AD, ADA) | payout_accounts, contest_winners | **prize_distributions** |

### `contestWinnersRoutes.js` + `contestWinners.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordContestWinner (→ emit `contest_won`) · getContestWinners · mark1099Filed | POST/GET /debates/:id/winners … (AD) | debates, contestants | **contest_winners** |

### `contestRegistrationsRoutes.js` + `contestRegistrations.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createStateRegistration · getStateRegistrations · updateStateRegistration · runStateRegistrationChecks | POST/GET/PATCH /debates/:id/state-registrations … (AD) | debates | **contest_state_registrations** |

### `payoutAccountsRoutes.js` + `payoutAccounts.js`  *(external: Stripe Connect / KYC)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| startPayoutOnboarding ({userId,processor}) · markPayoutVerified (id,taxIdType) · getPayoutAccount | POST/GET /payout-accounts … (A) | users | **payout_accounts** |

---

## §10 — Content Moderation  ⬜  *(external: Hive / OpenAI-mod / PhotoDNA; NCMEC for CSAM)*

### `contentItemsRoutes.js` + `contentItems.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createPendingContentItem · markUploadComplete · getContentItemById · updateVisibility · removeContentItem · setModerationStatus | POST/GET/PATCH … /content-items (A / AD) | — | **content_items** |

### `moderationEventsRoutes.js` + `moderationEvents.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordModerationEvent · getModerationEventsForItem · applyAutoDecision | POST/GET /content-items/:id/moderation-events (INT/AD) | content_items | **moderation_events** |

### `moderationQueueRoutes.js` + `moderationQueue.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| enqueueForReview · listOpenQueue · assignQueueItem · resolveQueueItem · getQueueSLAMetrics | POST/GET /admin/moderation-queue … (AD) | content_items | **moderation_queue** |

### `moderationAppealsRoutes.js` + `moderationAppeals.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| fileAppeal · getUserAppeals · listPendingAppeals · decideAppeal | POST/GET /moderation-appeals · /admin/moderation-appeals (A / AD) | moderation_events | **moderation_appeals** |

### `csamReportsRoutes.js` + `csamReports.js`  *(18 U.S.C. § 2258A; preserve 90d)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| openCSAMReport · attachNCMECReport · markLawEnforcementNotified · listCSAMReports | POST/GET /admin/csam-reports … (AD, INT) | content_items | **csam_reports** |

### `dmcaRoutes.js` + `dmca.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| fileDMCANotice · listDMCANotices · actOnDMCA · fileCounterNotice · restoreAfterCounter | POST/GET /dmca … (A / AD) | content_items, posts | **dmca_takedowns** |

### `liveStreamModerationRoutes.js` + `liveStreamModeration.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordLiveEvent · killLiveStream · getLiveStreamEvents · attachStreamTranscriptChunk | POST/GET /debate-streams/:id/moderation … (INT/AD) | debate_streams | **live_stream_moderation_events** |

---

## §11 — Trust & Safety  ⬜

### `userReportsRoutes.js` + `userReports.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| fileUserReport · listUserReports · resolveUserReport · markReportFalse | POST/GET /user-reports · /admin/user-reports (A / AD) | users | **user_reports** |

### `userStrikesRoutes.js` + `userStrikes.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| issueStrike · getStrikesForUser · appealStrike · expireStrike · getActiveStrikeCount | POST/GET /admin/users/:id/strikes … (AD) | users | **user_strikes** |

### `accountActionsRoutes.js` + `accountActions.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createAccountAction · getAccountActionsForUser · reverseAccountAction | POST/GET /admin/users/:id/actions … (AD, ADA) | users | **account_actions** |

### `userBlocksRoutes.js` + `userBlocks.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| blockUser · unblockUser · getMyBlocks · isBlockedBy | POST/DELETE/GET /blocks … (A) | users | **user_blocks** |

### `rateLimitRoutes.js` + `rateLimit.js`  *(write side already in the `rateLimit` middleware)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordViolation · listRateLimitViolations · countViolationsForIP | GET /admin/rate-limit-violations (AD) | rate_limit_violations | **rate_limit_violations** |

### `coordinatedBehaviorRoutes.js` + `coordinatedBehavior.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordCoordinatedSignal · listCoordinatedSignals · decideCoordinatedSignal · invalidateVotesForCluster | POST/GET /admin/coordinated-signals … (AD) | debate_votes | **coordinated_behavior_signals**, **debate_votes** (invalidate) |

---

## §12 — Messaging  ⬜  *(emits `new_message` → §17)*

### `conversationsRoutes.js` + `conversations.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createConversation · listConversationsForUser · getConversationById · addParticipant · removeParticipant · markConversationRead · leaveConversation | POST/GET/PATCH /conversations … (A) | users | **conversations**, **conversation_participants** |

### `messagesRoutes.js` + `messages.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| sendMessage (→ emit `new_message`) · getMessages · updateMessage · softDeleteMessage · recordSystemMessage | POST/GET/PATCH/DELETE /conversations/:id/messages (A) | conversations, conversation_participants | **messages** |

---

## §13 — Payments  🟡  *(WouldBe $5 creation-fee already built; rest todo — external: Stripe)*

### `tipsRoutes.js` + `tips.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createTipIntent · confirmTipFromIntent · getUserTips · refundTip · createTipFromWebhook | POST/GET /tips … (A / INT) | users | **tips** |

### `postPaymentsRoutes.js` + `postPayments.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createPostPaymentIntent · confirmPostPayment · getPostPaymentStatus | POST/GET /posts/:id/payment … (A) | posts | **post_payments** |

### `subscriptionsRoutes.js` + `subscriptions.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| startSubscription · getActiveSubscription · cancelSubscriptionAtPeriodEnd · resumeSubscription | POST/GET /subscriptions … (A) | users | **subscriptions** |
| upsertSubscriptionFromWebhook · recordSubscriptionPaymentFromWebhook · getUserSubscriptionPayments · refundSubscriptionPayment | (INT webhook) / GET | subscriptions | **subscriptions**, **subscription_payments** |

### `debatePaymentsRoutes.js` + `debatePayments.js`  *(entry economics; `sponsor_amount_cents` feeds §DU payouts)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| createDebateEntryIntent · confirmDebatePayment · getUserDebatePayments · refundDebatePayment | POST/GET /debates/:id/entry-payment … (A) | debates | **debate_payments** |

### `stripeWebhookRoutes.js` + `stripeWebhook.js`  *(→ emit `payment_receipt`)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| handleStripeWebhook · dispatchStripeEvent · markStripeEventProcessed | POST /internal/stripe/webhook (signature-verified) | stripe_webhook_events | **stripe_webhook_events** + (tips, subscription_payments, debate_payments, wouldbe_creation_payments) |

---

## §14 — Financial Audit + Tax  ⬜

### `financialAuditRoutes.js` + `financialAudit.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| recordFinancialEvent · listFinancialAuditEvents · getFinancialEventsForUser · reconcileWithStripe | POST/GET /admin/financial-audit … (AD / INT) | tips, debate_payments, subscription_payments, prize_distributions | **financial_audit_log** |

### `taxRecordsRoutes.js` + `taxRecords.js`  *(→ emit `tax_form_ready`; 1099 / 1042-S)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| upsertTaxRecord · listTaxRecords · attachW9ToTaxRecord · generate1099 · mark1099Filed · computeUserYearGross | POST/GET /admin/tax-records … (AD) | prize_distributions, debate_payments, tips, subscription_payments | **tax_records** |

---

## §15 — Admin & Operational  🟡  *(admin-user CRUD + recordAdminAction + change-reports already built)*

### `adminUsersRoutes.js` + `admins.js` — remaining bits
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| grantPIIAccess · revokePIIAccess | POST /admin/admins/:id/pii-access (AD super, ADA) | admin_users | **admin_users** |

### `adminActionsRoutes.js` — query side (write side = `recordAdminAction` middleware, built)
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| listAdminActions · getActionsForResource · getActionsByAdmin | GET /admin/admin-actions … (AD) | admin_actions | — |

### `systemJobsRoutes.js` + `systemJobs.js`  *(`job_type` incl. `election_calendar_sync`, `authority_link_health`, `stage_gate_evaluate`)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| enqueueJob · markJobRunning · markJobSucceeded · markJobFailed · listJobs · retryJob · cancelJob · getDueJobs | POST/GET /admin/jobs · /internal/jobs … (AD / INT) | system_jobs | **system_jobs** |

---

## §16 — Internal / Webhooks  🟡  *(only the age-band cron runs today)*

### `internalRoutes.js` — webhook handlers + crons
| Function | Route (mw) | Touches |
|---|---|---|
| handleHiveCallback · handleOpenAIModCallback · handlePhotoDNACallback | POST /internal/mod/* (INT) | moderation_events, content_items, csam_reports |
| handleCloudflareStreamEvent · handleR2UploadComplete | POST /internal/media/* (INT) | content_items, stream_recordings |
| evaluateWouldbeNotifications | POST /internal/notifications/run (INT) | → §17 |
| cronExpireStrikes · cronExpireTTWs · cronDispatchJobs · cronRunRetentionPurge | (cron) | user_strikes, testing_the_waters_campaigns, system_jobs, data_retention_policies |
| cronSyncElectionCalendar → `election_calendar_sync` *(calls built `computeDeadlinesForOffice`)* | (cron) | election_deadlines, deadline_offset_rules, election_date_anchors |
| cronCheckAuthorityLinks → `authority_link_health` *(calls built `recordLinkHealth`)* | (cron) | filing_authorities |
| cronEvaluateStageGates → `stage_gate_evaluate` *(calls built `evaluateStageGate`)* | (cron) | plan_timeline_components, stage_gate_transitions, stage_proofs |

---

## §17 — Notifications (candidate notifier)  ⬜  *(11 CFR 110.13: uniform objective criteria, logged)*

### `notificationCriteriaRoutes.js` + `notificationCriteria.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| getCurrentCriteria(algorithmKey) · publishCriteriaVersion · listCriteriaVersions | GET /notification-criteria · POST /admin/notification-criteria (AD) | notification_criteria_versions | **notification_criteria_versions** |

### `notificationsRoutes.js` + `notifications.js`
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| queueNotification · markNotificationSent/Delivered/Failed · suppressNotification · getUserNotifications · listNotifications | POST/GET /notifications · /admin/notifications (A / AD / INT) | notification_criteria_versions | **notifications** |

### `notificationEngine.js` (internal)
| Function | Reads | Writes |
|---|---|---|
| evaluateWouldbeNotifications() — ideology \|lean−lean\| · geo via `findUsersInJurisdictionTree` · goal `pledged/goal` · `is_open_seat` | wouldbe, races, user_jurisdictions, pledges, notification_criteria_versions | **notifications** |
| isUserNotifiable(userId,channel) · withinFrequencyCap(userId,window) | user_consents, push_subscriptions, notifications | — |
| **Unblocks** the real `getRecommendedWouldbes` (the §5 placeholder must share this scorer) and the `pledge_goal_reached` emission stubbed in pledges.js | | |

---

## Debate Update layer (from S4–S6 PDF; absent from MASTER)  🟡

### `twitchRoutes.js` + `twitch.js`  *(external: Twitch OAuth + EventSub; encrypt tokens at rest)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| upsertTwitchConnection (capture channel+user, store token, record consent) | GET /twitch/oauth/start · /callback (A) | — | **twitch_connections** |
| verifyVodStorage (after first stream → `vod_storage_verified_at`) | (onboarding, A) | — | **twitch_connections** |
| createEventSubSubscription · deleteEventSubSubscription | POST /admin/twitch/eventsub (AD) | twitch_connections | **twitch_eventsub_subscriptions** |
| handleEventSubWebhook (verify HMAC; dedupe `message_id`) → markStreamLive/markStreamOffline | POST /internal/twitch/eventsub (INT) | — | **twitch_eventsub_events**, **debate_streams** |

### `debateStreamsRoutes.js` + `debateStreams.js`  *(external: R2 for recordings)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| scheduleDebateStream (`method=embed`/`hybrid_record`; `embed_parent_domains`) · getDebateStream | POST/GET /debates/:id/stream (A/AD) | debates | **debate_streams** |
| ingestStreamRecording / attachStreamerVod · setRecordingModerationStatus · publishRecording · purgeExpiredRecordings (auto-delete window) | (internal) | debate_streams | **stream_recordings** |
| recordStreamParticipantConsent (hosting/replay, marketing, group-stream, minor) | POST /debate-streams/:id/consent (A, CTX) | — | **stream_participant_consents** |

### `debatePayoutsRoutes.js` + `debatePayouts.js`  *(external: Stripe transfer)*
| Function | Route (mw) | Reads | Writes |
|---|---|---|---|
| computeSponsorEntryPayout (sum `debate_payments.sponsor_amount_cents`) → disburseSponsorPayout (Stripe transfer) | (on conclusion, AD, ADA) | debate_payments | **debate_sponsor_payouts** |
| getSponsorPayouts | GET /debates/:id/sponsor-payouts (AD) | debate_sponsor_payouts | — |

---

## External dependencies the remaining work needs

| Dependency | Needed by |
|---|---|
| **Stripe** (+ Connect/transfers, webhooks) | §9 prize pool/payouts, §13 all payments, §14 reconcile, §DU sponsor payouts |
| **Cloudflare R2** (presigned upload, storage) | §8 posts media, §DU stream recordings, §16 R2 webhook |
| **Twitch** (OAuth + EventSub HMAC) | §DU livestream subsystem |
| **Hive / OpenAI-mod / PhotoDNA** | §10 moderation callbacks |
| **NCMEC** reporting | §10 CSAM |
| **FEC / state API client** *(also the open §4 stub)* | committee verification, finance-report proofs |

## Suggested build order
1. **§6 + §7 (debate core)** → unblocks §9 results/payouts and §DU streams.
2. **§13 payments + §DU economics/payouts** → the real-money loop (tips, entry fees, sponsor payouts).
3. **§8 posts/social** (needs R2).
4. **§17 notifier** → retro-fixes the §5 `getRecommendedWouldbes` + `*_reached` stubs.
5. **§10 + §11 moderation/T&S** → before public content.
6. **§14 tax**, **§15/§16 admin-jobs + crons** (wire the 3 jobs whose DB fns already exist).
