const { client } = require("../index.js");

// ============================================================================
// reviews — 1–5 stars + a description, left BY one user ON another's profile.
//
// SECURITY MODEL:
//  - reviewer_user_id ALWAYS comes from the token at the route layer, never the
//    body. Otherwise anyone could forge a review in someone else's name.
//  - status is NOT user-settable. A reviewer cannot mark their own review
//    'visible' after a moderator hid it; only setReviewStatus (admin) moves it.
//  - one review per (reviewer, reviewed) pair, DB-enforced. Editing replaces,
//    it doesn't stack — ten reviews from one person must not outweigh ten people.
//  - self-reviews are blocked by a CHECK, so no code path can create one.
//
// Only 'visible' rows are returned publicly or counted in the average, so a
// removal silently corrects the score as well as hiding the text.
// ============================================================================

const STATUSES = ["visible", "under_review", "removed"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Explicit projection + the reviewer's public identity, so a profile can render
// "who said this" without a second request per row. Deliberately NOT selecting
// the reviewer's email or anything else private.
const REVIEW_COLS = `
    r.id, r.reviewer_user_id, r.reviewed_user_id, r.rating, r.body, r.status,
    r.edited_at, r.created_at, r.updated_at,
    u.username        AS reviewer_username,
    u.first_name      AS reviewer_first_name,
    u.last_name       AS reviewer_last_name,
    u.profile_photo_url AS reviewer_photo_url
`;

const validate = ({ rating, body }) => {
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw httpError(400, "rating must be a whole number from 1 to 5");
    }
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) throw httpError(400, "body is required");
    if (text.length > 5000) throw httpError(400, "body must be 5000 characters or fewer");
    return { rating: n, body: text };
};

