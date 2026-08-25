const { client, withTransaction } = require("../index.js")
const { createContestant } = require("./contestants")

// ============================================================================
// debate_entries — the IMMUTABLE LEGAL entry record (attestations the entrant
// signed), distinct from contestants (the runtime competitive identity).
// enterDebate creates BOTH atomically: the contestants row (eligibility-gated +
// snapshot) and the debate_entries row that links to it. UNIQUE (debate_id,
// user_id). The DB CHECK enforces: adult (attestation_age_18=true) OR minor
// (is_minor_entry + guardian_consent_at present, not attesting 18+).
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const ENTRY_METHODS = ["nominated", "paid_per_debate", "subscription", "amoe", "free_self_entry"]

// enterDebate — the user-facing entry flow. Creates the contestant (eligibility
// + snapshot enforced in createContestant), then the legal entry record with the
// age/guardian attestation and rules acknowledgment — all in one transaction so
// a half-entry can never exist. The route gates adults via requireAttestation
// (age_18 + us_citizen); the minor/guardian branch here is defense-in-depth for
// a future minor-specific entry flow.
const enterDebate = async ({
    debate_id,
    user_id,
    entry_method = "free_self_entry",
    attestation_age_18,
    guardian_consent_at,
    guardian_consent_id,
    rules_version_seen,
    acknowledged_rules_at,
    nominator_id,
    amoe_submission_text,
    entry_payment_id,
}) => {
    if (!user_id) throw httpError(401, "must be signed in to enter a debate")
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!ENTRY_METHODS.includes(entry_method)) {
        throw httpError(400, `entry_method must be one of: ${ENTRY_METHODS.join(", ")}`)
    }
    try {
        return await withTransaction(async (tx) => {
            // 0) capacity. The sponsor bought a video-entry cap with their host
            //    tier (debates.entry_cap), so entry #101 on a Basic debate is
            //    refused rather than silently consuming storage nobody paid for.
            //    Checked INSIDE the transaction and counted with FOR UPDATE-free
            //    semantics: two simultaneous entries at the boundary can both
            //    pass, which is an acceptable off-by-one against a capacity
            //    limit — the alternative is locking the whole debate per entry.
            //    A NULL cap (debates from before tiers) means unlimited.
            const { rows: capRows } = await tx.query(
                `SELECT d.entry_cap, COUNT(e.entry_id)::int AS entries
                 FROM debates d
                 LEFT JOIN debate_entries e ON e.debate_id = d.id
                 WHERE d.id = $1
                 GROUP BY d.entry_cap`,
                [debate_id]
            )
            const cap = capRows[0]?.entry_cap
            if (cap != null && capRows[0].entries >= cap) {
                throw httpError(409, `this debate has reached its ${cap}-entry limit`)
            }

            // 1) runtime identity — enforces debate-open/age/state eligibility and
            //    derives the state/age snapshot from the user's profile.
            const contestant = await createContestant({ debate_id, user_id }, tx)

            // 2) reconcile the age/guardian attestation against the verified age.
            const isMinor = contestant.age_at_entry < 18
            if (isMinor) {
                if (!guardian_consent_at) {
                    throw httpError(403, "a parent/guardian must consent for entrants under 18")
                }
            } else if (attestation_age_18 !== true) {
                throw httpError(400, "you must attest that you are 18 or older to enter")
            }

            // 3) the immutable legal record, linked to the contestant row.
            const ins = await tx.query(
                `INSERT INTO debate_entries (
                    debate_id, user_id, contestant_id, entry_method, nominator_id,
                    amoe_submission_text, entry_payment_id, attestation_age_18,
                    is_minor_entry, age_at_entry, guardian_consent_id, guardian_consent_at,
                    attestation_state, attestation_rules_seen, rules_version_seen, acknowledged_rules_at
                )
                VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, true, $14, COALESCE($15, NOW())
                )
                RETURNING *;`,
                [
                    debate_id,
                    user_id,
                    contestant.id,
                    entry_method,
                    nominator_id,
                    amoe_submission_text,
                    entry_payment_id,
                    isMinor ? false : true,
                    isMinor,
                    contestant.age_at_entry,
                    guardian_consent_id,
                    guardian_consent_at,
                    contestant.state_at_entry,
                    rules_version_seen,
                    acknowledged_rules_at,
                ]
            )
            return { entry: ins.rows[0], contestant }
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "you have already entered this debate")
        if (err.code === "23514") throw httpError(400, "entry attestations are inconsistent (age/guardian)")
        if (err.code === "23503") throw httpError(400, "a referenced id (debate, user, nominator, payment) does not exist")
        console.error(err)
        throw err
    }
}

// getDebateEntries — the legal entry records for a debate (admin/sponsor view;
// holds attestation + minor data, so the route gates this to admins).
const getDebateEntries = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const SQL = `
            SELECT
                e.*,
                u.username,
                u.first_name,
                u.last_name
            FROM debate_entries AS e
            JOIN users AS u ON u.id = e.user_id
            WHERE e.debate_id = $1
            ORDER BY e.created_at DESC;
        `
        const result = await client.query(SQL, [debate_id])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getUserEntries — the caller's own entries, joined to the debate they belong to.
const getUserEntries = async ({ user_id }) => {
    if (!user_id) throw httpError(400, "user_id is required")
    try {
        const SQL = `
            SELECT
                e.*,
                d.title       AS debate_title,
                d.status      AS debate_status,
                d.start_date  AS debate_start_date
            FROM debate_entries AS e
            JOIN debates AS d ON d.id = e.debate_id
            WHERE e.user_id = $1
            ORDER BY e.created_at DESC;
        `
        const result = await client.query(SQL, [user_id])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getEntryById — one entry, scoped to its owner (the route passes the authed
// user's id; admins read the full set via getDebateEntries instead).
const getEntryById = async ({ entry_id, user_id = null }) => {
    if (!entry_id) throw httpError(400, "entry_id is required")
    try {
        const SQL = `
            SELECT *
            FROM debate_entries
            WHERE entry_id = $1
              AND ($2::uuid IS NULL OR user_id = $2)
        `
        const result = await client.query(SQL, [entry_id, user_id])
        return result.rows[0] || null
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    enterDebate,
    getDebateEntries,
    getUserEntries,
    getEntryById,
}
