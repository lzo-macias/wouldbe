// ============================================================================
// PROBLEM 05 — Why the dropdown got clipped (the CSS overflow rule, as logic)
// ----------------------------------------------------------------------------
// The slider scrolls sideways, so it has `overflow-x: auto`. We tried to let the
// dropdown hang below it with `overflow-y: visible` — and it STILL got clipped.
//
// The CSS spec rule: if either axis of `overflow` is a non-`visible` value
// (auto | scroll | hidden), then a `visible` on the OTHER axis is treated as
// `auto`. So `overflow-x: auto; overflow-y: visible` → overflow-y COMPUTES to
// `auto`, which clips anything spilling out vertically — including our flyout.
//
// Model it with two pure functions:
//   computedOverflowY(overflowX, overflowY): apply the rule above and return the
//     COMPUTED overflow-y. (Simplify: treat only 'visible' as visible; any other
//     string counts as non-visible.)
//   clipsBelowFlyout(overflowX, overflowY): true if a child hanging BELOW the box
//     would be clipped — i.e. the computed overflow-y is NOT 'visible'.
//
// CONCEPTS: a scroll container clips at its padding box; you cannot have real
// horizontal scroll AND a visible vertical overflow on the same element. That's
// exactly why the fix is to render the menu OUTSIDE this element (a portal).
// ============================================================================

function computedOverflowY(overflowX, overflowY) {
    // TODO
}

function clipsBelowFlyout(overflowX, overflowY) {
    // TODO (use computedOverflowY)
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("05 — overflow clip rule", [
    ["auto x + visible y -> computes auto", () => computedOverflowY("auto", "visible"), "auto"],
    ["visible x + visible y -> stays visible", () => computedOverflowY("visible", "visible"), "visible"],
    ["hidden x + visible y -> computes auto", () => computedOverflowY("hidden", "visible"), "auto"],
    ["auto x + hidden y -> stays hidden", () => computedOverflowY("auto", "hidden"), "hidden"],
    ["scroll slider clips the flyout", () => clipsBelowFlyout("auto", "visible"), true],
    ["fully visible does NOT clip", () => clipsBelowFlyout("visible", "visible"), false],
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
