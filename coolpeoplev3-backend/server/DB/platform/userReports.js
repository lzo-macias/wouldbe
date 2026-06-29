const { client } = require("../index.js");

// ============================================================================
// user_reports — community reporting (Trust & Safety pillar). A user reports
// either a content item OR another user for a category of violation. Admins
// triage the queue, resolve reports, and can flag a report as FALSE to defend
// against weaponized/abusive reporting.
//
// Mirrors the migration CHECKs exactly:
//   report_category ∈ harassment|hate_speech|threats|csam|dmca_violation|
//                     impersonation|spam|doxxing|election_misinformation|other
//   status          ∈ pending|under_review|resolved|dismissed|escalated
//   table CHECK     : reported_content_id IS NOT NULL OR reported_user_id IS NOT NULL
// ============================================================================

// Valid violation categories (mirrors the table CHECK).
const REPORT_CATEGORIES = [
    "harassment", "hate_speech", "threats", "csam", "dmca_violation",
    "impersonation", "spam", "doxxing", "election_misinformation", "other",
];
// Full lifecycle (the table CHECK). 'pending' is the initial state.
const REPORT_STATUSES = ["pending", "under_review", "resolved", "dismissed", "escalated"];
// Statuses a resolver may move a report INTO (not back to pending).
const RESOLVE_STATUSES = ["under_review", "resolved", "dismissed", "escalated"];

// Default triage priority by category (lower = more urgent). csam/threats first.
const CATEGORY_PRIORITY = {
    csam: 1, threats: 1, doxxing: 2, hate_speech: 2, harassment: 3,
    election_misinformation: 3, impersonation: 4, dmca_violation: 4,
    spam: 5, other: 5,
};

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// fileUserReport(...) — the submit writer. reporter_user_id ALWAYS comes from
// the caller's token (never the body). Exactly one of reported_content_id /
// reported_user_id must be set; a user cannot report themselves.
const fileUserReport = async ({
    reporter_user_id,
    reported_content_id = null,
    reported_user_id = null,
    report_category,
    description = null,
    evidence_urls = null,
}) => {
    if (!reporter_user_id) throw httpError(401, "authentication required to file a report");
    if (!REPORT_CATEGORIES.includes(report_category)) {
        throw httpError(400, `report_category must be one of: ${REPORT_CATEGORIES.join(", ")}`);
    }
    if (!reported_content_id && !reported_user_id) {
        throw httpError(400, "must report either reported_content_id or reported_user_id");
    }
    if (reported_user_id && reported_user_id === reporter_user_id) {
        throw httpError(400, "you cannot report yourself");
    }

    const priority = CATEGORY_PRIORITY[report_category] ?? null;
    try {
        const { rows } = await client.query(
            `INSERT INTO user_reports
               (reporter_user_id, reported_content_id, reported_user_id,
                report_category, description, evidence_urls, priority)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
                reporter_user_id, reported_content_id, reported_user_id,
                report_category, description,
                evidence_urls ? JSON.stringify(evidence_urls) : null,
                priority,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "duplicate report");
        if (err.code === "23503") throw httpError(400, "reported user or content does not exist");
        if (err.code === "23514") throw httpError(400, "report violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listUserReports(filters) — the admin triage queue. All filters optional.
// Sorted by priority (most urgent first), then newest.
const listUserReports = async ({
    status = null,
    report_category = null,
    reported_user_id = null,
    false_report_flag = null,
    limit = 100,
} = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT r.*,
                    reporter.username AS reporter_username,
                    reported.username AS reported_username
             FROM user_reports r
             LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
             LEFT JOIN users reported ON reported.id = r.reported_user_id
             WHERE ($1::text IS NULL OR r.status = $1)
               AND ($2::text IS NULL OR r.report_category = $2)
               AND ($3::uuid IS NULL OR r.reported_user_id = $3)
               AND ($4::boolean IS NULL OR r.false_report_flag = $4)
             ORDER BY r.priority ASC NULLS LAST, r.created_at DESC
             LIMIT $5`,
            [
                status, report_category, reported_user_id, false_report_flag,
                Math.min(Number(limit) || 100, 500),
            ]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "a filter value is malformed");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listReportsByReporter(...) — a caller viewing their OWN filed reports.
// reporter_user_id comes from the token; never trust a body/query value here.
const listReportsByReporter = async ({ reporter_user_id, limit = 100 }) => {
    if (!reporter_user_id) throw httpError(401, "authentication required");
    try {
        const { rows } = await client.query(
            `SELECT r.*, reported.username AS reported_username
             FROM user_reports r
             LEFT JOIN users reported ON reported.id = r.reported_user_id
             WHERE r.reporter_user_id = $1
             ORDER BY r.created_at DESC
             LIMIT $2`,
            [reporter_user_id, Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// resolveUserReport(...) — an admin moves a report to a terminal/triage state and
// records the outcome. Stamps resolved_at for the terminal states.
const resolveUserReport = async ({ id, status, resolution = null }) => {
    if (!RESOLVE_STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${RESOLVE_STATUSES.join(", ")}`);
    }
    // 'resolved'/'dismissed' are terminal — stamp the time they closed.
    const terminal = status === "resolved" || status === "dismissed";
    try {
        const { rows } = await client.query(
            `UPDATE user_reports SET
                status      = $2,
                resolution  = COALESCE($3, resolution),
                resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END
             WHERE id = $1
             RETURNING *`,
            [id, status, resolution, terminal]
        );
        if (!rows.length) throw httpError(404, "no report with that id");
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "invalid status value");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// markReportFalse(...) — an admin flags a report as abusive/false. This both
// dismisses it and sets the false_report_flag (used to spot serial false
// reporters). Idempotent: re-flagging a flagged report is a no-op result.
const markReportFalse = async ({ id, resolution = null }) => {
    try {
        const { rows } = await client.query(
            `UPDATE user_reports SET
                false_report_flag = true,
                status            = 'dismissed',
                resolution        = COALESCE($2, resolution),
                resolved_at       = COALESCE(resolved_at, now())
             WHERE id = $1
             RETURNING *`,
            [id, resolution]
        );
        if (!rows.length) throw httpError(404, "no report with that id");
        return rows[0];
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    REPORT_CATEGORIES,
    REPORT_STATUSES,
    RESOLVE_STATUSES,
    fileUserReport,
    listUserReports,
    listReportsByReporter,
    resolveUserReport,
    markReportFalse,
};
