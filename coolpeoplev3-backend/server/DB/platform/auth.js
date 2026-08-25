const { client } = require("../index");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// SECURITY: the JWT secret is the root of trust for EVERY auth + admin gate. A
// weak or missing secret means anyone can forge an admin token, so we refuse to
// boot rather than silently fall back. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
const JWT_SECRET = process.env.JWT_SECRET;
const WEAK_SECRETS = new Set([
    "shh",
    "your_super_secret_key_her",
    "secret",
    "changeme",
]);
if (!JWT_SECRET || JWT_SECRET.length < 32 || WEAK_SECRETS.has(JWT_SECRET)) {
    throw new Error(
        "FATAL: JWT_SECRET is unset, too short (<32 chars), or a known-weak value. " +
            "Refusing to start. Set a strong random JWT_SECRET in .env — generate one with: " +
            'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
}
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}:refresh`;
const ACCESS_TTL = "7d";
const REFRESH_TTL = "30d";
const PASSWORD_RESET_TTL = "30m";
const PHONE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Centralized token minting so the signing logic lives in one place.
const signAccessToken = (user) =>
    jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: ACCESS_TTL });
const signRefreshToken = (user) =>
    jwt.sign({ id: user.id, type: "refresh" }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });

// Per-user secret for password-reset tokens: binds the token to the user's
// CURRENT password hash, so the token dies the moment the password changes (and
// at the 30m expiry). This is what makes the reset single-use WITHOUT a table.
const resetSecretFor = (user) => `${JWT_SECRET}:pwd_reset:${user.password}`;

// authenticate({username, password}) — look up by username, bcrypt-compare,
// return { token, user } on success or null on bad credentials.
const authenticate = async ({ username, password }) => {
    try {
        const SQL = `SELECT id, username, email, password FROM users WHERE username = $1`;
        const response = await client.query(SQL, [username]);

        if (!response.rows.length) {
            console.log("no user found with username");
            return null;
        }

        const user = response.rows[0];

        // ✅ Compare password using bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            console.log("password not a match");
            return null;
        }

        // ✅ Generate JWT Token
        const token = signAccessToken(user);

        // Never hand the bcrypt hash back to the caller.
        delete user.password;

        // ✅ Return both token & user data
        return { token, user };
    } catch (err) {
        console.error("❌ Authentication Error:", err);
        throw err;
    }
};

// findUserByToken(token) — verify the JWT and fetch the user it points to.
const findUserByToken = async (token) => {
    try {
        if (!token) {
            console.log("no token provided");
            return null;
        }

        // ✅ Extract actual token (if prefixed with "Bearer ")
        if (token.startsWith("Bearer")) {
            token = token.split(" ")[1];
        }

        // ✅ Verify the token
        const payload = jwt.verify(token, JWT_SECRET);

        // ✅ Fetch user from the database (no password hash needed here)
        const SQL = `SELECT id, username, email, first_name, last_name FROM users WHERE id = $1`;
        const response = await client.query(SQL, [payload.id]);

        const user = response.rows[0];
        if (!user) {
            console.log("user not found");
            return null;
        }

        return user;
    } catch (err) {
        // An expired or malformed token is the NORMAL way a session ends — every
        // stale tab replays one on load. Printing a full stack for it buries the
        // errors that actually matter (four identical traces per page load was
        // the whole log). Callers still get the throw; requireAuth turns it into
        // a 401. Anything else IS unexpected and keeps its trace.
        if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError") {
            console.log(`auth: rejected token (${err.name})`);
        } else {
            console.error("❌ Authentication Error:", err);
        }
        throw err;
    }
};

// verifyRefreshToken(token) — verify a refresh token and return the user it
// points to (so the caller can mint a fresh access token), or null. Stateless:
// no server-side revocation/rotation yet — add a Redis/DB store of issued
// refresh-token ids if you need "log out all devices". (logout itself is a
// client-side token-drop; see authRoutes POST /logout.)
const verifyRefreshToken = async (token) => {
    try {
        if (!token) return null;
        if (token.startsWith("Bearer")) token = token.split(" ")[1];

        let payload;
        try {
            payload = jwt.verify(token, REFRESH_SECRET);
        } catch {
            return null; // expired/tampered
        }
        if (payload.type !== "refresh") return null;

        const SQL = `SELECT id, username, email, first_name, last_name FROM users WHERE id = $1`;
        const { rows } = await client.query(SQL, [payload.id]);
        return rows[0] || null;
    } catch (err) {
        console.error("❌ verifyRefreshToken Error:", err);
        throw err;
    }
};

// createPasswordResetToken(email) — issue a short-lived, single-use reset token.
// No table/Redis needed (see resetSecretFor). Returns { token, userId } or null
// if no ACTIVE account has that email — null lets the route return a generic
// 200 so the endpoint can't be used to enumerate accounts. Emailing is the
// route's job.
const createPasswordResetToken = async (email) => {
    try {
        const { rows } = await client.query(
            `SELECT id, password FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true`,
            [email]
        );
        if (!rows.length) return null;
        const user = rows[0];
        const token = jwt.sign({ id: user.id, purpose: "pwd_reset" }, resetSecretFor(user), {
            expiresIn: PASSWORD_RESET_TTL,
        });
        return { token, userId: user.id };
    } catch (err) {
        console.error("❌ createPasswordResetToken Error:", err);
        throw err;
    }
};

// resetPasswordWithToken(token, newPwd) — validate the token against the user's
// CURRENT hash, then write a new bcrypt hash. Success changes the hash, which
// instantly invalidates this (and any other outstanding) reset token.
const resetPasswordWithToken = async (token, newPwd) => {
    if (!newPwd || newPwd.length < 8) {
        throw new Error("password must be at least 8 characters");
    }
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id || decoded.purpose !== "pwd_reset") {
        throw new Error("invalid reset token");
    }
    const { rows } = await client.query(`SELECT id, password FROM users WHERE id = $1`, [decoded.id]);
    if (!rows.length) throw new Error("invalid reset token");
    const user = rows[0];
    try {
        jwt.verify(token, resetSecretFor(user)); // signature + expiry + hash-unchanged
    } catch {
        throw new Error("reset token is invalid or expired");
    }
    const hashedPassword = await bcrypt.hash(newPwd, 10);
    await client.query(`UPDATE users SET password = $2, updated_at = NOW() WHERE id = $1`, [
        user.id,
        hashedPassword,
    ]);
    return { id: user.id };
};

// markEmailVerified(userId) — idempotent setter the /verify-email route calls.
// Stamps email_verified_at once (COALESCE keeps the first verification time).
const markEmailVerified = async (userId) => {
    const { rows } = await client.query(
        `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
         WHERE id = $1 RETURNING id, email, email_verified_at`,
        [userId]
    );
    if (!rows.length) throw new Error("no user found with this ID");
    return rows[0];
};

// setPhoneVerificationCode(userId) — generate a 6-digit OTP, store ONLY its
// bcrypt hash + a 10-min expiry, and return the plaintext code so the route can
// SMS it. Companion to markPhoneVerified. (TCPA: only send to a number the user
// supplied, and log sms_transactional consent separately via recordConsent.)
const setPhoneVerificationCode = async (userId) => {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const code_hash = await bcrypt.hash(code, 10);
    const expires = new Date(Date.now() + PHONE_CODE_TTL_MS).toISOString();
    const { rows } = await client.query(
        `UPDATE users SET phone_verification_code_hash = $2, phone_verification_expires_at = $3
         WHERE id = $1 RETURNING id`,
        [userId, code_hash, expires]
    );
    if (!rows.length) throw new Error("no user found with this ID");
    return { code }; // route sends via SMS; never log this
};

// markPhoneVerified(userId, code) — compare the submitted OTP to the stored
// hash, check it hasn't expired, then stamp phone_verified_at and clear the code.
const markPhoneVerified = async (userId, code) => {
    const { rows } = await client.query(
        `SELECT phone_verification_code_hash AS hash, phone_verification_expires_at AS expires
         FROM users WHERE id = $1`,
        [userId]
    );
    if (!rows.length) throw new Error("no user found with this ID");
    const { hash, expires } = rows[0];
    if (!hash || !expires) throw new Error("no verification code outstanding");
    if (new Date(expires).getTime() < Date.now()) throw new Error("verification code expired");

    const ok = await bcrypt.compare(String(code), hash);
    if (!ok) throw new Error("incorrect verification code");

    const { rows: updated } = await client.query(
        `UPDATE users SET phone_verified_at = NOW(),
                          phone_verification_code_hash = NULL,
                          phone_verification_expires_at = NULL,
                          updated_at = NOW()
         WHERE id = $1 RETURNING id, phone_number, phone_verified_at`,
        [userId]
    );
    return updated[0];
};

module.exports = {
    authenticate,
    findUserByToken,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    createPasswordResetToken,
    resetPasswordWithToken,
    markEmailVerified,
    setPhoneVerificationCode,
    markPhoneVerified,
};
