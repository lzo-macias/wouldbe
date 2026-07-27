// ============================================================================
// PROBLEM 03 — "Is this interest selected?" (some, not forEach/includes)
// ----------------------------------------------------------------------------
// `myInterests` holds the FULL category objects the user picked. To style a
// dropdown item, we ask: is there one whose key matches?
//
//     myInterests.some(i => i.category_key === key)
//
// This is where we burned real time. Two wrong versions:
//   • myInterests.forEach(i => i.category_key === key)   // forEach ALWAYS
//       returns undefined → the check is always falsy, nothing ever highlights.
//   • myInterests.includes(key)                          // includes tests for an
//       exact element; the array holds OBJECTS, and object === "string" is never
//       true, so it's always false.
//
// Write isSelected(myInterests, key): return true iff some object in the array
// has category_key === key. Return a real boolean.
//
// CONCEPTS: `some(fn)` returns true/false and short-circuits on the first match;
// it can reach INSIDE each element (unlike `includes`, which only does `===` on
// whole elements). `forEach` returns undefined and is for side effects only.
// ============================================================================

function isSelected(myInterests, key) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
const mine = [
    { category_key: "mental_health", category_group: "healthcare" },
    { category_key: "student_debt",  category_group: "education" },
];

runTests("03 — is selected", [
    ["present -> true", () => isSelected(mine, "mental_health"), true],
    ["absent -> false", () => isSelected(mine, "climate_change"), false],
    ["empty -> false", () => isSelected([], "mental_health"), false],
    ["returns a real boolean", () => typeof isSelected(mine, "student_debt"), "boolean"],
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
