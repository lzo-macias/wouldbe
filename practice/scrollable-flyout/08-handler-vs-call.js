// ============================================================================
// PROBLEM 08 — Pass a handler vs CALL it (the "Too many re-renders" bug)
// ----------------------------------------------------------------------------
// This one bit us five times across the app. An event prop wants a FUNCTION to
// call LATER:
//     onMouseEnter={open}          // ✅ hand React the function
//     onMouseEnter={() => open()}  // ✅ also fine (a new function that calls open)
//     onMouseEnter={open()}        // ❌ CALLS open() right now, during render,
//                                  //    and passes its RETURN VALUE as the handler
//
// When `open()` calls setState during render, React re-renders, which calls it
// again... -> "Too many re-renders." The earlier version literally had
// `onMouseEnter={setHovered(true)}`.
//
// Model the distinction with a side-effecting counter:
//   passHandler(fn): return fn itself WITHOUT calling it (correct — React calls it later)
//   callHandler(fn): return fn() — i.e. call it now and hand back the result (the bug)
//
// CONCEPTS: an event prop is a reference to call on the event; writing `fn()`
// evaluates during render. If that call sets state, you get an infinite loop.
// ============================================================================

function passHandler(fn) {
    // TODO: return the function reference, do NOT call it
}

function callHandler(fn) {
    // TODO: call it now, return whatever it returns (models the bug)
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("08 — handler vs call", [
    ["passHandler does not invoke", () => {
        let calls = 0;
        const f = () => { calls++; return "x"; };
        const returned = passHandler(f);
        return [calls, typeof returned];   // still 0, and we got a function back
    }, [0, "function"]],
    ["passHandler returns the SAME function", () => {
        const f = () => 1;
        return passHandler(f) === f;
    }, true],
    ["callHandler invokes immediately", () => {
        let calls = 0;
        const f = () => { calls++; return "ran"; };
        const returned = callHandler(f);
        return [calls, returned];          // called once, got its return value
    }, [1, "ran"]],
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
