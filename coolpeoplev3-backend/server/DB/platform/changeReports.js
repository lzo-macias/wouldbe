const { client } = require("../index.js");

// ============================================================================
// change_reports — the "this is wrong" queue. Users (even unauthenticated
// viewers) flag a reference-data row (a deadline, filing authority, eligibility,
// etc.) with what's wrong + a proposed value + a source link; an admin reviews
// and, after verifying against the cited source, applies the fix and marks the
// report resolved. Reports target REFERENCE data only — never a user's pledge.
// ============================================================================

// What a report can be about (mirrors the table CHECK).
const ALLOWED_TARGETS = [
    "election_deadline", "filing_authority", "deadline_offset_rule",
    "office_eligibility", "office_recommended_goal", "other",
];
// Statuses an admin may MOVE a report to ('pending' is the initial state).
const REVIEW_STATUSES = ["under_review", "verified_applied", "rejected", "duplicate"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createReport(...) — the submit handler's writer. reporter_user_id is null for
// anonymous reports. description is required; target_type must be in the set.
const createReport = async ({
    reporter_user_id = null,
    target_type,
    target_id = null,
    field_name = null,
    current_value = null,
    proposed_value = null,
    source_url = null,
    description,
}) => {
    if (!ALLOWED_TARGETS.includes(target_type)) {
        throw httpError(400, `target_type must be one of: ${ALLOWED_TARGETS.join(", ")}`);
    }
    if (!description || !String(description).trim()) {
        throw httpError(400, "description is required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO change_reports
               (reporter_user_id, target_type, target_id, field_name,
                current_value, proposed_value, source_url, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [reporter_user_id, target_type, target_id, field_name,
             current_value, proposed_value, source_url, description]
        );
        return rows[0];
    } catch (err) {
        // malformed target_id uuid, etc.
        if (err.code === "22P02") throw httpError(400, "target_id must be a valid uuid");
        console.error(err);
        throw err;
    }
};

// listReports(filters) — the admin queue. All filters optional; omit status to
// see everything. Newest first.
const listReports = async ({ status = null, target_type = null, target_id = null, limit = 100 } = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT cr.*, u.username AS reporter_username
             FROM change_reports cr
             LEFT JOIN users u ON u.id = cr.reporter_user_id
             WHERE ($1::text IS NULL OR cr.status = $1)
               AND ($2::text IS NULL OR cr.target_type = $2)
               AND ($3::uuid IS NULL OR cr.target_id = $3)
             ORDER BY cr.created_at DESC
             LIMIT $4`,
            [status, target_type, target_id, Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// reviewReport(...) — an admin moves a report through the lifecycle. Stamps
// reviewer + reviewed_at; sets applied_at when the fix was actually written.
// NOTE: this records the DECISION; applying the corrected value to the live
// reference row is done via that row's own admin edit route, then marked here.
const reviewReport = async ({ id, status, reviewed_by_user_id, resolution_notes = null }) => {
    if (!REVIEW_STATUSES.includes(status)) {
        throw httpError(400, `status must be one of: ${REVIEW_STATUSES.join(", ")}`);
    }
    const applied = status === "verified_applied";
    try {
        const { rows } = await client.query(
            `UPDATE change_reports SET
                status              = $2,
                reviewed_by_user_id = $3,
                reviewed_at         = now(),
                resolution_notes    = COALESCE($4, resolution_notes),
                applied_at          = CASE WHEN $5 THEN now() ELSE applied_at END
             WHERE id = $1
             RETURNING *`,
            [id, status, reviewed_by_user_id, resolution_notes, applied]
        );
        if (!rows.length) throw httpError(404, "no change report with that id");
        return rows[0];
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = { ALLOWED_TARGETS, createReport, listReports, reviewReport };
