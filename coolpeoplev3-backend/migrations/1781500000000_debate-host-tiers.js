/*
 * SaaS host tiers — replaces the "charge the prize + 10% at approval" model.
 *
 * WHAT CHANGED, AND WHY IT'S A DIFFERENT SHAPE OF MONEY:
 *   OLD: submit → save a card → admin approves → ONE off-session charge for
 *        prize + a 10% platform fee. The platform's revenue scaled with the
 *        prize, and nothing was collected until an admin acted.
 *   NEW: submit (free) → pick a host tier and pay it immediately → an admin
 *        approves or rejects. The fee is a flat SaaS charge for the video-entry
 *        capacity the debate consumes, so it is priced off ENTRIES, not prize
 *        money, and it is collected on-session while the sponsor is present.
 *
 * Consequences of paying up front rather than at approval:
 *   - No SetupIntent, no saved card, no mandate, no off-session charge. A plain
 *     PaymentIntent the sponsor confirms themselves. 3DS is handled by the
 *     browser at that moment instead of failing later with no one at the keyboard.
 *   - The money arrives before review, so a REJECTION now owes a refund. That is
 *     recorded (see debates.tier_refunded_at) but the refund call itself is left
 *     for the admin to make in Stripe until there's a refund route.
 *
 * THE PRIZE IS NO LONGER CHARGED. sponsor_contribution_cents still records what
 * the sponsor said the prize would be, and prize_pool_cents still derives from it,
 * but nothing collects it. If prize collection comes back it needs its own flow.
 *
 * The 1781200000000 mandate columns (stripe_customer_id, payment_mandate_at,
 * platform_fee_cents, mandate_total_cents, funded_at) are left in place rather
 * than dropped: debates already carry values in them, and dropping columns to
 * "clean up" destroys the record of what was charged under the old model.
 */

// price_cents / entry_cap live in the DB, not in code, so pricing changes are an
// UPDATE rather than a deploy. Seeded with the three tiers as launched.
const TIERS = [
    {
        key: 'basic',
        name: 'Basic Debate',
        price: 1000,
        cap: 100,
        blurb: 'Up to 100 video entries.',
        features: ['Up to 100 video entries'],
    },
    {
        key: 'pro',
        name: 'Pro Debate',
        price: 5000,
        cap: 1000,
        blurb: 'Up to 1,000 video entries plus extended cloud storage.',
        features: ['Up to 1,000 video entries', 'Extended cloud storage'],
    },
    {
        key: 'enterprise',
        name: 'Enterprise Debate',
        price: 10000,
        cap: 10000,
        blurb: 'Up to 10,000 video entries, extended storage and live-stream moderation tools.',
        features: ['Up to 10,000 video entries', 'Extended cloud storage', 'Live-stream moderation tools'],
    },
];

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

exports.up = (pgm) => {
    /* TABLE: debate_host_tiers
     * The price list. A catalog row is a template — debates.tier_price_cents
     * freezes what a sponsor actually paid, so raising a price later never
     * rewrites history or makes an old receipt look wrong.
     */
    pgm.createTable('debate_host_tiers', {
        tier_key: { type: 'text', primaryKey: true },
        display_name: { type: 'text', notNull: true },
        // flat SaaS host fee, in cents
        price_cents: { type: 'bigint', notNull: true, check: 'price_cents >= 0' },
        // maximum video entries this tier allows for the debate
        entry_cap: { type: 'integer', notNull: true, check: 'entry_cap > 0' },
        // one-line summary for the pricing card
        blurb: { type: 'text', notNull: true },
        // bullet list rendered on the card
        features: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
        sort_order: { type: 'integer', notNull: true, default: 0 },
        is_active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.sql(
        `INSERT INTO debate_host_tiers (tier_key, display_name, price_cents, entry_cap, blurb, features, sort_order)
         VALUES ${TIERS.map((t, i) =>
            `(${sqlStr(t.key)}, ${sqlStr(t.name)}, ${t.price}, ${t.cap}, ${sqlStr(t.blurb)}, ${sqlStr(JSON.stringify(t.features))}::jsonb, ${i})`
         ).join(',\n                ')};`
    );

    pgm.addColumns('debates', {
        // which tier the sponsor bought; NULL until they pay
        tier_key: { type: 'text', references: 'debate_host_tiers(tier_key)' },
        // what they actually paid, frozen at purchase (catalog price can move)
        tier_price_cents: { type: 'bigint', check: 'tier_price_cents IS NULL OR tier_price_cents >= 0' },
        // the entry cap they bought, frozen for the same reason
        entry_cap: { type: 'integer', check: 'entry_cap IS NULL OR entry_cap > 0' },
        // the PaymentIntent, kept so a refund can be issued against it
        tier_payment_intent_id: { type: 'text' },
        // when the host fee cleared. This — not funded_at — is what approval requires.
        tier_paid_at: { type: 'timestamptz' },
        // stamped when a rejected debate's host fee is refunded
        tier_refunded_at: { type: 'timestamptz' },
        // admin's reason for rejecting, shown back to the sponsor
        rejection_reason: { type: 'text' },
    });

    // The admin inbox sorts on "submitted, and have they paid yet".
    pgm.createIndex('debates', ['status', 'tier_paid_at'], { name: 'idx_debates_status_tier_paid' });

    // The host fee is neither an entry fee nor prize funding, so it gets its own
    // payment_type rather than being folded into debate_sponsor_funding.
    pgm.sql(`
        ALTER TABLE debate_payments DROP CONSTRAINT IF EXISTS debate_payments_payment_type_check;
        ALTER TABLE debate_payments ADD CONSTRAINT debate_payments_payment_type_check CHECK (
            payment_type IN (
                'debate_entry_one_off',
                'subscription_credit',
                'debate_sponsor_flat_fee',
                'debate_sponsor_funding',
                'debate_host_fee'
            )
        );
    `);
};

exports.down = (pgm) => {
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
    pgm.dropIndex('debates', ['status', 'tier_paid_at'], { name: 'idx_debates_status_tier_paid' });
    pgm.dropColumns('debates', [
        'tier_key', 'tier_price_cents', 'entry_cap', 'tier_payment_intent_id',
        'tier_paid_at', 'tier_refunded_at', 'rejection_reason',
    ]);
    pgm.dropTable('debate_host_tiers');
};
