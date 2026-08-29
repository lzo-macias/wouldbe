/* The public profile: links out, and the two things you can hide.
 *
 * SOCIALS ARE FOUR COLUMNS, NOT A JSONB BAG. There is a fixed, small set of
 * places a candidate links to, each needs its own validation and its own icon,
 * and a bag would mean every read doing shape-checking at render time. Four
 * columns are also indexable and searchable if that is ever wanted; a bag is
 * neither. When the fifth network arrives it is one migration.
 *
 * PRIVACY IS TWO BOOLEANS, AND THEY ARE NOT "RENDER CONDITIONALLY".
 *
 * A hidden field must be ABSENT from the public payload, not present-and-marked
 * — a greyed "hidden" row leaks the very thing the setting exists to hide, and
 * a null in a JSON response that a determined reader can diff against an older
 * one leaks it too. So the read path builds two genuinely different objects:
 *
 *   public viewer   the field is not in the response at all
 *   the owner       the field is there, flagged, so they can see what the world
 *                   is missing
 *
 * WHY THE NAME CAN BE HIDDEN AT ALL. This is a site where people argue in
 * public under their own name and then stand for office. Somebody organising
 * tenants against a landlord has a real reason to be @lorenzo and not Lorenzo
 * Macias, and the alternative — make them choose between participating and
 * being findable — is worse than a username.
 *
 * A username becomes REQUIRED in that case, enforced by a CHECK: hiding your
 * name while having no handle leaves nothing to render at all.
 */

exports.up = (pgm) => {
    pgm.addColumns('users', {
        // Stored as full URLs rather than handles. A handle needs a base URL to
        // become a link, which means every consumer has to know the base URL
        // for every network — and gets it wrong for the one that changed domain.
        social_x: { type: 'text' },
        social_instagram: { type: 'text' },
        social_twitch: { type: 'text' },
        social_website: { type: 'text' },

        // The two privacy switches. Defaulted false: an existing account chose
        // nothing, and silently hiding what was public would be a change nobody
        // asked for.
        hide_real_name: { type: 'boolean', notNull: true, default: false },
        hide_state: { type: 'boolean', notNull: true, default: false },
    });

    // NOT VALID so the constraint applies to writes from now on without a table
    // scan that could fail on an old row someone has to fix by hand first.
    pgm.sql(`
        ALTER TABLE users ADD CONSTRAINT users_hidden_name_needs_handle_chk
            CHECK (hide_real_name = false OR username IS NOT NULL) NOT VALID;
    `);
};

exports.down = (pgm) => {
    pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hidden_name_needs_handle_chk;');
    pgm.dropColumns('users', [
        'social_x', 'social_instagram', 'social_twitch', 'social_website',
        'hide_real_name', 'hide_state',
    ]);
};
