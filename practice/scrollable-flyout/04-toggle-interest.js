// ============================================================================
// PROBLEM 04 — Toggle an interest (immutable add / remove the WHOLE object)
// ----------------------------------------------------------------------------
// Clicking a dropdown item flips its selection. State holds the FULL objects, but
// the click hands us only a `key`. So:
//   - if the key is already selected -> remove that object
//   - otherwise -> add the whole object (looked up from the master list)
// ...and always return a NEW array (never mutate `prev` — React compares by
// reference to decide whether to re-render).
//
//     prev.some(i => i.category_key === key)
//         ? prev.filter(i => i.category_key !== key)
//         : [...prev, all.find(i => i.category_key === key)]
//
// Write toggleInterest(prev, key, all): return the next selected array.
// You can assume `key` exists in `all`.
//
// CONCEPTS: derive the next state FROM prev (don't mutate); `filter` gives a new
// array without the match; spread `[...prev, x]` gives a new array with x added;
// `find` pulls the full object for the key.
// ============================================================================

function toggleInterest(prev, key, all) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
const all = [
    { category_key: "mental_health", category_group: "healthcare" },
    { category_key: "student_debt",  category_group: "education" },
];
const one = [{ category_key: "mental_health", category_group: "healthcare" }];

runTests("04 — toggle interest", [
    ["adds when absent (whole object)", () => toggleInterest([], "student_debt", all),
        [{ category_key: "student_debt", category_group: "education" }]],
    ["removes when present", () => toggleInterest(one, "mental_health", all), []],
    ["keeps others when removing", () => toggleInterest(
        [{ category_key: "mental_health" }, { category_key: "student_debt" }],
        "mental_health", all).map(i => i.category_key), ["student_debt"]],
    ["does not mutate prev", () => { const p = []; toggleInterest(p, "student_debt", all); return p.length; }, 0],
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
