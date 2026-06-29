const { client } = require("../index.js")

// ============================================================================
// contest_state_registrations — sweepstakes/contest registration status per state
// for a debate. PK is id; UNIQUE (debate_id, state_code). For prizes over the
// state threshold (notably NY/FL/RI; AZ has its own rules) a contest must be
// registered (and sometimes bonded) with the state agency BEFORE launch. This
// table tracks that obligation and its lifecycle per state.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const REGISTRATION_STATUSES = [
    "not_required",
    "pending",
    "registered",
    "bonded",
    "exempt_under_threshold",
]

// Registration-required states and their prize-pool thresholds in cents.
// ASSUMPTION (kept deliberately simple/honest): these are the commonly-cited
// thresholds — NY & FL require registration + bond when total prize value exceeds
// $5,000; RI requires registration for retail sweepstakes over $500. AZ is listed
// because it has notable rules but no clean dollar threshold, so we flag it for
// manual review rather than auto-deciding. Real filing rules are nuanced and
// change; this layer surfaces "looks like you need to register" — legal sign-off
// still happens off-platform.
const STATE_RULES = {
    NY: { threshold_cents: 500000, requires_bond: true },
    FL: { threshold_cents: 500000, requires_bond: true },
    RI: { threshold_cents: 50000, requires_bond: false },
    AZ: { threshold_cents: null, requires_bond: false }, // null => always flag for manual review
}

