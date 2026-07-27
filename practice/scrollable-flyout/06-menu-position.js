// ============================================================================
// PROBLEM 06 — Rect -> fixed coordinates (place the portaled menu by hand)
// ----------------------------------------------------------------------------
// Because we portal the menu to <body> to escape the clip (problem 05), it's no
// longer auto-positioned by the chip. We position it ourselves: read the chip's
// box and drop the menu at its bottom-left.
//
//     const r = chipEl.getBoundingClientRect()
//     setPos({ top: r.bottom, left: r.left, minWidth: r.width })
//     // <ul style={{ position: 'fixed', top, left, minWidth }} />
//
// `getBoundingClientRect()` returns VIEWPORT-relative coordinates, which is
// exactly what `position: fixed` is measured against — so they line up with no
// scroll-offset math. `top = rect.bottom` puts the menu's top edge at the chip's
// bottom edge (i.e. directly underneath).
//
// Write menuPosition(rect): return { top, left, minWidth } where top is the
// chip's bottom, left is its left, and minWidth matches its width.
//
// CONCEPTS: viewport coords (getBoundingClientRect) pair with position:fixed;
// bottom-of-chip = top-of-menu = "underneath". minWidth keeps the menu at least
// as wide as the chip.
// ============================================================================

function menuPosition(rect) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
// a fake rect like the browser returns:
const rect = { top: 100, left: 40, right: 160, bottom: 132, width: 120, height: 32 };

runTests("06 — menu position", [
    ["top = chip bottom", () => menuPosition(rect).top, 132],
    ["left = chip left", () => menuPosition(rect).left, 40],
    ["minWidth = chip width", () => menuPosition(rect).minWidth, 120],
    ["shape is exactly {top,left,minWidth}", () => Object.keys(menuPosition(rect)).sort(),
        ["left", "minWidth", "top"]],
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
