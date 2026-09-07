// ============================================================================
// feedFilters — what the feed can be narrowed and ordered by.
//
// SEPARATE FROM homeFilters.js on purpose. That module is the v1 grid's shape
// (status / type / lean / goalSort) and Grid2x still fetches with it; changing
// it under that page would break a screen nobody asked me to touch.
//
// WHAT WENT, AND WHY
//   status      — every kind has a different lifecycle (a debate is open or
//                 settled, a would be is funding or filed, a question is never
//                 anything but open, an artifact is published) so one status
//                 axis meant one word standing for four different states.
//   contentious — there is no contentiousness score in the database. It was a
//                 disabled control that taught people the panel does nothing.
//
// WHAT THE FEED IS ACTUALLY ABOUT, and therefore what it filters on:
//   · WHICH KINDS you want to see at all
//   · MONEY — a debate's purse, a would be's goal. This is a fundraising
//     platform; the size of what is at stake is the first question.
//   · TIME — days to a deadline, which only two kinds have.
//   · ENGAGEMENT — likes, reposts and responses together. That is "trending".
//
// EVERY MONEY FIGURE IS CENTS, as everywhere else in this app.
// ============================================================================

// The panel owns the vocabulary (FilterPanel.jsx: KINDS, GROUPS, SECTIONS) —
// this module owns what the feed DOES with it. Keeping the two apart means the
// control can be restyled without touching the ranking, which is exactly what
// just happened.
//
// The shape is { kinds: string[], picks: { order, prize, purse, goal, stage } }.

export const DEFAULT_FEED_FILTERS = {
    kinds: ['debate', 'wouldbe', 'question', 'artifact'],
    picks: { order: 'trending', prize: 'any', purse: 'any', goal: 'any', stage: 'any' },
}

// EVERY MONEY FIGURE IS CENTS, as everywhere else in this app.
const PURSE = { any: 0, '500': 50000, '1k': 100000, '5k': 500000 }
const GOAL = { any: 0, '5k': 500000, '25k': 2500000, '100k': 10000000 }

// ENGAGEMENT IS ONE NUMBER, not three. Likes, reposts and responses are all a
// reader spending something, and ranking on any one of them alone rewards the
// post that happens to farm that one. Summed, "trending" means what people
// assume it means: the thing the room is actually doing something about.
export const engagementOf = (p) => {
    let n = 0
    ;(p.responses || []).forEach((r) => {
        n += (r.likes || 0) + (r.reposts || 0) + (r.comments || 0)
    })
    ;(p.answers || []).forEach((a) => {
        n += (a.likes || 0) + (a.reposts || 0) + (a.replies || 0)
    })
    ;(p.comments || []).forEach((c) => { n += (c.likes || 0) + (c.reposts || 0) })
    return n
}

// The clock a post is running against, in days, or null when it has none. Only
// a debate with a purse and a would be with a filing date run against one; a
// question stays open and an artifact is a thing somebody wrote.
export const daysOf = (p) => {
    if (p.kind === 'wouldbe') return p.funding?.days ?? null
    if (p.kind === 'question' || p.kind === 'artifact') return null
    const m = /(\d+)\s*day/.exec(p.urgent || '')
    if (m) return Number(m[1])
    return /hour/.test(p.urgent || '') ? 0 : null
}

const prizeOf = (p) => Number(p.prizeCents || 0)
const pctOf = (p) => {
    const g = Number(p.funding?.goal || 0)
    return g > 0 ? (Number(p.funding?.raised || 0) / g) * 100 : 0
}

export const applyFeedFilters = (posts, f = DEFAULT_FEED_FILTERS) => {
    const kinds = f.kinds ?? DEFAULT_FEED_FILTERS.kinds
    const p = { ...DEFAULT_FEED_FILTERS.picks, ...(f.picks ?? {}) }

    const kept = posts.filter((post) => {
        const kind = post.kind ?? 'debate'
        if (!kinds.includes(kind)) return false

        if (kind === 'debate') {
            if (p.prize === 'cash' && prizeOf(post) <= 0) return false
            if (p.prize === 'arrow' && prizeOf(post) > 0) return false
            if (PURSE[p.purse] && prizeOf(post) < PURSE[p.purse]) return false
        }
        if (kind === 'wouldbe') {
            if (GOAL[p.goal] && Number(post.funding?.goal || 0) < GOAL[p.goal]) return false
            // A stage is a fact about the money and the clock together, which is
            // why it is one control rather than two: "ending soon" is only
            // interesting about something that has not already made it.
            const days = daysOf(post)
            if (p.stage === 'funded' && pctOf(post) < 100) return false
            if (p.stage === 'open' && pctOf(post) >= 100) return false
            if (p.stage === 'soon' && (pctOf(post) >= 100 || days === null || days > 7)) return false
        }
        return true
    })

    if (p.order === 'new') {
        // Newest first. The fixtures carry no timestamp yet, so the feed's own
        // order stands in for it — reversed, because the array is authored
        // oldest-interesting-first.
        return [...kept].reverse()
    }
    if (p.order === 'closing') {
        // Soonest deadline first, and anything without one goes to the BACK
        // rather than to the front on a null.
        return [...kept].sort((a, b) => {
            const x = daysOf(a), y = daysOf(b)
            if (x === null && y === null) return 0
            if (x === null) return 1
            if (y === null) return -1
            return x - y
        })
    }
    return [...kept].sort((a, b) => engagementOf(b) - engagementOf(a))
}
