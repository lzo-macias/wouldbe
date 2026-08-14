const { client, withTransaction } = require("../index.js");

// tiny helper so routes can map thrown errors to status codes
const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// ============================================================================
// content_items — unified registry for ALL moderatable uploads/content. One row
// per moderatable artifact; the moderation pipeline watches this single surface.
//
// SECURITY MODEL:
//  - A user creates an upload-INTENT row (createPendingContentItem). The row is
//    born in moderation_status='pending_upload'. A user can NEVER set their own
//    moderation_status — that is a pipeline/admin-only field (no self-approve).
//  - upload-complete + visibility are OWNER-scoped (user_id must match).
//  - removeContentItem is admin/moderator soft-remove (status + removed_at).
//  - setModerationStatus is INTERNAL/admin only (the scan pipeline drives it),
//    and is composable (accepts db=client) so applyAutoDecision can call it
//    inside the same transaction as the moderation_events insert.
// ============================================================================

// enum vocabularies straight from the migration CHECK constraints.
const PARENT_TYPES = [
    "profile", "wouldbe_post", "debate_response", "comment",
    "review", "message", "prompt_response",
    // optional image attached to a plan-of-action position
    // (added with the CHECK in migration 1782300000000)
    "plan_component",
];
const CONTENT_TYPES = ["video", "image", "text", "audio"];
const MODERATION_STATUSES = [
    "pending_upload", "pending_moderation", "approved", "flagged",
    "rejected", "pending_human_review", "removed",
];
const VISIBILITIES = ["public", "unlisted", "private", "restricted"];
const AGE_RESTRICTIONS = ["all", "13plus", "18plus"];
const REMOVED_REASONS = [
    "csam", "dmca", "defamation", "harassment", "tos_violation",
    "user_request", "admin_action",
];

// Explicit projection so future sensitive columns aren't leaked by accident.
const COLS = `
    id, user_id, parent_type, parent_id, content_type,
    storage_url, text_content, thumbnail_url, duration_seconds,
    file_size_bytes, mime_type, moderation_status, visibility,
    age_restriction, created_at, published_at, removed_at, removed_reason
`;

// ---- reads -----------------------------------------------------------------

const getContentItemById = async ({ id }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `SELECT ${COLS} FROM content_items WHERE id = $1`,
            [id]
        );
        return rows[0] || null;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// getLatestProfileImage — the caller's most recent avatar upload, whatever state
// it's in. This is what the "pending review" badge polls: the user needs to know
// their photo is in the queue, and if it was rejected they need to be told rather
// than left staring at an avatar that silently never appeared.
const getLatestProfileImage = async ({ user_id }) => {
    if (!user_id) throw httpError(400, "user_id is required");
    const { rows } = await client.query(
        `SELECT ${COLS} FROM content_items
          WHERE user_id = $1 AND parent_type = 'profile' AND content_type = 'image'
          ORDER BY created_at DESC
          LIMIT 1`,
        [user_id]
    );
    return rows[0] || null;
};

// ---- mutations -------------------------------------------------------------

