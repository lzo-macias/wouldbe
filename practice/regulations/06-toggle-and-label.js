// ============================================================================
// PROBLEM 06 — Toggle edit mode + derive the button label (functional updates)
// ----------------------------------------------------------------------------
// One button flips edit mode on and off, and its TEXT reflects the current state:
//
//     <button onClick={() => setallowHovered((v) => !v)}>
//         {allowHovered ? "Exit" : "Edit"}
//     </button>
//
// Two ideas here. (1) `setState((v) => !v)` — the FUNCTIONAL updater — flips the
// value based on the PREVIOUS state, which is the correct way to toggle (never
// `setState(!allowHovered)` inside handlers that might batch). (2) The label is
// DERIVED from state, not stored separately — one source of truth.
//
// Write two pure functions that model that logic:
//   - nextEditing(prev): return the toggled boolean.
//   - editLabel(editing): "Exit" when editing is true, "Edit" when false.
//
// CONCEPTS: (1) a toggle is `prev => !prev` — derive the next value FROM the
// previous, don't read possibly-stale outer state; (2) derive UI text from state
// instead of keeping a second "label" state that can drift out of sync.
// ============================================================================

function nextEditing(prev) {
    // TODO
    return !prev
}

function editLabel(editing) {
    // TODO
    return editing ? "Exit" : "Edit"
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("06 — toggle + label", [
    ["false -> true", () => nextEditing(false), true],
    ["true -> false", () => nextEditing(true), false],
    ["double toggle returns to start", () => nextEditing(nextEditing(false)), false],
    ["label when editing", () => editLabel(true), "Exit"],
    ["label when not editing", () => editLabel(false), "Edit"],
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
