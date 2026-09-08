const { client } = require("../index.js");
const stripe = require("../../services/stripe");

// ===========================================================================
// The launch raise. One row per pledge to WouldBe the COMPANY — a rewards
// pre-sale, NOT a contribution to a candidate. See the migration header for why
// this is deliberately not the `pledges` table.
//
// LIFECYCLE. createPledge inserts 'pending' and (for a Stripe channel) creates
// the PaymentIntent whose id it carries. The webhook flips it to 'succeeded'
// via markPledgePaid, which is idempotent because Stripe redelivers. Offline
// channels (a mailed check, a wire) skip Stripe entirely and are recorded by an
// admin with recordOfflinePledge.
//
// EVERY CHANNEL. The PaymentIntent is created with automatic_payment_methods so
// Stripe offers whatever is enabled on the account — card, Apple/Google Pay,
// Link, Cash App, ACH, Klarna, Affirm, Amazon Pay — without this file naming
// them. `channel` records what the backer actually used, which Stripe only
// tells us at confirmation time, so it starts as the client's declared intent
// and is corrected by the webhook.
// ===========================================================================

const httpError = (s, m) => { const e = new Error(m); e.status = s; return e; };

// Reward tiers, resolved from the AMOUNT rather than from whatever the client
// claims it clicked — the amount is the contract, and a client-supplied tier is
// a free upgrade to anyone who edits a request body.
const TIERS = [
    { id: "l1", level: 1, min_cents: 2500 },
    { id: "l2", level: 2, min_cents: 10000 },
    { id: "l3", level: 3, min_cents: 50000 },
];

const tierFor = (cents) =>
    [...TIERS].reverse().find((t) => cents >= t.min_cents) || null;

// Explicit projection. `ip_address` and `user_agent` are fraud-triage fields and
// are NOT in the default shape — they leave the database only through the admin
// board, which asks for them by name.
const PLEDGE_COLS = `
    id, user_id, email, backer_name, amount_cents, currency,
    tier_id, reward_level, channel, status, failure_reason,
    stripe_payment_intent_id, stripe_customer_id, paypal_order_id,
    fee_amount_cents, net_amount_cents, receipt_sent_at,
    charged_at, refunded_at, refund_amount_cents,
    is_anonymous, backer_note, created_at, updated_at
`;

