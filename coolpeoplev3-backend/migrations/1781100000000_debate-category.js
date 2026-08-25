/*
 * debates.category — the sponsor-chosen subject area for a debate
 * ("Business" | "Politics" | "Fashion" | free text when they pick "other").
 *
 * WHY A NEW COLUMN: the Apply-For-Debate form collects a category, and nothing
 * in the existing schema could hold it. It is deliberately NOT the
 * plan_component_categories controlled vocabulary — that taxonomy is the
 * political-issue vocabulary used for prompt/post tags and user interests, and a
 * casual debate's category ("Fashion") is a different axis. Prompts inside the
 * debate still tag against the controlled vocabulary via prompt_tags.
 *
 * Free text, nullable, no CHECK: the form's "other" option lets a sponsor type
 * their own, so an enum would reject valid submissions. Kept as a NEW migration
 * rather than editing an applied one.
 */

exports.up = (pgm) => {
    pgm.addColumns('debates', {
        // sponsor-chosen subject area; free text because the form allows "other"
        category: { type: 'text' },
    });
    // Browsing debates by category is the one query this column exists to serve.
    pgm.createIndex('debates', 'category', { name: 'idx_debates_category' });
};

exports.down = (pgm) => {
    pgm.dropIndex('debates', 'category', { name: 'idx_debates_category' });
    pgm.dropColumns('debates', ['category']);
};
