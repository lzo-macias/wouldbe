// ============================================================================
// PROBLEM 07 — CAPSTONE: the full timeline view-model (combines 01, 03, 04, 06)
// ----------------------------------------------------------------------------
// This is everything DeadlineTimeline computes before it renders, minus React.
// Given an office's deadlines, today, and its goal in cents, produce the exact
// shape the JSX maps over.
//
// Write buildTimeline({ deadlines, today, goalCents }):
//   1. points = buildPoints(deadlines, today)         (problem 06: group+merge+today)
//   2. give each point an evenly-spaced `left` percent (problem 03), in date order
//   3. return { goalLabel, points } where:
//        - goalLabel = formatUSD(goalCents), or null when goalCents == null
//          (problem 04 — the tag hides when there's no goal)
//        - points    = [{ date, labels, isToday, left }]
//
// This mirrors the pipeline in the PDF: group -> merge -> fold Today -> space ->
// (goal) -> render. Build the model first, then the JSX just reads from it.
//
// CONCEPTS: composing small pure helpers into a view-model; keeping formatting
// (formatUSD) and layout (left %) OUT of the render and IN the model, so the JSX
// stays a dumb map. `goalCents == null` (loose) catches both null and undefined.
// ============================================================================

const DEADLINE_LABELS = {
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    general_date: "General election",
};

// ---- provided helpers (assume these pass their own problems) ----------------
function buildPoints(deadlines, today) {
    const byDate = new Map();
    for (const d of deadlines) {
        const label = DEADLINE_LABELS[d.type] ?? d.type;
        if (byDate.has(d.date)) byDate.get(d.date).labels.push(label);
        else byDate.set(d.date, { date: d.date, labels: [label], isToday: false });
    }
    if (byDate.has(today)) byDate.get(today).isToday = true;
    else byDate.set(today, { date: today, labels: [], isToday: true });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function evenPct(i, n) { return n === 1 ? 50 : (i / (n - 1)) * 100; }
function formatUSD(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function buildTimeline({ deadlines, today, goalCents }) {
    // TODO — combine buildPoints + evenPct + formatUSD into the view-model
    const points = buildPoints(deadlines, today)
    const n = points.length
    return {
        goalLabel: goalCents == null ? null : formatUSD(goalCents),
        points: points.map((p, i) => ({...p, left: evenPct(i, n)}))
    }
}

// ---- tests (don't edit) ----------------------------------------------------
const D = [
    { type: "filing_close", date: "2026-08-07" },
    { type: "general_date", date: "2026-11-03" },
];

runTests("07 — capstone timeline model", [
    ["full model, with goal",
        () => buildTimeline({ deadlines: D, today: "2026-07-01", goalCents: 25000000 }),
        {
            goalLabel: "$250,000",
            points: [
                { date: "2026-07-01", labels: [], isToday: true, left: 0 },
                { date: "2026-08-07", labels: ["Filing closes"], isToday: false, left: 50 },
                { date: "2026-11-03", labels: ["General election"], isToday: false, left: 100 },
            ],
        }],
    ["no goal -> goalLabel null",
        () => buildTimeline({ deadlines: D, today: "2026-07-01", goalCents: null }).goalLabel,
        null],
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
