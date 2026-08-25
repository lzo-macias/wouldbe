/*
 * Prize type becomes three-way, and EVERY prize gets a signed agreement.
 *
 * WHY THE BOOLEAN WASN'T ENOUGH: prize_is_cash could say "money" or "not money",
 * but a sponsor offering $500 AND a studio session has a prize that is both, and
 * the winner is owed both. Squeezing that into a boolean means one half of the
 * prize goes unrecorded — and therefore unpromised.
 *
 * prize_is_cash is now GENERATED from prize_type rather than stored alongside it.
 * Two columns that must agree will eventually disagree; a generated column cannot.
 * Everything that already reads debates.prize_is_cash keeps working unchanged.
 *
 * THE AGREEMENT NOW COVERS EVERY PRIZE TYPE. It used to be cash-only, on the
 * reasoning that only money creates an obligation. That was wrong: a promised
 * internship that never materialises is the same broken promise to the same
 * winner, and the platform is the one they come to. So sponsor_prize_agreements
 * gains the prize TYPE and the DESCRIPTION as signed at the time, and prize_cents
 * relaxes to >= 0 so a non-cash prize can be signed for.
 *
 * WHAT THE SIGNATURE IS NOW CHECKED AGAINST: terms_hash, not the amount. The hash
 * covers the whole prize as rendered — amount and description — so editing either
 * one after signing invalidates the signature and the sponsor must re-sign. The
 * old check compared prize_cents alone, which would have let a sponsor sign for
 * "$500 + a laptop" and quietly downgrade it to "$500 + a sticker".
 */

exports.up = (pgm) => {
    // 1. DROP THE OLD SHAPE CONSTRAINT FIRST.
    //    It was added NOT VALID, which exempts EXISTING rows — but only until
    //    something updates them. The backfill below rewrites every row, and a NOT
    //    VALID constraint is enforced on every new row version, so the legacy
    //    prize-less debate would fail the moment we touched it. Dropping first
    //    means the backfill can run; the rule is re-added at the end.
    pgm.sql(`ALTER TABLE debates DROP CONSTRAINT IF EXISTS debates_prize_shape_chk;`);

    // 2. the three-way column, backfilled from the boolean it replaces
    pgm.addColumns('debates', {
        prize_type: {
            type: 'text',
            notNull: true,
            default: 'cash',
            check: "prize_type IN ('cash','non_cash','both')",
        },
    });
    pgm.sql(`
        UPDATE debates SET prize_type = CASE WHEN prize_is_cash THEN 'cash' ELSE 'non_cash' END;
    `);

    // 3. replace the stored boolean with a generated one
    pgm.dropColumns('debates', ['prize_is_cash']);
    pgm.sql(`
        ALTER TABLE debates
        ADD COLUMN prize_is_cash boolean
        GENERATED ALWAYS AS (prize_type IN ('cash','both')) STORED;
    `);

    // 4. the shape rule, now three-way. NOT VALID for the same reason as before:
    //    debates created before prizes were declared at all are older, not wrong.
    pgm.sql(`
        ALTER TABLE debates ADD CONSTRAINT debates_prize_shape_chk CHECK (
            (prize_type = 'cash'
                AND COALESCE(sponsor_contribution_cents, 0) > 0)
            OR
            (prize_type = 'non_cash'
                AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
            OR
            (prize_type = 'both'
                AND COALESCE(sponsor_contribution_cents, 0) > 0
                AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
        ) NOT VALID;
    `);

    // 5. the agreement row records WHAT was promised, not just how much
    pgm.addColumns('sponsor_prize_agreements', {
        // the prize type as signed for
        prize_type: { type: 'text', notNull: true, default: 'cash', check: "prize_type IN ('cash','non_cash','both')" },
        // the non-cash half, verbatim as it appeared in the signed terms
        prize_description: { type: 'text' },
    });
    // A non-cash prize is signed for with zero cents. The old CHECK demanded > 0.
    pgm.sql(`
        ALTER TABLE sponsor_prize_agreements DROP CONSTRAINT IF EXISTS sponsor_prize_agreements_prize_cents_check;
        ALTER TABLE sponsor_prize_agreements ADD CONSTRAINT sponsor_prize_agreements_prize_cents_check
            CHECK (prize_cents >= 0);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE sponsor_prize_agreements DROP CONSTRAINT IF EXISTS sponsor_prize_agreements_prize_cents_check;
        ALTER TABLE sponsor_prize_agreements ADD CONSTRAINT sponsor_prize_agreements_prize_cents_check
            CHECK (prize_cents > 0);
    `);
    pgm.dropColumns('sponsor_prize_agreements', ['prize_type', 'prize_description']);

    pgm.sql(`ALTER TABLE debates DROP CONSTRAINT IF EXISTS debates_prize_shape_chk;`);
    pgm.dropColumns('debates', ['prize_is_cash']);
    pgm.addColumns('debates', {
        prize_is_cash: { type: 'boolean', notNull: true, default: true },
    });
    pgm.sql(`UPDATE debates SET prize_is_cash = (prize_type <> 'non_cash');`);
    pgm.sql(`
        ALTER TABLE debates ADD CONSTRAINT debates_prize_shape_chk CHECK (
            (prize_is_cash = true  AND COALESCE(sponsor_contribution_cents, 0) > 0)
            OR
            (prize_is_cash = false AND prize_description IS NOT NULL AND length(btrim(prize_description)) > 0)
        ) NOT VALID;
    `);
    pgm.dropColumns('debates', ['prize_type']);
};