// createPendingContentItem — a user registers an upload-INTENT row. The file may
// not exist in storage yet; storage_url is optional here and gets stamped by
// markUploadComplete. moderation_status is NOT accepted from the caller — the row
// is born 'pending_upload' (no self-approve). user_id is the uploader (from the
// token at the route layer, never the body).
const createPendingContentItem = async ({
    user_id,
    parent_type,
    parent_id,
    content_type,
    storage_url = null,
    text_content = null,
    thumbnail_url = null,
    duration_seconds = null,
    file_size_bytes = null,
    mime_type = null,
    visibility = "private",
    age_restriction = null,
}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!parent_id) throw httpError(400, "parent_id is required");
    if (!PARENT_TYPES.includes(parent_type)) {
        throw httpError(400, `parent_type must be one of: ${PARENT_TYPES.join(", ")}`);
    }
    if (!CONTENT_TYPES.includes(content_type)) {
        throw httpError(400, `content_type must be one of: ${CONTENT_TYPES.join(", ")}`);
    }
    if (!VISIBILITIES.includes(visibility)) {
        throw httpError(400, `visibility must be one of: ${VISIBILITIES.join(", ")}`);
    }
    if (age_restriction !== null && !AGE_RESTRICTIONS.includes(age_restriction)) {
        throw httpError(400, `age_restriction must be one of: ${AGE_RESTRICTIONS.join(", ")}`);
    }

    try {
        const { rows } = await client.query(
            `INSERT INTO content_items
               (user_id, parent_type, parent_id, content_type, storage_url,
                text_content, thumbnail_url, duration_seconds, file_size_bytes,
                mime_type, visibility, age_restriction, moderation_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_upload')
             RETURNING ${COLS}`,
            [
                user_id, parent_type, parent_id, content_type, storage_url,
                text_content, thumbnail_url, duration_seconds, file_size_bytes,
                mime_type, visibility, age_restriction,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23505") throw httpError(409, "content item already exists");
        if (err.code === "23503") throw httpError(400, "user or parent does not exist");
        if (err.code === "23514") throw httpError(400, "content item violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// markUploadComplete — OWNER-scoped. Once the file has landed in storage, the
// owner flips the item out of 'pending_upload' into 'pending_moderation' so the
// scan pipeline can pick it up, and stamps the storage metadata. Still NOT a path
// to set moderation_status freely — we only advance pending_upload →
// pending_moderation. Returns null if the row doesn't exist or isn't the caller's.
const markUploadComplete = async ({
    id,
    user_id,
    storage_url = undefined,
    thumbnail_url = undefined,
    duration_seconds = undefined,
    file_size_bytes = undefined,
    mime_type = undefined,
}) => {
    if (!id) throw httpError(400, "id is required");
    if (!user_id) throw httpError(400, "user_id is required");

    try {
        const { rows } = await client.query(
            `UPDATE content_items
                SET storage_url     = COALESCE($3, storage_url),
                    thumbnail_url   = COALESCE($4, thumbnail_url),
                    duration_seconds = COALESCE($5, duration_seconds),
                    file_size_bytes = COALESCE($6, file_size_bytes),
                    mime_type       = COALESCE($7, mime_type),
                    moderation_status = 'pending_moderation'
              WHERE id = $1
                AND user_id = $2
                AND moderation_status = 'pending_upload'
              RETURNING ${COLS}`,
            [
                id, user_id,
                storage_url ?? null,
                thumbnail_url ?? null,
                duration_seconds ?? null,
                file_size_bytes ?? null,
                mime_type ?? null,
            ]
        );
        return rows[0] || null;
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "upload-complete violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "an id field must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// updateVisibility — OWNER-scoped. Lets the uploader change who can see the item.
// Promoting to a public scope stamps published_at the first time it goes public.
// Does NOT touch moderation_status (only 'approved' content actually renders
// publicly — visibility is the owner's intent, moderation is the gate).
// Returns null if the row doesn't exist or isn't the caller's.
const updateVisibility = async ({ id, user_id, visibility }) => {
    if (!id) throw httpError(400, "id is required");
    if (!user_id) throw httpError(400, "user_id is required");
    if (!VISIBILITIES.includes(visibility)) {
        throw httpError(400, `visibility must be one of: ${VISIBILITIES.join(", ")}`);
    }

    try {
        const { rows } = await client.query(
            `UPDATE content_items
                SET visibility = $3,
                    published_at = CASE
                        WHEN $3 IN ('public','unlisted') AND published_at IS NULL
                        THEN now() ELSE published_at END
              WHERE id = $1 AND user_id = $2
              RETURNING ${COLS}`,
            [id, user_id, visibility]
        );
        return rows[0] || null;
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "invalid visibility value");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// removeContentItem — admin/moderator soft-remove. Sets moderation_status='removed'
// plus removed_at + a coded removed_reason. This is the takedown path, distinct
// from the user's own visibility control. Not owner-scoped (the route gates it
// behind requireAdmin). Returns null if the row doesn't exist.
const removeContentItem = async ({ id, removed_reason }) => {
    if (!id) throw httpError(400, "id is required");
    if (!REMOVED_REASONS.includes(removed_reason)) {
        throw httpError(400, `removed_reason must be one of: ${REMOVED_REASONS.join(", ")}`);
    }

    try {
        const { rows } = await client.query(
            `UPDATE content_items
                SET moderation_status = 'removed',
                    removed_at = now(),
                    removed_reason = $2
              WHERE id = $1
              RETURNING ${COLS}`,
            [id, removed_reason]
        );
        // takedowns bypass setModerationStatus, so the avatar retraction has to
        // be repeated here or a removed photo stays live on the profile
        if (rows[0]) {
            await syncProfilePhoto(rows[0], client);
            await syncPlanComponentImage(rows[0], client);
        }
        return rows[0] || null;
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "removal violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

// syncProfilePhoto — the ONE place a moderated avatar reaches users.profile_photo_url.
//
// WHY IT LIVES HERE: this is the moment the verdict is known, and it is the only
// moment. Promoting from the route layer would mean every caller (auto-decision,
// admin approve, admin remove) has to remember to do it, and the one that forgets
// is the one that publishes an unreviewed photo. Hanging it off the status write
// makes "approved" and "visible" the same event.
//
// Runs on the caller's connection so it commits with the status change: a photo
// can never be live without its approval, or approved without going live.
//
// Both directions matter. approved → publish. rejected/removed → retract, but
// ONLY if this exact object is the one currently on the profile; a takedown of an
// old avatar must not wipe the newer one that replaced it.
const syncProfilePhoto = async (item, db) => {
    if (!item || item.parent_type !== "profile" || item.content_type !== "image") return;

    if (item.moderation_status === "approved" && item.storage_url) {
        await db.query(
            `UPDATE users SET profile_photo_url = $2, updated_at = now() WHERE id = $1`,
            [item.user_id, item.storage_url]
        );
        // a public avatar is public; keep the item's own visibility honest.
        // The values are copied back onto `item` because callers return the row
        // they were handed — without this the API response says 'private' for a
        // row that is public in the table, and an admin console believes it.
        const { rows } = await db.query(
            `UPDATE content_items
                SET visibility = 'public',
                    published_at = COALESCE(published_at, now())
              WHERE id = $1
              RETURNING visibility, published_at`,
            [item.id]
        );
        if (rows[0]) {
            item.visibility = rows[0].visibility;
            item.published_at = rows[0].published_at;
        }
        return;
    }

    if (["rejected", "removed", "flagged", "pending_human_review"].includes(item.moderation_status)) {
        await db.query(
            `UPDATE users
                SET profile_photo_url = NULL, updated_at = now()
              WHERE id = $1 AND profile_photo_url IS NOT DISTINCT FROM $2`,
            [item.user_id, item.storage_url]
        );
    }
};

// syncPlanComponentImage — the plan-position twin of syncProfilePhoto, and it
// exists for the same reason: "approved" and "visible" have to be one event, or
// some caller eventually publishes an image the scanner never cleared.
//
// parent_id is the plan_components row. Retraction is guarded on the URL matching
// so taking down a superseded image can't blank the replacement.
const syncPlanComponentImage = async (item, db) => {
    if (!item || item.parent_type !== "plan_component" || item.content_type !== "image") return;

    if (item.moderation_status === "approved" && item.storage_url) {
        await db.query(
            `UPDATE plan_components SET image_url = $2 WHERE id = $1`,
            [item.parent_id, item.storage_url]
        );
        const { rows } = await db.query(
            `UPDATE content_items
                SET visibility = 'public',
                    published_at = COALESCE(published_at, now())
              WHERE id = $1
              RETURNING visibility, published_at`,
            [item.id]
        );
        if (rows[0]) {
            item.visibility = rows[0].visibility;
            item.published_at = rows[0].published_at;
        }
        return;
    }

    if (["rejected", "removed", "flagged", "pending_human_review"].includes(item.moderation_status)) {
        await db.query(
            `UPDATE plan_components
                SET image_url = NULL
              WHERE id = $1 AND image_url IS NOT DISTINCT FROM $2`,
            [item.parent_id, item.storage_url]
        );
    }
};

// setModerationStatus — INTERNAL/admin only. The moderation pipeline (and admins)
// drive moderation_status here; users can NEVER reach this. Composable: pass
// db=client by default, or a tx from withTransaction so applyAutoDecision can
// flip status in the same transaction as the event insert.
//
// If the status moves to 'removed', a removed_reason may be supplied and
// removed_at is stamped. Returns null if the row doesn't exist.
//
// Side effect, deliberately: a 'profile' image reaching a terminal verdict syncs
// users.profile_photo_url (see syncProfilePhoto).
const setModerationStatus = async ({ id, moderation_status, removed_reason = null }, db = client) => {
    if (!id) throw httpError(400, "id is required");
    if (!MODERATION_STATUSES.includes(moderation_status)) {
        throw httpError(400, `moderation_status must be one of: ${MODERATION_STATUSES.join(", ")}`);
    }
    if (removed_reason !== null && !REMOVED_REASONS.includes(removed_reason)) {
        throw httpError(400, `removed_reason must be one of: ${REMOVED_REASONS.join(", ")}`);
    }
    if (moderation_status === "removed" && removed_reason === null) {
        // default to admin_action so the removed row always carries a coded reason
        removed_reason = "admin_action";
    }

    try {
        const { rows } = await db.query(
            `UPDATE content_items
                SET moderation_status = $2,
                    removed_at = CASE WHEN $2 = 'removed' THEN now() ELSE removed_at END,
                    removed_reason = CASE WHEN $2 = 'removed' THEN $3 ELSE removed_reason END
              WHERE id = $1
              RETURNING ${COLS}`,
            [id, moderation_status, removed_reason]
        );
        if (rows[0]) {
            await syncProfilePhoto(rows[0], db);
            await syncPlanComponentImage(rows[0], db);
        }
        return rows[0] || null;
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "moderation status violates a database constraint");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        throw err;
    }
};

module.exports = {
    PARENT_TYPES,
    CONTENT_TYPES,
    MODERATION_STATUSES,
    VISIBILITIES,
    AGE_RESTRICTIONS,
    REMOVED_REASONS,
    getContentItemById,
    getLatestProfileImage,
    createPendingContentItem,
    markUploadComplete,
    updateVisibility,
    removeContentItem,
    setModerationStatus,
};
