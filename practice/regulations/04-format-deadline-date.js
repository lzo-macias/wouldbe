// ============================================================================
// PROBLEM 04 — Format a full ISO timestamp -> "Aug 7, 2026" (dodge the TZ slip)
// ----------------------------------------------------------------------------
// The deadline arrived from Postgres as a full UTC timestamp, not a bare date:
//
//     "2026-08-07T04:00:00.000Z"
//
// If you feed that straight into `new Date(...).toLocaleDateString()`, that 4 AM
// UTC can render as **Aug 6** in a negative-offset (US) timezone — an off-by-one.
// The shipped helper sidesteps it by SLICING off the time and keeping only the
// calendar date:
//
//     function formatDeadlineDate(iso) {
//         const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
//         return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
//     }
//
// Write formatDeadlineDate(value):
//   - `value` may be a full ISO timestamp OR a bare "YYYY-MM-DD". Take the first
//     10 chars (the calendar date) either way.
//   - Return it like "Aug 7, 2026".
//   - For a DETERMINISTIC test regardless of the machine's timezone/locale,
//     build the date as UTC (`...T00:00:00Z`) and format with
//     { year:"numeric", month:"short", day:"numeric", timeZone:"UTC" } and the
//     "en-US" locale. (The real component uses the browser's locale; here we pin
//     it so the test passes everywhere.)
//
// CONCEPTS: (1) a date-only value has NO timezone — slicing to 10 chars strips a
// UTC time that would otherwise shift the day; (2) `String(x).slice(0,10)` handles
// both the timestamp and the bare-date forms with one code path; (3) pin locale +
// timeZone when you need a stable, testable string.
// ============================================================================

function formatDeadlineDate(value) {
    // TODO
    const d = new Date(`${String(value).slice(0,10)}T00:00:0Z`)
    return d.toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"})
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("04 — format deadline date", [
    ["full UTC timestamp -> local calendar date, no slip", () => formatDeadlineDate("2026-08-07T04:00:00.000Z"), "Aug 7, 2026"],
    ["bare YYYY-MM-DD works too", () => formatDeadlineDate("2026-11-03"), "Nov 3, 2026"],
    ["midnight-UTC timestamp", () => formatDeadlineDate("2027-01-31T00:00:00.000Z"), "Jan 31, 2027"],
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
