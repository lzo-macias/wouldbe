// ============================================================================
// PROBLEM 04 — Element progress through the viewport (ScrollTrigger's core)
// ----------------------------------------------------------------------------
// ScrollTrigger's whole job is turning "where is this element relative to the
// viewport" into a 0..1 you can scrub animations with. The classic window: the
// element enters from the BOTTOM of the viewport (progress 0) and leaves past the
// TOP (progress 1). Total travel distance = viewportHeight + elementHeight.
//
//     traveled = scrollY + viewportHeight - elementTop
//     progress = clamp(traveled / (viewportHeight + elementHeight), 0, 1)
//
// Write progress(scrollY, elementTop, elementHeight, viewportHeight):
//   - Return a value clamped to [0, 1].
//   - 0 when the element's top is exactly at the viewport bottom (just entering).
//   - 1 when the element's bottom has just passed the viewport top (fully gone).
//
// CONCEPTS: (1) progress is a normalized position, not pixels — resolution-
// independent; (2) the travel distance includes BOTH heights because the element
// crosses the entire screen plus its own size; (3) clamp so off-screen scroll
// positions stay pinned at 0 or 1 (that's how a scrubbed animation "holds").
// ============================================================================

function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

function progress(scrollY, elementTop, elementHeight, viewportHeight) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
// viewport 800 tall; element at y=1000, 400 tall. Travel = 800 + 400 = 1200.
runTests("04 — scroll progress", [
    ["just entering -> 0", () => progress(200, 1000, 400, 800), 0],
    ["fully gone -> 1", () => progress(1400, 1000, 400, 800), 1],
    ["halfway -> 0.5", () => progress(800, 1000, 400, 800), 0.5],
    ["above start clamps to 0", () => progress(0, 1000, 400, 800), 0],
    ["past end clamps to 1", () => progress(5000, 1000, 400, 800), 1],
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
