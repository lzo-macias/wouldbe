// ============================================================================
// PROBLEM 05 — Partition offices into the three feed sections
// ----------------------------------------------------------------------------
// In relevant mode WouldBeRows splits the offices into three lists:
//     const qualified     = offices.filter((o) => o.qualifies);
//     const districtLater  = offices.filter((o) => !o.qualifies && o.relevance_tier === 'district');
//     const stateLater     = offices.filter((o) => !o.qualifies && o.relevance_tier !== 'district');
//
// Write partitionOffices(offices): return { qualified, districtLater, stateLater }.
//   - qualified:     qualifies === true (any tier)
//   - districtLater: NOT qualified AND tier === 'district'   (your own seats, later)
//   - stateLater:    NOT qualified AND tier !== 'district'   (statewide + national)
//
// Shapes:  office = { id, qualifies, relevance_tier }
//
// CONCEPT: partitioning = splitting one list into several by a predicate. Three
// `.filter` passes is the clear, readable way (each condition is obvious). A
// single `reduce` pass does it in one loop — that's the stretch (problem 11).
// ============================================================================

function partitionOffices(offices) {
    // TODO: return { qualified, districtLater, stateLater }

    const qualified = offices.filter((o) => o.qualifies)

    const districtLater = offices.filter((o) => {
        return !o.qualifies && o.relevance_tier === 'district'
    })

    const stateLater = offices.filter((o) => !o.qualifies && o.relevance_tier !== 'district');

    return { qualified, districtLater, stateLater}
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFS = [
    { id: "a", qualifies: true, relevance_tier: "district" },
    { id: "b", qualifies: false, relevance_tier: "district" },
    { id: "c", qualifies: false, relevance_tier: "statewide" },
    { id: "d", qualifies: false, relevance_tier: "national" },
    { id: "e", qualifies: true, relevance_tier: "statewide" },
];
const ids = (p) => ({
    qualified: p.qualified.map((o) => o.id),
    districtLater: p.districtLater.map((o) => o.id),
    stateLater: p.stateLater.map((o) => o.id),
});

runTests("05 — partition", [
    ["three buckets", () => ids(partitionOffices(OFFS)),
        { qualified: ["a", "e"], districtLater: ["b"], stateLater: ["c", "d"] }],
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
