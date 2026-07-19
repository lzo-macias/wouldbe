// ============================================================================
// PROBLEM 03 — Even spacing (the design we shipped)
// ----------------------------------------------------------------------------
// Proportional spacing (problem 02) looks honest but bunches labels when dates
// cluster — and then they overlap. The final design drops strict proportionality:
// it spaces the points EVENLY in chronological order, so with every name + date
// always shown, no two labels can collide and the card stays a fixed size.
//
//     leftPct(i) = n === 1 ? 50 : (i / (n - 1)) * 100
//
// Write evenPct(i, n):
//   - Return the left-offset percent (0–100) of the i-th of n evenly-spaced points.
//   - First point (i=0) -> 0, last (i=n-1) -> 100.
//   - A lone point (n=1) -> 50 (centered), and never divide by zero.
//
// CONCEPTS: (1) evenly dividing a track into n-1 gaps, not n; (2) the n===1 guard
// mirrors the span===0 guard from problem 02 — both prevent a /0; (3) why we traded
// "truthful spacing" for "guaranteed legibility + fixed card height."
// ============================================================================

function evenPct(i, n) {
    // TODO
    return n === 1 ? 50: (i / (n - 1)) * 100
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("03 — even spacing", [
    ["first of 5 -> 0", () => evenPct(0, 5), 0],
    ["middle of 5 -> 50", () => evenPct(2, 5), 50],
    ["last of 5 -> 100", () => evenPct(4, 5), 100],
    ["lone point -> 50", () => evenPct(0, 1), 50],
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
