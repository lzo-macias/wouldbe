const { client } = require("../index.js")

const { getDebateContestants } = require("./contestants")
const { getDebateNominationCounts } = require("./nominations")
const { getCurrentDebateRules } = require("./debateRules")
const { getDebateCriteria } = require("./debateCriteria")

// ============================================================================
// debateFull — the one-request payload behind a debate's detail page.
//
// WHY IT EXISTS: rendering that page otherwise means five round trips
// (/debates/:id, /contestants, /nominations, /rules, /criteria), each with its
// own loading state and its own chance to arrive out of order. The page needs
// all five before it can show anything meaningful, so it is one read.
//
// Lives in its own module rather than debates.js because that file is marked
// off below its practice section.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// _getDebateHeader — the debate row plus the sponsor identity the page renders
// alongside it. getDebateById returns a bare `debates.*`, which leaves the
// caller unable to name or picture the host, and — more importantly — unable to
// answer "am I the sponsor?": debates.sponsor_id is a SPONSORS id, not a user
// id, so comparing it to a logged-in user id never matches. sponsor_user_id is
// the column that comparison actually wants.
const _getDebateHeader = async ({ debate_id }) => {
    const SQL = `
        SELECT
            d.*,
            s.display_name AS sponsor_name,
            s.user_id      AS sponsor_user_id,
            -- A corporate sponsor has a logo; a casual one is just a person, so
            -- fall back to their own avatar (same rule as listCurrentDebates).
            COALESCE(s.logo_url, su.profile_photo_url) AS sponsor_photo_url,
            s.verified_at  AS sponsor_verified_at
        FROM debates d
        JOIN sponsors s ON s.id = d.sponsor_id
        LEFT JOIN users su ON su.id = s.user_id
        WHERE d.id = $1
    `
    const result = await client.query(SQL, [debate_id])
    return result.rows[0] || null
}

// getDebateFull — a debate and everything its page needs, in one read.
//
// viewer_user_id is OPTIONAL and only ever widens what comes back: it decides
// is_sponsor, and it is what lets the host reach their own unpublished draft.
// Drafts, cancellations and retired rows are 404 to everyone else — the same
// visibility rule listSponsoredDebates uses, kept identical on purpose so a
// debate cannot be listed in one place and unreachable in the other.
//
// The four child reads do not depend on each other, so they run together; the
// header is awaited first because a 404 should not fan out four more queries.
const getDebateFull = async ({ debate_id, viewer_user_id = null }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    try {
        const debate = await _getDebateHeader({ debate_id })
        if (!debate) throw httpError(404, "debate not found")

        const isSponsor =
            !!viewer_user_id && debate.sponsor_user_id === viewer_user_id
        const unlisted =
            debate.retired || ["draft", "cancelled"].includes(debate.status)
        // Indistinguishable from a bad id on purpose — a 403 here would confirm
        // that someone's unpublished draft exists.
        if (unlisted && !isSponsor) throw httpError(404, "debate not found")

        const [contestants, nominations, rules, criteria] = await Promise.all([
            getDebateContestants({ debate_id }),
            getDebateNominationCounts({ debate_id }),
            getCurrentDebateRules({ debate_id }),
            getDebateCriteria({ debate_id }),
        ])

        return {
            debate,
            is_sponsor: isSponsor,
            contestants,
            nominations,
            rules,
            criteria,
            // Derived here so every caller counts them the same way. contestants
            // is already the active roster (withdrawn and disqualified are
            // filtered out), and nominations has one row per nominee.
            total_contestants: contestants.length,
            total_nominees: nominations.length,
        }
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        console.error(err)
        throw err
    }
}

module.exports = { getDebateFull }
