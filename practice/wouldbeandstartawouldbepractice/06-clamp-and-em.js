// ============================================================================
// PROBLEM 06 — relative units, as numbers (clamp() and em)
// ----------------------------------------------------------------------------
// Two CSS units in these pages are easiest to trust once you can COMPUTE them.
//
// 1) clamp(min, preferred, max) — the responsive headline:
//        font-size: clamp(24px, 3.4vw, 38px);
//    `3.4vw` = 3.4% of the viewport width. The browser evaluates the middle at the
//    current viewport, then pins it between min and max. So the effective size is
//    clamp(min, viewportPx * vw/100, max).
//
// 2) em — the gray subtitle sizes RELATIVE to the headline:
//        .headlineText { font-size: 0.55em; }   /* 0.55 x the parent's font-size */
//    `1em` = the element's inherited font-size. `0.55em` of a 38px headline = 20.9px.
//
// Write:
//   cssClamp(minPx, vw, maxPx, viewportPx) -> effective px of clamp(min, vw%*vp, max)
//   emToPx(em, parentPx)                   -> em * parentPx
//
// CONCEPTS: (1) clamp = a fluid value fenced by a floor and ceiling; (2) vw is a
// slice of viewport width; (3) em multiplies the inherited font-size — change the
// parent and every em-sized child scales with it.
// ============================================================================

function cssClamp(minPx, vw, maxPx, viewportPx) {
    // TODO: preferred = viewportPx * vw / 100; return it clamped to [minPx, maxPx].
    const preferred = viewportPx * vw / 100
    if (minPx > preferred) return minPx
    else if (maxPx < preferred) return maxPx
    else return preferred 
}

function emToPx(em, parentPx) {
    // TODO
    return em * parentPx
}

// ---- tests (don't edit) ----------------------------------------------------
const approx = (v) => Math.round(v * 100) / 100;
runTests("06 — clamp + em", [
    ["clamp picks preferred midrange", () => cssClamp(24, 3.4, 38, 1000), 34],
    ["clamp floors on a narrow screen", () => cssClamp(24, 3.4, 38, 500), 24],
    ["clamp ceils on a wide screen", () => cssClamp(24, 3.4, 38, 2000), 38],
    ["0.55em of a 38px headline", () => approx(emToPx(0.55, 38)), 20.9],
    ["1em is the parent size", () => emToPx(1, 16), 16],
    ["1.1em logo vs 24px line", () => approx(emToPx(1.1, 24)), 26.4],
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
