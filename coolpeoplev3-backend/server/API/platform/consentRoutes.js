const express = require("express");

const {
    recordConsent,
    withdrawConsentV2,
    getUserActiveConsents,
    getUserConsentHistory,
    recordSaleOptOut,
    getUserSaleStatus,
    isUserSellable,
    hasOptedOutOfSale,
    listSellableUsers,
} = require("../../DB/platform/consent");

const {
    savePushSubscription,
    revokePushSubscription,
    getActivePushTargets,
} = require("../../DB/platform/pushSubscriptions");

const { requireAuth, requireAdmin, captureRequestContext } = require("../../middleware");

const router = express.Router();

// Per-route middleware (NOT router.use): this router shares the "/api" mount with
// other routers, so a blanket router.use(requireAuth) would 401 EVERY /api/*
// request — including other routers' routes and unknown paths — not just these.
// CTX captures ip/user_agent (req.context) for the audit on write routes.
const authed = [requireAuth];
const authedCtx = [captureRequestContext, requireAuth];
const adminOnly = [requireAuth, requireAdmin()];

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------

// POST /consents — record a consent. Body: legal_document_id, consent_type,
// consent_method, context.
router.post("/consents", authedCtx, async (req, res, next) => {
    try {
        const { legal_document_id, consent_type, consent_method, context } = req.body;
        const consent = await recordConsent({
            user_id: req.user.id,
            legal_document_id,
            consent_type,
            ip_address: req.context.ip_address,
            user_agent: req.context.user_agent,
            consent_method,
            context,
        });
        return res.status(201).json(consent);
    } catch (err) {
        next(err);
    }
});

// POST /consents/:consentType/withdraw — append a withdrawal row for that type.
// (withdrawConsentV2 works by consent_type, so :consentType fills the spec's :id.)
router.post("/consents/:consentType/withdraw", authedCtx, async (req, res, next) => {
    try {
        const withdrawn = await withdrawConsentV2({
            user_id: req.user.id,
            consent_type: req.params.consentType,
            ip_address: req.context.ip_address,
            user_agent: req.context.user_agent,
            withdrawal_method: req.body?.withdrawal_method || "user_request",
            context: req.body?.context,
        });
        if (!withdrawn) {
            return res.status(404).json({ error: "No active consent of that type to withdraw" });
        }
        return res.json(withdrawn);
    } catch (err) {
        next(err);
    }
});

// GET /consents/me?consent_type=tos — the user's active consent for a type.
// (getUserActiveConsents is per-type; pass ?consent_type.)
router.get("/consents/me", authed, async (req, res, next) => {
    try {
        const { consent_type } = req.query;
        if (!consent_type) {
            return res.status(400).json({ error: "consent_type query param required" });
        }
        const consent = await getUserActiveConsents({ user_id: req.user.id, consent_type });
        return res.json(consent); // null if none active
    } catch (err) {
        next(err);
    }
});

// GET /consents/me/history — every consent row for the user.
router.get("/consents/me/history", authed, async (req, res, next) => {
    try {
        const history = await getUserConsentHistory({ user_id: req.user.id });
        return res.json(history);
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// Data sale (CCPA "Do Not Sell")
// ---------------------------------------------------------------------------

// GET /consents/me/sale-status — { sellable, opted_out, last_data_sale_consent }.
router.get("/consents/me/sale-status", authed, async (req, res, next) => {
    try {
        const status = await getUserSaleStatus({ user_id: req.user.id });
        return res.json(status);
    } catch (err) {
        next(err);
    }
});

// POST /consents/sale-opt-out — withdraw data_sale consent (CTX).
router.post("/consents/sale-opt-out", authedCtx, async (req, res, next) => {
    try {
        const result = await recordSaleOptOut({
            user_id: req.user.id,
            ip_address: req.context.ip_address,
            user_agent: req.context.user_agent,
            withdrawal_method: req.body?.withdrawal_method || "user_request",
            context: req.body?.context,
        });
        return res.json(result); // result.withdrawn is null if they were never opted in
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// Push subscriptions (PWA Web Push)
// ---------------------------------------------------------------------------

// POST /push/subscriptions — save/refresh this device's subscription.
router.post("/push/subscriptions", authedCtx, async (req, res, next) => {
    try {
        const { endpoint, p256dh_key, auth_key, consent_id } = req.body;
        if (!endpoint || !p256dh_key || !auth_key) {
            return res.status(400).json({ error: "endpoint, p256dh_key and auth_key are required" });
        }
        const sub = await savePushSubscription({
            user_id: req.user.id,
            endpoint,
            p256dh_key,
            auth_key,
            user_agent: req.context.user_agent,
            consent_id,
        });
        return res.status(201).json(sub);
    } catch (err) {
        next(err);
    }
});

// DELETE /push/subscriptions/:id — soft-revoke one subscription.
router.delete("/push/subscriptions/:id", authed, async (req, res, next) => {
    try {
        const result = await revokePushSubscription({ id: req.params.id });
        return res.json(result);
    } catch (err) {
        if (/no active push subscription/i.test(err.message)) {
            return res.status(404).json({ error: err.message });
        }
        next(err);
    }
});

// ---------------------------------------------------------------------------
// Admin / marketing
// ---------------------------------------------------------------------------

// GET /admin/sellable-users?limit&offset — users with active data_sale consent.
router.get("/admin/sellable-users", adminOnly, async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const offset = Number(req.query.offset) || 0;
        const users = await listSellableUsers({ limit, offset });
        return res.json(users);
    } catch (err) {
        next(err);
    }
});

// GET /admin/users/:userId/sale-status — both helper booleans for one user.
router.get("/admin/users/:userId/sale-status", adminOnly, async (req, res, next) => {
    try {
        const user_id = req.params.userId;
        const [sellable, opted_out] = await Promise.all([
            isUserSellable({ user_id }),
            hasOptedOutOfSale({ user_id }),
        ]);
        return res.json({ user_id, sellable, opted_out });
    } catch (err) {
        next(err);
    }
});

// GET /admin/users/:userId/push-targets — live endpoints for sending Web Push.
router.get("/admin/users/:userId/push-targets", adminOnly, async (req, res, next) => {
    try {
        const targets = await getActivePushTargets({ user_id: req.params.userId });
        return res.json(targets);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
