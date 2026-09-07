/* Questions and artifacts — the two written post kinds the feed already renders.
 *
 * The composer offers four things to start. Two of them were real (a debate has
 * its own tables, a would be is a campaign attached to an office) and two were
 * not: a question and an artifact were written into React state, led the feed
 * for the session, and were gone on reload. This gives them a row.
 *
 * THEY REUSE `posts` rather than getting tables of their own. posts is already
 * the UGC surface — one moderation pipeline, one endorsement table, one comment
 * thread, one takedown path. A questions table would have needed its own copy of
 * all four, and the second copy is the one that misses a takedown.
 *
 * WHAT MAKES THEM DIFFERENT from the two kinds already here: they are STANDALONE.
 * A campaign post hangs off a wouldbe and a response hangs off a contestant and a
 * prompt — the old table CHECK required exactly one of those parents, which is
 * precisely why a post with no parent could not be written. The rewritten CHECK
 * keeps that requirement for the two video kinds and requires the opposite for
 * the two written ones: no parent at all, and a title.
 *
 * TITLE AND BODY, not caption. `caption` is the line under a video; these are the
 * post. Their shape is the same for both kinds and only the requirement differs:
 *
 *   question   title = the question, body = optional context under it
 *   artifact   title = the claim,    body = the article, and it is required
 *
 * image_url is written ONLY by contentItems.syncPostImage on an approval verdict,
 * exactly like plan_components.image_url and users.profile_photo_url — so a post
 * can never render an image the scanner has not cleared. The user-supplied bytes
 * go to R2 under the uploader's own prefix and reach this column later or never.
 */

exports.up = (pgm) => {
    pgm.addColumns('posts', {
        // the question, or the artifact's claim — required for both written kinds
        title: { type: 'text' },
        // the context under a question (optional), or the article itself (required)
        body: { type: 'text' },
        // populated ONLY on moderation approval; null = no image, or not cleared yet
        image_url: { type: 'text' },
    });

    pgm.sql(`ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_post_type_check;`);
    pgm.sql(`
        ALTER TABLE posts ADD CONSTRAINT posts_post_type_check CHECK (
            post_type IN ('wouldbe_campaign','debate_response','question','artifact')
        );
    `);

    // The parent rule, restated for four kinds. The two video kinds are unchanged;
    // the two written kinds must have NO parent (a question that secretly belongs
    // to a debate is a response, and it should be stored as one) and must carry
    // the text that IS the post.
    pgm.sql(`ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_chck;`);
    pgm.sql(`
        ALTER TABLE posts ADD CONSTRAINT posts_chck CHECK (
            (post_type = 'wouldbe_campaign' AND wouldbe_id IS NOT NULL AND contestant_id IS NULL)
            OR
            (post_type = 'debate_response' AND contestant_id IS NOT NULL AND prompt_id IS NOT NULL)
            OR
            (
                post_type IN ('question','artifact')
                AND wouldbe_id IS NULL AND contestant_id IS NULL AND prompt_id IS NULL
                AND title IS NOT NULL AND btrim(title) <> ''
                AND (post_type <> 'artifact' OR (body IS NOT NULL AND btrim(body) <> ''))
            )
        );
    `);

    // The written feed is "newest question or artifact still standing" — the one
    // query the home column runs on every load.
    pgm.createIndex('posts', ['post_type', 'created_at'], {
        name: 'idx_posts_written_feed',
        where: `post_type IN ('question','artifact') AND removed_at IS NULL`,
    });

    // The moderation queue keys off parent_type, and there was no honest value for
    // an image attached to a written post. 'wouldbe_post' would have made the
    // queue mislabel what a moderator is looking at.
    pgm.sql(`ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_parent_type_check;`);
    pgm.sql(`
        ALTER TABLE content_items ADD CONSTRAINT content_items_parent_type_check CHECK (
            parent_type IN (
                'profile','wouldbe_post','debate_response','comment',
                'review','message','prompt_response','plan_component','written_post'
            )
        );
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DELETE FROM content_items WHERE parent_type = 'written_post';`);
    pgm.sql(`ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_parent_type_check;`);
    pgm.sql(`
        ALTER TABLE content_items ADD CONSTRAINT content_items_parent_type_check CHECK (
            parent_type IN (
                'profile','wouldbe_post','debate_response','comment',
                'review','message','prompt_response','plan_component'
            )
        );
    `);

    pgm.dropIndex('posts', ['post_type', 'created_at'], { name: 'idx_posts_written_feed' });

    // Rows of the new kinds would violate both narrower constraints, and their
    // children have to go first or the FKs block the delete.
    pgm.sql(`
        DELETE FROM post_endorsements
         WHERE post_id IN (SELECT id FROM posts WHERE post_type IN ('question','artifact'));
    `);
    pgm.sql(`
        DELETE FROM comments
         WHERE post_id IN (SELECT id FROM posts WHERE post_type IN ('question','artifact'));
    `);
    pgm.sql(`DELETE FROM posts WHERE post_type IN ('question','artifact');`);

    pgm.sql(`ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_chck;`);
    pgm.sql(`
        ALTER TABLE posts ADD CONSTRAINT posts_chck CHECK (
            (post_type = 'wouldbe_campaign' AND wouldbe_id IS NOT NULL AND contestant_id IS NULL)
            OR
            (post_type = 'debate_response' AND contestant_id IS NOT NULL AND prompt_id IS NOT NULL)
        );
    `);
    pgm.sql(`ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_post_type_check;`);
    pgm.sql(`
        ALTER TABLE posts ADD CONSTRAINT posts_post_type_check CHECK (
            post_type IN ('wouldbe_campaign','debate_response')
        );
    `);

    pgm.dropColumns('posts', ['title', 'body', 'image_url']);
};
