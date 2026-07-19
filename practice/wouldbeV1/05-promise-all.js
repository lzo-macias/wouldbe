// ============================================================================
// PROBLEM 05 — Parallel async with Promise.all + array destructuring
// ----------------------------------------------------------------------------
// The component fired three requests AT THE SAME TIME and waited for all of them:
//     const [recRes, offRes, dlRes] = await Promise.all([
//         api.get("/api/recommendations/received"),
//         api.get("/api/offices"),
//         api.get("/api/election-deadlines?..."),
//     ]);
//
// Why Promise.all? If you `await` them one-by-one, request 2 doesn't start until
// request 1 finishes (slow, sequential). Promise.all starts them together and
// resolves to an array of results IN THE SAME ORDER as the input.
//
// Below are three fake "api" calls that each resolve after a delay. Implement
// loadAll() to fetch all three IN PARALLEL and return a single object:
//     { recs, offices, deadlines }
// using the resolved values. Use array destructuring on the Promise.all result.
// ============================================================================

// fake api — each resolves after `ms` with the given value (do not edit)
const fakeApi = {
    get(path) {
        const table = {
            "/recs": { data: [{ office_id: "a" }], ms: 30 },
            "/offices": { data: [{ id: "a", office_name: "Mayor" }], ms: 10 },
            "/deadlines": { data: [{ jurisdiction_id: "j1", deadline_date: "2026-03-01" }], ms: 20 },
        };
        const { data, ms } = table[path];
        return new Promise((resolve) => setTimeout(() => resolve({ data }), ms));
    },
};

async function loadAll() {
    // TODO:
    //   1. Promise.all the three fakeApi.get("/recs"), ("/offices"), ("/deadlines")
    //   2. destructure the results in order
    //   3. return { recs, offices, deadlines } using each result's .data
    const [ resRecs, resOffices, resDeadlines ] = await Promise.all([
        fakeApi.get("/recs"),
        fakeApi.get("/offices"),
        fakeApi.get("/deadlines"),
    ]);

    const recs = resRecs.data
    const offices = resOffices.data
    const deadlines = resDeadlines.data

    return { recs, offices, deadlines} 
}

// ---- tests (don't edit) ----------------------------------------------------
(async () => {
    const start = Date.now();
    let result, error;
    try { result = await loadAll(); } catch (e) { error = e.message; }
    const elapsed = Date.now() - start;

    const cases = [
        ["returns recs", () => result?.recs, [{ office_id: "a" }]],
        ["returns offices", () => result?.offices, [{ id: "a", office_name: "Mayor" }]],
        ["returns deadlines", () => result?.deadlines, [{ jurisdiction_id: "j1", deadline_date: "2026-03-01" }]],
        // parallel means total time ~= the SLOWEST (30ms), not the SUM (60ms).
        // We give generous headroom (<55ms) — sequential awaits would blow past it.
        ["ran in parallel (<55ms)", () => elapsed < 55, true],
    ];
    if (error) console.log(`\n05 — promise.all\n  ✗ loadAll threw: ${error}`);
    else runTests("05 — promise.all", cases);
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
