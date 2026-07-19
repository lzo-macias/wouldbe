// ============================================================================
// STRETCH 10 — Filter to UPCOMING deadlines, sort by soonest
// ----------------------------------------------------------------------------
// The real component ranks by recommendations. Here's a different, common view:
// "only offices whose filing deadline hasn't passed yet, soonest first." This
// combines earliest-per-key + date comparison + filter + sort + map.
//
// Write upcomingOffices(offices, deadlines, today):
//   - `today` is a "YYYY-MM-DD" string.
//   - Build jurisdiction_id -> EARLIEST deadline_date (reuse Problem 02).       [02]
//   - KEEP only offices that HAVE a deadline AND whose date is strictly AFTER   [filter]
//     `today` (string compare is fine for YYYY-MM-DD).
//   - SORT the survivors by deadline date ASCENDING (soonest first).           [sort]
//   - RETURN [{ id, office_name, deadline }]  (deadline = the raw ISO string).  [map]
//
// Offices with no deadline, or a deadline on/before `today`, are dropped.
//
// Example (today = "2026-06-01"):
//   j1 earliest = 2026-03-15 (past -> drop),  j2 = 2026-11-03 (future -> keep)
// ============================================================================

function upcomingOffices(offices, deadlines, today) {
    // TODO
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFICES = [
    { id: "a", office_name: "Mayor", jurisdiction_id: "j1" },
    { id: "b", office_name: "Council", jurisdiction_id: "j2" },
    { id: "c", office_name: "Assessor", jurisdiction_id: "j3" }, // no deadline -> drop
    { id: "d", office_name: "Clerk", jurisdiction_id: "j4" },
];
const DEADLINES = [
    { jurisdiction_id: "j1", deadline_date: "2026-05-01" },
    { jurisdiction_id: "j1", deadline_date: "2026-03-15" }, // earliest j1 (past)
    { jurisdiction_id: "j2", deadline_date: "2026-11-03" }, // future
    { jurisdiction_id: "j4", deadline_date: "2026-07-20" }, // future, sooner than j2
];

runTests("10 — upcoming, soonest first", [
    ["only future, sorted soonest", () => upcomingOffices(OFFICES, DEADLINES, "2026-06-01"),
        [
            { id: "d", office_name: "Clerk", deadline: "2026-07-20" },
            { id: "b", office_name: "Council", deadline: "2026-11-03" },
        ]],
    ["earlier today keeps j1 too, still sorted", () => upcomingOffices(OFFICES, DEADLINES, "2026-01-01").map(o => o.id),
        ["a", "d", "b"]], // j1=03-15, j4=07-20, j2=11-03
    ["nothing upcoming -> []", () => upcomingOffices(OFFICES, DEADLINES, "2027-01-01"), []],
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
