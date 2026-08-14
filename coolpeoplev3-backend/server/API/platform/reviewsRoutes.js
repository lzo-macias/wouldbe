const express = require("express");

const { client } = require("../../DB/index");
const {
    upsertReview,
    listReviewsForUser,
    getReviewSummary,
    getReviewById,
    getMyReviewOf,
    deleteReview,
    setReviewStatus,
    listReportedReviews,
} = require("../../DB/platform/reviews");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");
const { findUserByToken } = require("../../DB/platform/auth");

const router = express.Router();

// ============================================================================
// Reviews: 1–5 stars + a description, left on a user's profile by any other user.
//
// Reporting deliberately reuses user_reports rather than adding a second queue —
// the category vocabulary, priority mapping, status workflow, false-report flag
// and admin triage list already exist there and none of it is review-specific.
// ============================================================================

// The reported_review_id column and the widened target CHECK come from migration
// 1782600000000. fileUserReport() doesn't know about reviews, so the insert is
// done here rather than by widening that helper's signature for one caller.
const REPORT_CATEGORIES = [
    "harassment", "hate_speech", "threats", "csam", "dmca_violation",
    "impersonation", "spam", "doxxing", "election_misinformation", "other",
];
const CATEGORY_PRIORITY = { csam: 1, threats: 1, doxxing: 2, harassment: 2, hate_speech: 2 };

// GET /api/users/:userId/reviews — the public profile feed + summary.
//
// Auth is OPTIONAL and only widens the result: the AUTHOR of a hidden review sees
// their own, so a moderated review doesn't just vanish without explanation. A bad
// token is treated as logged-out, since the public view is still a valid answer.
router.get("/users/:userId/reviews", async (req, res, next) => {
    try {
        let viewerId = null;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization);
                viewerId = viewer?.id ?? null;
            } catch { viewerId = null; }
        }

        const [reviews, summary] = await Promise.all([
            listReviewsForUser({
                reviewed_user_id: req.params.userId,
                limit: req.query.limit,
                offset: req.query.offset,
            }),
            getReviewSummary({ reviewed_user_id: req.params.userId }),
        ]);

        // The caller's own review, even if hidden — surfaced separately rather
        // than mixed into the public list so it can't leak to anyone else.
        let my_review = null;
        if (viewerId && viewerId !== req.params.userId) {
            my_review = await getMyReviewOf({
                reviewer_user_id: viewerId,
                reviewed_user_id: req.params.userId,
            });
        }

        return res.json({ ...summary, reviews, my_review });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/users/:userId/reviews — leave (or replace) a review.
// Body: { rating, body }. reviewer_user_id comes from the TOKEN, never the body.
//
// Upsert, not insert: one review per pair is DB-enforced, so a second submit
// edits rather than 409ing. Self-review is rejected by both the code and a CHECK.
router.post("/users/:userId/reviews", requireAuth, async (req, res, next) => {
    try {
        const review = await upsertReview({
            reviewer_user_id: req.user.id,
            reviewed_user_id: req.params.userId,
            rating: req.body?.rating,
            body: req.body?.body,
        });
        return res.status(201).json(review);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/reviews/:id — one review. Declared before nothing ambiguous, but kept
// above the admin routes for readability.
router.get("/reviews/:id", async (req, res, next) => {
    try {
        const review = await getReviewById({ id: req.params.id });
        if (!review) return res.status(404).json({ error: "review not found" });
        if (review.status !== "visible") return res.status(404).json({ error: "review not found" });
        return res.json(review);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// DELETE /api/reviews/:id — the AUTHOR withdraws their own review.
// Owner-scoped in the SQL as well as here, so a mistake in one gate isn't enough.
router.delete("/reviews/:id", requireAuth, async (req, res, next) => {
    try {
        const gone = await deleteReview({ id: req.params.id, reviewer_user_id: req.user.id });
        if (!gone) return res.status(404).json({ error: "review not found, or not yours" });
        return res.json({ deleted: gone.id });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/reviews/:id/report — report a review, with text saying why.
// Body: { report_category, description }.
//
// Files into user_reports so it lands in the SAME triage queue as every other
// report. Blocks reporting your own review — the delete route is how you remove
// that. The partial unique index stops one person filing repeatedly against the
// same review while an earlier report is still open.
router.post("/reviews/:id/report", requireAuth, async (req, res, next) => {
    try {
        const review = await getReviewById({ id: req.params.id });
        if (!review) return res.status(404).json({ error: "review not found" });
        if (review.reviewer_user_id === req.user.id) {
            return res.status(400).json({ error: "you cannot report your own review" });
        }

        const category = String(req.body?.report_category || "other");
        if (!REPORT_CATEGORIES.includes(category)) {
            return res.status(400).json({ error: `report_category must be one of: ${REPORT_CATEGORIES.join(", ")}` });
        }
        // The whole point of the feature: say WHY it should come down.
        const description = String(req.body?.description || "").trim();
        if (!description) {
            return res.status(400).json({ error: "description is required — tell us why this review should be removed" });
        }
        if (description.length > 5000) {
            return res.status(400).json({ error: "description must be 5000 characters or fewer" });
        }

        const { rows } = await client.query(
            `INSERT INTO user_reports
               (reporter_user_id, reported_review_id, reported_user_id,
                report_category, description, priority)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING *`,
            [
                req.user.id,
                review.id,
                // Also record WHO wrote it, so a pattern of abusive reviews from
                // one account is visible in the queue without a join.
                review.reviewer_user_id,
                category,
                description,
                CATEGORY_PRIORITY[category] ?? null,
            ]
        );
        return res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ error: "you already have an open report on this review" });
        }
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/admin/reported-reviews?status=pending|under_review|resolved|all
// The moderation queue: each open report alongside the review text it targets.
router.get("/admin/reported-reviews", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await listReportedReviews({ status: req.query.status, limit: req.query.limit }));
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/reviews/:id/status — hide, remove, or restore a review.
// Body: { status, removed_reason? }. Admin only: a reviewer must never be able to
// un-hide their own review, which is why status isn't accepted anywhere else.
router.post(
    "/admin/reviews/:id/status",
    requireAuth,
    requireAdmin(),
    recordAdminAction("set_review_status", { resourceType: "review" }),
    async (req, res, next) => {
        try {
            return res.json(
                await setReviewStatus({
                    id: req.params.id,
                    status: req.body?.status,
                    removed_reason: req.body?.removed_reason ?? null,
                    admin_user_id: req.user.id,
                })
            );
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            next(err);
        }
    }
);

module.exports = { router };
