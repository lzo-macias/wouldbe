const { client, withTransaction } = require("../index.js")
const { setPostTags, getPostTags } = require("../debate/tags")

// ============================================================================
// posts — the UGC surface. Two flavors (post_type): 'wouldbe_campaign' (needs
// wouldbe_id) and 'debate_response' (needs contestant_id + prompt_id) — the DB
// CHECK enforces exactly one parent. Subject-matter tags live in post_tags (many
// per post) via the shared tags engine. moderation_status/published_at are NOT
// caller-settable — a user must not self-approve or self-publish; those move
// through the moderation pipeline.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const POST_TYPES = ["wouldbe_campaign", "debate_response"]
const VISIBILITY = ["public", "unlisted", "private", "restricted"]

// getVisiblePostMedia — media for a publicly-renderable post (approved + public +
// not removed). Returns null otherwise.
const getVisiblePostMedia = async ({ id }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const result = await client.query(
            `SELECT video_url, thumbnail_url
             FROM posts
             WHERE id = $1
               AND moderation_status = 'approved'
               AND visibility = 'public'
               AND removed_at IS NULL`,
            [id]
        )
        return result.rows[0] || null
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getPostMedia — media regardless of moderation/visibility (owner/admin variant).
const getPostMedia = async ({ id }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const result = await client.query(
            `SELECT video_url, thumbnail_url FROM posts WHERE id = $1`,
            [id]
        )
        return result.rows[0] || null
    } catch (err) {
        console.error(err)
        throw err
    }
}

// createPost — create a post and (optionally) its subject-matter tags atomically.
// author_user_id comes from the token. moderation_status defaults to
// 'pending_upload' (the pipeline approves later); published_at is set on approval.
const createPost = async ({
    author_user_id,
    post_type,
    wouldbe_id,
    contestant_id,
    prompt_id,
    caption,
    video_url,
    thumbnail_url,
    duration_seconds,
    visibility,
    category_keys, // optional array of category_key
}) => {
    if (!author_user_id) throw httpError(401, "must be signed in to post")
    if (!POST_TYPES.includes(post_type)) {
        throw httpError(400, `post_type must be one of: ${POST_TYPES.join(", ")}`)
    }
    if (post_type === "wouldbe_campaign" && !wouldbe_id) {
        throw httpError(400, "wouldbe_campaign posts require wouldbe_id")
    }
    if (post_type === "debate_response" && (!contestant_id || !prompt_id)) {
        throw httpError(400, "debate_response posts require contestant_id and prompt_id")
    }
    if (visibility != null && !VISIBILITY.includes(visibility)) {
        throw httpError(400, `visibility must be one of: ${VISIBILITY.join(", ")}`)
    }

    const SQL = `
        INSERT INTO posts (
            author_user_id, post_type, wouldbe_id, contestant_id, prompt_id,
            caption, video_url, thumbnail_url, duration_seconds, visibility
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'public'))
        RETURNING *;
    `
    const params = [
        author_user_id, post_type, wouldbe_id, contestant_id, prompt_id,
        caption, video_url, thumbnail_url, duration_seconds, visibility,
    ]

    try {
        // No tags → single insert. With tags → insert + tag on one connection.
        if (!Array.isArray(category_keys) || category_keys.length === 0) {
            const result = await client.query(SQL, params)
            return { ...result.rows[0], tags: [] }
        }
        return await withTransaction(async (tx) => {
            const result = await tx.query(SQL, params)
            const post = result.rows[0]
            const tags = await setPostTags(post.id, category_keys, tx)
            return { ...post, tags }
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "post violates a constraint (check post_type/parent ids)")
        if (err.code === "23503") throw httpError(400, "author, wouldbe, contestant or prompt id does not exist")
        console.error(err)
        throw err
    }
}

// getPostById — the post plus its tag rows. PUBLIC-SAFE: a post is only returned
// if it's publicly renderable (approved + public + not removed) OR the caller is
// its author. Without this, an unauthenticated GET /posts/:id leaked private/
// unlisted/pending/removed posts to anyone who knew the id. viewer_user_id is the
// authed caller's id when available (null for anonymous).
const getPostById = async ({ id, viewer_user_id = null }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const result = await client.query(`SELECT * FROM posts WHERE id = $1`, [id])
        const post = result.rows[0]
        if (!post) return null
        const publiclyVisible =
            post.moderation_status === "approved" &&
            post.visibility === "public" &&
            post.removed_at === null
        if (!publiclyVisible && post.author_user_id !== viewer_user_id) return null
        post.tags = await getPostTags(id)
        return post
    } catch (err) {
        console.error(err)
        throw err
    }
}

