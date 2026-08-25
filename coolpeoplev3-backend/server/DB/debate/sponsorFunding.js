const { client, withTransaction } = require("../index.js");
const stripe = require("../../services/stripe");
const { hasActivePanel } = require("./debateJudges.js");

// ============================================================================
// Sponsor funding — collect the card at submission, charge it at approval.
//
//   submit   → startSponsorSetup()  : Stripe Customer + SetupIntent. No money
//                                     moves, no authorization hold, no expiry.
//   confirm  → recordSponsorMandate(): store the saved card + the exact amount
//                                     that was disclosed, and stamp when.
//   approve  → chargeAndFundDebate(): ONE off-session PaymentIntent for
//                                     prize + 10% fee, then publish.
//   deny     → releaseSponsorMandate(): charge nothing, detach the card.
//
// WHY A SETUPINTENT AND NOT A MANUAL-CAPTURE HOLD: a card authorization expires
// in roughly 7 days. Review is a human process, so an approval that slipped past
// a week would silently void the hold. A saved card has no expiry. The cost is
// that the charge can fail later (decline, or `authentication_required` when the
// issuer wants 3DS) — which is exactly why publishing is gated on it clearing.
//
// WHY ONE CHARGE FOR PRIZE + FEE: Stripe's fixed 30c is per charge. Billing the
// prize and the fee separately pays it twice for no benefit. The split is
// recorded on the single debate_payments row via sponsor_amount_cents (prize)
// and platform_amount_cents (fee).
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// The platform's cut, as a percentage of the prize. NOT a flat fee — the
// existing debates.sponsor_flat_fee_cents column is a different concept and is
// left alone. Kept here so the API, the charge and the UI copy can't drift.
const PLATFORM_FEE_PCT = 10;

// computeSponsorCharge — the money math, in one place. Everything downstream
// (the disclosure text, the mandate, the charge) reads from this, so the number
// the sponsor is shown and the number Stripe charges cannot diverge.
const computeSponsorCharge = (prize_cents) => {
    const prize = Math.max(0, Math.round(Number(prize_cents) || 0));
    const platform_fee_cents = Math.round((prize * PLATFORM_FEE_PCT) / 100);
    return {
        prize_cents: prize,
        platform_fee_cents,
        total_cents: prize + platform_fee_cents,
    };
};

