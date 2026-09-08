const express = require("express");

const {
    createPledge,
    refundPledge,
    recordOfflinePledge,
    markReceiptSent,
    listPledges,
    pledgeSummary,
} = require("../../DB/payments/fundPledges");
const { requireAuth, requireAdmin } = require("../../middleware");

const router = express.Router();

// ===========================================================================
// The launch raise — public pledge intake plus the admin board behind it.
//
// AUTH SHAPE, and why it is unusual for this codebase: POST /fund/pledges is
// the ONLY money route here that is not behind requireAuth. That is deliberate
// and it is the whole point — a backer arriving from an Instagram link has no
// account, and a signup wall in front of the payment form is where most of a
// raise goes to die. The email in the body is the identity.
//
// Everything that READS the ledger is admin-gated, because the ledger is a list
// of names, email addresses, amounts and IPs.
// ===========================================================================

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

// POST /fund/pledges — record a pledge and open the payment.
// Returns { pledge, client_secret }; the browser confirms with the secret.
router.post("/fund/pledges", async (req, res, next) => {
    try {
        const result = await createPledge({
            email: req.body.email,
            backer_name: req.body.backer_name ?? null,
            amount_cents: req.body.amount_cents,
            channel: req.body.channel ?? "card",
            is_anonymous: req.body.is_anonymous ?? false,
            backer_note: req.body.backer_note ?? null,
            // The reward tier is NOT read from the body — it is resolved from the
            // amount in the DB layer. A client-supplied tier is a free upgrade.
            //
            // user_id only if a real token happened to be present; this route
            // never REQUIRES one.
            user_id: req.user?.id ?? null,
            ip_address: req.ip ?? null,
            user_agent: req.headers["user-agent"] ?? null,
        });
        return res.status(201).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /fund/config — the Stripe PUBLISHABLE key, at runtime.
//
// WHY THIS EXISTS. The key used to reach the browser only through Vite's
// VITE_STRIPE_PUBLISHABLE_KEY, which is inlined at BUILD time. That coupling is
// a trap on a hosted frontend: setting the variable does nothing until the
// bundle is rebuilt, so "I set the key and it still doesn't work" is the
// expected experience rather than a mistake. Serving it from here means the
// backend is the single place Stripe is configured, and a restart is enough.
//
// PUBLISHABLE KEYS ARE PUBLIC. This one ships inside every page's JavaScript by
// design — it can create payment intents to confirm, nothing more. The SECRET
// key never leaves the server and is not referenced here.
router.get("/fund/config", (_req, res) => {
    const key = process.env.STRIPE_PUBLISHABLE_KEY || null;
    return res.json({
        publishable_key: key,
        // So an operator can tell live from test at a glance without reading
        // the key, and so the page can warn when it is about to take play money.
        mode: key ? (key.startsWith("pk_live_") ? "live" : "test") : null,
    });
});

// GET /fund/summary — the numbers behind the public meter.
// PUBLIC ON PURPOSE, and deliberately NOT the same shape as the admin summary:
// this returns totals only. No email, no name, no row ever reaches this route.
router.get("/fund/summary", async (_req, res, next) => {
    try {
        const s = await pledgeSummary();
        return res.json({
            raised_cents: s.raised_cents,
            backers: s.backers,
            avg_pledge_cents: s.avg_pledge_cents,
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// ADMIN — the board. requireAuth then requireAdmin, the order the middleware
// module documents: requireAdmin reads req.user, which requireAuth sets.
// ---------------------------------------------------------------------------

// GET /fund/pledges — the ledger. Every filter optional.
router.get("/fund/pledges", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listPledges({
            status: req.query.status || null,
            channel: req.query.channel || null,
            q: req.query.q || null,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /fund/pledges/summary — totals, plus the tier and channel breakdowns the
// public route withholds.
router.get("/fund/pledges/summary", requireAuth, requireAdmin(), async (_req, res, next) => {
    try {
        return res.json(await pledgeSummary());
    } catch (err) {
        next(err);
    }
});

// GET /fund/pledges/export.csv — the whole ledger as a file.
// This exists because the alternative is somebody pasting the table out of the
// browser into a spreadsheet, losing the cents-to-dollars conversion on the way.
router.get("/fund/pledges/export.csv", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const rows = await listPledges({ status: req.query.status || null, limit: 500 });
        const head = [
            "created_at", "email", "backer_name", "amount_usd", "tier_id",
            "reward_level", "channel", "status", "charged_at", "refunded_at",
            "refund_usd", "receipt_sent_at", "stripe_payment_intent_id",
        ];
        // A field that starts with = + - @ is executed as a formula by Excel and
        // Sheets. Prefixing with a quote neutralises it — a backer whose display
        // name is "=cmd|..." must not become a live cell in a finance export.
        const esc = (v) => {
            if (v === null || v === undefined) return "";
            let s = String(v);
            if (/^[=+\-@]/.test(s)) s = `'${s}`;
            return `"${s.replace(/"/g, '""')}"`;
        };
        const body = rows.map((r) => [
            r.created_at, r.email, r.backer_name, (r.amount_cents / 100).toFixed(2),
            r.tier_id, r.reward_level, r.channel, r.status, r.charged_at, r.refunded_at,
            r.refund_amount_cents == null ? "" : (r.refund_amount_cents / 100).toFixed(2),
            r.receipt_sent_at, r.stripe_payment_intent_id,
        ].map(esc).join(","));

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="wouldbe-backers-${new Date().toISOString().slice(0, 10)}.csv"`);
        return res.send([head.join(","), ...body].join("\n"));
    } catch (err) {
        next(err);
    }
});

// POST /fund/pledges/offline — a mailed check or a wire, entered by hand.
router.post("/fund/pledges/offline", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const pledge = await recordOfflinePledge({
            email: req.body.email,
            backer_name: req.body.backer_name ?? null,
            amount_cents: req.body.amount_cents,
            channel: req.body.channel ?? "check",
            backer_note: req.body.backer_note ?? null,
        });
        return res.status(201).json(pledge);
    } catch (err) {
        next(err);
    }
});

// POST /fund/pledges/:id/refund — honour the refund promise on the page.
// Full refund by default; pass amount_cents for a partial.
router.post("/fund/pledges/:id/refund", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const pledge = await refundPledge({
            id: req.params.id,
            amount_cents: req.body?.amount_cents ?? null,
        });
        return res.json(pledge);
    } catch (err) {
        next(err);
    }
});

// POST /fund/pledges/:id/receipt-sent — stamp that the receipt went out.
// Manual for now: the receipt itself is not wired to an email provider, and a
// timestamp claiming otherwise would be the page's refund promise resting on a
// record that is not true.
router.post("/fund/pledges/:id/receipt-sent", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        const pledge = await markReceiptSent({ id: req.params.id });
        if (!pledge) return res.status(404).json({ error: "Pledge not found" });
        return res.json(pledge);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
