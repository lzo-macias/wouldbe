/* Buying standing arrows, and the record of having bought them.
 *
 * WHY PURCHASED ARROWS ARE THEIR OWN ROW rather than just more user_trophies.
 *
 * An arrow earned by winning a debate and an arrow bought with a card are worth
 * the same at the door — both count toward the threshold that opens somebody
 * else's match — but they are NOT the same fact, and a system that cannot tell
 * them apart cannot answer the questions that matter later: what fraction of
 * this person's standing was bought, should a bought arrow count toward a
 * leaderboard, does a refund claw one back. So `source` lives on the trophy row
 * and a purchase keeps its own audit trail beside it.
 *
 * The trophies themselves are still user_trophies rows, so nothing downstream —
 * the count trigger, the threshold check, the profile case — needs to learn
 * about a second table.
 *
 * ONE MORE KIND. 'purchased' joins 'debate_win' and 'for_fun_response'; the
 * per-debate unique index does not apply to it, because a purchase is not tied
 * to a debate and buying ten is the entire point.
 */

exports.up = (pgm) => {
    // Where an arrow came from. Defaulted to 'earned' so every existing row —
    // all of which were won — is correctly labelled without a backfill.
    pgm.addColumns('user_trophies', {
        source: {
            type: 'text',
            notNull: true,
            default: 'earned',
            check: "source IN ('earned','purchased','admin')",
        },
        purchase_id: { type: 'uuid' },
    });

    pgm.sql(`
        ALTER TABLE user_trophies DROP CONSTRAINT IF EXISTS user_trophies_kind_check;
        ALTER TABLE user_trophies ADD CONSTRAINT user_trophies_kind_check
            CHECK (kind IN ('debate_win','for_fun_response','purchased'));
    `);

    pgm.createTable('arrow_purchases', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        quantity: { type: 'integer', notNull: true, check: 'quantity > 0 AND quantity <= 1000' },
        unit_price_cents: { type: 'integer', notNull: true, check: 'unit_price_cents >= 0' },
        amount_cents: { type: 'integer', notNull: true, check: 'amount_cents >= 0' },
        // The debate they were trying to answer when they hit the wall. Not
        // required — arrows can be bought from a profile — but recorded when it
        // is known, because "what did this purchase unlock" is the question
        // anybody investigating a bought win will ask first.
        debate_id: { type: 'uuid', references: 'debates(id)', onDelete: 'SET NULL' },
        payment_intent_id: { type: 'text' },
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','paid','failed','refunded')",
        },
        paid_at: { type: 'timestamptz' },
        refunded_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('arrow_purchases', ['user_id', 'created_at'], { name: 'idx_arrow_purchases_user' });
    // One purchase per PaymentIntent. Stripe can deliver the same webhook twice,
    // and without this the second delivery mints a second batch of arrows.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_arrow_purchases_intent
            ON arrow_purchases (payment_intent_id)
            WHERE payment_intent_id IS NOT NULL;
    `);

    pgm.addConstraint('user_trophies', 'user_trophies_purchase_fk',
        'FOREIGN KEY (purchase_id) REFERENCES arrow_purchases(id) ON DELETE SET NULL');
};

exports.down = (pgm) => {
    pgm.dropConstraint('user_trophies', 'user_trophies_purchase_fk');
    pgm.sql('DROP INDEX IF EXISTS idx_arrow_purchases_intent;');
    pgm.dropTable('arrow_purchases');
    pgm.sql(`
        ALTER TABLE user_trophies DROP CONSTRAINT IF EXISTS user_trophies_kind_check;
        ALTER TABLE user_trophies ADD CONSTRAINT user_trophies_kind_check
            CHECK (kind IN ('debate_win','for_fun_response'));
    `);
    pgm.dropColumns('user_trophies', ['source', 'purchase_id']);
};
