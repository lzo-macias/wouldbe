/* users.link — one public URL the user adds for their socials (Instagram, TikTok,
 * a linktree, a campaign site).
 *
 * ONE column, not one per platform. A column per network means a migration every
 * time a new one matters and a wide table of mostly-nulls; a single link lets the
 * user point at whatever aggregator they already keep current. If per-platform
 * handles ever become something we query or verify, that's a `user_links` child
 * table, not fifteen more columns here.
 *
 * Nullable, no default — most users won't set one, and "" and NULL should not both
 * mean "unset".
 *
 * NOTE the security shape: this value is rendered as an href, so the API layer
 * enforces http/https only (see normalizeLink in DB/platform/users.js). A
 * `javascript:` URL in an href executes on click — a stored XSS delivered by the
 * profile of anyone a visitor clicks through to. The DB stores text; the
 * validation is deliberately at the write path, which every caller goes through.
 */

exports.up = (pgm) => {
    pgm.addColumns('users', {
        link: { type: 'text' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('users', ['link']);
};
