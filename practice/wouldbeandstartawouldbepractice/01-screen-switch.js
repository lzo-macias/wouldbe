// ============================================================================
// PROBLEM 01 — screen switching + the "ready?" gate
// ----------------------------------------------------------------------------
// StartAnOffice.jsx holds a `screen` string ("1" | "2" | "3") and picks what to
// render from an OBJECT keyed by that string — not a chain of if/else:
//
//     const screens = { "1": <StartAWouldBe/>, "2": <Step2/>, "3": <Step3/> }
//     return individualOffice ? screens[screen] : <p>Loading…</p>
//
// Two tiny but load-bearing ideas live here:
//   • OBJECT-AS-SWITCH: `screens[key]` replaces a switch statement. Adding a step
//     is one more key, not another branch.
//   • THE GATE: you only index into `screens` AFTER the data exists, otherwise you
//     render a fallback. This is the same shape as Wouldbe's `!checkingJurisdictions
//     && <WouldBeRows/>`.
//
// Write:
//   pickScreen(screens, key)  -> screens[key], or screens["1"] if key is missing
//   gate(ready, content, fallback) -> content when ready, else fallback
//
// CONCEPTS: (1) an object literal is a lookup table; (2) `??`/`||` give a default
// branch; (3) gating render on a readiness flag avoids indexing undefined data.
// ============================================================================

function pickScreen(screens, key) {
    // TODO: return the entry for `key`; if there's no such key, fall back to "1".
    if (key in screens )return screens[key]
        return screens["1"]
}

function gate(ready, content, fallback) {
    // TODO: return content when ready is truthy, otherwise fallback.
    if (ready) return content
        return fallback
}

// ---- tests (don't edit) ----------------------------------------------------
const SCREENS = { "1": "start", "2": "step-two", "3": "step-three" };
runTests("01 — screen switch + gate", [
    ["picks current screen", () => pickScreen(SCREENS, "2"), "step-two"],
    ["falls back to '1' on unknown", () => pickScreen(SCREENS, "9"), "start"],
    ["falls back to '1' on undefined", () => pickScreen(SCREENS, undefined), "start"],
    ["gate shows content when ready", () => gate(true, "page", "Loading…"), "page"],
    ["gate shows fallback when not", () => gate(false, "page", "Loading…"), "Loading…"],
    ["gate treats null as not ready", () => gate(null, "page", "Loading…"), "Loading…"],
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
