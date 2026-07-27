// ============================================================================
// PROBLEM 02 — clamp + mapRange (scroll progress -> any animated value)
// ----------------------------------------------------------------------------
// Once you have a scroll progress (0..1), you drive everything off it: opacity,
// a Y offset, a shader uniform, a rotation. That's a RANGE REMAP — take a value
// in one range and rescale it into another:
//
//     opacity = mapRange(progress, 0, 1, 0, 1);
//     y       = mapRange(progress, 0, 1, 100, 0);   // slide up as you scroll
//     blur    = mapRange(velocity, 0, 40, 0, 8);    // faster scroll = more blur
//
// And you clamp so out-of-range input can't overshoot.
//
// Write:
//   clamp(v, min, max)                          -> v pinned into [min, max]
//   mapRange(v, inMin, inMax, outMin, outMax)   -> v rescaled to the out range
//                                                  (no clamping here)
//
// CONCEPTS: (1) normalize then scale: `(v-inMin)/(inMax-inMin)` gives a 0..1
// position, multiply by the out span and add outMin; (2) mapRange can invert
// (outMin > outMax) to run a value backwards; (3) clamp guards the edges so a
// progress of 1.2 doesn't push opacity past 1.
// ============================================================================

function clamp(v, min, max) {
    // TODO
}

function mapRange(v, inMin, inMax, outMin, outMax) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("02 — clamp + mapRange", [
    ["clamp inside", () => clamp(5, 0, 10), 5],
    ["clamp low", () => clamp(-2, 0, 10), 0],
    ["clamp high", () => clamp(99, 0, 10), 10],
    ["progress -> percent", () => mapRange(0.5, 0, 1, 0, 100), 50],
    ["center of -1..1", () => mapRange(5, 0, 10, -1, 1), 0],
    ["inverted range (slide up)", () => mapRange(0.25, 0, 1, 100, 0), 75],
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
