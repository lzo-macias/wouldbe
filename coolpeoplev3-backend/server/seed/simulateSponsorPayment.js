#!/usr/bin/env node
/*
 * simulateSponsorPayment.js — DEV ONLY. Drives the whole sponsor money path
 * end-to-end with Stripe TEST keys so you can watch the rows land in your own
 * database without a browser and without spending a cent.
 *
 * NO REAL MONEY IS INVOLVED. Test-mode keys (sk_test_…) charge Stripe's
 * simulator, not a bank. This script REFUSES to run against sk_live_ keys.
 *
 * WHAT IT DOES — the same calls the UI makes, in order:
 *   1. POST /api/debate-applications             submit a draft. FREE — nothing
 *                                                is collected at this point.
 *   2. PATCH /api/debates/:id/stream/channel     connect the Twitch channel
 *   3. (--pay only) the retired host-fee path: tier → PaymentIntent → confirm.
 *      Kept so the payment code stays exercised; nothing in the product uses it.
 *   5. POST /api/debate-applications/:id/approve (or /reject) — the admin's two
 *                                                buttons. HOSTING IS FREE, so no
 *                                                money moves either way.
 *
 * Step 3 is the only step a human would normally do by typing a card number.
 * Everything else is the real route, the real DB writes, the real Stripe calls.
 *
 * Usage (server must be running on PORT, default 3000):
 *   node server/seed/simulateSponsorPayment.js
 *   node server/seed/simulateSponsorPayment.js --tier pro --prize 250 --category Politics
 *   node server/seed/simulateSponsorPayment.js --hybrid            # adds a judge panel
 *   node server/seed/simulateSponsorPayment.js --hybrid --no-judges # 400 at submit
 *   node server/seed/simulateSponsorPayment.js --reject            # admin rejects + refunds
 *   node server/seed/simulateSponsorPayment.js --pay                # exercise the
 *                                                                  # retired host-fee path
 *
 * --tier: basic ($10 / 100 entries) | pro ($50 / 1,000) | enterprise ($100 / 10,000)
 *
 * --card options (Stripe's documented test cards):
 *   visa       pm_card_visa                   pays cleanly
 *   declined   pm_card_chargeDeclined         declined at the card form
 *   3ds        pm_card_authenticationRequired needs 3DS — on-session, so the
 *                                             browser would show the challenge
 */
require("dotenv").config();
const Stripe = require("stripe");

const CARDS = {
    visa: "pm_card_visa",
    declined: "pm_card_chargeDeclined",
    "3ds": "pm_card_authenticationRequired",
};

const parseArgs = (argv) => {
    const a = {
        username: "devadmin",
        password: "DevAdmin!2026",
        prize: "100",
        category: "Business",
        tier: "basic",
        card: "visa",
        channel: "coolpeopledebates",
        base: process.env.SIMULATE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
    };
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k === "--username") a.username = argv[++i];
        else if (k === "--password") a.password = argv[++i];
        else if (k === "--prize") a.prize = argv[++i];
        else if (k === "--category") a.category = argv[++i];
        else if (k === "--tier") a.tier = argv[++i];
        else if (k === "--card") a.card = argv[++i];
        else if (k === "--channel") a.channel = argv[++i];
        else if (k === "--base") a.base = argv[++i];
        else if (k === "--hybrid") a.hybrid = true;
        else if (k === "--no-judges") a.noJudges = true;
        else if (k === "--reject") a.reject = true;
        else if (k === "--pay") a.pay = true;
    }
    return a;
};

const usd = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

const call = async (base, path, { method = "GET", token = null, body = null } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
};

