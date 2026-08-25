/* Optional image on a plan component, behind the same moderation gate as avatars.
 *
 * TWO changes:
 *   1. plan_components.image_url — where an APPROVED image lands. Written only by
 *      contentItems.syncPlanComponentImage on a verdict, never by the user, so a
 *      plan position can't display an unreviewed image.
 *   2. content_items.parent_type gains 'plan_component' — the moderation pipeline
 *      keys off parent_type, and there was no honest value for these. Reusing
 *      'wouldbe_post' would have made the queue mislabel what a moderator is
 *      looking at.
 *
 * NOTE: PlanSwap in the frontend already reads `component.image_url`. Until now
 * that column didn't exist, so the image half of its text/image toggle rendered a
 * broken <img> every time.
 */

exports.up = (pgm) => {
    pgm.addColumns('plan_components', {
        // populated ONLY on moderation approval; null = no image, or not cleared yet
        image_url: { type: 'text' },
    });

    pgm.sql(`ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_parent_type_check;`);
    pgm.sql(`
        ALTER TABLE content_items ADD CONSTRAINT content_items_parent_type_check CHECK (
            parent_type IN (
                'profile','wouldbe_post','debate_response','comment',
                'review','message','prompt_response','plan_component'
            )
        );
    `);
};

exports.down = (pgm) => {
    // Rows written against the new value would violate the narrower constraint.
    pgm.sql(`DELETE FROM content_items WHERE parent_type = 'plan_component';`);
    pgm.sql(`ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_parent_type_check;`);
    pgm.sql(`
        ALTER TABLE content_items ADD CONSTRAINT content_items_parent_type_check CHECK (
            parent_type IN (
                'profile','wouldbe_post','debate_response','comment',
                'review','message','prompt_response'
            )
        );
    `);
    pgm.dropColumns('plan_components', ['image_url']);
};
