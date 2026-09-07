const { client, withTransaction } = require("../index.js")
const { setPostTags, getPostTags } = require("../debate/tags")

// ============================================================================
// posts — the UGC surface. FOUR flavors (post_type), in two families:
//
//   attached   'wouldbe_campaign' (needs wouldbe_id) and 'debate_response'
//              (needs contestant_id + prompt_id). A video hanging off a parent.
//   written    'question' and 'artifact'. Standalone, no parent, and the post
//              IS its text — title plus body (see createWrittenPost).
//
// The table CHECK enforces both rules: exactly one parent for the first family,
// no parent at all for the second. Subject-matter tags live in post_tags (many
// per post) via the shared tags engine.
//
// moderation_status/published_at are NOT caller-settable — a user must not
// self-approve or self-publish; those move through the moderation pipeline.
//
// WHAT "PUBLIC" MEANS DIFFERS BY FAMILY, and it has to. A video is dark until a
// scanner clears it, because nobody can review a video before it is watched. Text
// is live on arrival and comes down when it is reported — the same rule comments
// already run under, and the only one that does not leave every question invisible
// until a moderation vendor that is not wired up yet says otherwise. Both rules
// are written once, below, rather than at each call site.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

const ATTACHED_TYPES = ["wouldbe_campaign", "debate_response"]
const WRITTEN_TYPES = ["question", "artifact"]
const POST_TYPES = [...ATTACHED_TYPES, ...WRITTEN_TYPES]
const VISIBILITY = ["public", "unlisted", "private", "restricted"]

// A written post is hidden once moderation has actually said something against
// it. Anything short of that — pending, or never looked at — still renders.
const HIDDEN_STATUSES = ["flagged", "rejected", "pending_human_review", "removed"]

const TITLE_MAX = 160
const BODY_MAX = 20000

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
// author_user_id comes from the token. published_at is set on approval.
//
// moderation_status is chosen HERE and never by the caller, and it is the one
// place the two families genuinely diverge:
//
//   attached  'pending_upload' — the bytes are not even in the bucket yet, and
//             the pipeline moves it forward from there.
//   written   'pending_moderation' — there is nothing to upload. Nothing has
//             looked at the text, and the feed says so by rendering it anyway;
//             what it will not do is claim a vendor approved it.
//
// A written post also gets published_at now, because it IS published now. Leaving
// it null would put "no publish date" on every question in the feed to preserve a
// verdict that nothing is waiting on.
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
    title,
    body,
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

    const written = WRITTEN_TYPES.includes(post_type)
    if (written) {
        // Trimmed before length-checking and before storing: " " is not a title,
        // and a title with a trailing newline sorts and renders differently from
        // the same title without one.
        title = typeof title === "string" ? title.trim() : title
        body = typeof body === "string" ? body.trim() : body
        if (!title) throw httpError(400, `a ${post_type} requires a title`)
        if (title.length > TITLE_MAX) {
            throw httpError(400, `title must be ${TITLE_MAX} characters or fewer`)
        }
        // An artifact is its body — one with none is a title pretending to be a
        // post. A question is answerable without context, so its body is optional.
        if (post_type === "artifact" && !body) {
            throw httpError(400, "an artifact requires a body")
        }
        if (body && body.length > BODY_MAX) {
            throw httpError(400, `body must be ${BODY_MAX} characters or fewer`)
        }
        // The DB CHECK rejects a written post carrying a parent, but a 400 that
        // names the field beats a constraint violation the caller has to decode.
        if (wouldbe_id || contestant_id || prompt_id) {
            throw httpError(400, `a ${post_type} is standalone and takes no parent id`)
        }
        body = body || null
    } else if (title != null || body != null) {
        throw httpError(400, "title/body are for questions and artifacts; use caption")
    }

    const SQL = `
        INSERT INTO posts (
            author_user_id, post_type, wouldbe_id, contestant_id, prompt_id,
            caption, video_url, thumbnail_url, duration_seconds, title, body,
            visibility, moderation_status, published_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            COALESCE($12, 'public'),
            $13,
            CASE WHEN $13 = 'pending_moderation' THEN now() ELSE NULL END
        )
        RETURNING *;
    `
    const params = [
        author_user_id, post_type, wouldbe_id, contestant_id, prompt_id,
        caption, video_url, thumbnail_url, duration_seconds, title, body,
        visibility, written ? "pending_moderation" : "pending_upload",
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

// isPubliclyRenderable — the one definition of "a stranger may see this row",
// applied to a row already in hand. The SQL twins are `publicWhere` and
// `writtenPublicWhere` below; all three say the same thing in two languages, and
// they are kept next to each other so they stay that way.
const isPubliclyRenderable = (post) => {
    if (!post || post.visibility !== "public" || post.removed_at !== null) return false
    return WRITTEN_TYPES.includes(post.post_type)
        ? !HIDDEN_STATUSES.includes(post.moderation_status)
        : post.moderation_status === "approved"
}

// getPostById — the post plus its tag rows. PUBLIC-SAFE: a post is only returned
// if it's publicly renderable OR the caller is its author. Without this, an
// unauthenticated GET /posts/:id leaked private/unlisted/pending/removed posts to
// anyone who knew the id. viewer_user_id is the authed caller's id when available
// (null for anonymous).
const getPostById = async ({ id, viewer_user_id = null }) => {
    if (!id) throw httpError(400, "id is required")
    try {
        const result = await client.query(`SELECT * FROM posts WHERE id = $1`, [id])
        const post = result.rows[0]
        if (!post) return null
        if (!isPubliclyRenderable(post) && post.author_user_id !== viewer_user_id) return null
        post.tags = await getPostTags(id)
        return post
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "id must be a valid uuid")
        console.error(err)
        throw err
    }
}

