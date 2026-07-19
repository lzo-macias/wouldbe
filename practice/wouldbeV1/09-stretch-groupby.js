// ============================================================================
// STRETCH 09 — groupBy (one-to-many bucketing)
// ----------------------------------------------------------------------------
// Problem 01 COUNTED into an object (key -> number). groupBy COLLECTS into an
// object (key -> array of the items). Same accumulate-into-an-object shape, but
// you push whole items into a bucket instead of adding 1.
//
// Part A — write a GENERIC groupBy(items, keyFn):
//     groupBy([1,2,3,4], n => n % 2 ? "odd" : "even")
//       => { odd: [1,3], even: [2,4] }
//   keyFn receives an item and returns the string bucket it belongs in.
//
// Part B — use it: groupOfficesByType(offices) buckets offices by office_type.
//   Each bucket is an array of the office objects, in original order.
// ============================================================================

function groupBy(items, keyFn) {
    // TODO: for each item, compute k = keyFn(item); push item into acc[k]
    //       (create acc[k] = [] the first time you see k)
}

function groupOfficesByType(offices) {
    // TODO: return groupBy(offices, o => o.office_type)
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFICES = [
    { id: "a", office_name: "Mayor", office_type: "executive" },
    { id: "b", office_name: "Council", office_type: "legislative" },
    { id: "c", office_name: "Judge", office_type: "judicial" },
    { id: "d", office_name: "Assembly", office_type: "legislative" },
];

runTests("09 — groupBy", [
    ["generic odd/even", () => groupBy([1, 2, 3, 4], n => n % 2 ? "odd" : "even"), { odd: [1, 3], even: [2, 4] }],
    ["empty -> {}", () => groupBy([], x => x), {}],
    ["offices by type keys", () => Object.keys(groupOfficesByType(OFFICES)).sort(), ["executive", "judicial", "legislative"]],
    ["legislative bucket has 2", () => groupOfficesByType(OFFICES).legislative.map(o => o.id), ["b", "d"]],
    ["executive bucket has 1", () => groupOfficesByType(OFFICES).executive.map(o => o.id), ["a"]],
]);

function runTests(title, cases) {
    console.log(`\n${title}`);
    let pass = 0;
    for (const [name, fn, expected] of cases) {
        let got;
        try { got = fn(); } catch (e) { got = `threw ${e.message}`; }
        const ok = JSON.stringify(got) === JSON.stringify(expected);
        console.log(`  ${ok ? "✓" : "✗"} ${name}`);
        if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(got)}`);
        if (ok) pass++;
    }
    console.log(`  ${pass}/${cases.length} passing`);
}
