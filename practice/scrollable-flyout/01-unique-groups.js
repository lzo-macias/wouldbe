// ============================================================================
// PROBLEM 01 — Unique category groups (Set dedupe)
// ----------------------------------------------------------------------------
// GET /api/categories returns ~106 rows. Each carries a `category_group`, and
// only ~15 distinct groups exist — so the same group appears on many rows. To
// render the category slider we need the DISTINCT groups, once each.
//
// The bug we hit: mapping alone —
//     categories.map(c => c.category_group)
// gives ["healthcare","healthcare","education",...] with duplicates, and React
// warns "Each child in a list should have a unique key" because two chips share
// the same key.
//
// Write uniqueGroups(categories): return an array of the DISTINCT category_group
// strings, in first-seen order.
//
// CONCEPTS: `new Set(iterable)` keeps only unique values and preserves
// first-insertion order; `[...set]` (or Array.from) spreads it back to an array.
// ============================================================================

function uniqueGroups(categories) {
    // TODO: map to category_group, dedupe with a Set, return an array
}

// ---- tests (don't edit) ----------------------------------------------------
const rows = [
    { category_key: "universal_healthcare", category_group: "healthcare" },
    { category_key: "mental_health",        category_group: "healthcare" },
    { category_key: "k12_education",        category_group: "education" },
    { category_key: "student_debt",         category_group: "education" },
    { category_key: "climate_change",       category_group: "environment_climate" },
];

runTests("01 — unique groups", [
    ["collapses duplicates", () => uniqueGroups(rows), ["healthcare", "education", "environment_climate"]],
    ["first-seen order kept", () => uniqueGroups(rows)[0], "healthcare"],
    ["length is distinct count", () => uniqueGroups(rows).length, 3],
    ["empty input -> empty array", () => uniqueGroups([]), []],
]);

async function runTests(title, cases) {
    console.log(`\n${title}`);
    let pass = 0;
    for (const [name, fn, expected] of cases) {
        let got;
        try { got = await fn(); } catch (e) { got = `threw ${e.message}`; }
        const ok = JSON.stringify(got) === JSON.stringify(expected);
        console.log(`  ${ok ? "✓" : "✗"} ${name}`);
        if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(got)}`);
        if (ok) pass++;
    }
    console.log(`  ${pass}/${cases.length} passing`);
}