// updatePost — the AUTHOR edits their own post. Owner-scoped (id +
// author_user_id) so no one can edit someone else's post. moderation_status is
// deliberately NOT settable here — that's the §10 moderation pipeline's job; a
// user must never self-approve. Removal goes through softDeletePost.
//
// caption belongs to a video post and title/body to a written one. COALESCE means
// omitting a field leaves it alone; the CHECK still refuses to let a written post
// end up with an empty title or an artifact with an empty body, so an edit cannot
// hollow out a post that is already in the feed.
const updatePost = async ({ id, author_user_id, caption, visibility, title, body }) => {
    if (!id) throw httpError(400, "id is required")
    if (!author_user_id) throw httpError(401, "authentication required")
    if (visibility != null && !VISIBILITY.includes(visibility)) {
        throw httpError(400, `visibility must be one of: ${VISIBILITY.join(", ")}`)
    }
    if (title != null) {
        title = String(title).trim()
        if (!title) throw httpError(400, "title cannot be emptied")
        if (title.length > TITLE_MAX) {
            throw httpError(400, `title must be ${TITLE_MAX} characters or fewer`)
        }
    }
    if (body != null) {
        body = String(body).trim()
        if (body.length > BODY_MAX) {
            throw httpError(400, `body must be ${BODY_MAX} characters or fewer`)
        }
    }
    try {
        const SQL = `
            UPDATE posts SET
                caption    = COALESCE($3, caption),
                visibility = COALESCE($4, visibility),
                title      = COALESCE($5, title),
                body       = COALESCE($6, body),
                updated_at = NOW()
            WHERE id = $1 AND author_user_id = $2
            RETURNING *;
        `
        const result = await client.query(SQL, [id, author_user_id, caption, visibility, title, body])
        if (!result.rows.length) throw httpError(404, "post not found or not yours")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "that edit would leave the post without its required text")
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
// The written twin of publicWhere — the JS version is isPubliclyRenderable above.
const writtenPublicWhere = `
    p.moderation_status NOT IN ('flagged','rejected','pending_human_review','removed')
    AND p.visibility = 'public' AND p.removed_at IS NULL`

// The author, as the feed card needs them, and nothing else: no email, no
// date_of_birth, no address. A feed query that reaches for u.* is how a birthday
// ends up in a JSON response somebody screenshots.
const authorCols = `
    u.id            AS author_id,
    u.first_name    AS author_first_name,
    u.last_name     AS author_last_name,
    u.username      AS author_username,
    u.profile_photo_url AS author_photo_url`

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

// getWrittenPosts — the home feed's own query: questions and artifacts, newest
// first, with the author joined on and the engagement counted.
//
// COUNTS COME FROM SUBQUERIES, not JOINs. Two LEFT JOINs onto comments and
// post_endorsements multiply each other — a post with 4 comments and 3
// endorsements reports 12 of each — and that is the classic way a feed starts
// inventing numbers. Correlated subqueries can't do that.
//
// post_type is validated against the list rather than interpolated: it reaches
// this function from a query string.
const getWrittenPosts = async ({ post_type = null, limit = 30, offset = 0, author_user_id = null } = {}) => {
    if (post_type != null && !WRITTEN_TYPES.includes(post_type)) {
        throw httpError(400, `post_type must be one of: ${WRITTEN_TYPES.join(", ")}`)
    }
    const take = Math.min(Math.max(Number(limit) || 30, 1), 100)
    const skip = Math.max(Number(offset) || 0, 0)
    try {
        const result = await client.query(
            `SELECT p.id, p.post_type, p.title, p.body, p.image_url,
                    p.created_at, p.published_at, p.author_user_id,
                    ${authorCols},
                    -- ::int, because pg returns count() as bigint and node-pg
                    -- hands a bigint back as a STRING. "0" is truthy in JS, so a
                    -- card testing the raw count renders "0 answers" as if it
                    -- were some.
                    (SELECT count(*) FROM comments c
                      WHERE c.post_id = p.id AND c.removed_at IS NULL)::int AS comment_count,
                    (SELECT count(*) FROM post_endorsements e
                      WHERE e.post_id = p.id)::int AS endorsement_count,
                    ${tagsCol}
               FROM posts AS p
               JOIN users AS u ON u.id = p.author_user_id
              WHERE p.post_type IN ('question','artifact')
                AND ($1::text IS NULL OR p.post_type = $1)
                AND ($2::uuid IS NULL OR p.author_user_id = $2)
                AND ${writtenPublicWhere}
              ORDER BY p.created_at DESC
              LIMIT $3 OFFSET $4`,
            [post_type, author_user_id, take, skip]
        )
        return result.rows
    } catch (err) {
        if (err.code === "22P02") throw httpError(400, "author_user_id must be a valid uuid")
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
    POST_TYPES,
    WRITTEN_TYPES,
    isPubliclyRenderable,
    getWrittenPosts,
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
