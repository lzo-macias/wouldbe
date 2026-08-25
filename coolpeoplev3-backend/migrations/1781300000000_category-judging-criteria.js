/*
 * Pre-disclosed judging criteria, keyed to a debate's category.
 *
 * THE REQUIREMENT: every debate must publish what it is judged on BEFORE entries
 * are submitted. debate_judging_criteria already stores the published criteria
 * per debate, but nothing produced those rows — a sponsor submitting through the
 * apply form created a debate with zero criteria, and the rubric the form showed
 * them lived only in the React bundle. This migration moves that rubric into the
 * database and makes it the source of truth.
 *
 * TWO TABLES, ON PURPOSE:
 *   category_judging_criteria  — the CATALOG. One rubric per category, editable
 *                                by admins, versioned. Not tied to any debate.
 *   debate_judging_criteria    — the SNAPSHOT (already exists). Copied from the
 *                                catalog when the debate is created.
 *
 * Copy, not a foreign key. A debate's published criteria must never change
 * retroactively: if an admin edits the Business rubric in 2027, debates that ran
 * in 2026 keep the exact text their entrants and judges saw. That is the whole
 * point of pre-disclosure, and the reason user_criteria_acknowledgments records
 * a criteria_version — debates.criteria_version (added below) is the catalog
 * version the snapshot was taken from, so an ack can be tied to exact bytes.
 *
 * WEIGHTS ARE FRACTIONS (0.250), matching debate_judging_criteria.weight
 * (numeric(4,3), 0 < weight <= 1). The frontend renders them as percentages.
 * Each category's five weights sum to 1.000 so validateCriteriaWeightsSum passes
 * on a freshly created debate with no admin intervention.
 *
 * CATEGORY MATCHING is case-insensitive on the text of debates.category (added
 * in 1781100000000), which is free text because the form allows "other". A
 * sponsor-typed category simply matches nothing and the debate gets no criteria
 * — an admin adds them by hand through the existing POST /debates/:id/criteria.
 */

// Fractions, not percents — debate_judging_criteria.weight is numeric(4,3).
const CATALOG = {
    Business: [
        ['problem_and_opportunity', 'Problem and Opportunity', 'How clearly the entrant defines a real problem and the market need/size it addresses', 0.250],
        ['solution_and_differentiation', 'Solution and Differentiation', 'How well the proposed solution solves that problem and stands apart from alternatives', 0.200],
        ['feasibility_and_business_model', 'Feasibility and Business Model', 'Realism of execution, unit economics, and a credible path to revenue/sustainability', 0.200],
        ['evidence_and_rigor', 'Evidence and Rigor', 'Extent to which claims are supported by data, research, or sound financial reasoning', 0.200],
        ['delivery_and_responsiveness', 'Delivery and Responsiveness', 'Clarity, professionalism, and how directly each prompt/rebuttal is addressed', 0.150],
    ],
    Fashion: [
        ['design_and_aesthetic', 'Design and Aesthetic', 'Visual composition — silhouette, color, proportion, and overall impact', 0.250],
        ['craftsmanship_and_execution', 'Craftsmanship and Execution', 'Quality of construction, fit, detailing, and finish (or styling execution for best-dressed)', 0.200],
        ['originality_and_creativity', 'Originality and Creativity', 'Uniqueness and inventiveness of the look relative to convention', 0.200],
        ['concept_and_cohesion', 'Concept and Cohesion', 'How well the entry expresses a clear concept/theme and answers the specific prompt', 0.200],
        ['presentation_and_styling', 'Presentation and Styling', 'Overall polish and how effectively the look is presented on video', 0.150],
    ],
    // Viewpoint-neutral by construction: every criterion scores debate skill,
    // never the position taken. Changing that would put the platform in the
    // business of scoring political opinions.
    Politics: [
        ['argument_quality_and_logic', 'Argument Quality and Logic', 'Soundness, structure, and internal consistency of the reasoning — independent of the position taken', 0.300],
        ['evidence_and_accuracy', 'Evidence and Accuracy', 'Factual grounding and accurate, relevant use of sources to support claims', 0.250],
        ['responsiveness_and_rebuttal', 'Responsiveness and Rebuttal', 'How directly the entrant answers the prompt and engages opposing points', 0.200],
        ['clarity_and_organization', 'Clarity and Organization', 'How clearly and coherently the position is communicated', 0.150],
        ['composure_and_decorum', 'Composure and Decorum', 'Professionalism, respect for opponents, and time management', 0.100],
    ],
};

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

exports.up = (pgm) => {
    pgm.createTable('category_judging_criteria', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // matches debates.category (free text); compared case-insensitively
        category: { type: 'text', notNull: true },
        // version label frozen onto each debate that copies this rubric
        criteria_version: { type: 'text', notNull: true, default: 'v1' },
        // stable slug, carried through to debate_judging_criteria.criterion_key
        criterion_key: { type: 'text', notNull: true },
        // label shown to sponsors, entrants and judges
        display_name: { type: 'text', notNull: true },
        // the "what it measures" column of the published rubric
        description: { type: 'text', notNull: true },
        // fraction of the final score; a category's rows should sum to 1.000
        weight: { type: 'numeric(4,3)', notNull: true, check: 'weight > 0 AND weight <= 1' },
        // display order in the rubric
        display_order: { type: 'integer', notNull: true, default: 0 },
        // retire a criterion without deleting the rows debates were copied from
        is_active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        // one row per key per version of a category's rubric
        constraints: { unique: ['category', 'criteria_version', 'criterion_key'] },
    });

    // The lookup this table exists to serve: "the active rubric for category X".
    pgm.createIndex('category_judging_criteria', ['category', 'is_active'], {
        name: 'idx_category_criteria_lookup',
    });

    // Which catalog version a debate's snapshot came from. NULL = no rubric was
    // applied (an "other" category, or a debate created before this migration).
    pgm.addColumns('debates', {
        criteria_version: { type: 'text' },
    });

    const rows = [];
    for (const [category, list] of Object.entries(CATALOG)) {
        list.forEach(([key, name, description, weight], i) => {
            rows.push(
                `(${sqlStr(category)}, 'v1', ${sqlStr(key)}, ${sqlStr(name)}, ${sqlStr(description)}, ${weight}, ${i})`
            );
        });
    }
    pgm.sql(
        `INSERT INTO category_judging_criteria
            (category, criteria_version, criterion_key, display_name, description, weight, display_order)
         VALUES ${rows.join(',\n                ')}
         ON CONFLICT (category, criteria_version, criterion_key) DO NOTHING;`
    );
};

exports.down = (pgm) => {
    pgm.dropColumns('debates', ['criteria_version']);
    pgm.dropIndex('category_judging_criteria', ['category', 'is_active'], {
        name: 'idx_category_criteria_lookup',
    });
    pgm.dropTable('category_judging_criteria');
};