const main = async () => {
    const a = parseArgs(process.argv);

    const key = process.env.STRIPE_SECRET_KEY || "";
    if (!key) {
        console.error("✗ STRIPE_SECRET_KEY is not set — nothing to simulate against.");
        process.exit(1);
    }
    if (key.startsWith("sk_live_")) {
        console.error("✗ REFUSING TO RUN: STRIPE_SECRET_KEY is a LIVE key. This script would move real money.");
        process.exit(1);
    }
    const paymentMethod = CARDS[a.card] || a.card;
    const stripe = new Stripe(key);

    console.log(`\nsimulating a sponsor host-fee payment  (test mode — no real money)`);
    console.log(`  api      : ${a.base}`);
    console.log(`  tier     : ${a.tier}    card: ${a.card} → ${paymentMethod}`);
    console.log(`  prize    : $${a.prize}   category: ${a.category}${a.hybrid ? "   win_type: hybrid" : ""}\n`);

    // 1 — log in as the sponsor
    const login = await call(a.base, "/api/auth/login", {
        method: "POST",
        body: { username: a.username, password: a.password },
    });
    if (login.status !== 200 || !login.data.token) {
        console.error(`✗ login failed (${login.status}):`, login.data);
        process.exit(1);
    }
    const token = login.data.token;
    console.log(`1. logged in as ${a.username}`);

    // 2 — submit the application. FREE: no card, no charge.
    const submit = await call(a.base, "/api/debate-applications", {
        method: "POST",
        token,
        body: {
            title: `Simulated debate ${new Date().toISOString().slice(0, 16)}`,
            category: a.category,
            description: "Created by simulateSponsorPayment.js",
            win_type: a.hybrid ? "hybrid" : "general_vote",
            judges: a.hybrid && !a.noJudges
                ? [
                      {
                          email: `judge.one+${Date.now()}@example.com`,
                          qualification: "Twelve years judging collegiate policy debate.",
                          links: ["https://example.com/judge-one", "https://example.com/cv"],
                      },
                      {
                          email: `judge.two+${Date.now()}@example.com`,
                          qualification: "Editor, regional policy review.",
                          links: [],
                      },
                  ]
                : undefined,
            contribution_type: "closed",
            participation_type: "open",
            prize_amount: a.prize,
            // The start date IS the schedule now — prompts carry no dates. The
            // Twitch channel is attached on the NEXT screen (step 3 below), so
            // it is deliberately absent here.
            stream: {
                scheduled_at: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            },
            prompts: [{ body: "Simulated prompt one" }, { body: "Simulated prompt two" }],
        },
    });
    if (submit.status !== 201) {
        console.error(`✗ submit failed (${submit.status}):`, submit.data);
        process.exit(1);
    }
    const debateId = submit.data.debate.id;
    console.log(`2. application submitted FREE — debate ${debateId}`);
    if (submit.data.stream) {
        const s = submit.data.stream;
        console.log(`     stream scheduled ${new Date(s.scheduled_at).toLocaleDateString()} — channel: ${s.twitch_channel || "(not connected yet)"}`);
    }

    // 3 — connect the Twitch channel. Its own screen in the UI, because the OAuth
    // link leaves the page; here it is the PATCH that screen ends with.
    const connected = await call(a.base, `/api/debates/${debateId}/stream/channel`, {
        method: "PATCH", token,
        body: { twitch_channel: a.channel, invite_slots: 10 },
    });
    if (connected.status !== 200) {
        console.error(`✗ connect channel failed (${connected.status}):`, connected.data);
        process.exit(1);
    }
    console.log(`3. channel connected — twitch.tv/${connected.data.twitch_channel} (${connected.data.invite_slots} seats)`);
    console.log(`     status=${submit.data.debate.status}  prompts=${submit.data.prompts.length}`);
    console.log(`     criteria applied=${(submit.data.criteria || []).length} (version ${submit.data.debate.criteria_version})`);
    if (submit.data.judges?.length) {
        console.log(`     judges=${submit.data.judges.length}: ${submit.data.judges.map((j) => j.external_email).join(", ")}`);
    }

    // Hosting is FREE. The tier/PaymentIntent path below still exists for the
    // debates that were charged while the host fee did, and --pay exercises it;
    // by default the run goes straight from the channel to review, which is what
    // the product now does.
    if (!a.pay) {
        console.log(`4. hosting is free — no payment step.`);
    }

    // 5 — sign the prize agreement. Required for EVERY prize type, and approval
    // is gated on it, so the simulator has to do what the sponsor does.
    const signed = await call(a.base, `/api/debate-applications/${debateId}/prize-agreement`, {
        method: "POST", token, body: { signature_name: "Simulated Sponsor" },
    });
    if (signed.status !== 201) {
        console.error(`✗ signing failed (${signed.status}):`, signed.data);
        process.exit(1);
    }
    console.log(`5. prize agreement signed (${signed.data.agreement_version}) — ${signed.data.prize_type}, ${usd(signed.data.prize_cents)}`);

    // (optional, --pay) the retired host-fee path, kept so the tier code stays
    // exercised. Skipped by default: hosting is free.
    if (a.pay) {
        const tierRes = await call(a.base, `/api/debate-applications/${debateId}/tier`, {
            method: "POST", token, body: { tier_key: a.tier },
        });
        if (tierRes.status !== 201) {
            console.error(`✗ tier selection failed (${tierRes.status}):`, tierRes.data);
            process.exit(1);
        }
        const tier = tierRes.data.tier;
        console.log(`   chose ${tier.display_name} — ${usd(tier.price_cents)} for ${tier.entry_cap.toLocaleString()} video entries`);

        const piId = String(tierRes.data.client_secret).split("_secret_")[0];
        let intent;
        try {
            intent = await stripe.paymentIntents.confirm(piId, {
                payment_method: paymentMethod,
                return_url: `${a.base}/startadebate`,
            });
        } catch (err) {
            if (err.type === "StripeCardError") {
                console.log(`   card DECLINED — ${err.raw?.decline_code || err.raw?.code}: ${err.message}`);
                return;
            }
            throw err;
        }
        console.log(`   paid — PaymentIntent ${intent.status} (livemode: ${intent.livemode})`);

        const confirmed = await call(a.base, `/api/debate-applications/${debateId}/tier/confirm`, {
            method: "POST", token,
        });
        if (confirmed.status !== 200) {
            console.error(`✗ confirm failed (${confirmed.status}):`, confirmed.data);
            process.exit(1);
        }
        console.log(`   host fee recorded — ${usd(confirmed.data.paid_cents)}`);
    }

    // 6 — the admin's button
    if (a.reject) {
        const rejected = await call(a.base, `/api/debate-applications/${debateId}/reject`, {
            method: "POST", token, body: { reason: "Simulated rejection" },
        });
        console.log(`6. REJECTED (${rejected.status}) — refunded=${rejected.data.refunded} refund_due=${rejected.data.refund_due}`);
    } else {
        const approve = await call(a.base, `/api/debate-applications/${debateId}/approve`, {
            method: "POST", token, body: {},
        });
        if (approve.status === 200) {
            console.log(`6. APPROVED — status=${approve.data.debate.status} (hosting is free; no money involved)`);
        } else {
            console.log(`6. approval returned ${approve.status}:`, approve.data);
        }
    }

    const finalStream = await call(a.base, `/api/debates/${debateId}/stream`, { token });
    console.log(`\nstream:`, {
        channel: finalStream.data?.twitch_channel,
        scheduled_at: finalStream.data?.scheduled_at,
        seats: finalStream.data?.invite_slots,
    });
    console.log(`\ndebate id: ${debateId}`);
    console.log(`clean up with:  DELETE FROM debate_payments WHERE debate_id='${debateId}';`);
    console.log(`                DELETE FROM debate_judges WHERE debate_id='${debateId}';`);
    console.log(`                DELETE FROM debate_judging_criteria WHERE debate_id='${debateId}';`);
    console.log(`                DELETE FROM prompts WHERE debate_id='${debateId}';`);
    console.log(`                DELETE FROM debates WHERE id='${debateId}';`);
};

main().then(() => process.exit(0)).catch((e) => {
    console.error("✗", e);
    process.exit(1);
});
