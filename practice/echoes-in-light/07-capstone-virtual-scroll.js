// ============================================================================
// PROBLEM 07 — CAPSTONE: a mini-Lenis (virtual scroll model)
// ----------------------------------------------------------------------------
// Combine 01 (damp), 05 (the idea of easing toward a target), and 06 (the loop)
// into the thing that makes his page feel the way it does: a virtual scroll.
//
// The model:
//   state = { scroll, target, velocity }
//   - A wheel event doesn't move `scroll` — it moves `target` (clamped to the
//     scrollable range [0, max]).
//   - Every frame, `scroll` eases toward `target`; `velocity` is how far it moved
//     this frame (drives blur/shader distortion elsewhere).
//
// Write:
//   makeState(max)                 -> { scroll:0, target:0, velocity:0, max }
//   wheel(state, delta)            -> new state with target += delta, clamped [0,max]
//   tick(state, lerp)              -> new state where
//                                       scroll   = damp(scroll, target, lerp)
//                                       velocity = newScroll - oldScroll
//   run(max, deltas, ticksPer, lerp) -> array of `scroll` after each tick, applying
//                                       one wheel(delta) then `ticksPer` ticks, per delta
//
// Treat state as IMMUTABLE (return new objects) so the trace is easy to reason about.
//
// CONCEPTS: (1) the target/scroll split IS the smoothing — input sets a goal, the
// loop chases it; (2) clamping target (not scroll) keeps momentum from fighting the
// page bounds; (3) velocity falls off as you approach target — that decaying speed
// is what a scroll-reactive shader reads to add motion blur.
// ============================================================================

function damp(cur, tgt, f) { return cur + (tgt - cur) * f; }
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function makeState(max) {
    // TODO
}

function wheel(state, delta) {
    // TODO
}

function tick(state, lerp) {
    // TODO
}

function run(max, deltas, ticksPer, lerp) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("07 — mini-Lenis virtual scroll", [
    ["wheel sets target, not scroll", () => {
        const s = wheel(makeState(1000), 100);
        return [s.scroll, s.target];
    }, [0, 100]],
    ["target clamps to max", () => wheel(makeState(1000), 5000).target, 1000],
    ["target clamps to 0", () => wheel(makeState(1000), -50).target, 0],
    ["tick eases scroll toward target", () => {
        const s = tick(wheel(makeState(1000), 100), 0.5);
        return [s.scroll, s.velocity];
    }, [50, 50]],
    ["velocity decays as it settles", () => {
        let s = wheel(makeState(1000), 100);
        s = tick(s, 0.5); const v1 = s.velocity;   // 50
        s = tick(s, 0.5); const v2 = s.velocity;   // 25
        return v1 > v2 && v2 > 0;
    }, true],
    ["run traces eased scroll per tick", () => run(1000, [100], 3, 0.5), [50, 75, 87.5]],
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
