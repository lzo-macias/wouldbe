const { client } = require("../index");
const bcrypt = require("bcrypt");

// ============================================================================
// Helpers
// ============================================================================

// Derive age_band from a date_of_birth on demand. Compares against today, so
// the band naturally shifts as soon as a user crosses a threshold — no cron,
// no stored column to keep in sync. Use this anywhere the API exposes age
// category without exposing the DOB itself.
const deriveAgeBand = (dateOfBirth) => {
    if (!dateOfBirth) return null;
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    // [CORRECTION] these must match child_safety_records.age_band's CHECK (and
    // childSafety.js deriveAgeBand). The old ladder ('18_plus','21_plus',...) was
    // divergent and would mismatch anything comparing against the canonical bands.
    if (age < 13) return 'under_13';
    if (age < 18) return '13_17';
    if (age < 25) return '18_24';
    if (age < 30) return '25_29';
    if (age < 35) return '30_34';
    if (age < 40) return '35_39';
    if (age < 45) return '40_44';
    if (age < 50) return '45_49';
    if (age < 55) return '50_54';
    if (age < 60) return '55_59';
    if (age < 65) return '60_64';
    if (age < 70) return '65_69';
    if (age < 75) return '70_74';
    if (age < 80) return '75_79';
    if (age < 85) return '80_84';
    if (age < 90) return '85_89';
    return '90_plus';
};

// ============================================================================
// Create
// ============================================================================

