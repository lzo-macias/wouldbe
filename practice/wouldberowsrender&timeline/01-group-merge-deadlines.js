// ============================================================================
// PROBLEM 01 — Group + merge deadlines by date (the timeline's data prep)
// ----------------------------------------------------------------------------
// Each office arrives with a flat list of deadlines. Before we can draw the
// timeline we collapse them BY DATE — so two deadlines that fall on the same day
// (e.g. "Petition due" and "Filing closes" both on Aug 7) become ONE point whose
// labels list holds both. That's this loop from DeadlineTimeline:
//
//     const byDate = new Map();
//     for (const d of deadlines) {
//         const label = DEADLINE_LABELS[d.type] ?? d.type;
//         if (byDate.has(d.date)) byDate.get(d.date).labels.push(label);
//         else byDate.set(d.date, { date: d.date, labels: [label] });
//     }
//     return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
//
// Write groupByDate(deadlines): return [{ date, labels }] sorted by date ASCENDING.
//   - Convert each deadline's `type` to a human label via DEADLINE_LABELS
//     (fall back to the raw type if it's not in the map).
//   - Deadlines on the SAME date share one entry; push their labels in input order.
//   - Sort the result by ISO date ascending.
//
// Shapes:  deadline = { type, date }   // date = "YYYY-MM-DD"
//
// CONCEPTS: (1) a Map as an accumulator keyed by date — .has / .get / .set;
// (2) the "make-then-push" fold, but into an object that already exists in the Map;
// (3) ISO date strings sort correctly with localeCompare (they're zero-padded).
// ============================================================================

const DEADLINE_LABELS = {
    petition_circulation_start: "Petitioning opens",
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
};

// map.set(key, value) 
function groupByDate(deadlines) {
    // TODO
    const byDate = new Map()
    for (const d of deadlines){
        const label = DEADLINE_LABELS[d.type] ?? d.type
        if (byDate.has(d.date))
            byDate.get(d.date).labels.push(label)
        else{
            byDate.set(d.date)
            byDate.get(d.date, {date: d.date, labels: [label]})
        }
    }
    return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date))
}

// ---- tests (don't edit) ----------------------------------------------------
const D = [
    { type: "filing_close", date: "2026-08-07" },
    { type: "petition_filing_deadline", date: "2026-08-07" },
    { type: "primary_date", date: "2026-06-01" },
];

runTests("01 — group + merge deadlines", [
    ["merges same date, sorts ascending", () => groupByDate(D),
        [
            { date: "2026-06-01", labels: ["Primary"] },
            { date: "2026-08-07", labels: ["Filing closes", "Petition due"] },
        ]],
    ["unknown type falls back to raw", () => groupByDate([{ type: "fec_year_end", date: "2027-01-31" }]),
        [{ date: "2027-01-31", labels: ["fec_year_end"] }]],
    ["empty -> []", () => groupByDate([]), []],
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
