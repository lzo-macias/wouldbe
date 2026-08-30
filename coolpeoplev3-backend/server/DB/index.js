const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();



// Connection POOL (not a single shared Client): every query gets its own
// connection from the pool, so concurrent requests can't bleed into each other's
// transaction state. pool.query() auto-acquires/releases a connection for one-off
// statements. MULTI-statement transactions must use withTransaction() below so
// all their queries run on ONE checked-out connection.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Per-instance pool size. Keep (instances × DB_POOL_MAX) under Postgres'
    // max_connections (default ~100); front the DB with PgBouncer to scale past
    // that. See docs/SCALING.md. Defaults to pg's 10.
    max: Number(process.env.DB_POOL_MAX) || 10,
});

// withTransaction(fn) — check out a dedicated connection, run fn(tx) inside a
// BEGIN/COMMIT, ROLLBACK on any throw, and ALWAYS release the connection back to
// the pool. `tx` is the per-transaction client: every query inside fn MUST use
// tx.query(...) — using the shared pool there would run outside the transaction.
const withTransaction = async (fn) => {
    const tx = await pool.connect();
    try {
        await tx.query("BEGIN");
        const result = await fn(tx);
        await tx.query("COMMIT");
        return result;
    } catch (err) {
        await tx.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        tx.release();
    }
};

// `client` is exported as the pool so the many single-query modules that call
// client.query(...) keep working unchanged (Pool.query is a drop-in). Modules
// that need a transaction import withTransaction instead of issuing BEGIN/COMMIT
// on a shared connection.
module.exports = { client: pool, pool, withTransaction, app };

const PORT = process.env.PORT || 3000;

