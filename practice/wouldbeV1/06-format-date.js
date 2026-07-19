// ============================================================================
// PROBLEM 06 — Lookup + date formatting + fallback
// ----------------------------------------------------------------------------
// The component's helper read from a map and formatted the result:
//     function formatDeadline(jurisdictionId) {
//         const iso = deadlineByJurisdiction[jurisdictionId];
//         if (!iso) return "Filing date TBD";
//         return new Date(iso).toLocaleDateString(undefined, {
//             year: "numeric", month: "short", day: "numeric",
//         });
//     }
//
// Write formatDeadline(map, jurisdictionId):
//   - look up the ISO date string ("YYYY-MM-DD") in `map` by jurisdictionId
//   - if there's no date, return "Filing date TBD"
//   - otherwise return it formatted as "Mar 15, 2026"
//     (use toLocaleDateString with { year:'numeric', month:'short', day:'numeric' }
//      and pass "en-US" as the locale so the test is deterministic)
//
// GOTCHA worth knowing: `new Date("2026-03-15")` is parsed as UTC midnight. In
// timezones behind UTC that can render as Mar 14. To keep the practice
// deterministic, format with the "en-US" locale AND the { timeZone: "UTC" }
// option so the day never shifts.
// ============================================================================

function formatDeadline(map, jurisdictionId) {
    // TODO
    const iso = map[jurisdictionId]
    if (!iso) return "Filing date TBD"
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
        });
}

// ---- tests (don't edit) ----------------------------------------------------
const MAP = { j1: "2026-03-15", j2: "2026-11-03" };

runTests("06 — format date", [
    ["formats a date", () => formatDeadline(MAP, "j1"), "Mar 15, 2026"],
    ["formats another", () => formatDeadline(MAP, "j2"), "Nov 3, 2026"],
    ["missing key -> TBD", () => formatDeadline(MAP, "nope"), "Filing date TBD"],
    ["empty map -> TBD", () => formatDeadline({}, "j1"), "Filing date TBD"],
]);

function runTests(title, cases) {
    console.log(`\n${title}`);
    let pass = 0;
    for (const [name, fn, expected] of cases) {
        let got;
        try { got = fn(); } catch (e) { got = `threw ${e.message}`; }
        const ok = JSON.stringify(got) === JSON.stringify(expected);
        console.log(`  ${ok ? "✓" : "✗"} ${name}`);
        if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(got)}`);
        if (ok) pass++;
    }
    console.log(`  ${pass}/${cases.length} passing`);
}
