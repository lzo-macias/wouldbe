const { client, withTransaction } = require("../index.js");

// ============================================================================
// dmca_takedowns — DMCA safe-harbor takedown processing (§10 DMCA).
//
// WHY: DMCA safe harbor requires good-faith takedown processing, a counter-
// notice path, and a repeat-infringer policy. This file is the data layer for
// the notice lifecycle.
//
// Mirrors the migration columns/CHECK exactly (dmca_takedowns):
//   claimant_name/email/address  text NOT NULL   (claimant identity/contact)
//   claimed_work                 text NOT NULL   (work allegedly infringed)
//   affected_content_item_id     uuid -> content_items(id)
//   sworn_statement              text NOT NULL   (DMCA good-faith statement)
//   received_at                  timestamptz NOT NULL
//   action_taken                 text CHECK IN
//       ('content_removed','counter_notice_received','restored','no_action')
//   action_taken_at              timestamptz
//   counter_notice_id            uuid            (no FK; marks a counter exists)
//   restoration_date             timestamptz
//   created_at                   timestamptz NOT NULL default now()
//
// IMPORTANT — there is NO filer/reporter user column on dmca_takedowns and no
// FK to users. Real DMCA notices come from rights holders who may not be
// platform users, so the claimant is captured entirely from the body
// (name/email/address). The req.user.id of the authenticated submitter is NOT
// persisted on this table (nowhere to put it); the route still gates on auth.
//
// COUNTER-NOTICES: the schema has no separate counter-notices table —
// counter_notice_id is a bare uuid column. We therefore model "a counter-notice
// was filed" by stamping action_taken='counter_notice_received' and generating a
// uuid into counter_notice_id (a marker/handle, not an FK row).
//
// CONTENT STATUS: actOnDMCA(action='content_removed') and restoreAfterCounter
// also flip the affected content_items row's moderation_status. There is no
// ./contentItems setModerationStatus helper in this codebase, so to avoid an
// import cycle we update the content_items row DIRECTLY inside the same
// transaction (documented). content_items.moderation_status CHECK includes
// 'removed' and 'approved'; removed_reason CHECK includes 'dmca'.
// ============================================================================

