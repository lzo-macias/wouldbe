// ============================================================================
// PROBLEM 02 — Interests that belong to one group (filter by a field)
// ----------------------------------------------------------------------------
// When a category chip (e.g. "healthcare") is hovered, the dropdown lists only
// the interests whose `category_group` matches that group. That's a filter.
//
//     allInterests.filter(i => i.category_group === category_group)
//
// Write interestsInGroup(allInterests, category_group): return a new array of the
// interest objects in that group (order preserved). No matches -> [].
//
// CONCEPTS: `filter` returns a NEW array of the elements for which the predicate
// is truthy; it never mutates the source. Compare the field with `===`.
// ============================================================================

function interestsInGroup(allInterests, category_group) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
const all = [
    { category_key: "universal_healthcare", category_group: "healthcare" },
    { category_key: "mental_health",        category_group: "healthcare" },
    { category_key: "k12_education",        category_group: "education" },
];

runTests("02 — interests in group", [
    ["only healthcare", () => interestsInGroup(all, "healthcare").map(i => i.category_key),
        ["universal_healthcare", "mental_health"]],
    ["only education", () => interestsInGroup(all, "education").map(i => i.category_key),
        ["k12_education"]],
    ["unknown group -> empty", () => interestsInGroup(all, "nope"), []],
    ["does not mutate source", () => { interestsInGroup(all, "healthcare"); return all.length; }, 3],
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
