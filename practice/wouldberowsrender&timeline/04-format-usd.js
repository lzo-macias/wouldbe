// ============================================================================
// PROBLEM 04 — Format the recommended goal (cents -> "$250,000")
// ----------------------------------------------------------------------------
// The goal is stored in the DB as an integer number of CENTS (money is never a
// float). The card's tag shows whole dollars with a thousands separator and a
// dollar sign. Intl does all of that for you:
//
//     (cents / 100).toLocaleString("en-US",
//         { style: "currency", currency: "USD", maximumFractionDigits: 0 });
//
// Write formatUSD(cents):
//   - Divide by 100 to get dollars, then format as USD currency.
//   - No cents shown (maximumFractionDigits: 0) — goals are round numbers.
//
// CONCEPTS: (1) store money as integer cents, format only at the edge; (2)
// toLocaleString with style:"currency" handles the "$", commas, and rounding — you
// almost never hand-roll this; (3) maximumFractionDigits:0 drops the ".00".
// ============================================================================

function formatUSD(cents) {
    // TODO
    return ((cents/100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0}))
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("04 — format USD", [
    ["state house goal", () => formatUSD(1500000), "$15,000"],
    ["us house goal", () => formatUSD(25000000), "$250,000"],
    ["ceiling", () => formatUSD(100000000), "$1,000,000"],
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
