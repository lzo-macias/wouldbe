  const { client, withTransaction } = require("../index.js")

  const WIN_TYPES = ["sponsor_decision", "general_vote", "hybrid"]
  const CONTRIBUTION_TYPES = ["closed", "open_platform_only", "open_pre_debate_only"]
  const PARTICIPATION_TYPES = ["open", "invitation_only", "closed"]
  
  const httpError = (status, message) => {
      const e = new Error(message)
      e.status = status
      return e
  } 
  
  const createDebate = async ({
      sponsor_id, title, description, win_type, hybrid_crowd_weight_pct,
      contribution_type, participation_type, sponsor_contribution_cents,
      platform_top_up_cents, user_contributions_cents, prize_distribution_rules,
      scoring_methodology, status, start_date, end_date, results_announce_at,
      min_age_required, excluded_states, free_entry_method
  }) => {
      try {
          if (!WIN_TYPES.includes(win_type))
              throw httpError(400, `win_type must be one of: ${WIN_TYPES.join(", ")}`)
          if (!CONTRIBUTION_TYPES.includes(contribution_type))
              throw httpError(400, `contribution_type must be one of: 
  ${CONTRIBUTION_TYPES.join(", ")}`)
          if (!PARTICIPATION_TYPES.includes(participation_type))
              throw httpError(400, `participation_type must be one of: 
  ${PARTICIPATION_TYPES.join(", ")}`)
  
          // id / retired / created_at / updated_at default at the DB; prize_pool_cents
          // is GENERATED (never inserted). COALESCE covers NOT-NULL-with-default cols.
          const SQL = `
              INSERT INTO debates (
                  sponsor_id, title, description, win_type, hybrid_crowd_weight_pct,
                  contribution_type, participation_type, sponsor_contribution_cents,
                  platform_top_up_cents, user_contributions_cents, prize_distribution_rules,
                  scoring_methodology, status, start_date, end_date, results_announce_at,
                  min_age_required, excluded_states, free_entry_method
              )
              VALUES (
                  $1, $2, $3, $4, $5, $6, $7,
                  COALESCE($8, 0), COALESCE($9, 0), COALESCE($10, 0),
                  $11, $12, COALESCE($13, 'draft'),
                  $14, $15, $16,
                  COALESCE($17, 18), COALESCE($18::text[], '{}'), $19
              )
              RETURNING *;
          `
          const result = await client.query(SQL, [
              sponsor_id, title, description, win_type, hybrid_crowd_weight_pct,
              contribution_type, participation_type, sponsor_contribution_cents,
              platform_top_up_cents, user_contributions_cents, prize_distribution_rules,
              scoring_methodology, status, start_date, end_date, results_announce_at,
              min_age_required, excluded_states, free_entry_method
          ])
          return result.rows[0]
      } catch (err) { 
          if (err.code === "23514") throw httpError(400, "a debate field violates a check constraint")
          if (err.code === "23503") throw httpError(400, "sponsor_id does not exist")
          if (err.code === "22P02") throw httpError(400, "a uuid or array field is malformed")
          console.error(err)
          throw err
      }
  }
  
  // listCurrentDebates — the public feed.
  //
  // sort:
  //   'contestants' (default) — biggest field first. The original ordering.
  //   'featured'              — biggest CASH PRIZE first, ties broken by the most
  //                             nominations. This is the home-page ordering: money
  //                             is what draws people in, and among equally-funded
  //                             debates the one people are actually nominating into
  //                             is the livelier one.
  //
  // nomination_count is a correlated subquery rather than another LEFT JOIN:
  // joining a second one-to-many table alongside contestants multiplies the rows
  // and would inflate total_contestants.
  // prize: 'cash' — only debates putting money up ('cash' or 'both')
  //        'none' — only non-cash prizes
  //        null   — everything (default)
  const listCurrentDebates = async ({ limit = 100, sort = "contestants", prize = null } = {}) => {
      try {
          const ORDERINGS = {
              contestants: "total_contestants DESC, d.created_at DESC",
              featured: "d.sponsor_contribution_cents DESC, nomination_count DESC, d.created_at DESC",
          }
          // Whitelisted, never interpolated from raw input — this lands in the SQL
          // string, so an unchecked value would be an injection point.
          const orderBy = ORDERINGS[sort] || ORDERINGS.contestants

          const SQL = `
              SELECT d.*,
                     s.display_name AS sponsor_name,
                     -- A corporate sponsor has a logo; a casual one is just a
                     -- person, so fall back to their own avatar.
                     COALESCE(s.logo_url, su.profile_photo_url) AS sponsor_photo_url,
                     COUNT(c.id) FILTER (WHERE c.withdrew_at IS NULL)::int AS total_contestants,
                     (SELECT COUNT(DISTINCT n.nominator_user_id)::int
                        FROM nominations n WHERE n.debate_id = d.id) AS nomination_count
              FROM debates d
              JOIN sponsors s ON s.id = d.sponsor_id
              LEFT JOIN users su ON su.id = s.user_id
              LEFT JOIN contestants c ON c.debate_id = d.id
              WHERE d.retired = false AND d.status NOT IN ('draft', 'cancelled')
                -- prize_type is the source of truth ('cash' | 'non_cash' |
                -- 'both'); 'both' counts as cash because money IS on the table.
                AND ($2::text IS NULL
                     OR ($2 = 'cash' AND d.prize_type IN ('cash','both'))
                     OR ($2 = 'none' AND d.prize_type = 'non_cash'))
              -- Grouping by each table's PK lets Postgres' functional-dependency
              -- rule cover s.* and su.* without listing every column.
              GROUP BY d.id, s.id, su.id
              ORDER BY ${orderBy}
              LIMIT $1
          `
          const result = await client.query(SQL, [
              Math.min(Number(limit) || 100, 500),
              prize === "cash" || prize === "none" ? prize : null,
          ])
          return result.rows
      } catch (err) { console.error(err); throw err }
  }
  
  // listSponsoredDebates — the debates a USER hosts, reached through the sponsor
  // org they belong to (debates.sponsor_id -> sponsors.id -> sponsors.user_id).
  //
  // WHY IT EXISTS: hosting a debate and competing in one are different
  // relationships on different tables. /users/:id/debates and /debate-history
  // both join `contestants`, so a sponsor's own debates were unreachable through
  // the API entirely — the only way to find them was a hand-written join.
  //
  // includeUnlisted:
  //   false (default) — the PUBLIC view: same exclusions as listCurrentDebates,
  //                     so another user's drafts and cancellations stay hidden.
  //   true            — the OWNER's view: every state, including drafts. This is
  //                     how a sponsor gets back to a draft they left unpublished;
  //                     the route only passes it when the caller IS that user.
  //
  // Same shape as listCurrentDebates (d.* + the two counts) so a caller can
  // render both lists with one card component.
  const listSponsoredDebates = async ({ userId, includeUnlisted = false, limit = 100 } = {}) => {
      if (!userId) throw new Error("userId is required")
      try {
          const SQL = `
              SELECT d.*,
                     COUNT(c.id) FILTER (WHERE c.withdrew_at IS NULL)::int AS total_contestants,
                     (SELECT COUNT(DISTINCT n.nominator_user_id)::int
                        FROM nominations n WHERE n.debate_id = d.id) AS nomination_count
              FROM debates d
              JOIN sponsors s ON s.id = d.sponsor_id
              LEFT JOIN contestants c ON c.debate_id = d.id
              WHERE s.user_id = $1
                AND ($2::boolean OR (d.retired = false AND d.status NOT IN ('draft', 'cancelled')))
              GROUP BY d.id
              ORDER BY d.created_at DESC
              LIMIT $3
          `
          const result = await client.query(SQL, [
              userId, includeUnlisted, Math.min(Number(limit) || 100, 500),
          ])
          return result.rows
      } catch (err) { console.error(err); throw err }
  }

  const listAllDebates = async ({ limit = 100 } = {}) => {
      try {
          const SQL = `
              SELECT d.*, COUNT(c.id) FILTER (WHERE c.withdrew_at IS NULL)::int AS 
  total_contestants
              FROM debates d
              LEFT JOIN contestants c ON c.debate_id = d.id
              GROUP BY d.id
              ORDER BY total_contestants DESC, d.created_at DESC
              LIMIT $1
          `
          const result = await client.query(SQL, [Math.min(Number(limit) || 100, 500)])
          return result.rows
      } catch (err) { console.error(err); throw err }
  }
  
  const getDebateById = async ({ debate_id }) => {
      try {
          const SQL = `SELECT * FROM debates WHERE id = $1`
          const result = await client.query(SQL, [debate_id])   // ← was missing the params 
  array
          return result.rows[0] || null                          // ← was `reult.rows`
      } catch (err) { console.error(err); throw err }
  }
  