const createUsers = async ({
    first_name,           // [CORRECTION] required (NOT NULL); INSERT failed without these
    last_name,
    username,
    password,
    political_lean,
    phone_number,
    date_of_birth,
    email = null,
    address = null,
    state = null,
    profile_photo_url = null,
    bio = null,
}) => {
    try {
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // Don't match every NULL-email user when the new signup has no email.
        const check_SQL = `
            SELECT id FROM users
            WHERE username = $1
               OR ($2::text IS NOT NULL AND email = $2)
        `;
        const { rows } = await client.query(check_SQL, [username, normalizedEmail]);
        if (rows.length > 0) {
            throw new Error("user with this username or email already exists");
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const SQL = `
            INSERT INTO users (
                id, first_name, last_name, username, password, political_lean,
                phone_number, date_of_birth, email, address, state,
                profile_photo_url, bio, created_at
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
            ) RETURNING *;
        `;
        const result = await client.query(SQL, [
            first_name, last_name, username, hashedPassword, political_lean,
            phone_number, date_of_birth, normalizedEmail, address, state,
            profile_photo_url, bio
        ]);
        const user = result.rows[0];
        user.age_band = deriveAgeBand(user.date_of_birth);
        return user;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// ============================================================================
// Read
// ============================================================================

const fetchUserById = async ({ id }) => {
    try {
        const SQL = `
            SELECT id, first_name, last_name, username, date_of_birth, state,
                   city, zip_code, address, phone_number, email, political_lean,
                   profile_photo_url, bio, is_active, created_at, last_login_at
            FROM users WHERE id = $1
        `;
        const { rows } = await client.query(SQL, [id]);
        if (rows.length === 0) throw new Error("no users found with this ID");
        const user = rows[0];
        user.age_band = deriveAgeBand(user.date_of_birth);
        return user;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const fetchPublicUserById = async ({ id }) => {
    try {
        // Pull DOB only to derive age_band; never return it.
        const SQL = `
            SELECT id, first_name, last_name, username, bio, profile_photo_url,
                   political_lean, date_of_birth
            FROM users WHERE id = $1 AND is_active = true
        `;
        const { rows } = await client.query(SQL, [id]);
        if (rows.length === 0) throw new Error("no users found with this ID");
        const { date_of_birth, ...publicFields } = rows[0];
        publicFields.age_band = deriveAgeBand(date_of_birth);
        return publicFields;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const fetchUsernameById = async ({ id }) => {
    try {
        const { rows } = await client.query(`SELECT username FROM users WHERE id = $1`, [id]);
        if (rows.length === 0) throw new Error("no users found with this ID");
        return rows[0].username;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// Used by auth + DSR flows — needs the full row, not just the id.
const getUserByEmail = async ({ email }) => {
    try {
        const { rows } = await client.query(
            `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
            [email]
        );
        if (rows.length === 0) throw new Error("no user found with this email");
        const user = rows[0];
        user.age_band = deriveAgeBand(user.date_of_birth);
        return user;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const fetchIdbyEmail = async ({ email }) => {
    try {
        const { rows } = await client.query(
            `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
            [email]
        );
        if (rows.length === 0) throw new Error("no users found with this email");
        return rows[0].id;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// ============================================================================
// Update
// ============================================================================

const updateUser = async ({ id, payload }) => {
    try {
        const {
            first_name, last_name, username, date_of_birth, password,
            state, city, zip_code, address, phone_number, email,
            political_lean, profile_photo_url, bio
        } = payload;

        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // Block taking another user's email or username.
        if (normalizedEmail || username) {
            const conflictSQL = `
                SELECT id FROM users
                WHERE id <> $1
                  AND ( ($2::text IS NOT NULL AND username = $2)
                     OR ($3::text IS NOT NULL AND email = $3) )
                LIMIT 1
            `;
            const { rows: conflicts } = await client.query(
                conflictSQL, [id, username || null, normalizedEmail]
            );
            if (conflicts.length > 0) {
                throw new Error("username or email already taken by another user");
            }
        }

        const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

        // COALESCE preserves the existing value when the patch field is null.
        const SQL = `
            UPDATE users
            SET first_name        = COALESCE($1, first_name),
                last_name         = COALESCE($2, last_name),
                username          = COALESCE($3, username),
                date_of_birth     = COALESCE($4, date_of_birth),
                password          = COALESCE($5, password),
                state             = COALESCE($6, state),
                city              = COALESCE($7, city),
                zip_code          = COALESCE($8, zip_code),
                address           = COALESCE($9, address),
                phone_number      = COALESCE($10, phone_number),
                email             = COALESCE($11, email),
                political_lean    = COALESCE($12, political_lean),
                profile_photo_url = COALESCE($13, profile_photo_url),
                bio               = COALESCE($14, bio),
                updated_at        = NOW()
            WHERE id = $15
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            first_name, last_name, username, date_of_birth, hashedPassword,
            state, city, zip_code, address, phone_number, normalizedEmail,
            political_lean, profile_photo_url, bio, id
        ]);
        if (result.rowCount === 0) throw new Error("no users found with this ID");
        const user = result.rows[0];
        user.age_band = deriveAgeBand(user.date_of_birth);
        return user;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const deactivateUser = async ({ id }) => {
    try {
        const SQL = `
            UPDATE users SET is_active = false, updated_at = NOW()
            WHERE id = $1 RETURNING id
        `;
        const result = await client.query(SQL, [id]);
        if (result.rowCount === 0) throw new Error("no user found with this ID");
        return result.rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const updateUserLastLogin = async ({ id }) => {
    try {
        // [CLARIFICATION 2026-05-29] session_count drives the "after 3 sessions, ask for address"
        // prompt. Bumped here on each login; the handler reads the returned count to decide whether
        // the address-collection prompt is due.
        const SQL = `
            UPDATE users SET last_login_at = NOW(), session_count = session_count + 1
            WHERE id = $1
            RETURNING id, last_login_at, session_count
        `;
        const result = await client.query(SQL, [id]);
        if (result.rowCount === 0) throw new Error("no user found with this ID");
        return result.rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// ============================================================================
// Related entities
// ============================================================================

const getCurrentUserWouldbes = async ({ id }) => {
    try {
        const { rows } = await client.query(`
            SELECT * FROM wouldbe
            WHERE user_id = $1 AND retired = false
            ORDER BY created_at DESC
        `, [id]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const getAllUserWouldbes = async ({ id }) => {
    try {
        const { rows } = await client.query(`
            SELECT * FROM wouldbe
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [id]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const getUserCurrentDebates = async ({ id }) => {
    try {
        const { rows } = await client.query(`
            SELECT
                d.id                  AS debate_id,
                d.sponsor_id,
                d.title,
                d.description,
                d.status              AS debate_status,
                d.win_type,
                d.scoring_methodology,
                d.prize_distribution_rules,
                d.participation_type,
                d.sponsor_contribution_cents,
                d.platform_top_up_cents,
                d.user_contributions_cents,
                d.start_date,
                d.end_date,
                c.id                  AS contestant_id,
                c.status              AS contestant_status,
                c.joined_at
            FROM contestants c
            JOIN debates d ON d.id = c.debate_id
            WHERE c.user_id = $1
              AND c.status NOT IN ('withdrawn', 'disqualified')
              AND d.status NOT IN ('closed', 'cancelled')
              AND d.retired = false
            ORDER BY c.joined_at DESC
        `, [id]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const getUserEndorsementHistory = async ({ id }) => {
    try {
        const { rows } = await client.query(`
            SELECT
                e.id                AS endorsement_id,
                e.post_id,
                e.endorser_user_id,
                e.prompt_id,
                e.debate_id,
                e.endorsement_type,
                e.endorsed_user_id,
                e.contestant_id,
                e.endorsement_text,
                e.criterion_id,
                e.created_at        AS endorsed_at,
                p.author_user_id,
                p.post_type,
                p.caption,
                p.video_url,
                p.thumbnail_url,
                p.duration_seconds,
                p.moderation_status,
                p.visibility,
                pr.prompt_type,
                pr.title            AS prompt_title,
                pr.body             AS prompt_body,
                pr.image_url        AS prompt_image_url
            FROM post_endorsements e
            LEFT JOIN posts   p  ON p.id  = e.post_id
            LEFT JOIN prompts pr ON pr.id = e.prompt_id
            WHERE e.endorsed_user_id = $1
              AND (p.visibility IS NULL OR p.visibility = 'public')
            ORDER BY e.created_at DESC
        `, [id]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// searchUsers({q, limit}) — public people-search. ILIKE on username/first/last;
// returns only public-safe fields (never PII) for active users. username is
// CITEXT so the match is case-insensitive. limit is capped at 100.
const searchUsers = async ({ q, limit = 20 }) => {
    try {
        if (!q || !q.trim()) return [];
        const term = `%${q.trim()}%`;
        const cap = Math.min(Number(limit) || 20, 100);
        const { rows } = await client.query(
            `SELECT id, username, first_name, last_name, profile_photo_url
             FROM users
             WHERE is_active = true
               AND (username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
             ORDER BY username
             LIMIT $2`,
            [term, cap]
        );
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = {
    createUsers,
    searchUsers,
    fetchIdbyEmail,
    fetchUsernameById,
    fetchPublicUserById,
    fetchUserById,
    getUserByEmail,
    updateUser,
    deactivateUser,
    getCurrentUserWouldbes,
    getAllUserWouldbes,
    getUserCurrentDebates,
    getUserEndorsementHistory,
    updateUserLastLogin,
    deriveAgeBand,
};
