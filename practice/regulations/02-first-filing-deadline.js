// ============================================================================
// PROBLEM 02 — The soonest filing/petition deadline (Set membership + find)
// ----------------------------------------------------------------------------
// Regulations shows ONE deadline: the soonest one that actually gates candidacy —
// a filing-close or a petition-filing deadline. Not the FEC report dates, not the
// primary. That's this line in the component:
//
//     const filingDeadline = office.deadlines?.find(
//         (d) => d.deadline_type === "filing_close"
//             || d.deadline_type === "petition_filing_deadline"
//     );
//
// Because `office.deadlines` is already sorted ascending, `find` returns the
// EARLIEST match (find stops at the first hit).
//
// Write firstFilingDeadline(deadlines):
//   - Only these types count: "filing_close", "petition_filing_deadline".
//   - The input may be unsorted here — sort ascending by `deadline_date` FIRST,
//     then return the earliest matching deadline object, or null if none match.
//   - Don't mutate the caller's array (copy before sorting).
//
// Shapes:  deadline = { deadline_type, deadline_date }  // date = "YYYY-MM-DD"
//
// CONCEPTS: (1) a Set of allowed values reads better than a chain of `|| ===`;
// (2) sort a COPY (`[...arr].sort`) — sort mutates in place; (3) `find` returns
// the first match or undefined — normalize undefined to null.
// ============================================================================

const GATING_TYPES = new Set(["filing_close", "petition_filing_deadline"]);

function firstFilingDeadline(deadlines) {
    // TODO
    const sorted = deadlines?.sort((a, b) => (a.deadline_date.LocaleComapare(b.deadline_date)))

    const filingDeadline = sorted?.find(
        (d) => d.deadline_type == "filing_close" ||  d.deadline_type == "petition_filing_deadline"
    )

    return filingDeadline
}

// ---- tests (don't edit) ----------------------------------------------------
const DEADLINES = [
    { deadline_type: "general_date", deadline_date: "2026-11-03" },
    { deadline_type: "filing_close", deadline_date: "2026-08-07" },
    { deadline_type: "petition_filing_deadline", deadline_date: "2026-07-01" },
    { deadline_type: "primary_date", deadline_date: "2026-09-01" },
];

runTests("02 — first filing/petition deadline", [
    ["earliest gating deadline wins (petition before filing)", () => firstFilingDeadline(DEADLINES),
        { deadline_type: "petition_filing_deadline", deadline_date: "2026-07-01" }],
    ["only non-gating types -> null", () => firstFilingDeadline([
        { deadline_type: "general_date", deadline_date: "2026-11-03" },
        { deadline_type: "fec_year_end", deadline_date: "2027-01-31" },
    ]), null],
    ["empty -> null", () => firstFilingDeadline([]), null],
    ["does not mutate input order", () => {
        const copy = [...DEADLINES];
        firstFilingDeadline(copy);
        return copy[0].deadline_type;
    }, "general_date"],
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
