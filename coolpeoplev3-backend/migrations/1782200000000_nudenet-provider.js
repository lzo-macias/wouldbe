/* Add 'nudenet' to the moderation_events provider vocabulary.
 *
 * WHY: the avatar pipeline scans profile photos for nudity, and NudeNet is the
 * self-hosted classifier doing it. The provider list was written before that
 * decision, so an honest scan report was rejected by the CHECK constraint with
 * "provider must be one of: ..." — the scanner had no truthful value to send.
 *
 * The alternative was labelling NudeNet's verdicts 'manual', which would make
 * the audit trail lie about who judged the content. moderation_events is the
 * record we would hand a regulator; the provider column has to be true.
 *
 * New migration rather than editing the applied one — 1779234282879 has already
 * run everywhere.
 */

exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE moderation_events DROP CONSTRAINT IF EXISTS moderation_events_provider_check;`);
    pgm.sql(`
        ALTER TABLE moderation_events ADD CONSTRAINT moderation_events_provider_check CHECK (
            provider IN (
                'hive','openai_moderation','openai_vision','photodna',
                'thorn_safer','perspective','aws_rekognition','manual','nudenet'
            )
        );
    `);
};

exports.down = (pgm) => {
    // Rows written by the scanner would violate the narrower constraint, so drop
    // them to their nearest honest equivalent rather than failing the rollback.
    pgm.sql(`UPDATE moderation_events SET provider = 'manual' WHERE provider = 'nudenet';`);
    pgm.sql(`ALTER TABLE moderation_events DROP CONSTRAINT IF EXISTS moderation_events_provider_check;`);
    pgm.sql(`
        ALTER TABLE moderation_events ADD CONSTRAINT moderation_events_provider_check CHECK (
            provider IN (
                'hive','openai_moderation','openai_vision','photodna',
                'thorn_safer','perspective','aws_rekognition','manual'
            )
        );
    `);
};
