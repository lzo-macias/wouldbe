const { client } = require("../index.js")
const stripe = require("../../services/stripe")

// POST /wouldbes createWouldbe 🔲 (compliance gate; entry_path , starts launch status=draft ; enforce $5K–$1M) A, ATT 🔲


const GOAL_FLOOR_CENTS = 500000      // $5,000
const GOAL_CEILING_CENTS = 100000000 // $1,000,000

// resolveRaceForOffice — find (or create) the race a new WouldBe belongs to.
//
// WHY THIS EXISTS: every WouldBe needs a race_id, because the race owns the
// election cycle and general date that decide when a campaign ages out of the
// feed. But races are admin-write, and no admin creates one before a citizen
// decides to run — so a first-mover for any office would hit a hard stop.
//
// The data to build one already exists: election_deadlines holds the general
// date, the filing close and the primary for every jurisdiction we seeded. This
// derives a race from those rather than asking a user to invent election dates.
//
// FIND FIRST, CREATE SECOND. Two people starting a WouldBe for the same office
// must land on the SAME race — otherwise the office splits into parallel
// contests that can never be compared. The lookup is by (office, upcoming
// general date), and the insert is guarded by re-checking inside the same
// transaction.
//
// is_approved_on_platform stays FALSE: an auto-derived race is a scaffold built
// from seeded dates, not a vetted contest. An admin flips it once they've
// checked the dates are right.
const resolveRaceForOffice = async ({ office_id }, db = client) => {
    if (!office_id) throw new Error("office_id is required to resolve a race")

    // 1. an existing race for this office whose election hasn't passed
    const existing = await db.query(
        `SELECT id FROM races
         WHERE office_id = $1 AND general_date >= CURRENT_DATE
         ORDER BY general_date ASC
         LIMIT 1`,
        [office_id]
    )
    if (existing.rows.length) return existing.rows[0].id

    // 2. derive one from the office's jurisdiction deadlines.
    //
    // The GENERAL date is the anchor: it decides which cycle we're in and is the
    // only date that must still be ahead of us. The filing close and primary are
    // then taken as the latest instance ON OR BEFORE that general — they are
    // usually in the PAST by the time someone starts a campaign (filing closes
    // months before election day), so filtering them to "upcoming" would find
    // nothing and refuse to build a race for a live election.
    const { rows: deadlineRows } = await db.query(
        `SELECT ed.deadline_type, ed.deadline_date::text AS deadline_date, ed.election_cycle
         FROM election_deadlines ed
         JOIN office o ON o.jurisdiction_id = ed.jurisdiction_id
         WHERE o.id = $1
           AND ed.deadline_date IS NOT NULL
           AND ed.deadline_type IN ('general_date', 'filing_close', 'primary_date', 'petition_filing_deadline')
           AND (ed.applies_to_office_id IS NULL OR ed.applies_to_office_id = o.id)
         ORDER BY ed.deadline_date ASC`,
        [office_id]
    )

    const today = new Date().toISOString().slice(0, 10)
    // ::text in the SELECT above, so these are already 'YYYY-MM-DD'. Letting pg
    // parse a DATE into a JS Date and stringifying THAT gives "Tue Mar 17" —
    // the cast keeps the calendar day as the database wrote it.
    const day = (row) => row.deadline_date

    // the next general election that hasn't happened yet
    const general = deadlineRows.find((d) => d.deadline_type === "general_date" && day(d) >= today)
    if (!general) {
        throw new Error("no upcoming general election date is on file for this office — an admin must add one")
    }
    const generalDay = day(general)

    // latest instance of a type at or before the general
    const latestBeforeGeneral = (type) =>
        deadlineRows
            .filter((d) => d.deadline_type === type && day(d) <= generalDay)
            .at(-1) || null

    // filing_close is the real thing; petition_filing_deadline is the fallback,
    // since some jurisdictions record only the petition date.
    const filing = latestBeforeGeneral("filing_close") || latestBeforeGeneral("petition_filing_deadline")
    const primary = latestBeforeGeneral("primary_date")

    // races.filing_deadline is NOT NULL, so without one there is nothing honest
    // to insert. Inventing a date here would put a deadline in front of a
    // candidate that no election official ever set.
    if (!filing) {
        throw new Error("no filing deadline is on file for this office — an admin must add one")
    }

    const cycle =
        general.election_cycle ?? new Date(`${generalDay}T12:00:00Z`).getUTCFullYear()

    // Dates are sent as 'YYYY-MM-DD' strings, never as JS Dates: these are DATE
    // columns, and pg serialises a Date in the server's local zone, which west
    // of UTC lands on the previous day.
    const asDay = (row) => (row ? day(row) : null)

    const inserted = await db.query(
        `INSERT INTO races
            (office_id, election_cycle, election_type, primary_date, general_date,
             filing_deadline, is_approved_on_platform)
         VALUES ($1, $2, 'regular', $3, $4, $5, false)
         RETURNING id`,
        [office_id, cycle, asDay(primary), generalDay, asDay(filing)]
    )
    return inserted.rows[0].id
}

