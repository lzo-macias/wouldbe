// ============================================================================
// PROBLEM 05 — the math that DRIVES the CSS (rail progress %)
// ----------------------------------------------------------------------------
// The gold "you are here" rail is pure CSS — a linear-gradient with a hard color
// stop at `var(--progress)`. But WHERE that stop sits is computed in JS and handed
// to CSS as an inline custom property:
//
//     <div className="rail" style={{ '--progress': `${progress}%` }} />
//
// Nodes sit centered in equal grid cells, so node i's CENTER is at
// (i + 0.5)/n of the track width. But the rail is inset 5.5% on each side, so its
// own width is 89%. We convert the node center into a position along the RAIL:
//
//     centerPct = (i + 0.5) / n * 100
//     progress  = clamp(0, 100, (centerPct - inset) / (100 - 2*inset) * 100)
//
// Write:
//   clamp(min, max, v)             -> v pinned into [min, max]
//   nodeCenterPct(i, n)            -> (i + 0.5) / n * 100
//   railProgress(centerPct, inset) -> the clamped rail % above (inset default 5.5)
//
// CONCEPTS: (1) layout data computed in JS becomes a CSS variable — the boundary
// between the two languages; (2) remap a value from one coordinate space (whole
// track) into another (the inset rail); (3) clamp guards the 0..100 range.
// ============================================================================

function clamp(min, max, v) {
    // TODO
    if (min > v) return min
    else if (max < v) return max
    else return v
}

function nodeCenterPct(i, n) {
    // TODO
    return ((i + 0.5) / n * 100)
}

function railProgress(centerPct, inset = 5.5) {
    // TODO: map centerPct from [inset, 100-inset] onto [0, 100], then clamp.
    return clamp (0, 100, (centerPct - inset) / (100 - 2 * inset) * 100)
}

// ---- tests (don't edit) ----------------------------------------------------
const approx = (v) => Math.round(v * 100) / 100;
runTests("05 — rail progress %", [
    ["clamp low", () => clamp(0, 100, -5), 0],
    ["clamp high", () => clamp(0, 100, 130), 100],
    ["clamp passthrough", () => clamp(0, 100, 42), 42],
    ["center of first of 4", () => nodeCenterPct(0, 4), 12.5],
    ["center of last of 4", () => nodeCenterPct(3, 4), 87.5],
    ["rail progress at left edge inset", () => railProgress(5.5), 0],
    ["rail progress at right edge inset", () => railProgress(94.5), 100],
    ["rail progress midway", () => approx(railProgress(50)), approx((50 - 5.5) / 89 * 100)],
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
