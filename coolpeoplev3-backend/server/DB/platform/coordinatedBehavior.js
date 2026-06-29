const { client, withTransaction } = require("../index.js");

// ============================================================================
// coordinated_behavior_signals — detector output for coordinated/inauthentic
// behavior (IP clusters, signup bursts, suspicious voting patterns …). Cash-prize
// debates WILL attract vote brigading; this table records the detection signal,
// an admin's decision, and (optionally) the enforcement: invalidating the votes
// cast by the implicated cluster of accounts.
//
// A "cluster" is not its own column — it is the set of accounts named in a
// signal's related_user_ids (jsonb array of user ids), scoped to its
// related_debate_id. invalidateVotesForCluster reads a signal and stamps
// invalidated_at/invalidation_reason on those accounts' debate_votes.
// ============================================================================

const SIGNAL_TYPES = [
    "ip_cluster", "signup_burst", "voting_pattern", "content_similarity",
    "device_fingerprint_match", "timing_correlation",
];
// Statuses an admin may DECIDE on ('pending_review' is the initial state).
const DECISION_STATUSES = [
    "confirmed_inauthentic", "false_positive", "action_taken",
];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Normalize an array of user ids into a JSON string for the jsonb columns.
const asJsonArray = (val, label) => {
    if (val === null || val === undefined) return null;
    if (!Array.isArray(val)) throw httpError(400, `${label} must be an array`);
    return JSON.stringify(val);
};

