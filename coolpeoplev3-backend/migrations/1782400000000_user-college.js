/* users.college — free-text school affiliation shown on a public profile.
 *
 * Free text rather than a FK to an institutions table: there is no such table,
 * and inventing one would mean seeding ~4,000 US institutions to capture a field
 * that is decoration on a profile card. If it ever becomes something we filter or
 * match on, that's the point to normalize it.
 *
 * Nullable with no default — most users won't set it, and "" and NULL should not
 * both mean "unset".
 */

exports.up = (pgm) => {
    pgm.addColumns('users', {
        college: { type: 'text' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('users', ['college']);
};