// A pledge below the smallest tier is still a pledge (the page offers "any
// amount"), but Stripe will not process under $0.50 and a $0 row would sit in
// the totals forever as a rounding ghost.
const MIN_CENTS = 100;
// Nothing legitimate arrives above this on a rewards raise, and a mistyped
// amount ($500000 instead of $500.00) is a support incident either way.
const MAX_CENTS = 5000000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------------------
// createPledge — the public path. Inserts 'pending', then creates the Stripe
// PaymentIntent and stamps its id, returning the client_secret the browser needs
// to confirm. Insert-FIRST is deliberate: if Stripe succeeds and our insert
// fails we have taken money we have no record of, which is the one ordering
// that cannot be reconciled afterwards.
// ---------------------------------------------------------------------------
const createPledge = async ({
    email,
    backer_name = null,
    amount_cents,
    channel = "card",
    user_id = null,
    is_anonymous = false,
    backer_note = null,
    currency = "usd",
    ip_address = null,
    user_agent = null,
} = {}) => {
    const cents = Number(amount_cents);
    if (!Number.isInteger(cents)) throw httpError(400, "amount_cents must be an integer");
    if (cents < MIN_CENTS) throw httpError(400, `Minimum pledge is $${MIN_CENTS / 100}`);
    if (cents > MAX_CENTS) throw httpError(400, "Pledge exceeds the online maximum — contact us to arrange a transfer");

    const addr = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) throw httpError(400, "A valid email is required");

    const tier = tierFor(cents);

    const { rows } = await client.query(
        `INSERT INTO fund_pledges
            (user_id, email, backer_name, amount_cents, currency, tier_id,
             reward_level, channel, status, is_anonymous, backer_note,
             ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)
         RETURNING ${PLEDGE_COLS}`,
        [user_id, addr, backer_name, cents, currency, tier?.id ?? null,
         tier?.level ?? null, channel, !!is_anonymous, backer_note,
         ip_address, user_agent]
    );
    const pledge = rows[0];

    // Offline channels have no processor leg. The row stands as a record and an
    // admin confirms it when the money actually lands.
    if (channel === "check" || channel === "wire") {
        return { pledge, client_secret: null };
    }

    // The row is already safely written. If the PROCESSOR is unavailable we do
    // NOT throw it away: the stripe adapter raises a 503 until keys are
    // configured, and losing a backer's email over a missing env var is a worse
    // outcome than holding an unpaid intent. The pledge stands as 'pending' with
    // the reason recorded, the caller is told there is no payment leg, and it is
    // completed by hand or by a follow-up email.
    let intent;
    try {
        intent = await stripe.createPaymentIntent({
            amount_cents: cents,
            currency,
            // THE WHOLE PAYMENT-METHOD LIST COMES FROM HERE. Stripe returns
            // whatever is enabled on the account and the browser can actually
            // use — a wallet only appears on a device that has one. Nothing in
            // this codebase names the methods any more.
            automatic_payment_methods: true,
            metadata: {
                kind: "fund_pledge",
                fund_pledge_id: pledge.id,
                tier_id: tier?.id ?? "",
                email: addr,
            },
        });
    } catch (err) {
        const { rows: held } = await client.query(
            `UPDATE fund_pledges SET failure_reason = $2, updated_at = now()
             WHERE id = $1 RETURNING ${PLEDGE_COLS}`,
            [pledge.id, `processor_unavailable: ${err.message}`]
        );
        return { pledge: held[0], client_secret: null, processor_unavailable: true };
    }

    const { rows: updated } = await client.query(
        `UPDATE fund_pledges SET stripe_payment_intent_id = $2, updated_at = now()
         WHERE id = $1 RETURNING ${PLEDGE_COLS}`,
        [pledge.id, intent.id]
    );

    return { pledge: updated[0], client_secret: intent.client_secret };
};

// Stripe's payment_method_types do not all match our `channel` CHECK, and a
// mismatch would raise a constraint violation INSIDE the webhook handler — which
// Stripe reads as a failed delivery and retries, forever, on a payment that
// actually succeeded. So every incoming type is normalised and anything
// unrecognised becomes 'other'. Recording the channel imprecisely is a reporting
// nuisance; failing the webhook is a pledge that never settles.
const CHANNEL_ALIASES = {
    afterpay_clearpay: "afterpay",
    us_bank_account: "us_bank_account",
    cashapp: "cashapp",
    amazon_pay: "amazon_pay",
    sepa_debit: "sepa_debit",
    wechat_pay: "wechat_pay",
};
const ALLOWED_CHANNELS = new Set([
    "card", "apple_pay", "google_pay", "link", "cashapp", "ach", "us_bank_account",
    "paypal", "venmo", "klarna", "affirm", "afterpay", "amazon_pay", "alipay",
    "wechat_pay", "sepa_debit", "ideal", "bancontact", "check", "wire", "other",
]);
const normaliseChannel = (t) => {
    if (!t) return null;
    const v = CHANNEL_ALIASES[t] ?? t;
    return ALLOWED_CHANNELS.has(v) ? v : "other";
};

