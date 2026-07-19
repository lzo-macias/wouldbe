// ============================================================================
// PROBLEM 03 — Immutable sort with a tie-breaker
// ----------------------------------------------------------------------------
// In the component:
//     const ranked = [...offs].sort((a, b) => {
//         const diff = (officeCounts[b.id] ?? 0) - (officeCounts[a.id] ?? 0);
//         return diff !== 0 ? diff : a.office_name.localeCompare(b.office_name);
//     });
//
// Write rankOffices(offices, counts): return a NEW array sorted by:
//     1. recommendation count DESCENDING  (counts[office.id], default 0)
//     2. then office_name A→Z as a tie-breaker (use localeCompare)
//
// Two things being tested here:
//   - IMMUTABILITY: do NOT mutate the input `offices` array. `.sort()` sorts in
//     place, so copy first with [...offices] (or offices.slice()).
//   - COMPARATOR math: for DESCENDING numbers, return b - a. For A→Z strings,
//     return a.localeCompare(b).
//
// Example: office 'a' has 2 recs, 'b' has 5, 'c' has 2.
//   order by count desc -> b(5), then a & c tie at 2 -> break by name -> a, c
// ============================================================================

function rankOffices(offices, counts) {
    // TODO: your code here
    const ranked = 
        offices.sort((a,b) => {
            return (counts[b.id]?? 0) - (counts[a.id]?? 0)
        })
    return ranked
}

function rankOfficesV2(offices, counts) {
    const ranked = 
        offices.sort((a, b) => {
            const diff = (counts[b.id] ?? 0) - (counts[a.id] ?? 0)
            return diff !== 0 ? diff : a.office_name.localeCompare(b.office_name);
        })
    return ranked
}
// ---- tests (don't edit) ----------------------------------------------------
const OFFICES = [
    { id: "a", office_name: "Assessor" },
    { id: "b", office_name: "Mayor" },
    { id: "c", office_name: "Council" },
];
const COUNTS = { a: 2, b: 5, c: 2 };

runTests("03 — immutable sort", [
    ["sorted ids", () => rankOffices(OFFICES, COUNTS).map(o => o.id), ["b", "a", "c"]],
    ["missing count = 0", () => rankOffices(
        [{ id: "x", office_name: "Zed" }, { id: "y", office_name: "Amy" }], {}
    ).map(o => o.id), ["y", "x"]], // both 0, tie-break by name Amy<Zed
    ["does NOT mutate input", () => {
        const input = [...OFFICES];
        const before = input.map(o => o.id).join(",");
        rankOffices(input, COUNTS);
        return input.map(o => o.id).join(",") === before; // input order unchanged?
    }, true],
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
