// ============================================================================
// PROBLEM 03 — the `cancelled` flag (don't apply a stale async result)
// ----------------------------------------------------------------------------
// Wouldbe.jsx's rehydrate effect fetches jurisdictions, then offices, then calls
// setState. But an effect can be superseded (deps change / component unmounts)
// BEFORE its awaits finish. Writing state then would warn and can flash stale UI.
// The guard:
//
//     useEffect(() => {
//       let cancelled = false
//       async function run() {
//         const data = await slowFetch()
//         if (cancelled) return            // <- superseded: drop the result
//         setState(data)
//       }
//       run()
//       return () => { cancelled = true }  // cleanup flips the flag
//     }, [deps])
//
// We model the flag with a plain object so it's node-testable. `applyIfLive`
// writes ONLY while the run is still live.
//
// Write:
//   applyIfLive(run, value)  -> push `value` into run.applied, but ONLY if
//                               run.cancelled is false (no-op once cancelled)
//   cancel(run)              -> mark run.cancelled = true
//
// CONCEPTS: (1) async results can arrive after they're irrelevant; (2) a closure
// flag flipped by cleanup lets a late result no-op itself; (3) this is a race
// guard, not a way to stop the fetch (the request still completes).
// ============================================================================

function applyIfLive(run, value) {
    // TODO: if run is still live, record value into run.applied.
    if (!run.cancelled) run.applied.push(value)
}

function cancel(run) {
    // TODO: mark the run cancelled.
    run.cancelled = true
}

// ---- tests (don't edit) ----------------------------------------------------
function newRun() { return { cancelled: false, applied: [] }; }
runTests("03 — cancelled flag", [
    ["applies while live", () => { const r = newRun(); applyIfLive(r, "a"); return r.applied; }, ["a"]],
    ["no-op after cancel", () => { const r = newRun(); cancel(r); applyIfLive(r, "a"); return r.applied; }, []],
    ["live then cancelled", () => { const r = newRun(); applyIfLive(r, "a"); cancel(r); applyIfLive(r, "b"); return r.applied; }, ["a"]],
    ["cancel sets the flag", () => { const r = newRun(); cancel(r); return r.cancelled; }, true],
    ["two runs are independent", () => { const a = newRun(), b = newRun(); cancel(a); applyIfLive(a, "x"); applyIfLive(b, "y"); return [a.applied, b.applied]; }, [[], ["y"]]],
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
