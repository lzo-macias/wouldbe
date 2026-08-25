/*
================================================================================
 CoolPeople v3 / Would Be — Issue categories: user interests + post/prompt tags
================================================================================
 Layers on top of the existing `plan_component_categories` REFERENCE TABLE
 (category_key PK), which plan_components already FK into. This makes that table
 the single controlled vocabulary the whole product matches on:

     plan_component_categories  (category_key PK)
        ▲             ▲              ▲              ▲
   plan_components  user_areas_of_interest   post_tags   prompt_tags

 WHY a reference table (rows) and not a CHECK enum: categories GROW over time.
 With rows, adding a category later is one INSERT (an admin endpoint), no
 migration. A CHECK enum would need a migration every time. Categories are
 admin-curated on purpose — they're a controlled vocabulary, so matching works.

 This migration:
   1. Seeds plan_component_categories with the full issue list (idempotent).
   2. Adds three join tables so a user / post / prompt can carry many categories,
      each FK-validated against the canonical list and ON DELETE CASCADE.
================================================================================
*/

// Full issue taxonomy, grouped. category_key is the stable slug everything FKs to.
const CATEGORY_GROUPS = {
    housing_land_use: ['affordable_housing', 'homelessness', 'tenant_rights', 'housing_supply', 'zoning_land_use', 'gentrification', 'public_housing'],
    criminal_justice_public_safety: ['police_reform', 'criminal_justice_reform', 'mass_incarceration', 'gun_safety', 'bail_reform', 'juvenile_justice', 'emergency_response', 'domestic_violence', 'hate_crimes', 'community_safety'],
    healthcare: ['universal_healthcare', 'mental_health', 'reproductive_rights', 'maternal_health', 'addiction_and_recovery', 'prescription_drug_pricing', 'public_health', 'elder_care', 'disability_rights', 'harm_reduction'],
    education: ['k12_education', 'higher_education', 'student_debt', 'early_childhood_education', 'teacher_pay', 'school_funding', 'vocational_training', 'school_safety', 'civic_education'],
    economy_labor: ['minimum_wage', 'worker_rights', 'labor_unions', 'job_training', 'small_business', 'tax_policy', 'income_inequality', 'gig_economy', 'cost_of_living', 'economic_development'],
    environment_climate: ['climate_change', 'renewable_energy', 'clean_air_water', 'environmental_justice', 'conservation', 'public_lands', 'food_and_agriculture', 'pollution', 'green_jobs'],
    transportation_infrastructure: ['public_transit', 'infrastructure', 'broadband_access', 'pedestrian_bike_safety', 'electric_vehicles', 'rail_transit', 'road_safety'],
    civil_rights_equity: ['racial_justice', 'lgbtq_rights', 'gender_equity', 'immigration_reform', 'religious_freedom', 'indigenous_rights', 'disability_inclusion'],
    democracy_government_reform: ['voting_rights', 'campaign_finance_reform', 'ranked_choice_voting', 'redistricting', 'government_transparency', 'term_limits', 'lobbying_reform', 'youth_political_participation'],
    social_safety_net: ['social_security', 'food_security', 'child_care', 'paid_family_leave', 'poverty_reduction', 'veterans_services', 'unemployment_support'],
    technology_innovation: ['data_privacy', 'ai_regulation', 'big_tech_accountability', 'net_neutrality', 'cybersecurity', 'digital_equity'],
    foreign_policy_defense: ['foreign_policy', 'defense_spending', 'veterans_affairs', 'humanitarian_aid', 'trade_policy'],
    local_quality_of_life: ['parks_and_recreation', 'libraries', 'arts_and_culture', 'sanitation', 'noise_and_nuisance', 'street_vending'],
    youth_specific: ['youth_mental_health', 'youth_employment', 'youth_civic_engagement', 'student_government'],
    other: ['other'],
};

// display_name generation: title-case the slug, with acronym + full overrides.
const ACRONYMS = { ai: 'AI', lgbtq: 'LGBTQ+', k12: 'K-12' };
const NAME_OVERRIDES = { clean_air_water: 'Clean Air & Water' };
const titleCase = (key) => {
    if (NAME_OVERRIDES[key]) return NAME_OVERRIDES[key];
    return key
        .split('_')
        .map((w) => (w === 'and' ? '&' : ACRONYMS[w] || w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
};

exports.up = (pgm) => {
    // ----- 1. Seed the canonical category list (idempotent) -----------------
    const rows = [];
    let sort = 0;
    for (const [group, keys] of Object.entries(CATEGORY_GROUPS)) {
        for (const key of keys) {
            sort += 10;
            rows.push(`('${key}', '${titleCase(key)}', '${group}', ${sort})`);
        }
    }
    pgm.sql(
        `INSERT INTO plan_component_categories (category_key, display_name, category_group, sort_order)
         VALUES ${rows.join(',\n')}
         ON CONFLICT (category_key) DO NOTHING;`
    );

    // ----- 2a. User areas of interest ---------------------------------------
    pgm.createTable(
        'user_areas_of_interest',
        {
            user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
            category_key: { type: 'text', notNull: true, references: 'plan_component_categories(category_key)', onDelete: 'CASCADE' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { ifNotExists: true, constraints: { primaryKey: ['user_id', 'category_key'] } }
    );
    // reverse lookup: "which users care about category X" (audience targeting)
    pgm.createIndex('user_areas_of_interest', 'category_key', { ifNotExists: true });

    // ----- 2b. Post tags -----------------------------------------------------
    pgm.createTable(
        'post_tags',
        {
            post_id: { type: 'uuid', notNull: true, references: 'posts(id)', onDelete: 'CASCADE' },
            category_key: { type: 'text', notNull: true, references: 'plan_component_categories(category_key)', onDelete: 'CASCADE' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { ifNotExists: true, constraints: { primaryKey: ['post_id', 'category_key'] } }
    );
    pgm.createIndex('post_tags', 'category_key', { ifNotExists: true });

    // ----- 2c. Debate-prompt tags -------------------------------------------
    pgm.createTable(
        'prompt_tags',
        {
            prompt_id: { type: 'uuid', notNull: true, references: 'prompts(id)', onDelete: 'CASCADE' },
            category_key: { type: 'text', notNull: true, references: 'plan_component_categories(category_key)', onDelete: 'CASCADE' },
            created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        },
        { ifNotExists: true, constraints: { primaryKey: ['prompt_id', 'category_key'] } }
    );
    pgm.createIndex('prompt_tags', 'category_key', { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('prompt_tags', { ifExists: true });
    pgm.dropTable('post_tags', { ifExists: true });
    pgm.dropTable('user_areas_of_interest', { ifExists: true });
    // remove only the categories this migration seeded that nothing else references
    const all = Object.values(CATEGORY_GROUPS).flat().map((k) => `'${k}'`).join(',');
    pgm.sql(
        `DELETE FROM plan_component_categories
         WHERE category_key IN (${all})
           AND category_key NOT IN (SELECT category_key FROM plan_components);`
    );
};