// loadOwnedDraft — the debate plus proof the caller is its sponsor. Every
// sponsor-facing call here goes through this: user_id comes from the token, so a
// sponsor can never touch someone else's application. 404 vs 403 is kept
// distinct so a wrong id doesn't look like a permissions problem.
const loadOwnedDraft = async ({ debate_id, user_id }, db = client) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows } = await db.query(
        `SELECT d.*, s.user_id AS sponsor_user_id
         FROM debates d
         JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id]
    );
    const debate = rows[0];
    if (!debate) throw httpError(404, "debate not found");
    if (user_id && debate.sponsor_user_id !== user_id) {
        throw httpError(403, "you are not the sponsor of this debate");
    }
    return debate;
};

// startSponsorSetup — create (or reuse) the sponsor's Stripe Customer and return
// a SetupIntent client_secret for the card form. Returns the amounts too, so the
// UI renders its disclosure from the same source the charge will use.
//
// Reuses stripe_customer_id when the sponsor revisits the form, so retrying the
// card step doesn't leave a trail of orphan Customers.
const startSponsorSetup = async ({ debate_id, user_id }) => {
    const debate = await loadOwnedDraft({ debate_id, user_id });
    if (debate.status !== "draft") {
        throw httpError(409, "this debate is no longer awaiting approval");
    }

    const amounts = computeSponsorCharge(debate.sponsor_contribution_cents);

    let customerId = debate.stripe_customer_id;
    if (!customerId) {
        const { rows } = await client.query(
            `SELECT email, username FROM users WHERE id = $1`,
            [user_id]
        );
        const u = rows[0] || {};
        const customer = await stripe.createCustomer({
            email: u.email || null,
            name: u.username || null,
            metadata: { debate_id, user_id },
        });
        customerId = customer?.id ?? null;
        // Persist before returning: if the SetupIntent call fails the Customer
        // still exists at Stripe, and reusing it beats creating another.
        await client.query(
            `UPDATE debates SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1`,
            [debate_id, customerId]
        );
    }

    const setupIntent = await stripe.createSetupIntent({
        customer: customerId,
        metadata: { debate_id, user_id, kind: "debate_sponsor_mandate" },
    });

    return {
        client_secret: setupIntent?.client_secret ?? null,
        stripe_customer_id: customerId,
        ...amounts,
        platform_fee_pct: PLATFORM_FEE_PCT,
    };
};

// recordSponsorMandate — called once the card form succeeds. Stores the saved
// payment method and FREEZES the disclosed amounts onto the debate.
//
// The amounts are recomputed here from the debate's own prize rather than taken
// from the request body: a client that posted its own total could otherwise set
// the price it gets charged. They're frozen (not recomputed at approval) because
// the sponsor agreed to a specific figure — if the prize were edited afterwards,
// charging the new number would bill an amount they never saw.
const recordSponsorMandate = async ({ debate_id, user_id, payment_method_id }) => {
    if (!payment_method_id) throw httpError(400, "payment_method_id is required");
    const debate = await loadOwnedDraft({ debate_id, user_id });
    if (debate.status !== "draft") {
        throw httpError(409, "this debate is no longer awaiting approval");
    }
    if (debate.funded_at) throw httpError(409, "this debate has already been charged");

    const amounts = computeSponsorCharge(debate.sponsor_contribution_cents);

    const { rows } = await client.query(
        `UPDATE debates SET
            stripe_payment_method_id = $2,
            platform_fee_cents       = $3,
            mandate_total_cents      = $4,
            payment_mandate_at       = NOW(),
            updated_at               = NOW()
         WHERE id = $1
         RETURNING *;`,
        [debate_id, payment_method_id, amounts.platform_fee_cents, amounts.total_cents]
    );
    return { debate: rows[0], ...amounts };
};

// chargeAndFundDebate — the approval step. Charges the mandated total off-session,
// records the payment + prize-pool rows, stamps funded_at and opens the debate
// for entry. Admin-gated at the route.
//
// ORDERING IS DELIBERATE. A pending debate_payments row is written BEFORE the
// Stripe call, so a charge that succeeds while the process dies still has a row
// carrying its PaymentIntent id to reconcile against. Writing the row after the
// charge would risk money moving with nothing recording it. (Note this is the
// opposite of disburseSponsorPayout, which fires Stripe inside a transaction —
// that one can roll back a DB row after a transfer has already left.)
const chargeAndFundDebate = async ({ debate_id }) => {
    // No user_id: the admin gate at the route authorizes this, not ownership.
    const debate = await loadOwnedDraft({ debate_id, user_id: null });

    if (debate.funded_at) throw httpError(409, "this debate has already been charged");
    if (!debate.payment_mandate_at || !debate.stripe_payment_method_id) {
        throw httpError(409, "the sponsor has not completed the payment step yet");
    }
    if (debate.status !== "draft") {
        throw httpError(409, "only a draft debate can be approved");
    }

    // A hybrid debate is decided by its panel. Approving one with no active
    // judges would take the sponsor's money for a contest nobody can decide, so
    // the check runs BEFORE the charge — the submit path already requires a
    // panel, but a judge can recuse between submission and approval.
    if (debate.win_type === "hybrid" && !(await hasActivePanel({ debate_id }))) {
        throw httpError(409, "this hybrid debate has no active judges — the panel must be in place before approval");
    }

    const total = Number(debate.mandate_total_cents);
    if (!(total > 0)) throw httpError(409, "the mandated amount is missing or zero");

    const prize_cents = Number(debate.sponsor_contribution_cents) || 0;
    const platform_fee_cents = Number(debate.platform_fee_cents) || 0;

    // 1) pending row first — see ORDERING above.
    const pending = await client.query(
        `INSERT INTO debate_payments (
            user_id, debate_id, payment_type, amount_cents, currency,
            stripe_customer_id, sponsor_amount_cents, platform_amount_cents, status
         )
         VALUES ($1, $2, 'debate_sponsor_funding', $3, 'usd', $4, $5, $6, 'pending')
         RETURNING *;`,
        [
            debate.sponsor_user_id, debate_id, total,
            debate.stripe_customer_id, prize_cents, platform_fee_cents,
        ]
    );
    const paymentId = pending.rows[0].payment_id;

    // 2) charge
    let intent;
    try {
        intent = await stripe.chargeSavedPaymentMethod({
            amount_cents: total,
            customer: debate.stripe_customer_id,
            payment_method: debate.stripe_payment_method_id,
            metadata: {
                kind: "debate_sponsor_funding",
                debate_id,
                prize_cents: String(prize_cents),
                platform_fee_cents: String(platform_fee_cents),
            },
        });
    } catch (err) {
        // `authentication_required` means the issuer wants 3DS, which an
        // off-session charge cannot satisfy — the sponsor has to re-confirm with
        // a browser present. Surfaced as its own message so the caller can say so.
        const needsAuth = err?.code === "authentication_required";
        await client.query(
            `UPDATE debates SET updated_at = NOW() WHERE id = $1`, [debate_id]
        );
        await client.query(
            `UPDATE debate_payments
             SET status = 'failed', failure_reason = $2, stripe_payment_intent_id = $3
             WHERE payment_id = $1`,
            [paymentId, (err?.message || "charge failed").slice(0, 500), err?.raw?.payment_intent?.id ?? null]
        );
        if (err.status) throw err;   // e.g. the 503 when Stripe isn't configured
        throw httpError(
            needsAuth ? 402 : 402,
            needsAuth
                ? "the sponsor's bank requires re-authentication — ask them to confirm the payment again"
                : `the sponsor's card was declined: ${err?.message || "unknown error"}`
        );
    }

    // 3) record success + fund + publish, atomically. Nothing here can move
    //    money, so a rollback leaves only the pending→succeeded flip undone,
    //    which the PaymentIntent id makes reconcilable.
    return await withTransaction(async (tx) => {
        const paid = await tx.query(
            `UPDATE debate_payments SET
                status                   = 'succeeded',
                stripe_payment_intent_id = $2,
                stripe_charge_id         = $3,
                charged_at               = NOW()
             WHERE payment_id = $1
             RETURNING *;`,
            [paymentId, intent?.id ?? null, intent?.latest_charge ?? null]
        );

        // The prize is now real money in the platform balance. Recording it as a
        // 'sponsor' prize-pool contribution is what makes getPrizePool() and the
        // existing winner-payout path (createPrizeDistribution → markDisbursed)
        // see a funded pool. locked_at = now: it is not refundable to the sponsor
        // once the debate opens for entry.
        let contribution = null;
        if (prize_cents > 0) {
            const c = await tx.query(
                `INSERT INTO prize_pool_contributions (
                    debate_id, contributor_user_id, contribution_source,
                    amount_cents, stripe_payment_intent_id, locked_at
                 )
                 VALUES ($1, $2, 'sponsor', $3, $4, NOW())
                 RETURNING *;`,
                [debate_id, debate.sponsor_user_id, prize_cents, intent?.id ?? null]
            );
            contribution = c.rows[0];
        }

        const updated = await tx.query(
            `UPDATE debates
             SET funded_at = NOW(), status = 'open_entry', updated_at = NOW()
             WHERE id = $1
             RETURNING *;`,
            [debate_id]
        );

        return {
            debate: updated.rows[0],
            payment: paid.rows[0],
            contribution,
            charged_cents: total,
            prize_cents,
            platform_fee_cents,
        };
    });
};

