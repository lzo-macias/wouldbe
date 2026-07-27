// ============================================================================
// PROBLEM 03 — Easing curves (the difference between "moves" and "feels good")
// ----------------------------------------------------------------------------
// Linear motion reads as robotic. GSAP tweens and Lenis' `easing` option reshape
// a 0..1 time value into a 0..1 eased value — starting/ending with the right
// acceleration. Two workhorses:
//
//   easeOutExpo   — rockets out, glides to a stop (great for reveals/scroll)
//     t => t === 1 ? 1 : 1 - 2 ** (-10 * t)
//
//   easeInOutCubic — slow, fast, slow (great for symmetric moves)
//     t => t < 0.5 ? 4*t*t*t : 1 - (-2*t + 2) ** 3 / 2
//
// Write both. Inputs/outputs are 0..1. Keep the exact formulas above.
//
// CONCEPTS: (1) easing maps time->progress; the shape IS the personality of the
// motion; (2) "out" = fast then slow (decelerate), "in" = slow then fast; (3) the
// same tween duration with a different curve feels completely different — that's
// most of what "premium motion" is.
// ============================================================================

function easeOutExpo(t) {
    // TODO
}

function easeInOutCubic(t) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("03 — easing", [
    ["expo starts at 0", () => easeOutExpo(0), 0],
    ["expo ends at 1", () => easeOutExpo(1), 1],
    ["expo is fast early: e(0.1)=0.5", () => easeOutExpo(0.1), 0.5],
    ["cubic starts at 0", () => easeInOutCubic(0), 0],
    ["cubic ends at 1", () => easeInOutCubic(1), 1],
    ["cubic symmetric midpoint", () => easeInOutCubic(0.5), 0.5],
    ["cubic early quarter", () => easeInOutCubic(0.25), 0.0625],
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