// recordCoordinatedSignal(...) — write a detector signal. Typically called by an
// automated detector; related_user_ids is required (the implicated accounts).
const recordCoordinatedSignal = async ({
    signal_type,
    confidence_score,
    related_user_ids,
    related_content_item_ids = null,
    related_debate_id = null,
    detection_details = null,
} = {}) => {
    if (!SIGNAL_TYPES.includes(signal_type)) {
        throw httpError(400, `signal_type must be one of: ${SIGNAL_TYPES.join(", ")}`);
    }
    const conf = Number(confidence_score);
    if (Number.isNaN(conf) || conf < 0 || conf > 1) {
        throw httpError(400, "confidence_score must be a number between 0 and 1");
    }
    const userIds = asJsonArray(related_user_ids, "related_user_ids");
    if (!userIds) throw httpError(400, "related_user_ids is required");
    try {
        const { rows } = await client.query(
            `INSERT INTO coordinated_behavior_signals
               (signal_type, confidence_score, related_user_ids,
                related_content_item_ids, related_debate_id, detection_details)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING *`,
            [
                signal_type,
                conf,
                userIds,
                asJsonArray(related_content_item_ids, "related_content_item_ids"),
                related_debate_id,
                detection_details ? JSON.stringify(detection_details) : null,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "related_debate_id does not exist");
        if (err.code === "23514") throw httpError(400, "value violates a constraint on coordinated_behavior_signals");
        if (err.code === "22P02") throw httpError(400, "an id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// listCoordinatedSignals(filters) — the review queue. All filters optional; omit
// status to see everything. Newest first.
const listCoordinatedSignals = async ({
    status = null,
    signal_type = null,
    related_debate_id = null,
    limit = 100,
} = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT cbs.*, reviewer.username AS reviewed_by_username
             FROM coordinated_behavior_signals cbs
             LEFT JOIN users reviewer ON reviewer.id = cbs.reviewed_by_user_id
             WHERE ($1::text IS NULL OR cbs.status = $1)
               AND ($2::text IS NULL OR cbs.signal_type = $2)
               AND ($3::uuid IS NULL OR cbs.related_debate_id = $3)
             ORDER BY cbs.created_at DESC
             LIMIT $4`,
            [status, signal_type, related_debate_id, Math.min(Number(limit) || 100, 500)]
        );
        return rows;
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "related_debate_id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// decideCoordinatedSignal(...) — an admin records a verdict on a signal. Stamps
// the reviewer and (optionally) a narrative action_taken. reviewed_by_user_id is
// the acting admin's USER id (req.admin.user_id).
const decideCoordinatedSignal = async ({ id, decision, action_taken = null, reviewed_by_user_id = null } = {}) => {
    if (!id) throw httpError(400, "id is required");
    if (!DECISION_STATUSES.includes(decision)) {
        throw httpError(400, `decision must be one of: ${DECISION_STATUSES.join(", ")}`);
    }
    try {
        const { rows } = await client.query(
            `UPDATE coordinated_behavior_signals
                SET status              = $2,
                    action_taken        = COALESCE($3, action_taken),
                    reviewed_by_user_id = $4
              WHERE id = $1
              RETURNING *`,
            [id, decision, action_taken, reviewed_by_user_id]
        );
        if (!rows.length) throw httpError(404, "no coordinated-behavior signal with that id");
        return rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "reviewed_by_user_id does not exist");
        if (err.code === "23514") throw httpError(400, "value violates a constraint on coordinated_behavior_signals");
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid");
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// invalidateVotesForCluster(...) — the enforcement step. Reads a signal, then
// inside ONE transaction marks every still-valid debate_votes row cast by the
// implicated accounts (related_user_ids) — scoped to the signal's
// related_debate_id when present — as invalidated. Append-only: votes are not
// deleted, just stamped invalidated_at + invalidation_reason so they stop
// counting but remain in the forensic record.
//
// Accepts { signal_id } (preferred) or { cluster_id } as an alias for the
// signal id, plus a required reason.
const invalidateVotesForCluster = async ({ signal_id, cluster_id, reason } = {}) => {
    const sid = signal_id || cluster_id;
    if (!sid) throw httpError(400, "signal_id is required");
    if (!reason || !String(reason).trim()) throw httpError(400, "reason is required");

    return withTransaction(async (tx) => {
        try {
            const sig = await tx.query(
                `SELECT id, related_user_ids, related_debate_id
                 FROM coordinated_behavior_signals
                 WHERE id = $1
                 FOR UPDATE`,
                [sid]
            );
            const signal = sig.rows[0];
            if (!signal) throw httpError(404, "no coordinated-behavior signal with that id");

            // related_user_ids is jsonb (driver returns it parsed); normalize to a
            // plain array of ids.
            let userIds = signal.related_user_ids;
            if (typeof userIds === "string") userIds = JSON.parse(userIds);
            if (!Array.isArray(userIds) || userIds.length === 0) {
                throw httpError(400, "signal has no related_user_ids to invalidate");
            }

            // Mark the clustered votes invalidated. $2 = array of voter ids;
            // $3 = optional debate scope (NULL → all debates).
            const upd = await tx.query(
                `UPDATE debate_votes
                    SET invalidated_at     = now(),
                        invalidation_reason = $1
                  WHERE voter_user_id = ANY($2::uuid[])
                    AND invalidated_at IS NULL
                    AND ($3::uuid IS NULL OR debate_id = $3)
                  RETURNING vote_id`,
                [reason, userIds, signal.related_debate_id]
            );

            // Reflect the enforcement on the signal itself.
            await tx.query(
                `UPDATE coordinated_behavior_signals
                    SET status = 'action_taken',
                        action_taken = COALESCE(action_taken, $2)
                  WHERE id = $1`,
                [signal.id, `invalidated ${upd.rows.length} vote(s): ${reason}`]
            );

            return { signal_id: signal.id, invalidated_count: upd.rows.length };
        } catch (err) {
            if (err.code === "22P02") throw httpError(400, "a related user id is not a valid uuid");
            if (err.status) throw err;
            console.error(err);
            throw err;
        }
    });
};

module.exports = {
    SIGNAL_TYPES,
    DECISION_STATUSES,
    recordCoordinatedSignal,
    listCoordinatedSignals,
    decideCoordinatedSignal,
    invalidateVotesForCluster,
};
