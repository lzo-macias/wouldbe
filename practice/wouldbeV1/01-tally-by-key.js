// ============================================================================
// PROBLEM 01 — Tally by key
// ----------------------------------------------------------------------------
// In the component we did:
//     const officeCounts = {};
//     for (const rec of recs) {
//         officeCounts[rec.office_id] = (officeCounts[rec.office_id] ?? 0) + 1;
//     }
//
// Write countByOffice(recs): given an array of recommendation objects, return an
// object mapping each office_id -> how many recommendations have that office_id.
//
// Example:
//   countByOffice([{office_id:'a'},{office_id:'b'},{office_id:'a'}])
//   => { a: 2, b: 1 }
//
// Rules:
//   - An office_id you've never seen starts at 0 (use ?? 0), then +1.
//   - Return {} for an empty array.
// ============================================================================

function countByOffice(recs) {
    // TODO: your code here
    const recCounts = {}
    for (const rec of recs) {
        recCounts[rec.office_id] = (recCounts[rec.office_id] ?? 0) +1
    }
    return recCounts
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("01 — tally by key", [
    ["empty", () => countByOffice([]), {}],
    ["one", () => countByOffice([{ office_id: "a" }]), { a: 1 }],
    ["repeat", () => countByOffice([{ office_id: "a" }, { office_id: "b" }, { office_id: "a" }]), { a: 2, b: 1 }],
    ["all same", () => countByOffice([{ office_id: "x" }, { office_id: "x" }, { office_id: "x" }]), { x: 3 }],
]);

// tiny test runner shared by every problem file
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
