// ============================================================================
// CAPSTONE 07 — Combine EVERYTHING (runnable)
// ----------------------------------------------------------------------------
// This is the whole WouldBeRows data pipeline as one pure async function — every
// concept from 01–06 in a single place, but testable in node (no React).
//
// Write buildOfficeView(api):
//   1. fetch "/recs", "/offices", "/deadlines" IN PARALLEL (Promise.all)   [05]
//   2. pull .data off each, defaulting to []                               [04]
//   3. tally recommendations per office_id                                 [01]
//   4. map each jurisdiction_id -> its EARLIEST deadline_date              [02]
//   5. return a NEW array (don't mutate) of view-models:                   [03]
//         { id, office_name, count, deadline }
//      - count   = recommendations for that office (0 if none)             [04]
//      - deadline = the office's jurisdiction date formatted "Mar 15, 2026",
//                   or "Filing date TBD" if none                           [06]
//      - sorted by count DESC, then office_name A→Z                        [03]
//
// Reuse everything you wrote in 01–06. This is exactly what loadData() does
// inside the real component — minus the useState/useEffect plumbing.
// ============================================================================

// fake api (do not edit) — resolves each path after a short delay
const api = {
    get(path) {
        const table = {
            "/recs": [{ office_id: "a" }, { office_id: "a" }, { office_id: "c" }],
            "/offices": [
                { id: "a", office_name: "Mayor", office_type: "executive", jurisdiction_id: "j1" },
                { id: "b", office_name: "Assessor", office_type: "executive", jurisdiction_id: "j2" },
                { id: "c", office_name: "Council", office_type: "legislative", jurisdiction_id: "j1" },
            ],
            "/deadlines": [
                { jurisdiction_id: "j1", deadline_date: "2026-05-01" },
                { jurisdiction_id: "j1", deadline_date: "2026-03-15" }, // earliest for j1
                { jurisdiction_id: "j2", deadline_date: "2026-11-03" },
            ],
        };
        const delay = { "/recs": 30, "/offices": 10, "/deadlines": 20 }[path];
        return new Promise((resolve) => setTimeout(() => resolve({ data: table[path] }), delay));
    },
};

async function buildOfficeView(api) {
    // TODO: chain steps 1–5 above
    const [ recRes, officeRes, deadlineRes ] = await Promise.all([
        api.get("/recs"),
        api.get("/offices"),
        api.get("/deadlines")
    ])

    const reccomendations = recRes.data
    const offices = officeRes.data
    const deadlines = deadlineRes.data

    const countOfReccomendations = {}
    for (const rec of reccomendations) {
        countOfReccomendations[rec.office_id] = (countOfReccomendations[rec.office_id]?? 0 ) + 1
    }

    const dlMap = {}
    const today = new Date()

    for (const dl of deadlines) {
        //i added the today check because we shouldnt be displaying anything past 
        if (!dl.deadline_date || new Date(dl.deadline_date) < today) continue
        const existing = dlMap[dl.jurisdiction_id]
        if (!existing || new Date (dl.deadline_date) < existing)
            dlMap[dl.jurisdiction_id] = dl.deadline_date
    }

    const format = (iso) => iso
        ? new Date(iso).toLocaleDateString("en-us", {
            year: "numeric", month: "short", day: "numeric", timeZone: "UTC"
        })
        : "filing date tbd"

    return [...offices]
        .map((office) => ({
            id: office.id,
            office_name: office.office_name,
            count: countOfReccomendations[office.id] ?? 0,
            deadline: format(dlMap[office.jurisdiction_id]),
        }))
        .sort((a,b) => {
            const diff = b.count - a.count;
            return diff !==0 ? diff : a.office_name.localeCompare(b.office_name);
        })
}

// ---- tests (don't edit) ----------------------------------------------------
(async () => {
    let result, error;
    try { result = await buildOfficeView(api); } catch (e) { error = e.message; }

    const expected = [
        { id: "a", office_name: "Mayor", count: 2, deadline: "Mar 15, 2026" },
        { id: "c", office_name: "Council", count: 1, deadline: "Mar 15, 2026" },
        { id: "b", office_name: "Assessor", count: 0, deadline: "Nov 3, 2026" },
    ];

    if (error) { console.log(`\n07 — capstone\n  ✗ buildOfficeView threw: ${error}`); return; }
    runTests("07 — capstone pipeline", [
        ["full view-model, ranked", () => result, expected],
        ["is a new array (offices not mutated is on you)", () => Array.isArray(result), true],
    ]);
})();

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
