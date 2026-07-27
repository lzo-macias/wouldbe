// ============================================================================
// PROBLEM 07 — The close DELAY (a hover state machine)
// ----------------------------------------------------------------------------
// Because the menu is portaled to <body>, it is NOT a DOM child of the chip. So
// when you move the mouse from the chip toward the menu, the chip fires
// `mouseleave` — and a naive "close on leave" would snap the menu shut before you
// reach it.
//
// The fix is a DELAYED close: on leave, SCHEDULE a close; if the mouse enters the
// menu first, CANCEL it. In React that's a setTimeout stored in a ref. Here we
// model the same logic as a pure reducer over a fake clock (no real timers).
//
// state = { open: boolean, closeScheduled: boolean }
// actions:
//   "ENTER_CHIP"  -> open, cancel any pending close
//   "ENTER_MENU"  -> cancel the pending close (stay open)
//   "LEAVE"       -> schedule a close (still open for now)
//   "TICK"        -> the timer fires: if a close was scheduled, close it
//
// Write hoverReducer(state, action): return the next state object.
//
// CONCEPTS: the delay bridges the gap between two separate elements; entering the
// menu cancels the pending close so it stays open while you click items.
// ============================================================================

const START = { open: false, closeScheduled: false };

function hoverReducer(state, action) {
    // TODO: switch on action, return a NEW state object
}

// ---- tests (don't edit) ----------------------------------------------------
const enter = hoverReducer(START, "ENTER_CHIP");
const left  = hoverReducer(enter, "LEAVE");

runTests("07 — hover open/close", [
    ["enter chip -> open", () => hoverReducer(START, "ENTER_CHIP").open, true],
    ["leave -> still open, close scheduled", () => { const s = hoverReducer(enter, "LEAVE"); return [s.open, s.closeScheduled]; }, [true, true]],
    ["tick after leave -> closed", () => hoverReducer(left, "TICK").open, false],
    ["enter menu cancels the close, then tick keeps it open", () => {
        const kept = hoverReducer(left, "ENTER_MENU");
        return hoverReducer(kept, "TICK").open;
    }, true],
    ["tick with nothing scheduled -> unchanged open", () => hoverReducer(enter, "TICK").open, true],
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
