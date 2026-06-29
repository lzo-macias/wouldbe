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
app.use(express.json());

const init = async () => {
    try {
        // Fail fast at startup if the DB is unreachable (Pool connects lazily).
        await pool.query("SELECT 1");
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
        const { router: contestantsRouter } = require("../API/debate/contestantsRoutes");
        const { router: debateJudgesRouter } = require("../API/debate/debateJudgesRoutes");
        // §7 — debate entry, prompts, voting, ranked choice, criteria acks
        const { router: debateEntriesRouter } = require("../API/debate/debateEntriesRoutes");
        const { router: promptsRouter } = require("../API/debate/promptsRoutes");
        const { router: debateVotesRouter } = require("../API/debate/debateVotesRoutes");
        const { router: rankedVotesRouter } = require("../API/debate/rankedVotesRoutes");
        const { router: criteriaAcksRouter } = require("../API/debate/criteriaAcksRoutes");
        // §6/§9 debate lifecycle + results
        const { router: debatesRouter } = require("../API/debate/debatesRoutes");
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
        app.use("/api", contestantsRouter);
        app.use("/api", debateJudgesRouter);
        app.use("/api", debateEntriesRouter);
        app.use("/api", promptsRouter);
        app.use("/api", debateVotesRouter);
        app.use("/api", rankedVotesRouter);
        app.use("/api", criteriaAcksRouter);
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

        // Central JSON error handler (routes call next(err)).
        app.use((err, _req, res, _next) => {
            console.error(err);
            res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
        });

        app.listen(PORT, () => {
            console.log(`server alive on ${PORT}`);
        });
    } catch (err) {
        console.log(err);
    }
};

init();
