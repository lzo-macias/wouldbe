// ============================================================================
// STRETCH 10 — The "cancelled" flag that prevents a stale setState
// ----------------------------------------------------------------------------
// Wouldbe.jsx rehydrates on mount, but if the component unmounts (or re-runs the
// effect) before the fetch resolves, calling setState would warn / use stale
// data. The guard is a `cancelled` flag flipped by the effect's cleanup:
//
//     useEffect(() => {
//         let cancelled = false;
//         async function rehydrate() {
//             const jur = await api.get('/api/users/me/jurisdictions');
//             if (cancelled) return;                    // bail — don't touch state
//             ...setQualifiedOffices(...)
//         }
//         rehydrate();
//         return () => { cancelled = true; };           // cleanup flips the flag
//     }, []);
//
// Write makeRehydrate(api, setOffices): return { run, cancel }.
//   - run():   await api.get('/api/offices/relevant'); if NOT cancelled, call
//              setOffices(res.data ?? []).
//   - cancel(): flip an internal flag so a later-resolving run() skips setOffices.
//
// CONCEPT: a closure variable (`cancelled`) shared between run() and cancel() is
// how you make an in-flight async result a no-op. The flag is captured per
// makeRehydrate call, exactly like `let cancelled` is captured per effect run.
//
// The test starts run(), immediately calls cancel(), then awaits — the setter
// must NOT have fired.
// ============================================================================

function makeRehydrate(api, setOffices) {
    // TODO: keep a `cancelled` flag in closure; return { run, cancel }
    let cancelled = false;

    async function run (){
        const res = await api.get('/api/offices/relevant')
        if (!cancelled) setOffices(res.data ?? [])
    }

    function cancel(){
        cancelled = true
    }

    return { run, cancel}
}

// ---- tests (don't edit) ----------------------------------------------------
const API = { async get() { return { data: [{ id: "o1" }] }; } };

runTests("10 — rehydrate cancelled", [
    ["not cancelled -> setter called",
        async () => { let v = null; const r = makeRehydrate(API, (x) => { v = x; }); await r.run(); return v; },
        [{ id: "o1" }]],
    ["cancelled before resolve -> setter NOT called",
        async () => { let called = false; const r = makeRehydrate(API, () => { called = true; }); const p = r.run(); r.cancel(); await p; return called; },
        false],
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
