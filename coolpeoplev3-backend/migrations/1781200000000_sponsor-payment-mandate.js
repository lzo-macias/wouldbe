/*
 * Sponsor payment mandate — "collect the card at submission, charge it when an
 * admin approves."
 *
 * FLOW THIS SUPPORTS
 *   1. Sponsor submits a debate application and completes a Stripe SetupIntent.
 *      No money moves and no authorization hold is placed; the card is verified
 *      and saved, and the sponsor agrees to a stated amount. That agreement is
 *      the mandate — payment_mandate_at + mandate_total_cents record WHAT was
 *      disclosed and WHEN, which is both the business commitment and Stripe's
 *      requirement for charging off-session later.
 *   2. An admin approves. ONE off-session PaymentIntent charges
 *      mandate_total_cents = prize + platform fee. One charge, not two, so the
 *      30c fixed fee is paid once. funded_at stamps when it cleared, and
 *      publishing is gated on it.
 *   3. The prize sits in the platform's Stripe balance until the debate
 *      concludes, then the existing prize_distributions / markDisbursed path
 *      transfers it to the winner. Transfers to connected accounts are free, so
 *      holding-then-transferring costs no more than routing at charge time.
 *
 * WHY THE AMOUNTS ARE FROZEN HERE rather than recomputed at charge time: the
 * sponsor was shown an exact number next to the card form. If prizeAmt were
 * re-read at approval, an edit in between would charge a figure they never
 * agreed to. platform_fee_cents and mandate_total_cents are the disclosed
 * values, and the charge uses them verbatim.
 *
 * NOT a flat fee: platform_fee_cents is 10% of the prize (the existing
 * sponsor_flat_fee_cents column stays for the separate flat-fee concept in
 * migration 1780700000000 and is untouched).
 */

exports.up = (pgm) => {
    pgm.addColumns('debates', {
        // Stripe Customer holding the sponsor's saved card.
        stripe_customer_id: { type: 'text' },
        // The saved card, charged off-session at approval.
        stripe_payment_method_id: { type: 'text' },
        // When the sponsor agreed to be charged mandate_total_cents. NULL = no
        // mandate yet, so approval must refuse to charge.
        payment_mandate_at: { type: 'timestamptz' },
        // The platform's 10% cut, frozen at submission.
        platform_fee_cents: { type: 'bigint', check: 'platform_fee_cents IS NULL OR platform_fee_cents >= 0' },
        // Exactly what was disclosed = prize + platform_fee_cents.
        mandate_total_cents: { type: 'bigint', check: 'mandate_total_cents IS NULL OR mandate_total_cents >= 0' },
        // When the approval charge succeeded. Publishing requires this.
        funded_at: { type: 'timestamptz' },
    });

    // The admin review queue filters on "has a mandate but isn't funded yet".
    pgm.createIndex('debates', ['status', 'funded_at'], { name: 'idx_debates_status_funded' });

    // A sponsor charge is neither an entry fee nor the flat post fee, so it needs
    // its own payment_type. One row covers prize + fee because it is ONE charge;
    // the split is recorded in sponsor_amount_cents / platform_amount_cents.
    pgm.sql(`
        ALTER TABLE debate_payments DROP CONSTRAINT IF EXISTS debate_payments_payment_type_check;
        ALTER TABLE debate_payments ADD CONSTRAINT debate_payments_payment_type_check CHECK (
            payment_type IN (
                'debate_entry_one_off',
                'subscription_credit',
                'debate_sponsor_flat_fee',
                'debate_sponsor_funding'
            )
        );
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE debate_payments DROP CONSTRAINT IF EXISTS debate_payments_payment_type_check;
        ALTER TABLE debate_payments ADD CONSTRAINT debate_payments_payment_type_check CHECK (
            payment_type IN ('debate_entry_one_off','subscription_credit','debate_sponsor_flat_fee')
        );
    `);
    pgm.dropIndex('debates', ['status', 'funded_at'], { name: 'idx_debates_status_funded' });
    pgm.dropColumns('debates', [
        'stripe_customer_id',
        'stripe_payment_method_id',
        'payment_mandate_at',
        'platform_fee_cents',
        'mandate_total_cents',
        'funded_at',
    ]);
};
