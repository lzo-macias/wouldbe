// ============================================================================
// PROBLEM 07 — Pass a handler, don't CALL it (the bug we hit five times)
// ----------------------------------------------------------------------------
// This bug showed up again and again while building the component:
//
//     onClick={onComplete()}                 // ❌ runs NOW, during render
//     onMouseEnter={setEditBtnHovered(true)} // ❌ runs NOW, during render
//     onClick={navigate(`/wouldbe/...`)}     // ❌ runs NOW, during render
//
// `onClick={fn()}` CALLS fn while rendering and hands React the RETURN value as
// the "handler". If fn sets state, you get "Cannot update a component while
// rendering" / an infinite loop. The fix is to hand React a FUNCTION it can call
// later, on the event:
//
//     onClick={() => onComplete()}           // ✅ runs on click
//     onClick={onComplete}                   // ✅ also fine when it takes no args
//
// Model the correct pattern as a factory. Write makeHandler(fn, ...args):
//   - Return a NEW function that, WHEN CALLED, invokes fn(...args) and returns
//     its result.
//   - Crucially, calling makeHandler itself must NOT invoke fn yet — only calling
//     the returned function does. (That's the whole difference between
//     `onClick={fn()}` and `onClick={() => fn()}`.)
//
// CONCEPTS: (1) a function VALUE (`() => fn()`) vs a function CALL (`fn()`) — JSX
// event props want the value; (2) closures capture args for "call it later";
// (3) deferring the side effect off render is what keeps React happy.
// ============================================================================

function makeHandler(fn, ...args) {
    // TODO
    return () => fn(...args);
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("07 — pass a handler, don't call it", [
    ["making the handler does NOT call fn yet", () => {
        let calls = 0;
        makeHandler(() => { calls++; });     // building it must not fire fn
        return calls;
    }, 0],
    ["calling the returned handler fires fn once", () => {
        let calls = 0;
        const h = makeHandler(() => { calls++; });
        h();
        return calls;
    }, 1],
    ["bound args are passed through, result returned", () => {
        const h = makeHandler((a, b) => a + b, 2, 3);
        return h();
    }, 5],
    ["each event re-invokes (called twice -> fired twice)", () => {
        let calls = 0;
        const h = makeHandler(() => { calls++; });
        h(); h();
        return calls;
    }, 2],
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
