// ============================================================================
// PROBLEM 05 — Collision stagger (the anti-overlap algorithm we tried)
// ----------------------------------------------------------------------------
// Before switching to even spacing, we kept PROPORTIONAL positions and stopped
// labels overlapping by dropping close ones to lower rows. Given the points sorted
// left-to-right, each label takes the HIGHEST row whose last label is far enough
// away (>= minSep). If none qualifies, it opens a new row below.
//
//     const rowLastCenter = [];
//     const rowOf = positions.map((c) => {
//         for (let r = 0; r < rowLastCenter.length; r++) {
//             if (c - rowLastCenter[r] >= minSep) { rowLastCenter[r] = c; return r; }
//         }
//         rowLastCenter.push(c);
//         return rowLastCenter.length - 1;
//     });
//
// Write assignRows(positions, minSep): return the row index (0-based) for each
// position, where `positions` is already sorted ascending.
//
// CONCEPTS: (1) a greedy sweep — take the first row that fits, else make a new one;
// (2) `rowLastCenter[r]` remembers the rightmost label already in row r, so the gap
// check is O(rows) per point; (3) this is why the real bug was VERTICAL — a row's
// height must exceed a label's height or the rows still overlap (see the PDF).
// ============================================================================

function assignRows(positions, minSep) {
    // TODO
    let indexedSetWithRows = {}
    const rows = positions.map((p) => {
        for (let r = 0; r <= 3; r++){
            if (indexedSetWithRows[r] == null || p - indexedSetWithRows[r] >= minSep) {
                indexedSetWithRows[r] = p
                return r
            }
        }
    })
    return rows
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("05 — collision stagger", [
    ["spreads a tight cluster across rows",
        () => assignRows([0, 8, 31, 32, 39], 11), [0, 1, 0, 1, 2]],
    ["well-spaced points all stay in row 0",
        () => assignRows([0, 20, 40, 60], 11), [0, 0, 0, 0]],
    ["single point -> row 0", () => assignRows([50], 11), [0]],
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