// ---------------------------------------------------------------------------
// markPledgePaid — the webhook's job. IDEMPOTENT: the WHERE clause refuses to
// re-stamp a row already 'succeeded', so a redelivered event is a no-op rather
// than a second charged_at and a second entry in the day's totals.
// ---------------------------------------------------------------------------
const markPledgePaid = async ({
    stripe_payment_intent_id,
    stripe_charge_id = null,
    channel = null,
    fee_amount_cents = null,
    net_amount_cents = null,
} = {}) => {
    if (!stripe_payment_intent_id) throw httpError(400, "stripe_payment_intent_id is required");
    const { rows } = await client.query(
        `UPDATE fund_pledges
            SET status = 'succeeded',
                charged_at = COALESCE(charged_at, now()),
                stripe_charge_id = COALESCE($2, stripe_charge_id),
                channel = COALESCE($3, channel),
                fee_amount_cents = COALESCE($4, fee_amount_cents),
                net_amount_cents = COALESCE($5, net_amount_cents),
                updated_at = now()
          WHERE stripe_payment_intent_id = $1
            AND status <> 'succeeded'
        RETURNING ${PLEDGE_COLS}`,
        [stripe_payment_intent_id, stripe_charge_id, normaliseChannel(channel),
         fee_amount_cents, net_amount_cents]
    );
    return rows[0] || null;
};

const markPledgeFailed = async ({ stripe_payment_intent_id, failure_reason = null } = {}) => {
    const { rows } = await client.query(
        `UPDATE fund_pledges
            SET status = 'failed', failure_reason = $2, updated_at = now()
          WHERE stripe_payment_intent_id = $1 AND status = 'pending'
        RETURNING ${PLEDGE_COLS}`,
        [stripe_payment_intent_id, failure_reason]
    );
    return rows[0] || null;
};

// ---------------------------------------------------------------------------
// refundPledge — issues the Stripe refund FIRST, then records it. That order is
// the safe one here: a recorded refund that never reached the processor is a
// backer who was told they got their money back and did not.
// ---------------------------------------------------------------------------
const refundPledge = async ({ id, amount_cents = null } = {}) => {
    const { rows: found } = await client.query(
        `SELECT id, status, amount_cents, stripe_payment_intent_id
           FROM fund_pledges WHERE id = $1`, [id]
    );
    const p = found[0];
    if (!p) throw httpError(404, "Pledge not found");
    if (p.status === "refunded") throw httpError(409, "Pledge is already refunded");
    if (p.status !== "succeeded") throw httpError(409, "Only a succeeded pledge can be refunded");

    const amount = amount_cents == null ? p.amount_cents : Number(amount_cents);
    if (!Number.isInteger(amount) || amount <= 0 || amount > p.amount_cents) {
        throw httpError(400, "Refund amount must be between 1 and the pledge amount");
    }

    if (p.stripe_payment_intent_id) {
        await stripe.createRefund({
            payment_intent_id: p.stripe_payment_intent_id,
            amount_cents: amount,
        });
    }

    const { rows } = await client.query(
        `UPDATE fund_pledges
            SET status = 'refunded', refunded_at = now(),
                refund_amount_cents = $2, updated_at = now()
          WHERE id = $1
        RETURNING ${PLEDGE_COLS}`,
        [id, amount]
    );
    return rows[0];
};

// recordOfflinePledge — a mailed check or a wire, entered by an admin. Lands
// 'succeeded' immediately because the admin is confirming money already in the
// bank; there is no processor to wait on.
const recordOfflinePledge = async ({
    email, backer_name = null, amount_cents, channel = "check", backer_note = null,
} = {}) => {
    const cents = Number(amount_cents);
    if (!Number.isInteger(cents) || cents <= 0) throw httpError(400, "amount_cents must be a positive integer");
    const addr = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) throw httpError(400, "A valid email is required");
    if (!["check", "wire", "other"].includes(channel)) throw httpError(400, "Unsupported offline channel");

    const tier = tierFor(cents);
    const { rows } = await client.query(
        `INSERT INTO fund_pledges
            (email, backer_name, amount_cents, tier_id, reward_level, channel,
             status, charged_at, backer_note)
         VALUES ($1,$2,$3,$4,$5,$6,'succeeded', now(), $7)
         RETURNING ${PLEDGE_COLS}`,
        [addr, backer_name, cents, tier?.id ?? null, tier?.level ?? null, channel, backer_note]
    );
    return rows[0];
};