//dont edit below here

// updateDebate — partial COALESCE update. Only the enum fields that are actually
// supplied are validated (a partial update may omit them entirely). prize_pool_cents
// is GENERATED, so it is never written here. 404 when the row does not exist.
const updateDebate = async ({
    debate_id,
    sponsor_id,
    title,
    description,
    win_type,
    hybrid_crowd_weight_pct,
    contribution_type,
    participation_type,
    sponsor_contribution_cents,
    platform_top_up_cents,
    user_contributions_cents,
    prize_distribution_rules,
    scoring_methodology,
    status,
    start_date,
    end_date,
    results_announce_at,
    min_age_required,
    excluded_states,
    free_entry_method,
    retired

}) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required")

        if (win_type != null && !WIN_TYPES.includes(win_type))
            throw httpError(400, `win_type must be one of: ${WIN_TYPES.join(", ")}`)
        if (contribution_type != null && !CONTRIBUTION_TYPES.includes(contribution_type))
            throw httpError(400, `contribution_type must be one of: ${CONTRIBUTION_TYPES.join(", ")}`)
        if (participation_type != null && !PARTICIPATION_TYPES.includes(participation_type))
            throw httpError(400, `participation_type must be one of: ${PARTICIPATION_TYPES.join(", ")}`)

        const SQL = `
            UPDATE debates
            SET
                sponsor_id                 = COALESCE($2, sponsor_id),
                title                      = COALESCE($3, title),
                description                = COALESCE($4, description),
                win_type                   = COALESCE($5, win_type),
                hybrid_crowd_weight_pct    = COALESCE($6, hybrid_crowd_weight_pct),
                contribution_type          = COALESCE($7, contribution_type),
                participation_type         = COALESCE($8, participation_type),
                sponsor_contribution_cents = COALESCE($9, sponsor_contribution_cents),
                platform_top_up_cents      = COALESCE($10, platform_top_up_cents),
                user_contributions_cents   = COALESCE($11, user_contributions_cents),
                prize_distribution_rules   = COALESCE($12, prize_distribution_rules),
                scoring_methodology        = COALESCE($13, scoring_methodology),
                status                     = COALESCE($14, status),
                start_date                 = COALESCE($15, start_date),
                end_date                   = COALESCE($16, end_date),
                results_announce_at        = COALESCE($17, results_announce_at),
                min_age_required           = COALESCE($18, min_age_required),
                excluded_states            = COALESCE($19::text[], excluded_states),
                free_entry_method          = COALESCE($20, free_entry_method),
                retired                    = COALESCE($21, retired),
                updated_at                 = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await client.query(SQL, [
            debate_id, sponsor_id, title, description, win_type, hybrid_crowd_weight_pct,
            contribution_type, participation_type, sponsor_contribution_cents,
            platform_top_up_cents, user_contributions_cents, prize_distribution_rules,
            scoring_methodology, status, start_date, end_date, results_announce_at,
            min_age_required, excluded_states, free_entry_method, retired,
        ])
        if (result.rows.length === 0) throw httpError(404, "debate not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "a debate field violates a check constraint")
        if (err.code === "23503") throw httpError(400, "sponsor_id does not exist")
        if (err.code === "22P02") throw httpError(400, "a uuid or array field is malformed")
        console.error(err)
        throw err
    }
}

// setDebateMarketingConsent — stamps marketing_consent_at = NOW() on the debate
// (the sponsor agrees to be featured in platform marketing). [DB §5] Added in
// migration 1780700000000. Takes optional db so it can compose inside the PATCH
// transaction. 404 when missing.
const setDebateMarketingConsent = async ({ debate_id }, db = client) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required")
        const SQL = `
            UPDATE debates
            SET marketing_consent_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await db.query(SQL, [debate_id])
        if (result.rows.length === 0) throw httpError(404, "debate not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        console.error(err)
        throw err
    }
}