// releaseSponsorMandate — denial. Charges nothing and detaches the saved card,
// so a declined application leaves no chargeable method on file. The debate is
// moved to 'cancelled'. Detaching is best-effort: if Stripe is unreachable the
// local state still reflects the decision.
const releaseSponsorMandate = async ({ debate_id, reason = null }) => {
    const debate = await loadOwnedDraft({ debate_id, user_id: null });
    if (debate.funded_at) throw httpError(409, "this debate was already charged — refund it instead");

    let detached = false;
    if (debate.stripe_payment_method_id) {
        try {
            await stripe.detachPaymentMethod({ payment_method_id: debate.stripe_payment_method_id });
            detached = true;
        } catch (err) {
            console.warn(`[releaseSponsorMandate] could not detach card: ${err.message}`);
        }
    }

    const { rows } = await client.query(
        `UPDATE debates SET
            status                   = 'cancelled',
            stripe_payment_method_id = NULL,
            payment_mandate_at       = NULL,
            scoring_methodology      = COALESCE($2, scoring_methodology),
            updated_at               = NOW()
         WHERE id = $1
         RETURNING *;`,
        [debate_id, reason]
    );
    return { debate: rows[0], card_detached: detached, charged: false };
};

// getSponsorFundingStatus — what the sponsor (or the admin queue) needs to know:
// have they done the card step, and has it been charged.
const getSponsorFundingStatus = async ({ debate_id, user_id = null }) => {
    const debate = await loadOwnedDraft({ debate_id, user_id });
    const amounts = computeSponsorCharge(debate.sponsor_contribution_cents);
    return {
        debate_id,
        status: debate.status,
        mandate_recorded: !!debate.payment_mandate_at,
        payment_mandate_at: debate.payment_mandate_at,
        funded: !!debate.funded_at,
        funded_at: debate.funded_at,
        // Frozen figures once a mandate exists; live preview before that.
        platform_fee_cents: debate.platform_fee_cents ?? amounts.platform_fee_cents,
        total_cents: debate.mandate_total_cents ?? amounts.total_cents,
        prize_cents: amounts.prize_cents,
        platform_fee_pct: PLATFORM_FEE_PCT,
    };
};

module.exports = {
    PLATFORM_FEE_PCT,
    computeSponsorCharge,
    startSponsorSetup,
    recordSponsorMandate,
    chargeAndFundDebate,
    releaseSponsorMandate,
    getSponsorFundingStatus,
};
