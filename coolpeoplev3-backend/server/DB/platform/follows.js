const { client } = require("../index.js");

// ============================================================================
// follows — the polymorphic follow graph (User | Debate | Wouldbe). Drives the
// home feed and notification routing. (follower_id, followed_id, follow_type) is
// unique, so following twice is idempotent.
// ============================================================================

const FOLLOW_TYPES = ["User", "Debate", "Wouldbe"];

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// createFollow — follow a target. Idempotent (ON CONFLICT DO NOTHING) — re-following
// returns the existing edge rather than erroring.
const createFollow = async ({ follower_id, followed_id, follow_type }) => {
    if (!FOLLOW_TYPES.includes(follow_type)) {
        throw httpError(400, `follow_type must be one of: ${FOLLOW_TYPES.join(", ")}`);
    }
    if (follow_type === "User" && follower_id === followed_id) {
        throw httpError(400, "you cannot follow yourself");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO follows (follower_id, followed_id, follow_type)
             VALUES ($1,$2,$3)
             ON CONFLICT (follower_id, followed_id, follow_type) DO NOTHING
             RETURNING *`,
            [follower_id, followed_id, follow_type]
        );
        if (rows.length) return rows[0];
        const existing = await client.query(
            `SELECT * FROM follows WHERE follower_id = $1 AND followed_id = $2 AND follow_type = $3`,
            [follower_id, followed_id, follow_type]
        );
        return existing.rows[0];
    } catch (err) {
        if (err.code === "23503") throw httpError(400, "follower_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// deleteFollow — unfollow by edge id (owner only enforced at route).
const deleteFollow = async ({ id }) => {
    const { rows } = await client.query(`DELETE FROM follows WHERE id = $1 RETURNING *`, [id]);
    if (!rows.length) throw httpError(404, "follow not found");
    return { deleted: rows[0].id, follow: rows[0] };
};

// getFollowers({ userId }) — users following this user.
const getFollowers = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT f.id AS follow_id, u.id, u.username, u.first_name, u.last_name, f.created_at
         FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.followed_id = $1 AND f.follow_type = 'User'
         ORDER BY f.created_at DESC`,
        [userId]
    );
    return rows;
};

// getFollowing({ userId }) — users this user follows.
const getFollowing = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT f.id AS follow_id, u.id, u.username, u.first_name, u.last_name, f.created_at
         FROM follows f JOIN users u ON u.id = f.followed_id
         WHERE f.follower_id = $1 AND f.follow_type = 'User'
         ORDER BY f.created_at DESC`,
        [userId]
    );
    return rows;
};

// getHomeFeed({ userId, limit }) — posts from the WouldBes and users the caller
// follows, newest first. (Follows of type Wouldbe pull that WouldBe's posts;
// follows of type User pull posts on that user's WouldBes.)
const getHomeFeed = async ({ userId, limit = 50 }) => {
    const { rows } = await client.query(
        `SELECT po.*, w.title AS wouldbe_title, w.user_id AS wouldbe_owner_id
         FROM posts po
         JOIN wouldbe w ON w.id = po.wouldbe_id
         WHERE w.id IN (
                 SELECT followed_id FROM follows WHERE follower_id = $1 AND follow_type = 'Wouldbe'
               )
            OR w.user_id IN (
                 SELECT followed_id FROM follows WHERE follower_id = $1 AND follow_type = 'User'
               )
         ORDER BY po.created_at DESC
         LIMIT $2`,
        [userId, Math.min(Number(limit) || 50, 200)]
    );
    return rows;
};

module.exports = { createFollow, deleteFollow, getFollowers, getFollowing, getHomeFeed };
