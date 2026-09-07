/* The launch raise — one row per pledge to WouldBe the COMPANY.
 *
 * This is NOT the `pledges` table. That one is money pledged to a candidate's
 * WouldBe campaign, it is subject to the $3,300 sitewide cap, and it is the
 * table election law cares about. THIS table is a rewards pre-sale: a backer
 * buys a premium membership, the company keeps the money, and no candidate is
 * involved at any point. Merging them would have put company revenue inside the
 * candidate contribution ledger, which is the single worst mistake available in
 * this codebase.
 *
 * NO ACCOUNT REQUIRED. `user_id` is nullable on purpose — a backer arriving from
 * an Instagram link has no WouldBe account, and forcing a signup before taking
 * their money is how a raise loses most of its conversions. The EMAIL is the
 * identity here: it is where the receipt goes and how the reward is granted at
 * launch, so it is the one field that is genuinely required.
 *
 * KEEP-IT-ALL. Pledges are charged on confirm, not held to a goal, so `status`
 * moves pending → succeeded on the webhook and there is no "campaign closed
 * unsuccessfully, release everyone" path to model. What there IS is a refund
 * path, because the page promises full refunds within 30 days and in full if the
 * platform never launches — hence refunded_at and refund_amount_cents rather
 * than a bare boolean, since a partial refund is a thing that happens.
 *
 * MANY CHANNELS, ONE TABLE. `channel` records how the money actually arrived
 * (card, apple_pay, paypal, ach…). It is deliberately free text with a CHECK
 * rather than a Postgres enum: Stripe adds payment method types faster than we
 * will ship migrations, and an enum makes each new one a schema change.
 */

exports.up = (pgm) => {
    pgm.createTable('fund_pledges', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },

        // Nullable: most backers will not have an account. Set when a signed-in
        // user pledges, so their reward can be granted without an email match.
        user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },

        // The identity of a pledge. Receipt destination, and how the membership
        // is granted at launch. Stored lowercased — see the trigger below.
        email: { type: 'text', notNull: true },
        // Display name as typed. Not used for matching, so it is not normalised.
        backer_name: { type: 'text' },

        amount_cents: { type: 'integer', notNull: true, check: 'amount_cents > 0' },
        currency: { type: 'text', notNull: true, default: 'usd' },

        // Which reward this pledge earned, resolved from the AMOUNT at write
        // time. Stored rather than derived on read: tier prices will change
        // mid-campaign and a backer keeps the tier they actually bought.
        tier_id: { type: 'text', check: "tier_id IN ('l1','l2','l3')" },
        reward_level: { type: 'integer', check: 'reward_level BETWEEN 1 AND 3' },

        channel: {
            type: 'text',
            notNull: true,
            default: 'card',
            check: `channel IN (
                'card','apple_pay','google_pay','link','cashapp','ach','us_bank_account',
                'paypal','venmo','klarna','affirm','afterpay','amazon_pay','alipay',
                'wechat_pay','sepa_debit','ideal','bancontact','check','wire','other'
            )`,
        },

        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','succeeded','failed','refunded','disputed')",
        },
        failure_reason: { type: 'text' },

        // Processor references. Nullable because an offline channel (a mailed
        // check, a wire) has neither, and because the row is written BEFORE the
        // intent is confirmed.
        stripe_payment_intent_id: { type: 'text' },
        stripe_customer_id: { type: 'text' },
        stripe_charge_id: { type: 'text' },
        paypal_order_id: { type: 'text' },

        // What the processor kept, so the admin board can show NET without
        // re-deriving it from a fee schedule that changes.
        fee_amount_cents: { type: 'integer' },
        net_amount_cents: { type: 'integer' },

        // The receipt is a PROMISE on the public page ("your record and our
        // obligation"), so whether it went out is state, not a log line.
        receipt_sent_at: { type: 'timestamptz' },

        charged_at: { type: 'timestamptz' },
        refunded_at: { type: 'timestamptz' },
        refund_amount_cents: { type: 'integer', check: 'refund_amount_cents >= 0' },

        // Anonymous pledges still show in the backer count and the total; they
        // are only withheld from any public backer WALL.
        is_anonymous: { type: 'boolean', notNull: true, default: false },
        backer_note: { type: 'text' },

        // Fraud triage. A raise is a card-testing magnet: a burst of small
        // pledges from one IP is the signal, and it is unrecoverable after the fact.
        ip_address: { type: 'inet' },
        user_agent: { type: 'text' },

        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    // The admin board's default view: newest first.
    pgm.createIndex('fund_pledges', 'created_at', { name: 'idx_fund_pledges_created' });
    // "What has this person given us" — the support question, asked by email.
    pgm.createIndex('fund_pledges', 'email', { name: 'idx_fund_pledges_email' });
    pgm.createIndex('fund_pledges', 'status', { name: 'idx_fund_pledges_status' });

    // ONE ROW PER PAYMENT INTENT. Stripe delivers webhooks more than once and
    // will happily deliver the same one days later; without this, a retry books
    // the pledge twice and the public total silently inflates.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_fund_pledges_intent
            ON fund_pledges (stripe_payment_intent_id)
            WHERE stripe_payment_intent_id IS NOT NULL;
    `);
    pgm.sql(`
        CREATE UNIQUE INDEX idx_fund_pledges_paypal
            ON fund_pledges (paypal_order_id)
            WHERE paypal_order_id IS NOT NULL;
    `);

    // Email is normalised in the DATABASE, not in the route. Two routes write
    // here (public pledge, admin manual entry) and a third will exist by the
    // time anyone reads this; normalising in each of them means the one that
    // forgets creates a second identity for the same human, and reward grants
    // at launch then miss them.
    pgm.sql(`
        CREATE OR REPLACE FUNCTION fund_pledges_normalise() RETURNS trigger AS $$
        BEGIN
            NEW.email := lower(btrim(NEW.email));
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.sql(`
        CREATE TRIGGER trg_fund_pledges_normalise
            BEFORE INSERT OR UPDATE ON fund_pledges
            FOR EACH ROW EXECUTE FUNCTION fund_pledges_normalise();
    `);

    // A refunded pledge must carry the WHEN. Enforced here rather than trusted
    // to callers, because the refund promise on the public page is only as good
    // as the record behind it.
    pgm.sql(`
        ALTER TABLE fund_pledges ADD CONSTRAINT fund_pledges_refund_coherent CHECK (
            (status <> 'refunded') OR (refunded_at IS NOT NULL)
        );
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_fund_pledges_normalise ON fund_pledges;`);
    pgm.sql(`DROP FUNCTION IF EXISTS fund_pledges_normalise();`);
    pgm.dropTable('fund_pledges');
};