// Valid action_taken values (mirrors the table CHECK).
const DMCA_ACTIONS = [
    "content_removed",
    "counter_notice_received",
    "restored",
    "no_action",
];
// Actions an admin may take via actOnDMCA (counter_notice_received is set by the
// counter-notice path; restored is set by restoreAfterCounter).
const ADMIN_ACTIONS = ["content_removed", "no_action"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

const mapDbError = (err) => {
    if (err.code === "23505") return httpError(409, "duplicate dmca record");
    if (err.code === "23503") return httpError(400, "affected content item does not exist");
    if (err.code === "23514") return httpError(400, "value violates a database constraint");
    if (err.code === "22P02") return httpError(400, "an id field must be a valid uuid");
    return null;
};

// ---- writes ----------------------------------------------------------------

// fileDMCANotice(...) — record a takedown notice against a content item. The
// claimant details come entirely from the body (rights holders may not be
// users). received_at defaults to now() if the caller does not supply it. No
// action is taken on the content yet (admins triage via actOnDMCA).
const fileDMCANotice = async ({
    claimant_name,
    claimant_email,
    claimant_address,
    claimed_work,
    affected_content_item_id = null,
    sworn_statement,
    received_at = null,
}) => {
    if (!claimant_name) throw httpError(400, "claimant_name is required");
    if (!claimant_email) throw httpError(400, "claimant_email is required");
    if (!claimant_address) throw httpError(400, "claimant_address is required");
    if (!claimed_work) throw httpError(400, "claimed_work is required");
    if (!sworn_statement) throw httpError(400, "sworn_statement is required");

    try {
        const { rows } = await client.query(
            `INSERT INTO dmca_takedowns
               (claimant_name, claimant_email, claimant_address, claimed_work,
                affected_content_item_id, sworn_statement, received_at)
             VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now()))
             RETURNING *`,
            [
                claimant_name, claimant_email, claimant_address, claimed_work,
                affected_content_item_id, sworn_statement, received_at,
            ]
        );
        return rows[0];
    } catch (err) {
        const mapped = mapDbError(err);
        if (mapped) throw mapped;
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listDMCANotices(filters) — admin triage queue. All filters optional. Joins the
// affected content item's uploader for context. Newest first.
const listDMCANotices = async ({
    action_taken = null,
    affected_content_item_id = null,
    pending_only = false,
    limit = 100,
} = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT d.*,
                    ci.user_id          AS content_owner_user_id,
                    ci.moderation_status AS content_moderation_status
             FROM dmca_takedowns d
             LEFT JOIN content_items ci ON ci.id = d.affected_content_item_id
             WHERE ($1::text IS NULL OR d.action_taken = $1)
               AND ($2::uuid IS NULL OR d.affected_content_item_id = $2)
               AND (NOT $3::boolean OR d.action_taken IS NULL)
             ORDER BY d.received_at DESC, d.created_at DESC
             LIMIT $4`,
            [
                action_taken,
                affected_content_item_id,
                !!pending_only,
                Math.min(Number(limit) || 100, 500),
            ]
        );
        return rows;
    } catch (err) {
        const mapped = mapDbError(err);
        if (mapped) throw mapped;
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// actOnDMCA(...) — an admin acts on a notice. action ∈ content_removed|no_action.
// content_removed flips the affected content_items row to moderation_status
// 'removed' with removed_reason 'dmca' IN THE SAME TRANSACTION (direct update —
// no setModerationStatus helper exists; importing ./contentItems would risk a
// cycle, so we update the row directly here, documented above). no_action just
// records the disposition.
const actOnDMCA = async ({ id, action }) => {
    if (!id) throw httpError(400, "id is required");
    if (!ADMIN_ACTIONS.includes(action)) {
        throw httpError(400, `action must be one of: ${ADMIN_ACTIONS.join(", ")}`);
    }

    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM dmca_takedowns WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const notice = cur.rows[0];
            if (!notice) throw httpError(404, "no dmca notice with that id");

            // Take the content down atomically with recording the action.
            if (action === "content_removed" && notice.affected_content_item_id) {
                await tx.query(
                    `UPDATE content_items
                        SET moderation_status = 'removed',
                            removed_reason    = 'dmca',
                            removed_at        = COALESCE(removed_at, now())
                      WHERE id = $1`,
                    [notice.affected_content_item_id]
                );
            }

            const { rows } = await tx.query(
                `UPDATE dmca_takedowns
                    SET action_taken    = $2,
                        action_taken_at = now()
                  WHERE id = $1
                  RETURNING *`,
                [id, action]
            );
            return rows[0];
        });
    } catch (err) {
        const mapped = mapDbError(err);
        if (mapped) throw mapped;
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// fileCounterNotice(...) — the affected uploader disputes the takedown. The
// filer (counter_filer_user_id) comes from req.user.id at the route, never the
// body. We only allow a counter once content has actually been removed.
//
// The schema has no counter-notices table; counter_notice_id is a bare uuid. We
// generate a marker uuid into it and set action_taken='counter_notice_received'.
// We verify the filer is the uploader of the affected content (so a stranger
// cannot file a counter on someone else's content).
const fileCounterNotice = async ({ id, counter_filer_user_id }) => {
    if (!id) throw httpError(400, "id is required");
    if (!counter_filer_user_id) throw httpError(401, "authentication required to file a counter-notice");

    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT d.*, ci.user_id AS content_owner_user_id
                 FROM dmca_takedowns d
                 LEFT JOIN content_items ci ON ci.id = d.affected_content_item_id
                 WHERE d.id = $1
                 FOR UPDATE OF d`,
                [id]
            );
            const notice = cur.rows[0];
            if (!notice) throw httpError(404, "no dmca notice with that id");
            if (notice.action_taken !== "content_removed") {
                throw httpError(409, "can only file a counter-notice after content has been removed");
            }
            if (notice.counter_notice_id) {
                throw httpError(409, "a counter-notice has already been filed");
            }
            // Only the uploader of the affected content may dispute it.
            if (notice.content_owner_user_id !== counter_filer_user_id) {
                throw httpError(403, "only the uploader of the affected content may file a counter-notice");
            }

            const { rows } = await tx.query(
                `UPDATE dmca_takedowns
                    SET counter_notice_id = uuid_generate_v4(),
                        action_taken      = 'counter_notice_received',
                        action_taken_at   = now()
                  WHERE id = $1
                  RETURNING *`,
                [id]
            );
            return rows[0];
        });
    } catch (err) {
        const mapped = mapDbError(err);
        if (mapped) throw mapped;
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// restoreAfterCounter(...) — an admin restores the content after a valid
// counter-notice. Flips the affected content_items row back to 'approved' and
// clears removed_reason/removed_at, atomically with stamping the notice as
// 'restored' + restoration_date.
const restoreAfterCounter = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");

    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT * FROM dmca_takedowns WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const notice = cur.rows[0];
            if (!notice) throw httpError(404, "no dmca notice with that id");
            if (!notice.counter_notice_id || notice.action_taken !== "counter_notice_received") {
                throw httpError(409, "can only restore after a counter-notice has been received");
            }

            if (notice.affected_content_item_id) {
                await tx.query(
                    `UPDATE content_items
                        SET moderation_status = 'approved',
                            removed_reason    = NULL,
                            removed_at        = NULL
                      WHERE id = $1`,
                    [notice.affected_content_item_id]
                );
            }

            const { rows } = await tx.query(
                `UPDATE dmca_takedowns
                    SET action_taken     = 'restored',
                        action_taken_at  = now(),
                        restoration_date = now()
                  WHERE id = $1
                  RETURNING *`,
                [id]
            );
            return rows[0];
        });
    } catch (err) {
        const mapped = mapDbError(err);
        if (mapped) throw mapped;
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

module.exports = {
    DMCA_ACTIONS,
    ADMIN_ACTIONS,
    fileDMCANotice,
    listDMCANotices,
    actOnDMCA,
    fileCounterNotice,
    restoreAfterCounter,
};