// req.ip reflects the real client IP behind a proxy/LB (used for consent/
// attestation/audit rows). Safe locally too.
app.set("trust proxy", 1);
app.use(cors());
// Capture the raw request body so webhook routes (Stripe, Twitch EventSub) can
// verify HMAC signatures over the exact bytes — express.json() otherwise consumes
// the stream. Handlers read req.rawBody (a Buffer); normal JSON parsing is unchanged.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// waitForDatabase — the first query, retried.
//
// TWO REASONS THIS IS NOT A SINGLE ATTEMPT:
//
//   Railway's private network is not up the instant the container is. A service
//   that resolves postgres.railway.internal on its first tick can lose a race it
//   would win half a second later, and the failure looks identical to a genuinely
//   wrong password — which is how an afternoon disappears.
//
//   A restarting database is a normal event. Losing the app to a thirty-second
//   Postgres restart is a worse outage than the restart.
//
// Backs off 1s, 2s, 4s… and gives up after ~30s rather than retrying forever: a
// wrong DATABASE_URL should be a fast, loud failure, not a container that looks
// busy indefinitely.
const waitForDatabase = async ({ attempts = 6 } = {}) => {
    for (let i = 0; i < attempts; i++) {
        try {
            await pool.query("SELECT 1");
            if (i > 0) console.log(`database reachable after ${i + 1} attempts`);
            return;
        } catch (err) {
            const last = i === attempts - 1;
            if (last) throw err;
            const wait = 2 ** i * 1000;
            console.log(`database not reachable yet (${err.code || err.message}) — retrying in ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
};

const init = async () => {
    try {
        // Fail fast at startup if the DB is unreachable (Pool connects lazily).
        await waitForDatabase();
        // Lazy require (after module.exports is set) avoids a circular dep:
        // route files pull DB modules that require this file for `client`.
        const { startScheduledJobs } = require("../jobs/scheduledJobs.js");
        startScheduledJobs();

        // Mount routers. consent/legalDoc paths already start with /consents,
        // /push, /legal-docs, so they share the /api prefix.
        const { router: authRouter } = require("../API/platform/authRoutes");
        const { router: userRouter } = require("../API/platform/userRoutes");
        const { router: consentRouter } = require("../API/platform/consentRoutes");
        const { router: legalRouter } = require("../API/platform/legalDocRoutes");
        const { router: attestationRouter } = require("../API/platform/attestationRoutes");
        const { router: childSafetyRouter } = require("../API/platform/childSafetyRoutes");
        const { router: adminRouter } = require("../API/platform/adminRoutes");
        // §3 Political reference data + §6 election calendar (all share /api).
        const { router: jurisdictionsRouter } = require("../API/elections/jurisdictionsRoutes");
        const { router: officesRouter } = require("../API/elections/officesRoutes");
        const { router: politiciansRouter } = require("../API/candidacy/politiciansRoutes");
        const { router: racesRouter } = require("../API/elections/racesRoutes");
        const { router: electionDeadlinesRouter } = require("../API/elections/electionDeadlinesRoutes");
        const { router: electionCalendarRouter } = require("../API/elections/electionCalendarRoutes");
        const { router: filingAuthoritiesRouter } = require("../API/elections/filingAuthoritiesRoutes");
        const { router: userJurisdictionsRouter } = require("../API/elections/userJurisdictionsRoutes");
        // §2 privacy ops + §5 WouldBe/plan-timeline (newly routed DB modules).
        const { router: dataRightsRouter } = require("../API/platform/dataRightsRoutes");
        const { router: dataRetentionsRouter } = require("../API/platform/dataRetentionsRoutes");
        const { router: piiAccessRouter } = require("../API/platform/piiAccessRoutes");
        const { router: planTimelineRouter } = require("../API/candidacy/planTimelineRoutes");
        const { router: wouldbeRouter } = require("../API/candidacy/wouldbeRoutes");
        // Issue categories (controlled vocabulary) + user interests + post/prompt tags.
        const { router: categoriesRouter } = require("../API/elections/categoriesRoutes");
        const { router: interestsRouter } = require("../API/elections/interestsRoutes");
        const { router: tagsRouter } = require("../API/debate/tagsRoutes");
        const { router: changeReportsRouter } = require("../API/platform/changeReportsRoutes");
        const { router: stageProofsRouter } = require("../API/candidacy/stageProofsRoutes");
        const { router: rulesVersionsRouter } = require("../API/elections/rulesVersionsRoutes");
        // §4 FEC / election-law compliance gates (none previously built).
        const { router: candidateCommitteesRouter } = require("../API/candidacy/candidateCommitteesRoutes");
        const { router: jurisdictionRulesRouter } = require("../API/elections/jurisdictionRulesRoutes");
        const { router: complianceChecksRouter } = require("../API/platform/complianceChecksRoutes");
        const { router: testingTheWatersRouter } = require("../API/candidacy/testingTheWatersRoutes");
        const { router: fundraisingEligibilityRouter } = require("../API/candidacy/fundraisingEligibilityRoutes");
        // §5 plans / goals / pledges / follows.
        const { router: plansRouter } = require("../API/candidacy/plansRoutes");
        const { router: goalsRouter } = require("../API/candidacy/goalsRoutes");
        const { router: pledgesRouter } = require("../API/candidacy/pledgesRoutes");
        const { router: followsRouter } = require("../API/platform/followsRoutes");
        const { router: userBlocksRouter } = require("../API/platform/userBlocksRoutes");
        // §6 sponsors / debates …
        const { router: sponsorsRouter } = require("../API/debate/sponsorsRoutes");
        const { router: debateRulesRouter } = require("../API/debate/debateRulesRoutes");
        const { router: debateCriteriaRouter } = require("../API/debate/debateCriteriaRoutes");
        // pre-disclosed criteria catalog, keyed to a debate's category
        const { router: categoryCriteriaRouter } = require("../API/debate/categoryCriteriaRoutes");
        const { router: contestantsRouter } = require("../API/debate/contestantsRoutes");
        const { router: debateJudgesRouter } = require("../API/debate/debateJudgesRoutes");
        // §7 — debate entry, prompts, voting, ranked choice, criteria acks
        const { router: debateEntriesRouter } = require("../API/debate/debateEntriesRoutes");
        const { router: promptsRouter } = require("../API/debate/promptsRoutes");
        // typed debates — one prompt per bracket match, plus the category assist
        const { router: matchPromptsRouter } = require("../API/debate/matchPromptsRoutes");
        // typed debates — round clock, answers, threaded comments, engagement
        const { router: matchResponsesRouter } = require("../API/debate/matchResponsesRoutes");
        // typed debates read as a message app — conversation list + auto ballots
        const { router: matchConversationsRouter } = require("../API/debate/matchConversationsRoutes");
        const { router: debateVotesRouter } = require("../API/debate/debateVotesRoutes");
        // bracket-match crowd voting — the vote screen a host puts up mid-debate
        const { router: debateMatchesRouter } = require("../API/debate/debateMatchesRoutes");
        const { router: rankedVotesRouter } = require("../API/debate/rankedVotesRoutes");
        const { router: criteriaAcksRouter } = require("../API/debate/criteriaAcksRoutes");
        // §6/§9 debate lifecycle + results
        const { router: debatesRouter } = require("../API/debate/debatesRoutes");
        // sponsor-facing debate submission + the admin review inbox
        const { router: debateApplicationsRouter } = require("../API/debate/debateApplicationsRoutes");
        const { router: debateResultsRouter } = require("../API/debate/debateResultsRoutes");
        const { router: contestWinnersRouter } = require("../API/debate/contestWinnersRoutes");
        const { router: contestRegistrationsRouter } = require("../API/debate/contestRegistrationsRoutes");
        // §8 social: nominations, recommendations, posts, endorsements
        const { router: nominationsRouter } = require("../API/debate/nominationsRoutes");
        const { router: wouldbeRecommendationsRouter } = require("../API/candidacy/wouldbeRecommendationsRoutes");
        const { router: postsRouter } = require("../API/content/postsRoutes");
        const { router: postEndorsementsRouter } = require("../API/content/postEndorsementsRoutes");
        const { router: commentsRouter } = require("../API/content/commentsRoutes");
        // §11 trust & safety
        const { router: userReportsRouter } = require("../API/platform/userReportsRoutes");
        const { router: reviewsRouter } = require("../API/platform/reviewsRoutes");
        const { router: userStrikesRouter } = require("../API/platform/userStrikesRoutes");
        const { router: accountActionsRouter } = require("../API/platform/accountActionsRoutes");
        const { router: coordinatedBehaviorRouter } = require("../API/platform/coordinatedBehaviorRoutes");
        const { router: rateLimitRouter } = require("../API/platform/rateLimitRoutes");
        // §12 messaging
        const { router: conversationsRouter } = require("../API/platform/conversationsRoutes");
        const { router: messagesRouter } = require("../API/platform/messagesRoutes");
        // §14 financial audit + tax
        const { router: financialAuditRouter } = require("../API/platform/financialAuditRoutes");
        const { router: taxRecordsRouter } = require("../API/platform/taxRecordsRoutes");
        // §15 admin actions query + system jobs
        const { router: adminActionsRouter } = require("../API/platform/adminActionsRoutes");
        const { router: systemJobsRouter } = require("../API/platform/systemJobsRoutes");
        // §17 notifications
        const { router: notificationCriteriaRouter } = require("../API/platform/notificationCriteriaRoutes");
        const { router: notificationsRouter } = require("../API/platform/notificationsRoutes");
        // §10 moderation (records/queues/appeals/dmca — vendor callbacks still stubbed)
        const { router: contentItemsRouter } = require("../API/platform/contentItemsRoutes");
        const { router: avatarRouter } = require("../API/platform/avatarRoutes");
        const { router: moderationEventsRouter } = require("../API/platform/moderationEventsRoutes");
        const { router: moderationQueueRouter } = require("../API/platform/moderationQueueRoutes");
        const { router: moderationAppealsRouter } = require("../API/platform/moderationAppealsRoutes");
        const { router: dmcaRouter } = require("../API/platform/dmcaRoutes");
        // §13 payments + §9 prize pool/payouts + DU sponsor payouts (Stripe — adapter-stubbed)
        const { router: tipsRouter } = require("../API/payments/tipsRoutes");
        const { router: postPaymentsRouter } = require("../API/payments/postPaymentsRoutes");
        const { router: subscriptionsRouter } = require("../API/payments/subscriptionsRoutes");
        const { router: stripeWebhookRouter } = require("../API/payments/stripeWebhookRoutes");
        const { router: debatePaymentsRouter } = require("../API/payments/debatePaymentsRoutes");
        const { router: prizePoolRouter } = require("../API/payments/prizePoolRoutes");
        const { router: payoutAccountsRouter } = require("../API/payments/payoutAccountsRoutes");
        const { router: debatePayoutsRouter } = require("../API/payments/debatePayoutsRoutes");
        // Debate-Update livestream layer (Twitch/R2 — adapter-stubbed)
        const { router: twitchRouter } = require("../API/debate/twitchRoutes");
        const { router: debateStreamsRouter } = require("../API/debate/debateStreamsRoutes");
        // Seeding day — the sponsor's bracket + prompt assignment, and the lock.
        const { router: debateSeedingRouter } = require("../API/debate/debateSeedingRoutes");
        // Standing arrows: the trophy case, the open-response gate, the backdoor.
        const { router: trophiesRouter } = require("../API/debate/trophiesRoutes");
        app.use("/api/auth", authRouter);
        app.use("/api/users", userRouter);
        app.use("/api", consentRouter);
        app.use("/api", legalRouter);
        app.use("/api", attestationRouter);
        app.use("/api", childSafetyRouter);
        app.use("/api", adminRouter);
        app.use("/api", jurisdictionsRouter);
        app.use("/api", officesRouter);
        app.use("/api", politiciansRouter);
        app.use("/api", racesRouter);
        app.use("/api", electionDeadlinesRouter);
        app.use("/api", electionCalendarRouter);
        app.use("/api", filingAuthoritiesRouter);
        app.use("/api", userJurisdictionsRouter);
        app.use("/api", dataRightsRouter);
        app.use("/api", dataRetentionsRouter);
        app.use("/api", piiAccessRouter);
        app.use("/api", planTimelineRouter);
        app.use("/api", wouldbeRouter);
        app.use("/api", categoriesRouter);
        app.use("/api", interestsRouter);
        app.use("/api", tagsRouter);
        app.use("/api", changeReportsRouter);
        app.use("/api", stageProofsRouter);
        app.use("/api", rulesVersionsRouter);
        app.use("/api", candidateCommitteesRouter);
        app.use("/api", jurisdictionRulesRouter);
        app.use("/api", complianceChecksRouter);
        app.use("/api", testingTheWatersRouter);
        app.use("/api", fundraisingEligibilityRouter);
        app.use("/api", plansRouter);
        app.use("/api", goalsRouter);
        app.use("/api", pledgesRouter);
        app.use("/api", followsRouter);
        app.use("/api", userBlocksRouter);
        app.use("/api", sponsorsRouter);
        app.use("/api", debateRulesRouter);
        app.use("/api", debateCriteriaRouter);
        app.use("/api", categoryCriteriaRouter);
        app.use("/api", contestantsRouter);
        app.use("/api", debateJudgesRouter);
        app.use("/api", debateEntriesRouter);
        app.use("/api", promptsRouter);
        app.use("/api", matchPromptsRouter);
        app.use("/api", matchResponsesRouter);
        app.use("/api", matchConversationsRouter);
        app.use("/api", debateVotesRouter);
        app.use("/api", debateMatchesRouter);
        app.use("/api", rankedVotesRouter);
        app.use("/api", criteriaAcksRouter);
        app.use("/api", debateApplicationsRouter);
        app.use("/api", debatesRouter);
        app.use("/api", debateResultsRouter);
        app.use("/api", contestWinnersRouter);
        app.use("/api", contestRegistrationsRouter);
        app.use("/api", nominationsRouter);
        app.use("/api", wouldbeRecommendationsRouter);
        app.use("/api", postsRouter);
        app.use("/api", postEndorsementsRouter);
        app.use("/api", commentsRouter);
        app.use("/api", userReportsRouter);
        app.use("/api", reviewsRouter);
        app.use("/api", userStrikesRouter);
        app.use("/api", accountActionsRouter);
        app.use("/api", coordinatedBehaviorRouter);
        app.use("/api", rateLimitRouter);
        app.use("/api", conversationsRouter);
        app.use("/api", messagesRouter);
        app.use("/api", financialAuditRouter);
        app.use("/api", taxRecordsRouter);
        app.use("/api", adminActionsRouter);
        app.use("/api", systemJobsRouter);
        app.use("/api", notificationCriteriaRouter);
        app.use("/api", notificationsRouter);
        app.use("/api", contentItemsRouter);
        app.use("/api", avatarRouter);
        app.use("/api", moderationEventsRouter);
        app.use("/api", moderationQueueRouter);
        app.use("/api", moderationAppealsRouter);
        app.use("/api", dmcaRouter);
        app.use("/api", tipsRouter);
        app.use("/api", postPaymentsRouter);
        app.use("/api", subscriptionsRouter);
        app.use("/api", stripeWebhookRouter);
        app.use("/api", debatePaymentsRouter);
        app.use("/api", prizePoolRouter);
        app.use("/api", payoutAccountsRouter);
        app.use("/api", debatePayoutsRouter);
        app.use("/api", twitchRouter);
        app.use("/api", debateStreamsRouter);
        app.use("/api", debateSeedingRouter);
        app.use("/api", trophiesRouter);

        // Central JSON error handler (routes call next(err)).
        app.use((err, _req, res, _next) => {
            console.error(err);
            res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
        });

        app.listen(PORT, () => {
            console.log(`server alive on ${PORT}`);
        });
    } catch (err) {
        // EXIT NON-ZERO. This used to log and fall through, which left the
        // process alive with nothing listening — so the platform saw a healthy
        // container, showed it green, and every request came back 502 with no
        // indication of why. A crash is information; a silent half-start is not.
        console.error("\n\u2716 FATAL: the server could not start.\n");
        console.error(err);
        if (err && err.code) {
            console.error(`\n(error code ${err.code})`);
        }
        console.error(
            "\nIf this is a connection error, check DATABASE_URL. On Railway the private\n" +
            "hostname (*.railway.internal) only resolves from inside the project — use the\n" +
            "public URL if this service sits elsewhere.\n"
        );
        process.exit(1);
    }
};

init();
