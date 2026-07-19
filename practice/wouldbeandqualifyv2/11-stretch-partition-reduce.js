// ============================================================================
// STRETCH 11 — Partition in ONE pass with reduce
// ----------------------------------------------------------------------------
// Problem 05 used three `.filter` passes (three loops over the array). `reduce`
// does the same split in a single loop by folding into an accumulator object.
//
// Write partitionReduce(offices): same result as problem 05 —
//   { qualified, districtLater, stateLater } — but built with ONE offices.reduce.
//
// Rules (identical to 05):
//   - qualifies === true            -> qualified
//   - !qualifies && tier==='district' -> districtLater
//   - !qualifies && tier!=='district' -> stateLater
//
// Shapes:  office = { id, qualifies, relevance_tier }
//
// CONCEPT: reduce with an OBJECT accumulator. Seed it with all three empty arrays
// (`{ qualified: [], districtLater: [], stateLater: [] }`), push into the right
// one each iteration, and RETURN the accumulator every step. Three filters read
// clearer; reduce is one pass (better when the list is huge or you want a single
// traversal). Same output, different tradeoff — good to have both in the toolkit.
// ============================================================================

// function partitionReduce(offices) {
//     return offices.reduce((acc, o) => { 
//         if (o.qualifies) acc.qualified.push(o); 
//         else if (o.relevance_tier === "district") acc.districtLater.push(o);
//         else acc.stateLater.push(o);
//         return acc;
//     }, { qualified: [], districtLater: [], stateLater: [] });
// }

function partitionReduceV2(offices){
    return offices.reduce((acc, o) => {
        if (o.qulifies) acc.qualified.push(o)
        else if (o.relevance_tier === "district") acc.districtLater.push(o)
        else acc.stateLater.push(0)
    }, {qualifies: [], districtLater: [], stateLater: []})
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFS = [
    { id: "a", qualifies: true, relevance_tier: "district" },
    { id: "b", qualifies: false, relevance_tier: "district" },
    { id: "c", qualifies: false, relevance_tier: "statewide" },
];
const ids = (p) => ({
    qualified: p.qualified.map((o) => o.id),
    districtLater: p.districtLater.map((o) => o.id),
    stateLater: p.stateLater.map((o) => o.id),
});

runTests("11 — partition via reduce", [
    ["same result as the filter version", () => ids(partitionReduce(OFFS)),
        { qualified: ["a"], districtLater: ["b"], stateLater: ["c"] }],
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
