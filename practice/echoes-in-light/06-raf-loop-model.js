// ============================================================================
// PROBLEM 06 — The single RAF loop (one clock drives everything)
// ----------------------------------------------------------------------------
// His smoothness isn't just the lerp — it's that ONE loop advances the whole
// system every frame, in order:
//
//     gsap.ticker.add((time) => {
//         lenis.raf(time * 1000);   // 1) advance the smoothed scroll
//     });                           // 2) lenis emits 'scroll' -> ScrollTrigger.update()
//                                   // 3) the WebGL render reads the new scroll
//     gsap.ticker.lagSmoothing(0);  // don't let gsap fudge the clock
//
// One rAF, deterministic order, no two systems fighting over the frame. Model the
// stepping part: repeatedly damp a value toward a target and return the trace.
//
// Write stepToward(start, target, factor, frames):
//   - Apply `damp` (value += (target - value) * factor) `frames` times.
//   - Return the value AFTER that many frames.
// Also write trace(start, target, factor, frames):
//   - Return an array of the value after each frame (length === frames).
//
// CONCEPTS: (1) animation = a value nudged toward a target once per frame in a
// loop — that loop is the rAF; (2) the same helper (damp) called every frame is
// the entire engine; (3) capturing the per-frame trace is how you reason about
// "does it converge / overshoot / stall" without opening a browser.
// ============================================================================

function damp(cur, tgt, f) {
    return cur + (tgt - cur) * f;
}

function stepToward(start, target, factor, frames) {
    // TODO
}

function trace(start, target, factor, frames) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("06 — single RAF loop model", [
    ["1 frame (50% of 0->100)", () => stepToward(0, 100, 0.5, 1), 50],
    ["2 frames", () => stepToward(0, 100, 0.5, 2), 75],
    ["3 frames", () => stepToward(0, 100, 0.5, 3), 87.5],
    ["trace records each frame", () => trace(0, 100, 0.5, 3), [50, 75, 87.5]],
    ["converges close after many frames", () => stepToward(0, 100, 0.5, 20) > 99.99, true],
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