// updatePost — the AUTHOR edits their own post's caption/visibility. Owner-scoped
// (id + author_user_id) so no one can edit someone else's post. moderation_status
// is deliberately NOT settable here — that's the §10 moderation pipeline's job; a
// user must never self-approve. Removal goes through softDeletePost.
const updatePost = async ({ id, author_user_id, caption, visibility }) => {
    if (!id) throw httpError(400, "id is required")
    if (!author_user_id) throw httpError(401, "authentication required")
    if (visibility != null && !VISIBILITY.includes(visibility)) {
        throw httpError(400, `visibility must be one of: ${VISIBILITY.join(", ")}`)
    }
    try {
        const SQL = `
            UPDATE posts SET
                caption    = COALESCE($3, caption),
                visibility = COALESCE($4, visibility),
                updated_at = NOW()
            WHERE id = $1 AND author_user_id = $2
            RETURNING *;
        `
        const result = await client.query(SQL, [id, author_user_id, caption, visibility])
        if (!result.rows.length) throw httpError(404, "post not found or not yours")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid visibility value")
        console.error(err)
        throw err
    }
}

// updatePostTags — REPLACE a post's tag set with the given list (add some / drop
// some = send the full desired set). setPostTags handles the delete+insert.
const updatePostTags = async ({ id, category_keys }) => {
    if (!id) throw httpError(400, "id is required")
    return setPostTags(id, category_keys)
}

// softDeletePost — the AUTHOR withdraws their own post (preserve the row for
// thread continuity; no hard delete). Owner-scoped so a caller can only remove
// their own post; admin/moderator takedowns go through the §10 moderation path.
const softDeletePost = async ({ id, author_user_id, removed_reason = null }) => {
    if (!id) throw httpError(400, "id is required")
    if (!author_user_id) throw httpError(401, "authentication required")
    try {
        const result = await client.query(
            `UPDATE posts
             SET removed_at = NOW(), removed_reason = $3, updated_at = NOW()
             WHERE id = $1 AND author_user_id = $2 AND removed_at IS NULL
             RETURNING *;`,
            [id, author_user_id, removed_reason]
        )
        if (!result.rows.length) throw httpError(409, "post not found, not yours, or already removed")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        console.error(err)
        throw err
    }
}

// Shared bits for the public post-list feeds. tagsCol attaches each post's tag
// keys as an ARRAY via a correlated subquery — so untagged posts still appear and
// a multi-tag post is NOT duplicated into several rows (an inner JOIN on post_tags
// would do both wrong). publicWhere limits to renderable posts.
const tagsCol = `
    COALESCE(
        (SELECT array_agg(t.category_key ORDER BY t.category_key)
         FROM post_tags t WHERE t.post_id = p.id),
        '{}'
    ) AS category_keys`
const publicWhere = `p.moderation_status = 'approved' AND p.visibility = 'public' AND p.removed_at IS NULL`

// getPostsForWouldbe — public campaign posts for a WouldBe, newest first.
const getPostsForWouldbe = async ({ wouldbe_id }) => {
    if (!wouldbe_id) throw httpError(400, "wouldbe_id is required")
    try {
        const result = await client.query(
            `SELECT p.*, ${tagsCol}
             FROM posts AS p
             WHERE p.wouldbe_id = $1 AND ${publicWhere}
             ORDER BY p.created_at DESC`,
            [wouldbe_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getPostsForDebate — public response posts across a whole debate. Posts have no
// debate_id, so we reach the debate through the contestant (contestant_id ->
// contestants.debate_id). For a single prompt's responses, filter by prompt_id.
const getPostsForDebate = async ({ debate_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const result = await client.query(
            `SELECT p.*, ${tagsCol}
             FROM posts AS p
             JOIN contestants c ON c.id = p.contestant_id
             WHERE c.debate_id = $1 AND ${publicWhere}
             ORDER BY p.created_at DESC`,
            [debate_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getUserPosts — a user's public posts (profile view). For the owner's OWN view,
// add a variant without the public/approved filter so they see pending/private.
const getUserPosts = async ({ author_user_id }) => {
    if (!author_user_id) throw httpError(400, "author_user_id is required")
    try {
        const result = await client.query(
            `SELECT p.*, ${tagsCol}
             FROM posts AS p
             WHERE p.author_user_id = $1 AND ${publicWhere}
             ORDER BY p.created_at DESC`,
            [author_user_id]
        )
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    getVisiblePostMedia,
    getPostMedia,
    createPost,
    getPostById,
    updatePost,
    updatePostTags,
    softDeletePost,
    getPostsForWouldbe,
    getPostsForDebate,
    getUserPosts,
}
