/* Paying to answer: a $5 single, or $10 a month for any of them.
 *
 * WHAT CHANGED, AND WHY IT IS A BETTER MODEL THAN THE ONE IT REPLACES.
 *
 * Arrows used to be purchasable. That was wrong on its own terms: standing you
 * can buy is not standing, and it meant the number under somebody's name said
 * two different things depending on how they got it. Money now buys ACCESS, not
 * standing — a pass, not a rank — and the two lanes stop pretending to be one.
 *
 *   EARNED   win debates -> arrows -> past this debate's threshold -> answer
 *   PAID     $5 for this one prompt, or $10/month for any prompt
 *
 * Either opens the door. Neither changes the other: a subscriber's arrow count
 * stays whatever they won, and the leaderboards that read arrows keep meaning
 * what they meant.
 *
 * THE SINGLE PASS IS BOUND TO A PROMPT, not to a debate and not to a count.
 * "One response" as a decrementing balance would need a spend ledger and would
 * raise the question of what happens when an answer is deleted; bound to the
 * prompt it is a fact with one answer — this pass opens this question — and
 * re-editing that same answer is free, which is the behaviour anybody would
 * expect from having paid for it.
 *
 * THE SUBSCRIPTION REUSES `subscriptions`, tier 'responder'. That table already
 * has the status vocabulary, the period columns, the Stripe ids and a
 * one-active-per-user index. A second subscriptions table would be a second
 * place that thinks it knows whether somebody is paid up.
 */

exports.up = (pgm) => {
    pgm.createTable('response_passes', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
        // The one question this pass opens.
        prompt_id: { type: 'uuid', notNull: true, references: 'prompts(id)', onDelete: 'CASCADE' },
        // Carried for reporting so "what did people pay to answer" does not need
        // a join through prompts on every query.
        debate_id: { type: 'uuid', references: 'debates(id)', onDelete: 'SET NULL' },
        amount_cents: { type: 'integer', notNull: true, check: 'amount_cents >= 0' },
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

    pgm.createIndex('response_passes', ['user_id', 'prompt_id'], { name: 'idx_response_passes_lookup' });

    // ONE PAID PASS PER PERSON PER PROMPT. Partial on status so a failed or
    // abandoned attempt does not block a second try, while a paid one makes a
    // duplicate charge impossible.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_response_passes_one_paid
            ON response_passes (user_id, prompt_id)
            WHERE status = 'paid';
    `);

    // One pass per PaymentIntent — Stripe delivers webhooks more than once.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_response_passes_intent
            ON response_passes (payment_intent_id)
            WHERE payment_intent_id IS NOT NULL;
    `);

    // Arrows are no longer for sale. The table and the 'purchased' kind stay:
    // anyone who bought arrows under the old model keeps them, and deleting the
    // rows would make their trophy count unexplainable. Nothing writes here any
    // more — the comment is the deprecation.
    pgm.sql(`
        COMMENT ON TABLE arrow_purchases IS
            'DEPRECATED. Arrows are earned only; access is bought via response_passes or a responder subscription. Retained so historical purchases stay auditable.';
    `);
};

exports.down = (pgm) => {
    pgm.sql('COMMENT ON TABLE arrow_purchases IS NULL;');
    pgm.sql('DROP INDEX IF EXISTS idx_response_passes_intent;');
    pgm.sql('DROP INDEX IF EXISTS idx_response_passes_one_paid;');
    pgm.dropTable('response_passes');
};
