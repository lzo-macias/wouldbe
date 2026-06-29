// ============================================================================
// Cross-cutting Express middleware (the MASTER's "Cross-cutting middleware" set)
// ----------------------------------------------------------------------------
// One home for the gates every route composes. Wired to the real DB functions
// where they exist; honest stubs where the infra doesn't (MFA freshness needs a
// challenge flow + timestamp column; rateLimit is in-memory pending Redis).
//
// Composition order matters:
//   captureRequestContext  → requireAuth → [requireAdmin → requireMFAFresh]
//                          → requireConsent / requireAttestation / requireAgeGate
//                          / requireCriteriaAck → handler → recordAdminAction
//
// requireAuth sets req.user; requireAdmin sets req.admin (the admin_users row).
// Anything that needs ip/user_agent reads req.context (or req.ip directly).
// ============================================================================

const { client } = require("../DB/index");
const { findUserByToken } = require("../DB/platform/auth");
const { getUserActiveConsents } = require("../DB/platform/consent");
const { isAttestationCurrent } = require("../DB/platform/attestation");
const { logPIIAccess: logPIIAccessRow } = require("../DB/platform/PIIAccess");

// ---- helpers ---------------------------------------------------------------

// Exact age in years from a date_of_birth (used by requireAgeGate).
const ageFromDOB = (dob) => {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
};

// Pull a target user id from the usual param/body spots (for PII logging, etc.).
const targetUserId = (req) =>
    req.params.userId || req.params.id || req.body?.user_id || null;

// ============================================================================
// captureRequestContext — stamp ip + user_agent on req for consent/attestation/
//   audit rows. Mount this early (app-level) so handlers can read req.context.
//   NOTE: accurate req.ip behind a proxy needs `app.set("trust proxy", 1)`.
// ============================================================================
const captureRequestContext = (req, _res, next) => {
    req.context = {
        ip_address: req.ip,
        user_agent: req.headers["user-agent"] || null,
    };
    next();
};

// ============================================================================
// requireAuth — verify the Bearer JWT and attach req.user.
//   findUserByToken takes the RAW header string and strips its own "Bearer ".
// ============================================================================
const requireAuth = async (req, res, next) => {
    try {
        const user = await findUserByToken(req.headers.authorization);
        if (!user) return res.status(401).json({ error: "Not authenticated" });
        req.user = user;
        next();
    } catch {
        // verify() throws on expired/tampered tokens → 401, not 500.
        return res.status(401).json({ error: "Invalid or expired token" });
    }
};

// ============================================================================
// requireAdmin(role?) — must follow requireAuth. Confirms the user has an active
//   admin_users row (optionally of a specific role) and stashes it on req.admin
//   so downstream middleware (requireMFAFresh, recordAdminAction) can use it.
// ============================================================================
const requireAdmin = (role = null) => async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Not authenticated" });
        const { rows } = await client.query(
            `SELECT * FROM admin_users
             WHERE user_id = $1 AND status = 'active' AND terminated_at IS NULL`,
            [req.user.id]
        );
        const admin = rows[0];
        if (!admin) return res.status(403).json({ error: "Admin access required" });
        if (role && admin.role !== role) {
            return res.status(403).json({ error: `Requires '${role}' role` });
        }
        req.admin = admin;
        next();
    } catch (err) {
        next(err);
    }
};

// ============================================================================
// requireMFAFresh(maxAgeMinutes?) — gate sensitive admin actions on recent MFA.
//   Must follow requireAdmin. TRUE freshness needs an MFA-challenge flow + a
//   `last_mfa_at` timestamp; neither exists yet. Minimal proxy: require the
//   admin to have MFA enabled. [TODO] add admin_users.last_mfa_at + a challenge
//   endpoint, then compare against maxAgeMinutes here.
// ============================================================================
const requireMFAFresh = (maxAgeMinutes = 15) => async (req, res, next) => {
    if (!req.admin) return res.status(403).json({ error: "Admin access required" });
    if (!req.admin.mfa_enabled) {
        return res.status(403).json({ error: "MFA must be enabled for this action" });
    }
    // const lastMfa = req.admin.last_mfa_at; // column does not exist yet
    // if (!lastMfa || Date.now() - new Date(lastMfa) > maxAgeMinutes*60_000) → 403
    void maxAgeMinutes;
    next();
};

// ============================================================================
// requireInternal — gate internal/cron-only endpoints (recompute, regeocode,
//   link-health). Authenticates the CALLER, not a user: the request must carry
//   `x-internal-secret` matching process.env.INTERNAL_API_SECRET. Closed by
//   default — if the secret isn't configured, every call is rejected (never open).
// ============================================================================
const requireInternal = (req, res, next) => {
    const secret = process.env.INTERNAL_API_SECRET;
    const provided = req.headers["x-internal-secret"];
    if (secret && provided && provided === secret) return next();
    return res.status(403).json({ error: "Internal endpoint" });
};

// ============================================================================
// requireConsent(consentType) — must follow requireAuth. Blocks unless the user
//   has an active (non-withdrawn) consent of this type.
// ============================================================================
const requireConsent = (consentType) => async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Not authenticated" });
        const consent = await getUserActiveConsents({
            user_id: req.user.id,
            consent_type: consentType,
        });
        if (!consent) {
            return res.status(403).json({ error: `Missing consent: ${consentType}` });
        }
        next();
    } catch (err) {
        next(err);
    }
};

