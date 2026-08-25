const { client } = require("../index.js");

// ============================================================================
// PWA Web Push transport (table: push_subscriptions, added in full-scope-prep).
// One row per browser/device install. endpoint is UNIQUE, so re-subscribing the
// same device upserts (and un-revokes) rather than duplicating. revoked_at is a
// soft-revoke so we keep the row for audit.
// ============================================================================

// savePushSubscription(data) — create or refresh a subscription. consent_id
// links the push_debate/push_wouldbe consent that authorized it (FEC/TCPA audit).
const savePushSubscription = async ({
    user_id,
    endpoint,
    p256dh_key,
    auth_key,
    user_agent = null,
    consent_id = null,
}) => {
    try {
        const SQL = `
            INSERT INTO push_subscriptions
                (user_id, endpoint, p256dh_key, auth_key, user_agent, consent_id, last_used_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (endpoint) DO UPDATE SET
                user_id    = EXCLUDED.user_id,
                p256dh_key = EXCLUDED.p256dh_key,
                auth_key   = EXCLUDED.auth_key,
                user_agent = EXCLUDED.user_agent,
                consent_id = EXCLUDED.consent_id,
                last_used_at = NOW(),
                revoked_at = NULL
            RETURNING *;
        `;
        const { rows } = await client.query(SQL, [
            user_id, endpoint, p256dh_key, auth_key, user_agent, consent_id,
        ]);
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// revokePushSubscription({id}) — soft-revoke one subscription by id (DELETE
// /push/subscriptions/:id). Keeps the row; just stamps revoked_at.
const revokePushSubscription = async ({ id }) => {
    try {
        const { rows } = await client.query(
            `UPDATE push_subscriptions SET revoked_at = NOW()
             WHERE id = $1 AND revoked_at IS NULL
             RETURNING id`,
            [id]
        );
        if (!rows.length) throw new Error("no active push subscription with this id");
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// getActivePushTargets(userId) — the live endpoints + keys to send Web Push to.
const getActivePushTargets = async ({ user_id }) => {
    try {
        const { rows } = await client.query(
            `SELECT id, endpoint, p256dh_key, auth_key
             FROM push_subscriptions
             WHERE user_id = $1 AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [user_id]
        );
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = {
    savePushSubscription,
    revokePushSubscription,
    getActivePushTargets,
};
