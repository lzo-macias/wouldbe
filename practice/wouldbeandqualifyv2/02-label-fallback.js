// ============================================================================
// PROBLEM 02 — Deadline label with a 3-way fallback
// ----------------------------------------------------------------------------
// v2's formatDeadline shows the most specific thing it has, in priority order:
//     1. an upcoming filing date  -> "Jun 1, 2026"
//     2. else the next election YEAR -> "2027 election"
//     3. else                     -> "Filing date TBD"
//
//     function formatDeadline(office) {
//         const iso = deadlineByJurisdiction[office.jurisdiction_id];
//         if (iso) return new Date(iso).toLocaleDateString(undefined, {...});
//         if (office.next_election_year) return `${office.next_election_year} election`;
//         return "Filing date TBD";
//     }
//
// Write deadlineLabel(office, dlMap):
//   - iso = dlMap[office.jurisdiction_id]. If present, format "Mon D, YYYY"
//     (toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric",
//      timeZone:"UTC" }) — "en-US" + UTC keep it deterministic; see v1 problem 06).
//   - else if office.next_election_year is truthy, return `${year} election`.
//   - else return "Filing date TBD".
//
// Shapes:  office = { jurisdiction_id, next_election_year? }   dlMap = { [jurisdiction_id]: "YYYY-MM-DD" }
//
// CONCEPT: an ordered fallback — check the best source first, fall through to the
// next only when it's missing. Order matters: an office can have BOTH an upcoming
// date and a next_election_year; the date must win.
// ============================================================================

function deadlineLabel(office, dlMap) {
    // TODO
    const iso = dlMap[office.jurisdiction_id]
    if (iso) 
        return new Date(iso).toLocaleDateString("en-US",{ year: "numeric", month: "short", day: "numeric", timeZone: "UTC"})
    else if (office.next_election_year)
        return `${office.next_election_year} election`
    else
        return "Filing date TBD"
}

// ---- tests (don't edit) ----------------------------------------------------
const DLMAP = { j1: "2026-06-01" };

runTests("02 — label fallback", [
    ["upcoming date wins over year", () => deadlineLabel({ jurisdiction_id: "j1", next_election_year: 2028 }, DLMAP), "Jun 1, 2026"],
    ["falls back to year", () => deadlineLabel({ jurisdiction_id: "j9", next_election_year: 2027 }, DLMAP), "2027 election"],
    ["nothing known -> TBD", () => deadlineLabel({ jurisdiction_id: "j9" }, DLMAP), "Filing date TBD"],
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
