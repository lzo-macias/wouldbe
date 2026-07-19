// ============================================================================
// PROBLEM 01 — Hide offices whose filing window has closed
// ----------------------------------------------------------------------------
// In WouldBeRows we keep an office only if it still has an UPCOMING filing date,
// OR we have no deadline data for it at all. An office whose only deadlines are
// in the past is dropped:
//
//     const hasAnyDeadline = new Set();
//     const dlMap = {};
//     for (const d of deadlines) {
//         if (!d.deadline_date) continue;
//         hasAnyDeadline.add(d.jurisdiction_id);
//         if (dateOf(d) < today) continue;              // already passed
//         ...keep soonest upcoming per jurisdiction...
//     }
//     const runnable = offs.filter((o) =>
//         dlMap[o.jurisdiction_id] ? true : !hasAnyDeadline.has(o.jurisdiction_id));
//
// Write filterRunnable(offices, deadlines, today): return only the offices that
// are still runnable.
//
// Rules:
//   - A deadline row with no `deadline_date` is ignored.
//   - "upcoming" means deadline_date >= today (same-day still counts).
//   - Compare dates as strings sliced to 10 chars: String(d).slice(0,10). ISO
//     "YYYY-MM-DD" sorts lexically, so string >= works. `today` is "YYYY-MM-DD".
//   - Keep an office if its jurisdiction has an upcoming deadline OR the
//     jurisdiction has NO deadline rows at all. Drop it if the jurisdiction has
//     deadlines but none upcoming.
//
// Shapes:  office = { id, jurisdiction_id }   deadline = { jurisdiction_id, deadline_date }
//
// GOTCHA: two Sets make this clean — `hasAny` (jurisdictions with any deadline)
// and `upcoming` (jurisdictions with a future one). The "no data at all" case is
// `!hasAny.has(id)`, which is different from "had data, all past".
// ============================================================================

//here i should still be saving offices that have no deadlines at all (usually deadlines havent been declared yet but instead i only return offices with deadlines)
function filterRunnable(offices, deadlines, today) {
    // TODO: build the two sets, then filter
    const runnable = []
    const hasAny = new Set()
    const dlMap = {}

    for (const dl of deadlines) {
        if(!dl.deadline_date && dl.jurisdiction_id)
            continue
        hasAny.add(dl.jurisdiction_id)
        if (String(dl.deadline_date).slice(0,10) < today)
            continue
        const existing = dlMap[dl.jurisdiction_id]
        if (!existing || dl.deadline_date < existing)
            dlMap[dl.jurisdiction_id] = dl.deadline_date
    }

    for (const office of offices){
        if (dlMap[office.jurisdiction_id] || !hasAny.has(office.jurisdiction_id))
            runnable.push(office)
    }

    return runnable

}

//return earliest deadline and returns offices with no deadlines


// ---- tests (don't edit) ----------------------------------------------------
const OFFICES = [
    { id: "a", jurisdiction_id: "j1" }, { id: "b", jurisdiction_id: "j2" },
    { id: "c", jurisdiction_id: "j3" }, { id: "d", jurisdiction_id: "j4" },
];
const DEADLINES = [
    { jurisdiction_id: "j1", deadline_date: "2026-09-01" }, // future  -> keep a
    { jurisdiction_id: "j2", deadline_date: "2026-02-01" }, // past    -> drop b
    { jurisdiction_id: "j3", deadline_date: "2026-01-01" }, // past …
    { jurisdiction_id: "j3", deadline_date: "2026-12-01" }, // …but also future -> keep c
    // j4 has no deadlines at all -> keep d
];

runTests("01 — filter runnable", [
    ["future kept, past-only dropped, no-data kept",
        () => filterRunnable(OFFICES, DEADLINES, "2026-07-13").map((o) => o.id), ["a", "c", "d"]],
    ["same-day counts as upcoming",
        () => filterRunnable([{ id: "x", jurisdiction_id: "jx" }], [{ jurisdiction_id: "jx", deadline_date: "2026-07-13" }], "2026-07-13").map((o) => o.id), ["x"]],
    ["all past -> empty",
        () => filterRunnable([{ id: "x", jurisdiction_id: "jx" }], [{ jurisdiction_id: "jx", deadline_date: "2000-01-01" }], "2026-07-13").map((o) => o.id), []],
]);

// tiny async-capable test runner shared by every problem file
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
