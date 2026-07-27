/*
 * Adds an "umbrella" category_key inside every category_group whose key is the
 * SAME name as the group (e.g. group 'healthcare' gets category_key 'healthcare').
 * Lets a user pick a whole issue area, not just a specific leaf position.
 *
 * Additive + idempotent: ON CONFLICT DO NOTHING, so the pre-existing 'other'
 * key (group 'other' already contains key 'other') is left untouched, and a
 * re-run inserts nothing new. Kept as a NEW migration rather than editing the
 * applied 1780800000000 seed in place.
 */

// The 15 groups from 1780800000000_categories-and-tags.js. The umbrella key IS
// the group name, so we only need the list of groups here.
const GROUPS = [
    'housing_land_use',
    'criminal_justice_public_safety',
    'healthcare',
    'education',
    'economy_labor',
    'environment_climate',
    'transportation_infrastructure',
    'civil_rights_equity',
    'democracy_government_reform',
    'social_safety_net',
    'technology_innovation',
    'foreign_policy_defense',
    'local_quality_of_life',
    'youth_specific',
    'other',
];

// Title-case the group slug for display_name (matches the seed's convention;
// no acronyms/overrides apply to any group name).
const titleCase = (slug) =>
    slug
        .split('_')
        .map((w) => (w === 'and' ? '&' : w === 'of' ? 'of' : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');

exports.up = (pgm) => {
    // sort_order 5 sorts the umbrella key FIRST within its group (leaf keys use
    // multiples of 10 starting at 10), so it heads the list in the picker.
    const rows = GROUPS.map(
        (g) => `('${g}', '${titleCase(g)}', '${g}', 5)`
    );
    pgm.sql(
        `INSERT INTO plan_component_categories (category_key, display_name, category_group, sort_order)
         VALUES ${rows.join(',\n')}
         ON CONFLICT (category_key) DO NOTHING;`
    );
};

exports.down = (pgm) => {
    // Only remove the umbrella keys this migration added. 'other' pre-existed
    // the seed, so it is explicitly excluded from the rollback. FK references
    // (user_areas_of_interest / post_tags / prompt_tags) cascade on delete.
    const toRemove = GROUPS.filter((g) => g !== 'other');
    pgm.sql(
        `DELETE FROM plan_component_categories
         WHERE category_key = ANY(ARRAY[${toRemove.map((g) => `'${g}'`).join(', ')}])
           AND category_key = category_group;`
    );
};
