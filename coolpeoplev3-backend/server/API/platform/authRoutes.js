const express = require("express");

const {
    authenticate,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    createPasswordResetToken,
    resetPasswordWithToken,
    markEmailVerified,
    setPhoneVerificationCode,
    markPhoneVerified,
} = require("../../DB/platform/auth");
const { createUsers, updateUserLastLogin, deriveAgeBand } = require("../../DB/platform/users");
const { createChildSafetyRecord } = require("../../DB/platform/childSafety");
const { recordConsent } = require("../../DB/platform/consent");
const { recordAttestation } = require("../../DB/platform/attestation");
const { getCurrentLegalDoc } = require("../../DB/platform/legalDocs");
const { requireAuth, rateLimit } = require("../../middleware");

const router = express.Router();

// Frozen version label for the age-eligibility attestation language. When the
// wording changes, bump this so each row records which text the user saw.
const ATTESTATION_VERSION = "2026-05-29";
// Jurisdiction scope for the platform-wide legal docs (TOS / privacy). These
// are seeded with jurisdiction_scope containing "US"; see legalDocs.publishNewLegalDocV2.
const PLATFORM_JURISDICTION = "US";

// requireAuth now lives in ../middleware (imported above) and is re-exported at
// the bottom for back-compat with anything that imported it from here.

// ============================================================================
// POST /signup
//   Order matters: create the user first, then hang the legal/compliance rows
//   off the new id. There is no surrounding transaction yet (the codebase
//   shares a single pg Client — see DB/index.js), so on a mid-flow failure you
//   can be left with a user row but missing consent/attestation rows. Move to a
//   Pool + explicit BEGIN/COMMIT before production. [TODO: transaction]
// ============================================================================
router.post("/signup", async (req, res, next) => {
    try {
        const {
            first_name,
            last_name,
            username,
            password,
            political_lean,
            phone_number,
            date_of_birth,
            email,
            state,
            profile_photo_url,
            bio,
            // compliance inputs from the signup form:
            accepted_tos,           // boolean — user ticked the TOS box
            accepted_privacy,       // boolean — user ticked the privacy box
            consent_method = "signup_checkbox",
            age_verification_method = "self_attested",
            age_verified_value,
        } = req.body;

        // createUsers enforces these at the DB (first_name/last_name/username/
        // password are NOT NULL; date_of_birth is NOT NULL). Fail fast with 400.
        if (!first_name || !last_name || !username || !password || !date_of_birth) {
            return res.status(400).json({
                error: "Missing required fields: first_name, last_name, username, password, date_of_birth",
            });
        }

        // COPPA gate: under-13 cannot self-register; they need the parental-consent
        // flow before an account exists. Block here rather than create-then-restrict.
        const age_band = deriveAgeBand(date_of_birth);
        if (age_band === "under_13") {
            return res.status(403).json({ error: "Users under 13 cannot create an account" });
        }

        // Captured for TCPA/FEC defense on every consent/attestation row.
        const ip_address = req.ip;
        const user_agent = req.headers["user-agent"] || null;

        // 1) Create the account. Returns the row incl. derived age_band — and the
        //    bcrypt hash (RETURNING *), which we strip before responding.
        const user = await createUsers({
            first_name, last_name, username, password, political_lean,
            phone_number, date_of_birth, email, state, profile_photo_url, bio,
        });

        // 2) Child-safety record (sets COPPA / minor-participation flags by band).
        await createChildSafetyRecord({
            userId: user.id,
            dob: date_of_birth,
            age_verification_method,
            age_verified_value,
        });

        // 3) Consents — must reference the current legal doc version. Best-effort:
        //    if the docs aren't seeded yet (fresh dev DB), log and continue rather
        //    than 500 the signup. In production these MUST be seeded and recording
        //    consent should be mandatory (treat a miss as a hard error).
        const recordDocConsent = async (docType, consent_type, accepted) => {
            if (!accepted) return;
            try {
                const doc = await getCurrentLegalDoc({
                    docType,
                    jurisdiction: PLATFORM_JURISDICTION,
                });
                await recordConsent({
                    user_id: user.id,
                    legal_document_id: doc.id,
                    consent_type,
                    ip_address,
                    user_agent,
                    consent_method,
                    context: { surface: "signup" },
                });
            } catch (err) {
                console.warn(`[signup] consent '${consent_type}' not recorded: ${err.message}`);
            }
        };
        await recordDocConsent("tos", "tos", accepted_tos);
        await recordDocConsent("privacy_policy", "privacy_policy", accepted_privacy);

        // 4) Age-eligibility attestation (positive only). 18+ attests age_18;
        //    13–17 attests age_13. Guardian consent (not this) is the gate for
        //    what minors can actually DO — see childSafety + debate_entries.
        await recordAttestation({
            user_id: user.id,
            attestation_type: age_band === "13_17" ? "age_13" : "age_18",
            attested_value: "true",
            attestation_version: ATTESTATION_VERSION,
            attested_at: new Date().toISOString(),
            ip_address,
            context: "signup",
        });

        // 5) Mint the session token. Reuse authenticate() so token logic lives in
        //    exactly one place (it re-checks the password — cheap, and avoids a
        //    duplicate jwt.sign here).
        const auth = await authenticate({ username, password });

        delete user.password; // never return the bcrypt hash
        return res.status(201).json({ token: auth?.token ?? null, user });
    } catch (err) {
        // Unique-violation (username/email taken) surfaces as a thrown Error from
        // createUsers; map the common ones to 409, everything else to the handler.
        if (/already exists|already taken/i.test(err.message)) {
            return res.status(409).json({ error: err.message });
        }
        next(err);
    }
});

