const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const { findUserByToken } = require("../../DB/platform/auth");
const {
    createDebate,
    listCurrentDebates,
    listSponsoredDebates,
    getDebateById,
    updateDebate,
    setDebateMarketingConsent,
    publishDebate,
    startDebate,
    closeDebate,
    cancelDebate,
    getDebateLeaderboard,
    recordSponsorFlatFeePayment,
} = require("../../DB/debate/debates");
const { getDebateFull } = require("../../DB/debate/debateFull");
const { setDebateStart } = require("../../DB/debate/debateStart");
const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
} = require("../../middleware");

const router = express.Router();

// POST /api/debates — admin creates a debate (the sponsor_id is supplied in the
// body; sponsor self-serve creation, if added later, would gate differently).
router.post(
    "/debates",
    requireAuth,
    requireAdmin(),
    recordAdminAction("create_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            const debate = await createDebate({
                sponsor_id: req.body.sponsor_id,
                title: req.body.title,
                description: req.body.description,
                win_type: req.body.win_type,
                hybrid_crowd_weight_pct: req.body.hybrid_crowd_weight_pct,
                contribution_type: req.body.contribution_type,
                participation_type: req.body.participation_type,
                sponsor_contribution_cents: req.body.sponsor_contribution_cents,
                platform_top_up_cents: req.body.platform_top_up_cents,
                user_contributions_cents: req.body.user_contributions_cents,
                prize_distribution_rules: req.body.prize_distribution_rules,
                scoring_methodology: req.body.scoring_methodology,
                status: req.body.status,
                start_date: req.body.start_date,
                end_date: req.body.end_date,
                results_announce_at: req.body.results_announce_at,
                min_age_required: req.body.min_age_required,
                excluded_states: req.body.excluded_states,
                free_entry_method: req.body.free_entry_method,
            });
            return res.status(201).json(debate);
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/debates — the public list of current (non-draft, non-cancelled) debates.
// ?sort=featured orders by cash prize then nominations (the home page's ordering);
// the default is by field size.
router.get("/debates", async (req, res, next) => {
    try {
        return res.json(
            await listCurrentDebates({
                limit: req.query.limit,
                sort: req.query.sort,
                prize: req.query.prize,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:userId/sponsored-debates — debates this user HOSTS, reached via
// debates.sponsor_id -> sponsors.user_id. Distinct from /users/:userId/debates and
// /debate-history, which both join `contestants` — hosting and competing are
// different relationships, and a sponsor's own debates were previously unreachable
// through the API.
//
// Visibility mirrors GET /api/debates for everyone EXCEPT the sponsor themselves:
// drafts, cancellations and retired rows are hidden from other viewers, and
// returned in full to the owner (that's the only way back to an unpublished
// draft). Auth is therefore OPTIONAL — a token upgrades the view rather than
// gating it, so public profiles keep working logged-out. A bad/expired token is
// treated as logged-out rather than 401, since the public view is still valid.
router.get("/users/:userId/sponsored-debates", async (req, res, next) => {
    try {
        let isOwner = false;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization);
                isOwner = !!viewer && viewer.id === req.params.userId;
            } catch {
                isOwner = false;
            }
        }
        return res.json(
            await listSponsoredDebates({
                userId: req.params.userId,
                includeUnlisted: isOwner,
                limit: req.query.limit,
            })
        );
    } catch (err) {
        if (err.code === "22P02") return res.status(400).json({ error: "userId must be a valid uuid" });
        next(err);
    }
});

// GET /api/debates/:id/leaderboard — per-contestant valid-vote counts (public).
// Declared before /debates/:id so it isn't shadowed by the bare-id route.
router.get("/debates/:id/leaderboard", async (req, res, next) => {
    try {
        return res.json(await getDebateLeaderboard({ debate_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id/full — the debate detail page in one request: the debate
// (with sponsor identity), the active contestant roster, the nomination tally,
// the current official rules and the judging criteria. Declared before
// /debates/:id so the bare-id route doesn't shadow it.
//
// Auth is OPTIONAL and only widens the response, matching
// /users/:userId/sponsored-debates: a token sets is_sponsor and is what lets the
// host open their own unpublished draft. A bad or expired token is treated as
// logged-out rather than 401, since the public view is still perfectly valid.
router.get("/debates/:id/full", async (req, res, next) => {
    try {
        let viewerUserId = null;
        if (req.headers.authorization) {
            try {
                const viewer = await findUserByToken(req.headers.authorization);
                viewerUserId = viewer ? viewer.id : null;
            } catch {
                viewerUserId = null;
            }
        }
        return res.json(
            await getDebateFull({
                debate_id: req.params.id,
                viewer_user_id: viewerUserId,
            })
        );
    } catch (err) {
        next(err);
    }
});

// GET /api/debates/:id — a single debate (public).
router.get("/debates/:id", async (req, res, next) => {
    try {
        const debate = await getDebateById({ debate_id: req.params.id });
        if (!debate) return res.status(404).json({ error: "debate not found" });
        return res.json(debate);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/debates/:id/schedule — set or move WHEN the debate starts.
//
// Named /schedule, not /start, because POST /debates/:id/start already exists
// further down and means "it is starting NOW, mark it live". Those are different
// enough that sharing a path only by verb would be a trap.
//
// Body: { scheduled_at, timezone }
//   scheduled_at — 'YYYY-MM-DDTHH:mm' straight from <input type="datetime-local">
//                  (no zone in it), or a full ISO instant.
//   timezone     — IANA name, e.g. 'America/New_York'. REQUIRED: the instant
//                  alone cannot say whether the sponsor meant 8pm Eastern or 8pm
//                  Pacific, and that is the string the page shows a viewer.
//
// Writes start_at, start_timezone, the start_date/end_date shadow and the
// debate_streams row together, so the schedule cannot half-move. A start with no
// hour is rejected — this is a livestream, not a calendar day.
//
// Admin-gated like the other lifecycle writes on this router. Sponsors schedule
// through the application form; moving a published debate is a decision with
// entrants on the other end of it.
router.patch(
    "/debates/:id/schedule",
    requireAuth,
    requireAdmin(),
    recordAdminAction("set_debate_schedule", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            const debate = await setDebateStart({
                debate_id: req.params.id,
                scheduled_at: req.body.scheduled_at,
                timezone: req.body.timezone,
            });
            return res.json(debate);
        } catch (err) {
            next(err);
        }
    }
);

// PATCH /api/debates/:id — admin partial update. If the body carries
// marketing_consent=true we ALSO stamp marketing_consent_at, in one transaction
// with the field update so they can't half-commit.
router.patch(
    "/debates/:id",
    requireAuth,
    requireAdmin(),
    recordAdminAction("update_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            const debate = await withTransaction(async (tx) => {
                const updated = await updateDebate(
                    {
                        debate_id: req.params.id,
                        sponsor_id: req.body.sponsor_id,
                        title: req.body.title,
                        description: req.body.description,
                        win_type: req.body.win_type,
                        hybrid_crowd_weight_pct: req.body.hybrid_crowd_weight_pct,
                        contribution_type: req.body.contribution_type,
                        participation_type: req.body.participation_type,
                        sponsor_contribution_cents: req.body.sponsor_contribution_cents,
                        platform_top_up_cents: req.body.platform_top_up_cents,
                        user_contributions_cents: req.body.user_contributions_cents,
                        prize_distribution_rules: req.body.prize_distribution_rules,
                        scoring_methodology: req.body.scoring_methodology,
                        status: req.body.status,
                        start_date: req.body.start_date,
                        end_date: req.body.end_date,
                        results_announce_at: req.body.results_announce_at,
                        min_age_required: req.body.min_age_required,
                        excluded_states: req.body.excluded_states,
                        free_entry_method: req.body.free_entry_method,
                        retired: req.body.retired,
                    },
                    tx
                );
                if (req.body.marketing_consent === true) {
                    return await setDebateMarketingConsent({ debate_id: req.params.id }, tx);
                }
                return updated;
            });
            return res.json(debate);
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/publish — admin opens the debate for entry (open_entry).
router.post(
    "/debates/:id/publish",
    requireAuth,
    requireAdmin(),
    recordAdminAction("publish_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            return res.json(await publishDebate({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/start — admin marks the debate live.
router.post(
    "/debates/:id/start",
    requireAuth,
    requireAdmin(),
    recordAdminAction("start_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            return res.json(await startDebate({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/close — admin closes the concluded debate.
router.post(
    "/debates/:id/close",
    requireAuth,
    requireAdmin(),
    recordAdminAction("close_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            return res.json(await closeDebate({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/cancel — admin cancels the debate.
router.post(
    "/debates/:id/cancel",
    requireAuth,
    requireAdmin(),
    recordAdminAction("cancel_debate", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            return res.json(await cancelDebate({ debate_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/debates/:id/sponsor-fee — admin records the sponsor flat-fee payment
// row (the Stripe charge happened elsewhere; this only writes debate_payments).
router.post(
    "/debates/:id/sponsor-fee",
    requireAuth,
    requireAdmin(),
    recordAdminAction("record_sponsor_flat_fee", { resourceType: "debates" }),
    async (req, res, next) => {
        try {
            const payment = await recordSponsorFlatFeePayment({
                debate_id: req.params.id,
                user_id: req.body.user_id,
                amount_cents: req.body.amount_cents,
                currency: req.body.currency,
                stripe_customer_id: req.body.stripe_customer_id,
                stripe_payment_intent_id: req.body.stripe_payment_intent_id,
                stripe_charge_id: req.body.stripe_charge_id,
                stripe_balance_txn_id: req.body.stripe_balance_txn_id,
                fee_amount_cents: req.body.fee_amount_cents,
                net_amount_cents: req.body.net_amount_cents,
                platform_amount_cents: req.body.platform_amount_cents,
                card_brand: req.body.card_brand,
                card_last4: req.body.card_last4,
                wallet_type: req.body.wallet_type,
                status: req.body.status,
                charged_at: req.body.charged_at,
            });
            return res.status(201).json(payment);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
