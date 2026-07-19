// ============================================================================
// PROBLEM 02 — Proportional position (place a date on the [earliest, latest] track)
// ----------------------------------------------------------------------------
// The FIRST timeline design spaced every point by its real date, so the gap
// between two ticks reflected the actual time between them. To place a date you
// map it onto the span from the earliest to the latest date and return a percent:
//
//     pos = (thisDate - min) / (max - min) * 100
//
// Write positionPct(dateISO, allDatesISO):
//   - Convert each "YYYY-MM-DD" to a number with new Date(`${iso}T00:00:00`).getTime().
//   - Return where dateISO sits across [min(all), max(all)] as a 0–100 percent.
//   - If every date is the same (span 0), return 50 (avoid divide-by-zero).
//
// Shapes:  dateISO = "YYYY-MM-DD",  allDatesISO = ["YYYY-MM-DD", …]
//
// CONCEPTS: (1) date → milliseconds so you can do arithmetic; (2) appending
// "T00:00:00" parses as LOCAL midnight (the offset cancels out in a ratio, and it
// dodges the UTC off-by-one that bites date-only strings); (3) guard the span so a
// single-date office doesn't divide by zero.
// ============================================================================

function positionPct(dateISO, allDatesISO) {
    // TODO

    //setting function to change dates into milliseconds so i can do arithimitic
    const ms = (iso) => new Date(`${iso}T00:00:00`).getTime()
    //calls function and sets every date in milliseconds
    const newDates = allDatesIso.map(ms);
    const min = Math.min(...newDates);
    const max = Math.max(...newDates);
    if (max === min) return 50;

    return (ms(dateISO) - min / (max - min) * 100)
}

// ---- tests (don't edit) ----------------------------------------------------
const DATES = ["2026-01-01", "2026-01-11", "2026-01-21"]; // 10 days apart each

runTests("02 — proportional position", [
    ["earliest -> 0", () => positionPct("2026-01-01", DATES), 0],
    ["latest -> 100", () => positionPct("2026-01-21", DATES), 100],
    ["midpoint -> 50", () => positionPct("2026-01-11", DATES), 50],
    ["all same date -> 50", () => positionPct("2026-05-05", ["2026-05-05", "2026-05-05"]), 50],
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