// ============================================================================
// requireAttestation(type) — must follow requireAuth. Blocks unless the user has
//   a current (non-expired, non-superseded) attestation of this type.
// ============================================================================
const requireAttestation = (type) => async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Not authenticated" });
        const ok = await isAttestationCurrent({ userId: req.user.id, type });
        if (!ok) {
            return res.status(403).json({ error: `Missing attestation: ${type}` });
        }
        next();
    } catch (err) {
        next(err);
    }
};

// ============================================================================
// requireAgeGate(minAge) — must follow requireAuth. Blocks users younger than
//   minAge. req.user (from findUserByToken) has no DOB, so we fetch it.
// ============================================================================
const requireAgeGate = (minAge) => async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Not authenticated" });
        const { rows } = await client.query(
            `SELECT date_of_birth FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (!rows.length) return res.status(401).json({ error: "Not authenticated" });
        if (ageFromDOB(rows[0].date_of_birth) < minAge) {
            return res.status(403).json({ error: `Must be at least ${minAge}` });
        }
        next();
    } catch (err) {
        next(err);
    }
};

// ============================================================================
// requireCriteriaAck(ackType) — must follow requireAuth. Blocks unless the user
//   has acknowledged the criteria for this context. Scoped to a debate when a
//   debate id is present on the request (params/body).
// ============================================================================
const requireCriteriaAck = (ackType) => async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Not authenticated" });
        const debateId =
            req.params.debateId || req.params.debate_id || req.body?.debate_id || null;
        const { rows } = await client.query(
            `SELECT 1 FROM user_criteria_acknowledgments
             WHERE user_id = $1 AND ack_type = $2
               AND ($3::uuid IS NULL OR debate_id = $3)
             LIMIT 1`,
            [req.user.id, ackType, debateId]
        );
        if (!rows.length) {
            return res.status(403).json({ error: `Criteria not acknowledged: ${ackType}` });
        }
        next();
    } catch (err) {
        next(err);
    }
};

// ============================================================================
// rateLimit({ type, windowMs, max }) — throttle by (ip + route). In-memory
//   fixed window: CORRECT for a single instance, but per-process — with N
//   instances the effective limit becomes N×. [TODO(scaling)] move to a shared
//   store (Redis/Upstash) BEFORE running a 2nd instance. See docs/SCALING.md.
//   On breach, best-effort writes a rate_limit_violations row and returns 429.
// ============================================================================
const _buckets = new Map(); // key -> { count, resetAt }
const rateLimit = ({ type = "generic", windowMs = 60_000, max = 60 } = {}) =>
    async (req, res, next) => {
        const key = `${type}:${req.ip}:${req.baseUrl}${req.path}`;
        const now = Date.now();
        let b = _buckets.get(key);
        if (!b || now > b.resetAt) {
            b = { count: 0, resetAt: now + windowMs };
            _buckets.set(key, b);
        }
        b.count++;
        if (b.count > max) {
            try {
                await client.query(
                    `INSERT INTO rate_limit_violations
                       (user_id, rate_limit_type, limit_value, actual_value, ip_address, action_taken, window_start)
                     VALUES ($1,$2,$3,$4,$5,'throttled', to_timestamp($6/1000.0))`,
                    [req.user?.id || null, type, max, b.count, req.ip, b.resetAt - windowMs]
                );
            } catch (err) {
                console.warn(`[rateLimit] could not record violation: ${err.message}`);
            }
            res.set("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
            return res.status(429).json({ error: "Too many requests" });
        }
        next();
    };

// ============================================================================
// logPIIAccess({ fields, reason, method }) — wrap a PII-exposing read. Must
//   follow requireAuth. Records WHO accessed WHOSE PII before the handler runs.
//   Failing the audit fails the request (the log is the point).
// ============================================================================
const logPIIAccess = ({ fields = [], reason = null, method = "api" } = {}) =>
    async (req, res, next) => {
        try {
            await logPIIAccessRow({
                accessed_user_id: targetUserId(req),
                accessor_user_id: req.user?.id || null,
                accessor_role: req.admin?.role || "user",
                fields_accessed: fields,
                access_reason: reason,
                access_method: method,
                session_id: null,
                ip_address: req.ip,
            });
            next();
        } catch (err) {
            next(err);
        }
    };

// ============================================================================
// recordAdminAction(actionType, { resourceType }) — must follow requireAdmin.
//   Appends an admin_actions audit row AFTER the request succeeds (2xx/3xx), so
//   we don't log actions that errored out. Reads req.admin for the actor.
// ============================================================================
const recordAdminAction = (actionType, { resourceType = null } = {}) =>
    (req, res, next) => {
        res.on("finish", () => {
            if (res.statusCode >= 400 || !req.admin) return;
            client
                .query(
                    `INSERT INTO admin_actions
                       (admin_user_id, action_type, target_resource_type, target_resource_id,
                        reason, ip_address, user_agent, mfa_verified)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [
                        req.admin.id,
                        actionType,
                        resourceType,
                        targetUserId(req) || req.params.id || null,
                        req.body?.reason || null,
                        req.ip,
                        req.headers["user-agent"] || null,
                        !!req.admin.mfa_enabled,
                    ]
                )
                .catch((err) => console.error(`[recordAdminAction] ${err.message}`));
        });
        next();
    };

const httpError = (status, message)  => {
    const e = new Error(message)
    e.status = status
    return e
}
module.exports = {
    captureRequestContext,
    requireAuth,
    requireAdmin,
    requireInternal,
    requireMFAFresh,
    requireConsent,
    requireAttestation,
    requireAgeGate,
    requireCriteriaAck,
    rateLimit,
    logPIIAccess,
    recordAdminAction,
    httpError
};
