const { client } = require("../index.js");
const { getCurrentCriteria } = require("./notificationCriteria");

// ============================================================================
// §17 notification ENGINE — INTERNAL module, no routes.
//
// This is the NEUTRAL SCORER. It evaluates which users should be notified about
// which WouldBe campaigns by running every (candidate-campaign, user) pair through
// ONE objective formula whose parameters come from the in-force
// notification_criteria_versions row (11 CFR 110.13 "pre-established objective
// criteria"). It does NOT send anything and it does NOT write notifications — it
// returns ranked candidate matches, each carrying the trigger_snapshot (the
// objective inputs that fired the rule). A job runner / route then consent-checks
// (isUserNotifiable), frequency-caps (withinFrequencyCap), and queues the send.
//
// The same scoring is what getRecommendedWouldbes should eventually share — keep
// the geo/ideology math here honest and commented so there is a single source of
// truth for "why did this user see this campaign".
//
// INPUTS read: wouldbe, races, office, jurisdiction (tree), user_jurisdictions,
//              users.political_lean, pledges (via wouldbe.pledged_total_cents),
//              notification_criteria_versions, user_consents, push_subscriptions,
//              notifications.
//
// HELPER PROVENANCE (grep'd at build time):
//   - findUsersInJurisdictionTree  EXISTS  (server/DB/elections/userJurisdictions.js)
//        but returns only id/email/username/name — NOT political_lean — so the
//        ideology scorer needs lean; we run a lean-aware variant inline here
//        rather than do a second round-trip per user.
//   - getQualifyingOffices         EXISTS  (server/DB/elections/offices.js) —
//        the reciprocal "offices a user could run for"; not needed for fan-out.
//   - is_open_seat                 EXISTS  as races.is_open_seat (boolean).
// ============================================================================

// Defaults used ONLY if no criteria version has been published yet, so the engine
// degrades safely instead of throwing. A published version overrides all of these.
const DEFAULT_PARAMETERS = {
    // |recipient.political_lean - candidate.political_lean| must be <= this (1–10 scale).
    ideology_tolerance: 2,
    // geo-match tiers we will notify (1 = exact jurisdiction layer, 2 = same tree,
    // 3 = same state). Lower tier number = closer / stronger match.
    max_geo_tier: 3,
    // notify on goal-progress milestones at/above these ratios (pledged/goal).
    goal_progress_thresholds: [0.5, 0.75],
    // near_goal fires once pledged/goal >= this.
    near_goal_ratio: 0.9,
    // an open seat is treated as inherently more "contentious"/relevant.
    open_seat_bonus: true,
    // frequency cap: max notifications to one user per rolling window.
    frequency_cap: 3,
    frequency_window_hours: 24,
};