const createWouldbeV2 = async ({
    title,
    description,
    user_id,
    office_id = null,
    race_id = null,
    goal_cents,
    deadline,
    can_post_videos = null,
    entry_path = null,
    approval_method = null,
    contest_external_ids = null,
}) => {
    try {
        // Required fields (the rest are nullable or DB-defaulted). race_id is
        // required: every WouldBe runs for a specific race, and the race is the
        // single source of truth for the election cycle (races.election_cycle /
        // general_date). Without it we can't tell which cycle a WouldBe belongs
        // to, so past-cycle campaigns couldn't be aged out of the feed.
        if (!title || !description || !user_id || goal_cents == null || !deadline) {
            throw new Error("title, description, user_id, goal_cents and deadline are required")
        }

        // race_id may be omitted when office_id is given: the race is derived
        // from the office's seeded election dates. Requiring the caller to
        // supply one meant a citizen could not start a WouldBe for any office an
        // admin had not already built a race for — which was every office.
        if (!race_id) {
            if (!office_id) throw new Error("either race_id or office_id is required")
            race_id = await resolveRaceForOffice({ office_id })
        }

        // The race owns the office too, so derive office_id from it rather than
        // trusting the caller — keeps wouldbe.office_id and races.office_id from
        // ever diverging.
        const raceRow = await client.query(`SELECT office_id FROM races WHERE id = $1`, [race_id])
        if (!raceRow.rows.length) throw new Error("race_id does not match any race")
        office_id = raceRow.rows[0].office_id

        // Enforce the $5K–$1M goal window.
        const goal = Number(goal_cents)
        if (!Number.isInteger(goal) || goal < GOAL_FLOOR_CENTS || goal > GOAL_CEILING_CENTS) {
            throw new Error(`goal_cents must be between ${GOAL_FLOOR_CENTS} and ${GOAL_CEILING_CENTS} (cents)`)
        }

        const SQL = `
            INSERT INTO wouldbe (
                id,
                title,
                description,
                user_id,
                office_id,
                race_id,
                goal_cents,
                deadline,
                can_post_videos,
                entry_path,
                launch_status,
                approval_method,
                contest_external_ids
            ) VALUES (
                uuid_generate_v4(),
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                COALESCE($8, false),
                COALESCE($9, 'self_start'),
                'draft',
                COALESCE($10, 'manual'),
                $11
            )
            RETURNING *;
        `

        const result = await client.query(SQL, [
            title,
            description,
            user_id,
            office_id ?? null,
            race_id ?? null,
            goal,
            deadline,
            can_post_videos ?? null,
            entry_path ?? null,
            approval_method ?? null,
            contest_external_ids == null ? null : JSON.stringify(contest_external_ids),
        ])

        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}


// ============================================================================
// TRENDING SCORE — the ?sort=trending ranking.
//
// COMPUTED IN SQL, NOT STORED. Two of the four inputs change with the CLOCK
// rather than with a write: velocity is a 7-day rolling window, and urgency
// rises daily as the deadline nears. A stored score column would be correct at
// the instant it was written and drift from then on, with no event to trigger a
// recompute — the same reason reviews.average_rating and users.age are derived.
// (pledged_total_cents IS denormalized on this table, and that's fine, because
// it only changes when a pledge changes.)
//
// Also computed here rather than in JS because ranking decides WHICH rows you
// get, not just their order: scoring client-side means fetching every active
// campaign to find the top 12.
//
// Every term is normalised to 0–1 and multiplied by its weight; the weights sum
// to 1, so the score is 0–1 and campaigns are directly comparable.
// ============================================================================
const TRENDING_WEIGHTS = {
    funding: 0.4,
    velocity: 0.3,
    backers: 0.2,
    urgency: 0.1,
};

// Ceilings for the log curves. These are "what counts as a lot" — a campaign at
// the ceiling scores ~1.0 on that term; past it, the gain flattens rather than
// running away. Log-scaled so a 500-backer campaign doesn't bury a 50-backer one
// by 10x: the 5th backer matters more than the 500th.
const TRENDING_VELOCITY_CEILING_CENTS = 2_500_000;  // $25k pledged in 7 days
const TRENDING_BACKER_CEILING = 500;
// Urgency starts climbing this far out. Beyond it a deadline isn't news yet.
const TRENDING_URGENCY_WINDOW_DAYS = 90;

// Statuses that count. Mirrors ACTIVE_PLEDGE_STATUSES in pledges.js — a withdrawn
// pledge must not inflate velocity or backer count.
const TRENDING_PLEDGE_STATUSES = ["pending", "goal_reached", "converted"];

// NULLIF guards the divide-by-zero; ::numeric stops bigint integer division
// flooring a 62%-funded campaign to 0. LEAST caps funding at 100% so a 400%
// campaign can't contribute 4.0 to a score where every other term maxes at 1.0.
const TRENDING_SCORE_SQL = `
    (
        ${TRENDING_WEIGHTS.funding} * LEAST(
            COALESCE(w.pledged_total_cents::numeric / NULLIF(w.goal_cents, 0), 0), 1
        )
      + ${TRENDING_WEIGHTS.velocity} * LEAST(
            LN(1 + COALESCE(ps.velocity_cents, 0)) / LN(1 + ${TRENDING_VELOCITY_CEILING_CENTS}), 1
        )
      + ${TRENDING_WEIGHTS.backers} * LEAST(
            LN(1 + COALESCE(ps.backer_count, 0)) / LN(1 + ${TRENDING_BACKER_CEILING}), 1
        )
      + ${TRENDING_WEIGHTS.urgency} * CASE
            -- A PASSED deadline scores 0, not 1. Without this branch the
            -- subtraction goes negative, so 1 - (negative/90) exceeds 1, LEAST
            -- clamps it back to 1 -- and every EXPIRED campaign gets MAXIMUM
            -- urgency. Exactly backwards, and it silently gave all five seeded
            -- campaigns an identical 0.1000.
            -- (No backticks in this comment: the whole block is a JS template
            -- literal, and a backtick here terminates the string.)
            WHEN w.deadline < CURRENT_DATE THEN 0
            ELSE GREATEST(0, LEAST(1,
                1 - ((w.deadline - CURRENT_DATE)::numeric / ${TRENDING_URGENCY_WINDOW_DAYS})
            ))
        END
    )
`;

// One pass over pledges, aggregated per campaign, rather than two correlated
// subqueries per row.
const TRENDING_PLEDGE_CTE = `
    WITH pledge_stats AS (
        SELECT p.wouldbe_id,
               COUNT(DISTINCT p.pledger_user_id)::int AS backer_count,
               COALESCE(SUM(p.amount_cents) FILTER (
                   WHERE p.created_at >= now() - interval '7 days'
               ), 0)::bigint AS velocity_cents
          FROM pledges p
         WHERE p.status = ANY($2)
         GROUP BY p.wouldbe_id
    )
`;

// GET /wouldbes listWouldbes 🔲— 🔲
// Public list = LIVE campaigns (non-retired), newest first. (Was filtering
// `retired = true`, which returned only the dead ones.)
// listWouldbes({ office_id }) — live campaigns for the CURRENT cycle, newest
// first. "Current" is enforced two ways:
//   1. retired IS NOT TRUE           — manual/auto retirement (missed filing
//                                       proof, eliminated in primary, etc.)
//   2. r.general_date >= CURRENT_DATE — the race's general election hasn't
//                                       happened yet. Once it passes, that cycle
//                                       is over for the office and its WouldBes
//                                       drop off automatically, while a newer
//                                       cycle's WouldBes (later general_date)
//                                       keep showing. This is the backstop for
//                                       when the auto-retire jobs haven't run.
// office_id optional: pass it to scope to one office. Filtering on r.office_id
// (NOT NULL, authoritative) rather than w.office_id keeps office + cycle aligned.
// sort:
//   'newest' (default) — as before.
//   'pledged'          — most money pledged first. The home page's ordering:
//                        a campaign people have actually backed is the one worth
//                        showing above the fold.
//
// pledger_count is a correlated subquery, not a JOIN — joining pledges would
// multiply the wouldbe rows and break every other column.




// Filters (all optional, all AND-ed):
//   state      — two-letter code, matched on the office's jurisdiction
//   lean_min /
//   lean_max   — the POSTER's users.political_lean (1-10 conservative→progressive)
//   has_goal_sort — 'goal_desc' (closest to funded first) / 'goal_asc'
//
// political_lean is filtered here but deliberately NOT returned on the row.
// It is sensitive personal data about the campaign owner; letting a caller
// narrow by it is the feature, publishing every user's number on a public feed
// is not. The filter works without the value ever leaving the database.
// status:
//   null / 'all' — every current campaign (the historical behaviour)
//   'active'     — the funding window is still open: no deadline, or one that
//                  has not passed. The home feed asks for this, because a
//                  campaign nobody can still back is a result, not an ask.
//   'concluded'  — the deadline has passed.
//
// This is a SEPARATE question from retired/general_date, which the WHERE below
// already handles: a campaign can be perfectly current and still have closed its
// own funding window.
const listWouldbes = async ({
    office_id = null,
    sort = "newest",
    limit = null,
    state = null,
    lean_min = null,
    lean_max = null,
    status = null,
} = {}) => {
    try{
        const ORDERINGS = {
            newest: "w.created_at DESC",
            pledged: "w.pledged_total_cents DESC, w.created_at DESC",
            // Highest score first; created_at breaks ties deterministically so
            // paging can't show the same row twice.
            trending: "trending_score DESC, w.created_at DESC",
            // "Almost reached goal" — ordered by the RATIO, not the raw amount,
            // so a $900/$1,000 campaign outranks a $50k/$500k one. NULLIF guards
            // the divide: goal_cents has a >0 check, but a defensive 0 here would
            // be a division error rather than a wrong sort.
            goal_desc: "(w.pledged_total_cents::numeric / NULLIF(w.goal_cents,0)) DESC, w.created_at DESC",
            goal_asc:  "(w.pledged_total_cents::numeric / NULLIF(w.goal_cents,0)) ASC, w.created_at DESC",
        }
        // Whitelisted: this is interpolated into the SQL string, so an unchecked
        // value would be an injection point.
        const orderBy = ORDERINGS[sort] || ORDERINGS.newest
        const isTrending = sort === "trending"

        // The score's component parts come back on the row too, so a caller can
        // see WHY something ranked where it did without re-deriving it.
        const SQL = `
            ${isTrending ? TRENDING_PLEDGE_CTE : ""}
            SELECT w.*, r.election_cycle, r.general_date,
                   o.office_name, j.state_code,
                   u.username, u.first_name, u.last_name,
                   u.profile_photo_url AS poster_photo_url,
                   (SELECT COUNT(DISTINCT p.pledger_user_id)::int
                      FROM pledges p WHERE p.wouldbe_id = w.id) AS pledger_count
                   ${isTrending ? `,
                   COALESCE(ps.backer_count, 0)   AS backer_count,
                   COALESCE(ps.velocity_cents, 0) AS velocity_cents,
                   ROUND(${TRENDING_SCORE_SQL}::numeric, 4) AS trending_score` : ""}
            FROM wouldbe w
            JOIN races r ON r.id = w.race_id
            -- The card reads "<poster> would be <title>", so the owner's name
            -- and avatar ship with the row rather than costing an N+1 per card.
            JOIN users u ON u.id = w.user_id
            -- office/jurisdiction are LEFT joins: office_id is nullable on
            -- wouldbe, and a campaign with no office anchor must still list.
            LEFT JOIN office o ON o.id = w.office_id
            LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
            ${isTrending ? "LEFT JOIN pledge_stats ps ON ps.wouldbe_id = w.id" : ""}
            WHERE w.retired IS NOT TRUE
              AND r.general_date >= CURRENT_DATE
              AND ($1::uuid IS NULL OR r.office_id = $1)
              AND ($${isTrending ? 3 : 2}::text IS NULL OR j.state_code = $${isTrending ? 3 : 2})
              AND ($${isTrending ? 4 : 3}::int  IS NULL OR u.political_lean >= $${isTrending ? 4 : 3})
              AND ($${isTrending ? 5 : 4}::int  IS NULL OR u.political_lean <= $${isTrending ? 5 : 4})
              -- 'active' | 'concluded' | null. A NULL deadline is an open-ended
              -- campaign, which is active by definition and must not be dropped
              -- by a comparison against NULL.
              AND ($${isTrending ? 6 : 5}::text IS NULL
                   OR ($${isTrending ? 6 : 5} = 'active'
                       AND (w.deadline IS NULL OR w.deadline >= CURRENT_DATE)
                       -- A failed launch is over regardless of the date on it.
                       AND w.launch_status <> 'failed')
                   OR ($${isTrending ? 6 : 5} = 'concluded'
                       AND w.deadline < CURRENT_DATE))
            ORDER BY ${orderBy}
            ${limit ? `LIMIT ${Math.min(Number(limit) || 50, 200)}` : ""}
        `

        // $2 only exists on the trending path (the CTE's status filter), which is
        // why the filter placeholders above shift by one for it.
        const filters = [
            state || null,
            Number.isFinite(Number(lean_min)) && lean_min !== null ? Number(lean_min) : null,
            Number.isFinite(Number(lean_max)) && lean_max !== null ? Number(lean_max) : null,
            status === "active" || status === "concluded" ? status : null,
        ]
        const params = isTrending
            ? [office_id, TRENDING_PLEDGE_STATUSES, ...filters]
            : [office_id, ...filters]
        const result = await client.query(SQL, params)

        return result.rows

    }catch(err){
        console.error(err)
        throw err
    }
}


// score = 0.4 × min(pct_funded, 100)/100
//       + 0.3 × velocity          (pledged in last 7 days, log-scaled)
//       + 0.2 × backer_count      (log-scaled — 50 people beats one big pledge)
//       + 0.1 × urgency           (rises as the filing deadline nears)

const Weights = {
    fundingProgress: .4,
    velocity: .3,
    backer_count: .2,
    urgency: .1,
}

const today = new Date()

function calculatePoints (goal, funded, pledgesInTheLastSevenDays, backerCount, deadline){
    const fundedpct = goal/funded
    const urgency = 1 / ((today - deadline) + 1)
    const score = ((.4 * min(fundedpct, 100) / 100) + (.3 * pledgesInTheLastSevenDays) + (.2 * backerCount) + (.1 * urgency))  
    return score
}

const listWouldbesV2 = async ({}) => {
    try {
        const SQLV1 = `
            SELECT w.*, 
        `
    }catch(err){

    }
}


// listMyWouldbes — the caller's own campaigns, every lifecycle state.
//
// WHY IT EXISTS: /wouldbes hides nothing by launch_status, but it is the PUBLIC
// feed — it drops campaigns whose election has passed and isn't scoped to anyone.
// A user who closed the tab between creating a draft and paying the creation fee
// had no way back to it: the id lived only in React state.
//
// NO DATE FILTER and NO STATUS FILTER on purpose. Your own campaign is still
// yours after the election, and a draft you never launched is exactly the row
// you're most likely looking for. Callers filter by launch_status themselves.
//
// Retired campaigns ARE excluded — retiring is the user's own soft-delete, so
// showing them back would undo the only "remove this" the product has.
const listMyWouldbes = async ({ user_id }) => {
    if (!user_id) throw new Error("user_id is required")
    try {
        const SQL = `
            SELECT w.*,
                   r.election_cycle,
                   r.general_date,
                   o.office_name,
                   j.state_code,
                   (SELECT COUNT(DISTINCT p.pledger_user_id)::int
                      FROM pledges p WHERE p.wouldbe_id = w.id) AS pledger_count
            FROM wouldbe w
            LEFT JOIN races r ON r.id = w.race_id
            LEFT JOIN office o ON o.id = w.office_id
            LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE w.user_id = $1
              AND w.retired IS NOT TRUE
            ORDER BY w.created_at DESC
        `
        const result = await client.query(SQL, [user_id])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// listUserWouldbes — one USER's campaigns, viewed by someone else.
//
// Same shape and same ordering as listMyWouldbes, because both feed the same
// card. The difference is visibility: listMyWouldbes is always the owner, so it
// hides nothing; here the viewer is usually a stranger, and a stranger has no
// business seeing an unpaid draft or a campaign sitting in the review queue.
//
// includeUnlisted:
//   false (default) — PUBLIC: only launch_status='active'. draft /
//                     pending_committee / pending_review / suspended / failed
//                     are all pre- or post-decision states that say something
//                     about a person the person hasn't chosen to publish.
//   true            — the OWNER's view: every status, identical to
//                     listMyWouldbes. The route only passes it when the viewer
//                     IS :userId.
//
// NO DATE FILTER either way, unlike the public /wouldbes feed: this is a
// profile, and a campaign someone ran last cycle is still part of who they are.
// Retired is excluded in both views — that's the user's own soft-delete.
const listUserWouldbes = async ({ user_id, includeUnlisted = false }) => {
    if (!user_id) throw new Error("user_id is required")
    try {
        const SQL = `
            SELECT w.*,
                   r.election_cycle,
                   r.general_date,
                   o.office_name,
                   j.state_code,
                   (SELECT COUNT(DISTINCT p.pledger_user_id)::int
                      FROM pledges p WHERE p.wouldbe_id = w.id) AS pledger_count
            FROM wouldbe w
            LEFT JOIN races r ON r.id = w.race_id
            LEFT JOIN office o ON o.id = w.office_id
            LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
            WHERE w.user_id = $1
              AND w.retired IS NOT TRUE
              AND ($2::boolean = true OR w.launch_status = 'active')
            ORDER BY w.created_at DESC
        `
        const result = await client.query(SQL, [user_id, includeUnlisted])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// GET /wouldbes/:id getWouldbeById 🔲— 🔲

const getWouldbeById = async ({
    id
}) => {
    try {
        const result = await client.query(
            `
                SELECT *
                FROM wouldbe
                WHERE id = $1
            `,
            [id]
        )

        return result.rows[0]

    }catch(err){
        console.error(err)
        throw err
    }
}


// PATCH /wouldbes/:id updateWouldbe 🔲 (enforce $5K–$1M) A 🔲
// Partial update: COALESCE keeps existing values when a field is omitted. Goal,
// when supplied, is re-validated against the $5K–$1M window before it hits the DB.
const updateWouldbe = async ({
    id,
    title = null,
    description = null,
    goal_cents = null,
    deadline = null,
    can_post_videos = null,
}) => {
    try{
        if (goal_cents != null) {
            const goal = Number(goal_cents)
            if (!Number.isInteger(goal) || goal < GOAL_FLOOR_CENTS || goal > GOAL_CEILING_CENTS) {
                throw new Error(`goal_cents must be between ${GOAL_FLOOR_CENTS} and ${GOAL_CEILING_CENTS} (cents)`)
            }
        }

        const SQL = `
            UPDATE wouldbe SET
                title           = COALESCE($2, title),
                description     = COALESCE($3, description),
                goal_cents      = COALESCE($4, goal_cents),
                deadline        = COALESCE($5, deadline),
                can_post_videos = COALESCE($6, can_post_videos),
                updated_at      = NOW()
            WHERE id = $1
            RETURNING *;
        `

        const result = await client.query(SQL, [
            id,
            title ?? null,
            description ?? null,
            goal_cents ?? null,
            deadline ?? null,
            can_post_videos ?? null,
        ])

        if (!result.rows.length) throw new Error("no wouldbe with this id")
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}


// POST /wouldbes/:id/retire retireWouldbe 🔲 A 🔲

const retireWouldbe = async ({
    id
}) => {
    try{
        const SQL = `
            UPDATE wouldbe
            SET
                retired = true,
                retired_at = NOW()
            WHERE id = $1
            RETURNING *;
        `

        const result = await client.query(SQL, [id])

        if (!result.rows.length) throw new Error("no wouldbe with this id")
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}


// GET /wouldbes/:id/pledgers getWouldbePledgers 🔲 A 🔲
// Pledges for a campaign, joined to the pledger's public identity. (pledges has
// no `user_id` — the FK is `pledger_user_id`; and `WHERE id` was ambiguous.)
const getWouldbePledgers = async ({
    id
}) => {
    try{
        const SQL = `
            SELECT
                p.*,
                u.username,
                u.first_name,
                u.last_name,
                u.profile_photo_url
            FROM pledges p
            JOIN users u ON u.id = p.pledger_user_id
            WHERE p.wouldbe_id = $1
            ORDER BY p.created_at DESC
        `

        const result = await client.query(SQL, [id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}


// GET /wouldbes/:id/posts getWouldbePosts 🔲— 🔲
// A campaign's non-removed posts. (Missing commas + an unqualified `removed_at`
// fixed; removed_at lives on posts.)
const getWouldbePosts = async ({
    id
}) => {
    try {
        const SQL = `
            SELECT
                p.*,
                w.title
            FROM posts p
            JOIN wouldbe w ON w.id = p.wouldbe_id
            WHERE w.id = $1
                AND p.removed_at IS NULL
            ORDER BY p.created_at DESC
        `

        const result = await client.query(SQL, [id])

        return result.rows

    }catch(err){
        console.error(err)
        throw err
    }
}


// GET /wouldbes/:id/rankings getWouldbeRankings 🔲— 🔲
// This WouldBe's standing among the competing campaigns for the same seat (same
// race_id, or same office_id when there's no race), ranked by pledged total.
// Excludes retired; ranks only launched ('active') campaigns. Returns the full
// board plus this WouldBe's own row (rank + field_size) for a "you're #3 of 7" UI.
const getWouldbeRankings = async ({
    id
}) => {
    try {
        const SQL = `
            WITH target AS (
                SELECT id, race_id, office_id FROM wouldbe WHERE id = $1
            ),
            peers AS (
                SELECT
                    w.id,
                    w.title,
                    w.user_id,
                    w.pledged_total_cents,
                    w.goal_cents,
                    RANK() OVER (ORDER BY w.pledged_total_cents DESC, w.created_at ASC) AS rank,
                    COUNT(*) OVER () AS field_size
                FROM wouldbe w, target t
                WHERE w.retired IS NOT TRUE
                    AND w.launch_status = 'active'
                    AND (
                            (t.race_id IS NOT NULL AND w.race_id = t.race_id)
                         OR (t.race_id IS NULL AND w.office_id = t.office_id)
                    )
            )
            SELECT * FROM peers ORDER BY rank
        `

        const { rows } = await client.query(SQL, [id])

        return {
            ranked: rows,                                   // the full leaderboard
            target: rows.find((r) => r.id === id) || null,  // this WouldBe's row (rank, field_size)
        }
    }catch(err){
        console.error(err)
        throw err
    }
}



// getRecommendedWouldbes / incrementPledgedTotal / checkWouldbeCanPostVideos are
// implemented below, near module.exports (§6 remaining helpers).

// ===========================================================================
// Debate Update [DB §1] — $5 creation fee + contribution-processor link.
// ===========================================================================

// recordWouldbeCreationPayment({...}) — write the $5 creation-fee charge. When
// the charge `status='succeeded'`, atomically stamp wouldbe.creation_fee_paid_at
// (once) so the campaign can clear the creation-fee gate. Returns the payment row.
const recordWouldbeCreationPayment = async ({
    wouldbe_id,
    user_id,
    amount_cents = null,
    currency = null,
    stripe_customer_id = null,
    stripe_payment_intent_id = null,
    stripe_charge_id = null,
    stripe_balance_txn_id = null,
    fee_amount_cents = null,
    net_amount_cents = null,
    status,
    failure_reason = null,
}) => {
    try {
        if (!wouldbe_id || !user_id || !status) {
            throw new Error("wouldbe_id, user_id and status are required")
        }
        const SQL = `
            WITH pay AS (
                INSERT INTO wouldbe_creation_payments (
                    id, wouldbe_id, user_id, amount_cents, currency,
                    stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
                    stripe_balance_txn_id, fee_amount_cents, net_amount_cents,
                    status, failure_reason, charged_at
                ) VALUES (
                    uuid_generate_v4(), $1, $2, COALESCE($3, 500), COALESCE($4, 'usd'),
                    $5, $6, $7, $8, $9, $10, $11, $12,
                    CASE WHEN $11 = 'succeeded' THEN NOW() END
                )
                RETURNING *
            ),
            stamp AS (
                UPDATE wouldbe
                SET creation_fee_paid_at = NOW()
                WHERE id = $1
                    AND (SELECT status FROM pay) = 'succeeded'
                    AND creation_fee_paid_at IS NULL
                RETURNING id
            )
            SELECT * FROM pay;
        `
        const result = await client.query(SQL, [
            wouldbe_id, user_id, amount_cents ?? null, currency ?? null,
            stripe_customer_id ?? null, stripe_payment_intent_id ?? null, stripe_charge_id ?? null,
            stripe_balance_txn_id ?? null, fee_amount_cents ?? null, net_amount_cents ?? null,
            status, failure_reason ?? null,
        ])
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getWouldbeCreationPayment({ wouldbe_id }) — the most recent creation-fee charge.
const getWouldbeCreationPayment = async ({ wouldbe_id }) => {
    try {
        const SQL = `
            SELECT *
            FROM wouldbe_creation_payments
            WHERE wouldbe_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `
        const result = await client.query(SQL, [wouldbe_id])
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// setContributionProcessor({ wouldbe_id, processor, url }) — set the external
// contribution processor (ActBlue/WinRed) + the link pledgers get on goal completion.
const setContributionProcessor = async ({ wouldbe_id, processor, url }) => {
    try {
        const SQL = `
            UPDATE wouldbe
            SET contribution_processor = $2,
                contribution_processor_url = $3,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await client.query(SQL, [wouldbe_id, processor ?? null, url ?? null])
        if (!result.rows.length) throw new Error("no wouldbe with this id")
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// recordGoalReached({...}) — idempotent record that a goal was met and pledgers
// were sent the processor link. plan_timeline_component_id null = the campaign's
// main goal; set = a deadline-attached micro-goal. Inserts once per goal (guarded
// by NOT EXISTS to honor the partial-unique indexes); returns the row, or null if
// it had already fired.
const recordGoalReached = async ({
    wouldbe_id,
    plan_timeline_component_id = null,
    threshold_cents,
    processor_url = null,
    pledgers_notified_count = null,
}) => {
    try {
        if (!wouldbe_id || threshold_cents == null) {
            throw new Error("wouldbe_id and threshold_cents are required")
        }
        const goal_kind = plan_timeline_component_id ? "micro_goal" : "campaign_goal"
        const SQL = `
            INSERT INTO pledge_goal_notifications (
                id, wouldbe_id, plan_timeline_component_id, goal_kind, threshold_cents,
                processor_url, pledgers_notified_count, notified_at
            )
            SELECT
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6,
                CASE WHEN $6 IS NOT NULL THEN NOW() END
            WHERE NOT EXISTS (
                SELECT 1 FROM pledge_goal_notifications
                WHERE wouldbe_id = $1
                    AND plan_timeline_component_id IS NOT DISTINCT FROM $2
            )
            RETURNING *;
        `
        const result = await client.query(SQL, [
            wouldbe_id, plan_timeline_component_id ?? null, goal_kind, threshold_cents,
            processor_url ?? null, pledgers_notified_count ?? null,
        ])
        return result.rows[0] ?? null // null = already fired for this goal
    } catch (err) {
        console.error(err)
        throw err
    }
}


// ============================================================================
// §6 remaining helpers — recommendations + internal counters
// ============================================================================

// getRecommendedWouldbes — active WouldBes in the user's jurisdictions that they
// don't own and haven't already pledged to. Reuses the notifier's jurisdiction
// link (user_jurisdictions → office.jurisdiction_id) as the relevance signal.
const getRecommendedWouldbes = async ({ userId, limit = 25 }) => {
    const { rows } = await client.query(
        `SELECT w.*, o.office_name, o.district_name, j.state_code,
                u.username, u.first_name, u.last_name,
                u.profile_photo_url AS poster_photo_url
         FROM wouldbe w
         JOIN office o ON o.id = w.office_id
         JOIN users u ON u.id = w.user_id
         LEFT JOIN jurisdiction j ON j.id = o.jurisdiction_id
         WHERE w.launch_status = 'active'
           AND w.retired = false
           AND w.user_id <> $1
           AND o.jurisdiction_id IN (
                 SELECT jurisdiction_id FROM user_jurisdictions WHERE user_id = $1
               )
           AND w.id NOT IN (
                 SELECT wouldbe_id FROM pledges WHERE pledger_user_id = $1 AND status <> 'withdrawn'
               )
         ORDER BY w.pledged_total_cents DESC, w.created_at DESC
         LIMIT $2`,
        [userId, Math.min(Number(limit) || 25, 100)]
    );
    return rows;
};

// incrementPledgedTotal — internal counter bump. createPledge already does this
// inside its own transaction; this is for other callers adjusting the running
// total. delta_cents may be negative.
const incrementPledgedTotal = async ({ wouldbeId, delta_cents }) => {
    const { rows } = await client.query(
        `UPDATE wouldbe SET pledged_total_cents = GREATEST(0, pledged_total_cents + $2), updated_at = now()
         WHERE id = $1 RETURNING id, pledged_total_cents`,
        [wouldbeId, delta_cents]
    );
    if (!rows.length) {
        const e = new Error("WouldBe not found");
        e.status = 404;
        throw e;
    }
    return rows[0];
};

// checkWouldbeCanPostVideos — a WouldBe unlocks video posting once it reaches its
// goal. Flips can_post_videos true (and keeps it) when pledged_total >= goal.
const checkWouldbeCanPostVideos = async ({ wouldbeId }) => {
    const { rows } = await client.query(
        `UPDATE wouldbe
         SET can_post_videos = (can_post_videos OR pledged_total_cents >= goal_cents),
             updated_at = now()
         WHERE id = $1
         RETURNING id, can_post_videos, pledged_total_cents, goal_cents`,
        [wouldbeId]
    );
    if (!rows.length) {
        const e = new Error("WouldBe not found");
        e.status = 404;
        throw e;
    }
    return rows[0];
};

// ---------------------------------------------------------------------------
// $5 creation fee — Stripe PaymentIntent flow (mirrors post_payments).
//   createWouldbeCreationPaymentIntent → creates the PaymentIntent and inserts a
//   'pending' row carrying the pi_ id. The webhook (metadata.kind ===
//   "wouldbe_creation") flips it to 'succeeded'/'failed' via
//   confirmWouldbeCreationPayment and stamps wouldbe.creation_fee_paid_at on
//   success. INERT until STRIPE_SECRET_KEY is set (services/stripe throws 503).
// ---------------------------------------------------------------------------
const WOULDBE_CREATION_FEE_CENTS = 500  // $5

const createWouldbeCreationPaymentIntent = async ({
    wouldbe_id,
    user_id,
    amount_cents = WOULDBE_CREATION_FEE_CENTS,
    currency = "usd",
    stripe_customer_id = null,
} = {}) => {
    if (!wouldbe_id || !user_id) throw new Error("wouldbe_id and user_id are required")
    if (!amount_cents || amount_cents <= 0) throw new Error("amount_cents must be a positive integer")

    const intent = await stripe.createPaymentIntent({
        amount_cents,
        currency,
        customer: stripe_customer_id || undefined,
        metadata: { kind: "wouldbe_creation", wouldbe_id, user_id },
    })

    try {
        const { rows } = await client.query(
            `INSERT INTO wouldbe_creation_payments (
                id, wouldbe_id, user_id, amount_cents, currency,
                stripe_customer_id, stripe_payment_intent_id, status
             ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 'pending'
             )
             RETURNING *`,
            [wouldbe_id, user_id, amount_cents, currency, stripe_customer_id ?? null, intent?.id ?? null]
        )
        return { payment: rows[0], client_secret: intent?.client_secret ?? null }
    } catch (err) {
        if (err.code === "23505") throw new Error("a creation payment already exists for this payment intent")
        if (err.code === "23503") throw new Error("wouldbe_id or user_id does not exist")
        console.error(err)
        throw err
    }
}

const confirmWouldbeCreationPayment = async ({
    stripe_payment_intent_id,
    status = "succeeded",
    stripe_charge_id = null,
    failure_reason = null,
} = {}) => {
    if (!stripe_payment_intent_id) throw new Error("stripe_payment_intent_id is required")
    try {
        // Flip the pending row (idempotent — only matches while still 'pending')
        // and stamp the wouldbe's creation_fee_paid_at on success.
        const SQL = `
            WITH pay AS (
                UPDATE wouldbe_creation_payments
                   SET status = $2,
                       stripe_charge_id = COALESCE($3, stripe_charge_id),
                       failure_reason = COALESCE($4, failure_reason),
                       charged_at = CASE WHEN $2 = 'succeeded' THEN NOW() ELSE charged_at END
                 WHERE stripe_payment_intent_id = $1
                   AND status = 'pending'
                RETURNING *
            ),
            stamp AS (
                UPDATE wouldbe
                   SET creation_fee_paid_at = NOW()
                 WHERE id = (SELECT wouldbe_id FROM pay)
                   AND $2 = 'succeeded'
                   AND creation_fee_paid_at IS NULL
                RETURNING id
            )
            SELECT * FROM pay;
        `
        const upd = await client.query(SQL, [stripe_payment_intent_id, status, stripe_charge_id, failure_reason])
        if (upd.rows.length) return upd.rows[0]

        // Already processed (or unknown) — return the existing row idempotently.
        const { rows } = await client.query(
            `SELECT * FROM wouldbe_creation_payments WHERE stripe_payment_intent_id = $1`,
            [stripe_payment_intent_id]
        )
        if (!rows.length) throw new Error("no creation payment for this payment intent")
        return rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    createWouldbeV2,
    listWouldbes,
    listMyWouldbes,
    listUserWouldbes,
    getWouldbeById,
    updateWouldbe,
    retireWouldbe,
    getWouldbePledgers,
    getWouldbePosts,
    getWouldbeRankings,
    // Debate Update
    recordWouldbeCreationPayment,
    getWouldbeCreationPayment,
    resolveRaceForOffice,
    createWouldbeCreationPaymentIntent,
    confirmWouldbeCreationPayment,
    setContributionProcessor,
    recordGoalReached,
    // §6 remaining
    getRecommendedWouldbes,
    incrementPledgedTotal,
    checkWouldbeCanPostVideos,
}
