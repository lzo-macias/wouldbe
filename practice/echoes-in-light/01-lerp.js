// ============================================================================
// PROBLEM 01 — lerp + damp (the heartbeat of smooth scroll)
// ----------------------------------------------------------------------------
// Native scroll jumps the page to the exact wheel position. Lenis instead keeps
// a `target` and eases the real `scroll` TOWARD it a fraction each frame:
//
//     scroll = scroll + (target - scroll) * factor;   // every animation frame
//
// That single line is why his scroll feels like heavy glass instead of a step
// function. `lerp(a, b, t)` is the general form; `damp` is the per-frame version
// where `a` is where you are and `b` is where you're headed.
//
// Write:
//   lerp(a, b, t)      -> a + (b - a) * t     (t=0 -> a, t=1 -> b)
//   damp(cur, tgt, f)  -> move `cur` a fraction `f` toward `tgt` (same math)
//
// CONCEPTS: (1) interpolation blends two values by a 0..1 weight; (2) applied
// every frame with a small factor, it becomes exponential easing — fast then
// slow — the "glide"; (3) damp is just lerp(cur, tgt, f) renamed for the loop.
// ============================================================================

function lerp(a, b, t) {
    // TODO
}

function damp(cur, tgt, f) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("01 — lerp + damp", [
    ["midpoint", () => lerp(0, 10, 0.5), 5],
    ["t=0 -> a", () => lerp(0, 10, 0), 0],
    ["t=1 -> b", () => lerp(0, 10, 1), 10],
    ["quarter of 10..20", () => lerp(10, 20, 0.25), 12.5],
    ["damp one step (10% of 0->100)", () => damp(0, 100, 0.1), 10],
    ["damp two steps converges", () => damp(damp(0, 100, 0.5), 100, 0.5), 75],
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