// ----------------------------------------------------------------------------
// evaluateWouldbeNotifications() — the main pass.
// Returns an array of candidate matches:
//   { recipient_user_id, wouldbe_id, notification_type, criteria_version_id,
//     trigger_snapshot } — ready to hand to consent/cap checks then queue.
// It does NOT dedupe against already-sent notifications or check consent; those
// are isUserNotifiable / withinFrequencyCap, kept separate so this stays a pure
// scorer.
// ----------------------------------------------------------------------------
const evaluateWouldbeNotifications = async () => {
    const criteria = await getCurrentCriteria({ algorithmKey: "wouldbe_notification" });
    const params = { ...DEFAULT_PARAMETERS, ...(criteria?.parameters || {}) };
    const criteriaVersionId = criteria?.id || null;

    // Active campaigns + their race/office/jurisdiction context. We need the
    // office's jurisdiction to find who lives there, and is_open_seat from the
    // race. retired campaigns are excluded. goal_cents is guaranteed > 0 by CHECK.
    const { rows: campaigns } = await client.query(
        `SELECT w.id AS wouldbe_id,
                w.user_id AS candidate_user_id,
                w.goal_cents,
                w.pledged_total_cents,
                o.jurisdiction_id,
                r.is_open_seat,
                cu.political_lean AS candidate_lean
         FROM wouldbe w
         LEFT JOIN races r     ON r.id = w.race_id
         LEFT JOIN office o    ON o.id = COALESCE(w.office_id, r.office_id)
         LEFT JOIN users  cu   ON cu.id = w.user_id
         WHERE w.retired = false`
    );

    const matches = [];

    for (const c of campaigns) {
        const goalRatio = c.goal_cents > 0
            ? Number(c.pledged_total_cents) / Number(c.goal_cents)
            : 0;

        // What kind of notice does this campaign's STATE warrant right now? One
        // campaign can qualify for several (e.g. it just crossed near_goal AND it
        // is an open seat). We compute the set, then fan out to matched users.
        const campaignTypes = classifyCampaign({ goalRatio, isOpenSeat: c.is_open_seat, params });
        if (campaignTypes.length === 0) continue;

        // Find candidate RECIPIENTS with their geo tier + political_lean in one
        // query (lean-aware variant of findUsersInJurisdictionTree). Tier 1 = this
        // exact jurisdiction layer; tier 2 = a descendant layer in the tree; we
        // approximate tier 3 (same state) only when we have no jurisdiction at all.
        const recipients = await findRecipientsForJurisdiction({
            jurisdictionId: c.jurisdiction_id,
            excludeUserId: c.candidate_user_id, // don't notify the candidate about themself
        });

        for (const u of recipients) {
            if (u.geo_tier > params.max_geo_tier) continue;

            // Ideology match: only when BOTH leans are known. Missing lean is NOT
            // treated as a match (neutral: we don't guess political alignment).
            let ideologyDelta = null;
            let ideologyMatch = false;
            if (c.candidate_lean != null && u.political_lean != null) {
                ideologyDelta = Math.abs(Number(u.political_lean) - Number(c.candidate_lean));
                ideologyMatch = ideologyDelta <= params.ideology_tolerance;
            }

            // The objective inputs that fired the rule — frozen onto every send as
            // proof the same formula ran for everyone.
            const snapshotBase = {
                ideology_delta: ideologyDelta,
                ideology_tolerance: params.ideology_tolerance,
                goal_progress_ratio: round2(goalRatio),
                geo_match_tier: u.geo_tier,
                is_open_seat: !!c.is_open_seat,
                candidate_lean: c.candidate_lean ?? null,
                recipient_lean: u.political_lean ?? null,
            };

            for (const notification_type of campaignTypes) {
                // ideology_match notices require an actual ideology match; the
                // other types are state-of-campaign notices and go to everyone in
                // range (still recorded with the ideology inputs for audit).
                if (notification_type === "ideology_match" && !ideologyMatch) continue;

                matches.push({
                    recipient_user_id: u.id,
                    wouldbe_id: c.wouldbe_id,
                    notification_type,
                    criteria_version_id: criteriaVersionId,
                    trigger_snapshot: { ...snapshotBase, rule: notification_type },
                });
            }
        }
    }

    return matches;
};

// classifyCampaign — pure: which notification_type(s) a campaign's current state
// warrants under the given params. Order is most-specific-first.
function classifyCampaign({ goalRatio, isOpenSeat, params }) {
    const types = [];
    // near_goal takes precedence over generic goal_progress.
    if (goalRatio >= params.near_goal_ratio) {
        types.push("near_goal");
    } else if (
        Array.isArray(params.goal_progress_thresholds) &&
        params.goal_progress_thresholds.some((t) => goalRatio >= t)
    ) {
        types.push("goal_progress");
    }
    // contentious_race: open seats are the canonical objective "contentious" signal
    // we have today (no incumbent). Gated by the param so criteria can disable it.
    if (params.open_seat_bonus && isOpenSeat) {
        types.push("contentious_race");
    }
    // ideology_match is always a candidate TYPE; whether a given user actually
    // matches is decided per-recipient by the lean delta.
    types.push("ideology_match");
    return types;
}

// findRecipientsForJurisdiction — users in/under a jurisdiction WITH political_lean
// and a geo tier. Lean-aware companion to findUsersInJurisdictionTree (which omits
// lean). tier 1 = exact layer; tier 2 = descendant layer; we keep the closest tier
// per user via MIN. If jurisdictionId is null we have no geography to match on and
// return [] (a statewide fallback would need users.state, left as a TODO below).
async function findRecipientsForJurisdiction({ jurisdictionId, excludeUserId = null }) {
    if (!jurisdictionId) {
        // TODO(statewide-fallback): when a campaign has no office/jurisdiction we
        // could fan out to users.state via findUsersInState, but that has no lean-
        // aware geo tier yet. Skipped rather than over-notify on weak geography.
        return [];
    }
    const { rows } = await client.query(
        `WITH RECURSIVE tree AS (
            SELECT id, 1 AS depth FROM jurisdiction WHERE id = $1
            UNION ALL
            SELECT j.id, t.depth + 1
            FROM jurisdiction j
            JOIN tree t ON j.parent_jurisdiction_id = t.id
         )
         SELECT u.id,
                u.email,
                u.username,
                u.political_lean,
                MIN(CASE WHEN t.depth = 1 THEN 1 ELSE 2 END) AS geo_tier
         FROM tree t
         JOIN user_jurisdictions uj ON uj.jurisdiction_id = t.id
         JOIN users u              ON u.id = uj.user_id
         WHERE ($2::uuid IS NULL OR u.id <> $2)
         GROUP BY u.id, u.email, u.username, u.political_lean`,
        [jurisdictionId, excludeUserId]
    );
    return rows;
}