// _setDebateStatus — internal helper behind the lifecycle transitions. The
// debates.status enum is ('draft','open_entry','live','no_posting','closed','cancelled').
const _setDebateStatus = async (debate_id, status, db = client) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required")
        const SQL = `
            UPDATE debates
            SET status = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await db.query(SQL, [debate_id, status])
        if (result.rows.length === 0) throw httpError(404, "debate not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23514") throw httpError(400, "invalid status transition")
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        console.error(err)
        throw err
    }
}

// publishDebate — open the debate for contestant entry.
const publishDebate = async ({ debate_id }, db = client) =>
    _setDebateStatus(debate_id, "open_entry", db)

// startDebate — the debate is now running / streaming.
const startDebate = async ({ debate_id }, db = client) =>
    _setDebateStatus(debate_id, "live", db)

// closeDebate — the debate has concluded.
const closeDebate = async ({ debate_id }, db = client) =>
    _setDebateStatus(debate_id, "closed", db)

// cancelDebate — the debate is called off.
const cancelDebate = async ({ debate_id }, db = client) =>
    _setDebateStatus(debate_id, "cancelled", db)

// getDebateLeaderboard — per-contestant valid-vote counts for a debate. Invalidated
// votes (invalidated_at IS NOT NULL) are excluded. Every non-withdrawn contestant
// appears, even with zero votes (LEFT JOIN), ordered most votes first.
const getDebateLeaderboard = async ({ debate_id }) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required")
        const SQL = `
            SELECT
                c.id            AS contestant_id,
                c.user_id,
                c.status,
                COUNT(v.vote_id) FILTER (WHERE v.invalidated_at IS NULL)::int AS valid_votes
            FROM contestants c
            LEFT JOIN debate_votes v
                ON v.contestant_id = c.id AND v.debate_id = c.debate_id
            WHERE c.debate_id = $1 AND c.withdrew_at IS NULL
            GROUP BY c.id, c.user_id, c.status
            ORDER BY valid_votes DESC, c.joined_at ASC;
        `
        const result = await client.query(SQL, [debate_id])
        return result.rows
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        console.error(err)
        throw err
    }
}

// recordSponsorFlatFeePayment — writes the debate_payments row for the flat fee a
// sponsor pays to POST a debate (payment_type='debate_sponsor_flat_fee', added in
// migration 1780700000000). This DOES NOT call Stripe — it only records the row;
// pass the Stripe identifiers/status the caller already obtained. status defaults
// to 'succeeded' (the row exists because the charge cleared).
const recordSponsorFlatFeePayment = async ({
    user_id,
    debate_id,
    amount_cents,
    currency = "usd",
    stripe_customer_id = null,
    stripe_payment_intent_id = null,
    stripe_charge_id = null,
    stripe_balance_txn_id = null,
    fee_amount_cents = null,
    net_amount_cents = null,
    platform_amount_cents = null,
    card_brand = null,
    card_last4 = null,
    wallet_type = null,
    status = "succeeded",
    charged_at = null,
}, db = client) => {
    try {
        if (!user_id) throw httpError(400, "user_id is required")
        if (!debate_id) throw httpError(400, "debate_id is required")
        if (!(Number(amount_cents) > 0)) throw httpError(400, "amount_cents must be > 0")
        const SQL = `
            INSERT INTO debate_payments (
                user_id, debate_id, payment_type, amount_cents, currency,
                stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
                stripe_balance_txn_id, fee_amount_cents, net_amount_cents,
                platform_amount_cents, card_brand, card_last4, wallet_type,
                status, charged_at
            )
            VALUES (
                $1, $2, 'debate_sponsor_flat_fee', $3, $4,
                $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING *;
        `
        const result = await db.query(SQL, [
            user_id, debate_id, amount_cents, currency,
            stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
            stripe_balance_txn_id, fee_amount_cents, net_amount_cents,
            platform_amount_cents, card_brand, card_last4, wallet_type,
            status, charged_at,
        ])
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") throw httpError(409, "this payment was already recorded")
        if (err.code === "23503") throw httpError(400, "user_id or debate_id does not exist")
        if (err.code === "23514") throw httpError(400, "a payment field violates a check constraint")
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed")
        console.error(err)
        throw err
    }
}

// incrementDebateContributions — internal: bump a debate's running total of user
// voluntary contributions by amount_cents (prize_pool_cents recomputes from it via
// the GENERATED column). Positive amounts only.
const incrementDebateContributions = async ({ debate_id, amount_cents }, db = client) => {
    try {
        if (!debate_id) throw httpError(400, "debate_id is required")
        if (!(Number(amount_cents) > 0)) throw httpError(400, "amount_cents must be > 0")
        const SQL = `
            UPDATE debates
            SET user_contributions_cents = user_contributions_cents + $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *;
        `
        const result = await db.query(SQL, [debate_id, amount_cents])
        if (result.rows.length === 0) throw httpError(404, "debate not found")
        return result.rows[0]
    } catch (err) {
        if (err.status) throw err
        // prize_pool_cap_chk (prize pool exceeds $5,000) surfaces as 23514.
        if (err.code === "23514") throw httpError(400, "contribution would exceed the prize-pool cap")
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        console.error(err)
        throw err
    }
}

module.exports = {
    WIN_TYPES,
    CONTRIBUTION_TYPES,
    PARTICIPATION_TYPES,
    createDebate,
    listCurrentDebates,
    listSponsoredDebates,
    listAllDebates,
    getDebateById,
    updateDebate,
    setDebateMarketingConsent,
    publishDebate,
    startDebate,
    closeDebate,
    cancelDebate,
    getDebateLeaderboard,
    recordSponsorFlatFeePayment,
    incrementDebateContributions,
}
