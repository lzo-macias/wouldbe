const {
    fetchPublicUserById,
    getUserDebateHistory,
    getUserCurrentDebates,
} = require("./users.js")
const { listReviewsForUser, getReviewSummary } = require("./reviews.js")
const { listUserWouldbes } = require("../candidacy/wouldbe.js")
const { getUserInterests } = require("../elections/interests.js")

// ============================================================================
// userFull — the one-request payload behind a user's profile page.
//
// WHY IT EXISTS: rendering that page otherwise means SIX round trips
// (/users/:id, /interests, /reviews, /debates, /debate-history, /wouldbes),
// each with its own loading state and its own chance to arrive out of order.
// The page needs all of them before it shows anything meaningful, so it is one
// read. Same reasoning, same shape, as getDebateFull.
//
// Lives in its own module rather than users.js so the aggregate's dependency on
// four other domains doesn't drag those requires into every caller of users.js.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// getUserFull — a user and everything their profile needs, in one read.
//
// viewer_user_id is OPTIONAL and only ever widens what comes back. It decides:
//   is_self          — is this the viewer's own profile
//   wouldbes         — the owner also sees their unlisted/draft campaigns
//   interests        — see the privacy note below
//   reviews.my_review— the viewer's own review, even if moderated
//
// The profile row is awaited FIRST: a 404 should not fan out five more queries.
// The rest do not depend on each other, so they run together.
const getUserFull = async ({ user_id, viewer_user_id = null }) => {
    if (!user_id) throw httpError(400, "user_id is required")
    try {
        // fetchPublicUserById throws a bare Error on a miss and filters on
        // is_active, so a deactivated account is a 404 here too. It strips
        // date_of_birth and returns derived age/age_band instead.
        let user
        try {
            user = await fetchPublicUserById({ id: user_id })
        } catch {
            throw httpError(404, "user not found")
        }

        const isSelf = !!viewer_user_id && viewer_user_id === user_id

        const [
            interests,
            reviews,
            reviewSummary,
            currentDebates,
            debateHistory,
            wouldbes,
        ] = await Promise.all([
            // PRIVACY: the standalone GET /users/:id/interests is behind
            // requireAuth. Loosening that here would silently make a gated field
            // public through a side door, so this mirrors the existing rule —
            // logged-out callers get null, not the list. null (not []) so the
            // client can tell "hidden from you" from "has none".
            viewer_user_id
                ? getUserInterests({ userId: user_id })
                : Promise.resolve(null),
            listReviewsForUser({ reviewed_user_id: user_id }),
            getReviewSummary({ reviewed_user_id: user_id }),
            getUserCurrentDebates({ id: user_id }),
            getUserDebateHistory({ id: user_id }),
            // includeUnlisted only for the owner — drafts and unlisted campaigns
            // are not published, and this payload is readable by anyone.
            listUserWouldbes({ user_id, includeUnlisted: isSelf }),
        ])

        return {
            user,
            is_self: isSelf,
            interests,
            reviews,
            review_summary: reviewSummary,
            // Kept as two lists rather than merged: /debates is what is LIVE and
            // /debate-history is the full record, and a profile shows them in
            // different places. Merging would force every caller to re-split.
            current_debates: currentDebates,
            debate_history: debateHistory,
            wouldbes,
            // Derived here so every caller counts them the same way.
            total_wouldbes: wouldbes.length,
            total_debates: debateHistory.length,
        }
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "user_id is malformed")
        console.error(err)
        throw err
    }
}

module.exports = { getUserFull }