// ----------------------------------------------------------------------------
// isUserNotifiable({ userId, channel }) — consent + reachability gate.
// Returns { notifiable: boolean, reason, consent_id }. A match from the scorer is
// only allowed to send if this passes for the chosen channel. Reads:
//   - user_consents for the channel's required consent type (active = withdrawn_at
//     IS NULL), and
//   - push_subscriptions for push (must have a live, non-revoked subscription).
// We DON'T re-derive marketing vs transactional here beyond mapping the channel to
// its consent type; the caller picks the channel.
// ----------------------------------------------------------------------------
const CHANNEL_CONSENT = {
    // wouldbe notifications are marketing-class outreach about a campaign.
    email: "marketing_email",
    sms: "sms_marketing",
    push: "push_wouldbe",
    // in_app is shown inside the authenticated product surface; no extra consent.
    in_app: null,
};

const isUserNotifiable = async ({ userId, channel }) => {
    if (!userId) return { notifiable: false, reason: "missing_user", consent_id: null };
    if (!CHANNEL_CONSENT.hasOwnProperty(channel)) {
        return { notifiable: false, reason: "unknown_channel", consent_id: null };
    }

    const consentType = CHANNEL_CONSENT[channel];

    // in_app needs no consent row.
    if (consentType === null) {
        return { notifiable: true, reason: null, consent_id: null };
    }

    // Latest ACTIVE consent of the required type (withdrawn_at IS NULL).
    const { rows: consents } = await client.query(
        `SELECT id FROM user_consents
         WHERE user_id = $1 AND consent_type = $2 AND withdrawn_at IS NULL
         ORDER BY consented_at DESC
         LIMIT 1`,
        [userId, consentType]
    );
    if (!consents.length) {
        return { notifiable: false, reason: "no_active_consent", consent_id: null };
    }
    const consent_id = consents[0].id;

    // push also requires a live subscription (a browser to deliver to).
    if (channel === "push") {
        const { rows: subs } = await client.query(
            `SELECT id FROM push_subscriptions
             WHERE user_id = $1 AND revoked_at IS NULL
             LIMIT 1`,
            [userId]
        );
        if (!subs.length) {
            return { notifiable: false, reason: "no_push_subscription", consent_id };
        }
    }

    return { notifiable: true, reason: null, consent_id };
};

// ----------------------------------------------------------------------------
// withinFrequencyCap({ userId, window }) — true if the user is UNDER the cap (i.e.
// it's OK to send one more). Counts notifications that actually went out or are in
// flight (queued/sent/delivered) in the rolling window; suppressed/failed don't
// count against the user. window is { count, hours }; defaults come from the
// in-force criteria parameters.
// ----------------------------------------------------------------------------
const withinFrequencyCap = async ({ userId, window = null }) => {
    if (!userId) return false;

    let cap = window?.count;
    let hours = window?.hours;
    if (cap == null || hours == null) {
        const criteria = await getCurrentCriteria({ algorithmKey: "wouldbe_notification" });
        const params = { ...DEFAULT_PARAMETERS, ...(criteria?.parameters || {}) };
        cap = cap ?? params.frequency_cap;
        hours = hours ?? params.frequency_window_hours;
    }
    // A non-positive cap means "no sends allowed"; an unset cap means "no limit".
    if (cap == null) return true;
    if (cap <= 0) return false;

    const { rows } = await client.query(
        `SELECT count(*)::int AS n
         FROM notifications
         WHERE recipient_user_id = $1
           AND status IN ('queued','sent','delivered')
           AND created_at >= now() - ($2 || ' hours')::interval`,
        [userId, String(hours)]
    );
    return rows[0].n < cap;
};

// pure round helper for snapshot ratios
function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
    evaluateWouldbeNotifications,
    isUserNotifiable,
    withinFrequencyCap,
};