// ----------------------------------------------------------------------------
// createStateRegistration — insert one (debate, state) registration row.
// ----------------------------------------------------------------------------
const createStateRegistration = async ({
    debate_id,
    state_code,
    registration_required,
    registration_status,
    registration_id_external = null,
    bond_amount_cents = null,
    bond_provider = null,
    filed_at = null,
    expires_at = null,
}, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    if (!state_code || state_code.length !== 2) throw httpError(400, "state_code must be a 2-letter code")
    if (typeof registration_required !== "boolean") {
        throw httpError(400, "registration_required must be a boolean")
    }
    if (!REGISTRATION_STATUSES.includes(registration_status)) {
        throw httpError(400, `registration_status must be one of: ${REGISTRATION_STATUSES.join(", ")}`)
    }
    try {
        const SQL = `
            INSERT INTO contest_state_registrations
                (debate_id, state_code, registration_required, registration_status,
                 registration_id_external, bond_amount_cents, bond_provider, filed_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `
        const { rows } = await db.query(SQL, [
            debate_id,
            state_code.toUpperCase(),
            registration_required,
            registration_status,
            registration_id_external,
            bond_amount_cents,
            bond_provider,
            filed_at,
            expires_at,
        ])
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "a registration row already exists for this debate + state")
        if (err.code === "23503") throw httpError(400, "debate_id does not exist")
        if (err.code === "23514") throw httpError(400, "invalid registration_status")
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// getStateRegistrations — all registration rows for a debate, alphabetical by state.
// ----------------------------------------------------------------------------
const getStateRegistrations = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const { rows } = await client.query(
            `SELECT * FROM contest_state_registrations WHERE debate_id = $1 ORDER BY state_code ASC`,
            [debate_id]
        )
        return rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// updateStateRegistration — patch a single registration row by id. Only the
// supplied fields change (COALESCE keeps the rest). status is validated when given.
// ----------------------------------------------------------------------------
const updateStateRegistration = async ({
    id,
    registration_required = null,
    registration_status = null,
    registration_id_external = null,
    bond_amount_cents = null,
    bond_provider = null,
    filed_at = null,
    expires_at = null,
}) => {
    if (!id) throw httpError(400, "id is required")
    if (registration_status !== null && !REGISTRATION_STATUSES.includes(registration_status)) {
        throw httpError(400, `registration_status must be one of: ${REGISTRATION_STATUSES.join(", ")}`)
    }
    try {
        const SQL = `
            UPDATE contest_state_registrations SET
                registration_required    = COALESCE($2, registration_required),
                registration_status      = COALESCE($3, registration_status),
                registration_id_external = COALESCE($4, registration_id_external),
                bond_amount_cents        = COALESCE($5, bond_amount_cents),
                bond_provider            = COALESCE($6, bond_provider),
                filed_at                 = COALESCE($7, filed_at),
                expires_at               = COALESCE($8, expires_at)
            WHERE id = $1
            RETURNING *;
        `
        const { rows } = await client.query(SQL, [
            id,
            registration_required,
            registration_status,
            registration_id_external,
            bond_amount_cents,
            bond_provider,
            filed_at,
            expires_at,
        ])
        if (rows.length === 0) throw httpError(404, "registration row not found")
        return rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid registration_status")
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

// ----------------------------------------------------------------------------
// runStateRegistrationChecks — compute, for a debate's prize pool, which states
// (from STATE_RULES) appear to require registration, and reconcile against the
// rows already on file. This does NOT file anything; it returns a per-state
// verdict the admin can act on. Logic is intentionally simple and transparent:
//   - prize_pool >= state threshold  => registration_required (or 'bonded' note)
//   - state has a null threshold (AZ) => flag for manual review
//   - state is in the debate's excluded_states => not_required (no entrants there)
// ----------------------------------------------------------------------------
const runStateRegistrationChecks = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const debateRes = await client.query(
            `SELECT id, prize_pool_cents, excluded_states FROM debates WHERE id = $1`,
            [debate_id]
        )
        if (debateRes.rows.length === 0) throw httpError(404, "debate not found")
        const debate = debateRes.rows[0]
        const prizePool = Number(debate.prize_pool_cents) || 0
        const excluded = new Set((debate.excluded_states || []).map((s) => s.toUpperCase()))

        const existing = await getStateRegistrations({ debate_id })
        const existingByState = new Map(existing.map((r) => [r.state_code, r]))

        const checks = Object.entries(STATE_RULES).map(([state, rule]) => {
            const onFile = existingByState.get(state) || null

            // Excluded states take no entrants, so registration is moot.
            if (excluded.has(state)) {
                return {
                    state_code: state,
                    prize_pool_cents: prizePool,
                    verdict: "not_required",
                    reason: "state is excluded from entry",
                    requires_bond: false,
                    on_file_status: onFile ? onFile.registration_status : null,
                    needs_attention: false,
                }
            }

            // No clean threshold => the rule needs a human.
            if (rule.threshold_cents === null) {
                const compliant = onFile && onFile.registration_status !== "pending"
                return {
                    state_code: state,
                    prize_pool_cents: prizePool,
                    verdict: "manual_review",
                    reason: "state has nuanced rules with no dollar threshold; review manually",
                    requires_bond: rule.requires_bond,
                    on_file_status: onFile ? onFile.registration_status : null,
                    needs_attention: !compliant,
                }
            }

            const required = prizePool >= rule.threshold_cents
            if (!required) {
                return {
                    state_code: state,
                    prize_pool_cents: prizePool,
                    threshold_cents: rule.threshold_cents,
                    verdict: "exempt_under_threshold",
                    reason: `prize pool below ${state} threshold`,
                    requires_bond: false,
                    on_file_status: onFile ? onFile.registration_status : null,
                    needs_attention: false,
                }
            }

            // Required: compliant only if there's a row in a satisfied state.
            const satisfied =
                onFile && ["registered", "bonded"].includes(onFile.registration_status)
            return {
                state_code: state,
                prize_pool_cents: prizePool,
                threshold_cents: rule.threshold_cents,
                verdict: "registration_required",
                reason: `prize pool meets/exceeds ${state} threshold`,
                requires_bond: rule.requires_bond,
                on_file_status: onFile ? onFile.registration_status : null,
                needs_attention: !satisfied,
            }
        })

        return {
            debate_id,
            prize_pool_cents: prizePool,
            checks,
            needs_attention: checks.some((c) => c.needs_attention),
        }
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "invalid uuid in request")
        console.error(err)
        throw err
    }
}

module.exports = {
    REGISTRATION_STATUSES,
    STATE_RULES,
    createStateRegistration,
    getStateRegistrations,
    updateStateRegistration,
    runStateRegistrationChecks,
}
