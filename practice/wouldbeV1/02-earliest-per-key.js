// ============================================================================
// PROBLEM 02 — Keep the minimum (earliest) value per key
// ----------------------------------------------------------------------------
// In the component we mapped each jurisdiction to its SOONEST filing date:
//     const dlMap = {};
//     for (const d of deadlines) {
//         if (!d.deadline_date) continue;
//         const existing = dlMap[d.jurisdiction_id];
//         if (!existing || d.deadline_date < existing) {
//             dlMap[d.jurisdiction_id] = d.deadline_date;
//         }
//     }
//
// Write earliestByJurisdiction(deadlines): return an object mapping
// jurisdiction_id -> the EARLIEST deadline_date seen for it.
//
// Notes:
//   - Dates are strings "YYYY-MM-DD". For that format, string < string is the
//     same as chronological order — so you can compare with plain `<`.
//   - SKIP rows whose deadline_date is missing (null/undefined/"").
//   - First value for a key wins until a smaller one shows up.
//
// Example:
//   earliestByJurisdiction([
//     { jurisdiction_id: 'j1', deadline_date: '2026-05-01' },
//     { jurisdiction_id: 'j1', deadline_date: '2026-03-01' },
//     { jurisdiction_id: 'j2', deadline_date: null },
//   ])  =>  { j1: '2026-03-01' }
// ============================================================================

function earliestByJurisdiction(deadlines) {
    // TODO: your code here
    const today = getDate()
    const dlMap = {}
    for (const dl of deadlines) {
        if (!dl.deadline_date || new Date(dl.deadline_date) < today ) continue
        const existing = dlMap[dl.jurisdiction_id]
        if(!existing || dl.jurisdiction_id < existing)
            dlMap[dl.jurisdiction_id] = dl.deadline_date
    }
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("02 — earliest per key", [
    ["empty", () => earliestByJurisdiction([]), {}],
    ["single", () => earliestByJurisdiction([{ jurisdiction_id: "j1", deadline_date: "2026-05-01" }]), { j1: "2026-05-01" }],
    ["keeps earliest", () => earliestByJurisdiction([
        { jurisdiction_id: "j1", deadline_date: "2026-05-01" },
        { jurisdiction_id: "j1", deadline_date: "2026-03-01" },
        { jurisdiction_id: "j1", deadline_date: "2026-09-01" },
    ]), { j1: "2026-03-01" }],
    ["skips missing dates", () => earliestByJurisdiction([
        { jurisdiction_id: "j2", deadline_date: null },
        { jurisdiction_id: "j2", deadline_date: "" },
    ]), {}],
    ["two keys", () => earliestByJurisdiction([
        { jurisdiction_id: "a", deadline_date: "2026-02-10" },
        { jurisdiction_id: "b", deadline_date: "2026-01-05" },
    ]), { a: "2026-02-10", b: "2026-01-05" }],
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
