const { client } = require("../index.js")

// POST /wouldbes createWouldbe 🔲 (compliance gate; entry_path , starts launch status=draft ; enforce $5K–$1M) A, ATT 🔲


const GOAL_FLOOR_CENTS = 500000      // $5,000
const GOAL_CEILING_CENTS = 100000000 // $1,000,000

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
        // Required fields (the rest are nullable or DB-defaulted).
        if (!title || !description || !user_id || goal_cents == null || !deadline) {
            throw new Error("title, description, user_id, goal_cents and deadline are required")
        }

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


// GET /wouldbes listWouldbes 🔲— 🔲
// Public list = LIVE campaigns (non-retired), newest first. (Was filtering
// `retired = true`, which returned only the dead ones.)
const listWouldbes = async ({} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM wouldbe
            WHERE retired IS NOT TRUE
            ORDER BY created_at DESC
        `

        const result = await client.query(SQL)

        return result.rows

    }catch(err){
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
        `SELECT w.*, o.office_name, o.district_name
         FROM wouldbe w
         JOIN office o ON o.id = w.office_id
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

module.exports = {
    createWouldbeV2,
    listWouldbes,
    getWouldbeById,
    updateWouldbe,
    retireWouldbe,
    getWouldbePledgers,
    getWouldbePosts,
    getWouldbeRankings,
    // Debate Update
    recordWouldbeCreationPayment,
    getWouldbeCreationPayment,
    setContributionProcessor,
    recordGoalReached,
    // §6 remaining
    getRecommendedWouldbes,
    incrementPledgedTotal,
    checkWouldbeCanPostVideos,
}