// upsertReview — create, or replace the caller's existing review of this person.
//
// ON CONFLICT rather than a read-then-write: two rapid submits would otherwise
// race past a "have they already reviewed?" check and one would die on the unique
// index. The upsert makes a double-submit idempotent instead of an error.
//
// A re-review resets status to 'visible': the moderated text no longer exists, so
// carrying its 'removed' flag forward would punish content nobody has seen. It
// also stamps edited_at so the UI can mark it.
const upsertReview = async ({ reviewer_user_id, reviewed_user_id, rating, body }) => {
    if (!reviewer_user_id) throw httpError(401, "authentication required");
    if (!reviewed_user_id) throw httpError(400, "reviewed_user_id is required");
    if (reviewer_user_id === reviewed_user_id) throw httpError(400, "you cannot review yourself");
    const clean = validate({ rating, body });

    try {
        const { rows } = await client.query(
            `INSERT INTO reviews (reviewer_user_id, reviewed_user_id, rating, body)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (reviewer_user_id, reviewed_user_id) DO UPDATE
                SET rating     = EXCLUDED.rating,
                    body       = EXCLUDED.body,
                    status     = 'visible',
                    edited_at  = now(),
                    updated_at = now()
             RETURNING *`,
            [reviewer_user_id, reviewed_user_id, clean.rating, clean.body]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(404, "that user does not exist");
        if (err.code === "23514") throw httpError(400, "review violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listReviewsForUser — the profile feed. Public: visible rows only.
//
// includeHidden is for the AUTHOR looking at their own review and for admins —
// someone whose review was pulled should be able to see that, rather than have it
// vanish silently.
const listReviewsForUser = async ({ reviewed_user_id, limit = 50, offset = 0, includeHidden = false }) => {
    if (!reviewed_user_id) throw httpError(400, "reviewed_user_id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${REVIEW_COLS}
               FROM reviews r
               JOIN users u ON u.id = r.reviewer_user_id
              WHERE r.reviewed_user_id = $1
                AND ($4::boolean OR r.status = 'visible')
              ORDER BY r.created_at DESC
              LIMIT $2 OFFSET $3`,
            [reviewed_user_id, Math.min(Number(limit) || 50, 200), Number(offset) || 0, includeHidden]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "reviewed_user_id must be a valid uuid");
        throw err;
    }
};

// getReviewSummary — average + count + star distribution, for the header.
//
// Computed on read rather than cached on users: a stored average is wrong the
// moment a review is removed, and removals are exactly when accuracy matters.
// Only 'visible' rows count, so hiding a review corrects the score automatically.
//
// AVG returns numeric (a string over the wire); rounded to one decimal here so
// every caller doesn't have to remember to.
const getReviewSummary = async ({ reviewed_user_id }) => {
    if (!reviewed_user_id) throw httpError(400, "reviewed_user_id is required");
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS review_count,
                ROUND(AVG(rating)::numeric, 1)::float8 AS average_rating,
                COUNT(*) FILTER (WHERE rating = 5)::int AS five_star,
                COUNT(*) FILTER (WHERE rating = 4)::int AS four_star,
                COUNT(*) FILTER (WHERE rating = 3)::int AS three_star,
                COUNT(*) FILTER (WHERE rating = 2)::int AS two_star,
                COUNT(*) FILTER (WHERE rating = 1)::int AS one_star
           FROM reviews
          WHERE reviewed_user_id = $1 AND status = 'visible'`,
        [reviewed_user_id]
    );
    // No reviews -> average_rating is null, NOT 0. A 0 would render as a
    // zero-star rating, which is a claim we haven't earned.
    return rows[0];
};

const getReviewById = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${REVIEW_COLS} FROM reviews r JOIN users u ON u.id = r.reviewer_user_id
              WHERE r.id = $1`,
            [id]
        );
        return rows[0] || null;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        throw err;
    }
};

// getMyReviewOf — "have I already reviewed this person?", so the UI can open the
// form pre-filled for editing instead of offering a duplicate it would reject.
const getMyReviewOf = async ({ reviewer_user_id, reviewed_user_id }) => {
    const { rows } = await client.query(
        `SELECT * FROM reviews WHERE reviewer_user_id = $1 AND reviewed_user_id = $2`,
        [reviewer_user_id, reviewed_user_id]
    );
    return rows[0] || null;
};

// deleteReview — the AUTHOR withdrawing their own review. Owner-scoped in the
// WHERE clause, not just at the route, so a wrong caller deletes nothing rather
// than trusting one gate.
const deleteReview = async ({ id, reviewer_user_id }) => {
    const { rows } = await client.query(
        `DELETE FROM reviews WHERE id = $1 AND reviewer_user_id = $2 RETURNING id`,
        [id, reviewer_user_id]
    );
    return rows[0] || null;
};

// setReviewStatus — ADMIN ONLY. Hide during a dispute, remove for a violation, or
// restore. Users can never reach this; a reviewer must not be able to un-hide
// their own review.
const setReviewStatus = async ({ id, status, removed_reason = null, admin_user_id = null }) => {
    if (!STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${STATUSES.join(", ")}`);
    }
    const { rows } = await client.query(
        `UPDATE reviews
            SET status = $2,
                removed_at         = CASE WHEN $2 = 'removed' THEN now() ELSE NULL END,
                removed_reason     = CASE WHEN $2 = 'removed' THEN $3 ELSE NULL END,
                removed_by_user_id = CASE WHEN $2 = 'removed' THEN $4 ELSE NULL END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, status, removed_reason, admin_user_id]
    );
    if (!rows.length) throw httpError(404, "review not found");
    return rows[0];
};

// listReportedReviews — the moderation queue, review-shaped: the review text and
// its author alongside every open report against it, so a moderator can judge
// without opening two screens.
const listReportedReviews = async ({ status = "pending", limit = 100 }) => {
    const { rows } = await client.query(
        `SELECT rep.id            AS report_id,
                rep.report_category, rep.description AS report_description,
                rep.status         AS report_status,
                rep.priority, rep.created_at AS reported_at,
                rep.reporter_user_id,
                r.id               AS review_id,
                r.rating, r.body, r.status AS review_status,
                r.reviewer_user_id, r.reviewed_user_id,
                ru.username        AS reviewer_username,
                tu.username        AS reviewed_username
           FROM user_reports rep
           JOIN reviews r  ON r.id  = rep.reported_review_id
           JOIN users   ru ON ru.id = r.reviewer_user_id
           JOIN users   tu ON tu.id = r.reviewed_user_id
          WHERE rep.reported_review_id IS NOT NULL
            AND ($1::text IS NULL OR rep.status = $1)
          ORDER BY rep.priority NULLS LAST, rep.created_at ASC
          LIMIT $2`,
        [status === "all" ? null : status, Math.min(Number(limit) || 100, 500)]
    );
    return rows;
};

module.exports = {
    STATUSES,
    upsertReview,
    listReviewsForUser,
    getReviewSummary,
    getReviewById,
    getMyReviewOf,
    deleteReview,
    setReviewStatus,
    listReportedReviews,
};
