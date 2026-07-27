// ============================================================================
// PROBLEM 05 — Frame-rate-INDEPENDENT damping (why it feels the same on any Hz)
// ----------------------------------------------------------------------------
// Problem 01's `damp(cur, tgt, 0.1)` moves 10% PER FRAME. On a 120 Hz display
// that's twice as many frames per second as 60 Hz, so the scroll converges twice
// as fast — the feel changes with the monitor. Not acceptable for "premium."
//
// The fix is exponential damping driven by ELAPSED TIME (dt), not frame count:
//
//     next = target + (current - target) * Math.exp(-lambda * dt)
//
// `lambda` sets the stiffness; `dt` is seconds since the last frame. Now the
// value decays toward target on a real-time clock, identical at any frame rate.
// (This is the idea behind gsap's time-based tweens and Lenis' internal timing.)
//
// Write dampDt(current, target, lambda, dt):
//   - Return `current` unchanged when dt is 0 (no time passed).
//   - Return `target` when already there.
//   - Otherwise apply the exponential formula above.
//
// CONCEPTS: (1) tie motion to TIME, not frames, or behavior forks across devices;
// (2) exponential decay never quite arrives but gets imperceptibly close — that's
// the natural "settle"; (3) `dt` comes from the rAF timestamp delta each frame.
// ============================================================================

function dampDt(current, target, lambda, dt) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

runTests("05 — frame-rate-independent damp", [
    ["dt=0 -> unchanged", () => dampDt(30, 100, 5, 0), 30],
    ["already at target", () => dampDt(100, 100, 5, 0.016), 100],
    ["lambda*dt = ln2 -> halfway", () => round(dampDt(0, 100, Math.LN2, 1)), 50],
    ["bigger dt -> closer to target", () => round(dampDt(0, 100, Math.LN2, 2)), 75],
    ["decays toward target (monotonic)", () => {
        const a = dampDt(0, 100, 3, 0.016);
        const b = dampDt(a, 100, 3, 0.016);
        return b > a && b < 100;
    }, true],
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
