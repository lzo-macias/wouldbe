/*
 * Sponsor-nominated judges for hybrid debates.
 *
 * WHY: a hybrid debate is "the platform votes a top ten, then the sponsor's panel
 * picks the winner". That panel is the part of the contest a regulator actually
 * looks at — a skill contest defends itself on WHO judged and WHY they were
 * qualified. The apply form now collects that at submission time, so an admin has
 * it in hand when deciding whether to approve.
 *
 * debate_judges already existed (external_name / external_bio / role / disclosed_at)
 * but had nowhere to put the three things the form asks for:
 *
 *   external_email     how to reach a judge who has no account yet. Judges are
 *                      nominated by email before they ever sign up, so user_id
 *                      stays NULL until (and unless) they do.
 *   qualification_note WHY this person is qualified to judge THIS debate. Distinct
 *                      from external_bio, which is a general public blurb: the
 *                      qualification is the sponsor's justification, and it is what
 *                      an admin reviews.
 *   credential_links   supporting links (LinkedIn, portfolio, publications).
 *                      jsonb array, not text[]: the count is open-ended, the form
 *                      starts with one row and lets the sponsor add more, and jsonb
 *                      leaves room to attach a label per link later without a
 *                      second migration.
 *
 * NO UNIQUE ON EMAIL GLOBALLY — the same person can judge many debates. The
 * partial index below scopes uniqueness to one debate and ignores rows with no
 * email (on-platform judges added by user_id), so a sponsor can't list the same
 * address twice on one panel.
 */

exports.up = (pgm) => {
    pgm.addColumns('debate_judges', {
        // contact for an off-platform judge; NULL for judges added by user_id
        external_email: { type: 'text' },
        // the sponsor's stated reason this judge is qualified for this debate
        qualification_note: { type: 'text' },
        // supporting links, e.g. ["https://linkedin.com/in/…", "https://…"]
        credential_links: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
    });

    // Same address twice on one panel is a data-entry mistake, not a use case.
    // Partial + LOWER() so it ignores on-platform judges and is case-insensitive.
    pgm.sql(`
        CREATE UNIQUE INDEX idx_debate_judges_email_per_debate
        ON debate_judges (debate_id, LOWER(external_email))
        WHERE external_email IS NOT NULL;
    `);

    // The panel-completeness check the approve route runs is
    // "does this hybrid debate have a non-recused judge?" — index the shape.
    pgm.createIndex('debate_judges', ['debate_id', 'recused_at'], {
        name: 'idx_debate_judges_active',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('debate_judges', ['debate_id', 'recused_at'], { name: 'idx_debate_judges_active' });
    pgm.sql(`DROP INDEX IF EXISTS idx_debate_judges_email_per_debate;`);
    pgm.dropColumns('debate_judges', ['external_email', 'qualification_note', 'credential_links']);
};
