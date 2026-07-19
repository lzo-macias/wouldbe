// ============================================================================
// PROBLEM 06 — Fold "Today" into the points (the "you are here" marker)
// ----------------------------------------------------------------------------
// The timeline needs a Today marker sitting among the deadlines in date order. We
// build it from problem 01's grouping, then fold today IN: if a deadline already
// lands on today's date we just flag that point isToday; otherwise we add a new
// empty-label point for today. Then sort.
//
//     if (byDate.has(today)) byDate.get(today).isToday = true;
//     else byDate.set(today, { date: today, labels: [], isToday: true });
//
// Write buildPoints(deadlines, today): return [{ date, labels, isToday }] sorted
// by date ascending, with exactly one point marked isToday: true.
//   - Reuse problem 01's group-and-merge (labels via DEADLINE_LABELS).
//   - Every grouped deadline starts isToday: false.
//   - Fold today in: reuse the matching point if one exists, else insert a new
//     point with labels: [].
//
// Shapes:  deadline = { type, date },  today = "YYYY-MM-DD"
//
// CONCEPTS: (1) reusing an existing entry vs. inserting — the has/get/set branch;
// (2) Today is "just another point" so the same positioning code handles it;
// (3) the empty labels array is how the render tells a Today marker from a deadline.
// ============================================================================

const DEADLINE_LABELS = {
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
};

function buildPoints(deadlines, today) {
    let byDateDeadlines = new Map()
    for (const dl of deadlines) {
        const label = DEADLINE_LABELS[dl.type] ?? dl.type      // look up the label
        if (byDateDeadlines.has(dl.date)) byDateDeadlines.get(dl.date).labels.push(label)
        else byDateDeadlines.set(dl.date, { date: dl.date, labels: [label], isToday: false })
    }
    if (byDateDeadlines.has(today)) byDateDeadlines.get(today).isToday = true
    else byDateDeadlines.set(today, { date: today, labels: [], isToday: true })
    return [...byDateDeadlines.values()].sort((a, b) => a.date.localeCompare(b.date))
}


// ---- tests (don't edit) ----------------------------------------------------
const D = [
    { type: "filing_close", date: "2026-08-07" },
    { type: "primary_date", date: "2026-06-01" },
];

runTests("06 — fold today", [
    ["inserts Today as its own point",
        () => buildPoints(D, "2026-07-01"),
        [
            { date: "2026-06-01", labels: ["Primary"], isToday: false },
            { date: "2026-07-01", labels: [], isToday: true },
            { date: "2026-08-07", labels: ["Filing closes"], isToday: false },
        ]],
    ["reuses the point when Today == a deadline date",
        () => buildPoints(D, "2026-08-07"),
        [
            { date: "2026-06-01", labels: ["Primary"], isToday: false },
            { date: "2026-08-07", labels: ["Filing closes"], isToday: true },
        ]],
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