const markReceiptSent = async ({ id } = {}) => {
    const { rows } = await client.query(
        `UPDATE fund_pledges SET receipt_sent_at = now(), updated_at = now()
          WHERE id = $1 RETURNING ${PLEDGE_COLS}`, [id]
    );
    return rows[0] || null;
};

// ---------------------------------------------------------------------------
// listPledges — the admin board. Filters compose; every one is optional.
// ---------------------------------------------------------------------------
const listPledges = async ({
    status = null, channel = null, q = null, limit = 100, offset = 0,
} = {}) => {
    const where = [];
    const args = [];
    if (status) { args.push(status); where.push(`status = $${args.length}`); }
    if (channel) { args.push(channel); where.push(`channel = $${args.length}`); }
    if (q) {
        args.push(`%${String(q).trim().toLowerCase()}%`);
        where.push(`(email LIKE $${args.length} OR lower(coalesce(backer_name,'')) LIKE $${args.length})`);
    }
    args.push(Math.min(Number(limit) || 100, 500));
    args.push(Math.max(Number(offset) || 0, 0));

    const { rows } = await client.query(
        `SELECT ${PLEDGE_COLS}, ip_address
           FROM fund_pledges
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          LIMIT $${args.length - 1} OFFSET $${args.length}`,
        args
    );
    return rows;
};

// ---------------------------------------------------------------------------
// pledgeSummary — the numbers behind both the admin board and the PUBLIC meter.
// Only 'succeeded' counts toward the raise: a pending intent is a browser tab
// somebody abandoned, and counting it would make the public total drift up all
// day and back down overnight.
//
// backers is DISTINCT ON EMAIL, not a row count — one person pledging three
// times is one backer, and the avg-pledge tile is wrong the moment those differ.
// ---------------------------------------------------------------------------
const pledgeSummary = async () => {
    const { rows } = await client.query(`
        SELECT
            COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)::int      AS raised_cents,
            COALESCE(SUM(COALESCE(refund_amount_cents,0))
                     FILTER (WHERE status = 'refunded'), 0)::int                          AS refunded_cents,
            COUNT(DISTINCT email) FILTER (WHERE status = 'succeeded')::int                AS backers,
            COUNT(*) FILTER (WHERE status = 'succeeded')::int                             AS pledge_count,
            COUNT(*) FILTER (WHERE status = 'pending')::int                               AS pending_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int                                AS failed_count,
            COUNT(*) FILTER (WHERE status = 'refunded')::int                              AS refunded_count
        FROM fund_pledges
    `);
    const s = rows[0];
    // Net of refunds: what the company actually holds.
    s.net_cents = s.raised_cents - s.refunded_cents;
    s.avg_pledge_cents = s.backers ? Math.round(s.raised_cents / s.backers) : 0;

    const { rows: byTier } = await client.query(`
        SELECT tier_id,
               COUNT(*)::int AS count,
               COALESCE(SUM(amount_cents),0)::int AS cents
          FROM fund_pledges
         WHERE status = 'succeeded'
         GROUP BY tier_id ORDER BY tier_id NULLS FIRST
    `);
    const { rows: byChannel } = await client.query(`
        SELECT channel,
               COUNT(*)::int AS count,
               COALESCE(SUM(amount_cents),0)::int AS cents
          FROM fund_pledges
         WHERE status = 'succeeded'
         GROUP BY channel ORDER BY cents DESC
    `);
    return { ...s, by_tier: byTier, by_channel: byChannel };
};

module.exports = {
    TIERS, tierFor, normaliseChannel,
    createPledge, markPledgePaid, markPledgeFailed, refundPledge,
    recordOfflinePledge, markReceiptSent, listPledges, pledgeSummary,
};