// ============================================================================
// POST /login
//   authenticate() returns { token, user } or null on bad credentials. On
//   success bump the session counter; updateUserLastLogin returns session_count
//   so we can surface the "after 3 sessions, ask for address" prompt.
//   [TODO] Replace the >=3 heuristic with getDuePrompts(userId) once the
//   user_prompt_log helpers are built, so a declined ask isn't re-shown forever.
// ============================================================================
router.post("/login", async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Missing username or password" });
        }

        const result = await authenticate({ username, password });
        if (!result) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const { session_count } = await updateUserLastLogin({ id: result.user.id });

        return res.status(200).json({
            token: result.token,                          // short-lived access token
            refreshToken: signRefreshToken(result.user),  // long-lived; used by POST /refresh
            user: result.user,
            session_count,
            address_prompt_due: session_count >= 3, // TODO: getDuePrompts()
        });
    } catch (err) {
        next(err);
    }
});


// ============================================================================
// POST /logout
//   Stateless JWT: there is nothing to invalidate server-side — the CLIENT drops
//   the token (localStorage/cookie). This endpoint just acknowledges. requireAuth
//   so only a valid session can call it / for symmetry.
//   [TODO] For true revocation ("log out all devices"), add a Redis denylist of
//   token ids (jti) and check it in requireAuth.
// ============================================================================
router.post("/logout", requireAuth, (_req, res) => {
    return res.status(200).json({ message: "Logged out" });
});

// ============================================================================
// POST /refresh
//   Exchange a valid refresh token for a fresh access token. Refresh token comes
//   from the body or an x-refresh-token header (login issues it).
// ============================================================================
router.post("/refresh", async (req, res, next) => {
    try {
        const token = req.body?.refreshToken || req.headers["x-refresh-token"];
        const user = await verifyRefreshToken(token);
        if (!user) {
            return res.status(401).json({ error: "Invalid or expired refresh token" });
        }
        return res.status(200).json({ token: signAccessToken(user) });
    } catch (err) {
        next(err);
    }
});

// ============================================================================
// POST /forgot-password  (rate-limited)
//   Always returns the same generic 200 so it can't be used to probe which
//   emails have accounts. In non-production we surface devToken so you can test
//   the reset flow before an email provider is wired.
// ============================================================================
router.post(
    "/forgot-password",
    rateLimit({ type: "forgot_password", windowMs: 15 * 60 * 1000, max: 5 }),
    async (req, res, next) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ error: "Missing email" });

            const reset = await createPasswordResetToken(email);
            // TODO: if `reset`, email a link containing reset.token to the user.
            const body = { message: "If that email exists, a reset link has been sent." };
            if (reset && process.env.NODE_ENV !== "production") body.devToken = reset.token;
            return res.status(200).json(body);
        } catch (err) {
            next(err);
        }
    }
);

// ============================================================================
// POST /reset-password  (rate-limited)
//   Body: { token, newPassword }. Validates the token against the user's current
//   hash, writes the new one (which kills the token).
// ============================================================================
router.post(
    "/reset-password",
    rateLimit({ type: "reset_password", windowMs: 15 * 60 * 1000, max: 5 }),
    async (req, res, next) => {
        try {
            const { token, newPassword } = req.body;
            if (!token || !newPassword) {
                return res.status(400).json({ error: "Missing token or newPassword" });
            }
            await resetPasswordWithToken(token, newPassword);
            return res.status(200).json({ message: "Password updated" });
        } catch (err) {
            if (/invalid|expired|at least/i.test(err.message)) {
                return res.status(400).json({ error: err.message });
            }
            next(err);
        }
    }
);

// ============================================================================
// POST /verify-email  (authenticated)
//   NOTE: a fuller flow emails a one-time token and verifies THAT. Per the spec
//   (markEmailVerified(userId) + requireAuth) this marks the authed user's email
//   verified. Swap in token verification when the email-token issuer exists.
// ============================================================================
router.post("/verify-email", requireAuth, async (req, res, next) => {
    try {
        const result = await markEmailVerified(req.user.id);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

// ============================================================================
// POST /verify-phone/request  (authenticated) — send an SMS OTP
//   TCPA: only to the number the user supplied; record sms_transactional consent
//   separately. Returns devCode outside production until an SMS provider is wired.
// ============================================================================
router.post(
    "/verify-phone/request",
    requireAuth,
    rateLimit({ type: "phone_code", windowMs: 15 * 60 * 1000, max: 5 }),
    async (req, res, next) => {
        try {
            const { code } = await setPhoneVerificationCode(req.user.id);
            // TODO: send `code` via SMS provider here.
            const body = { message: "Verification code sent" };
            if (process.env.NODE_ENV !== "production") body.devCode = code;
            return res.status(200).json(body);
        } catch (err) {
            next(err);
        }
    }
);

// ============================================================================
// POST /verify-phone  (authenticated) — submit the SMS OTP
//   Body: { code }.
// ============================================================================
router.post("/verify-phone", requireAuth, async (req, res, next) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: "Missing code" });
        const result = await markPhoneVerified(req.user.id, code);
        return res.status(200).json(result);
    } catch (err) {
        if (/code|expired|outstanding/i.test(err.message)) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});

module.exports = { router, requireAuth };
