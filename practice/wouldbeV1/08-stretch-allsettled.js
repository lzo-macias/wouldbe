// ============================================================================
// STRETCH 08 — Resilient loading with Promise.allSettled
// ----------------------------------------------------------------------------
// Problem with Promise.all: if ANY request fails, the whole thing rejects and
// you get nothing — even the requests that succeeded. Sometimes you'd rather
// show partial data (offices loaded fine; deadlines API is down → show "TBD").
//
// Promise.allSettled NEVER rejects. It resolves to an array of:
//     { status: "fulfilled", value }   OR   { status: "rejected", reason }
// one per input, in order. You inspect each and decide what to do.
//
// Write loadResilient(api): fetch "/offices" and "/deadlines" with allSettled.
//   - offices: if it FAILED, treat as [] (nothing to show).
//   - deadlines: if it FAILED, treat as [] so every office shows "Filing date TBD".
//   Return: { items, deadlinesFailed }
//     items = [{ id, office_name, deadline }]  (deadline formatted or TBD)
//     deadlinesFailed = true/false  (did the deadlines request reject?)
//
// In THIS test the deadlines endpoint always rejects — so a correct answer still
// returns all offices, each with "Filing date TBD", and deadlinesFailed = true.
// ============================================================================

const api = {
    get(path) {
        if (path === "/offices") {
            return Promise.resolve({ data: [
                { id: "a", office_name: "Mayor", jurisdiction_id: "j1" },
                { id: "b", office_name: "Council", jurisdiction_id: "j2" },
            ]});
        }
        // deadlines endpoint is DOWN
        return Promise.reject(new Error("503 deadlines service unavailable"));
    },
};

function formatDeadline(map, jurisdictionId) {
    const iso = map[jurisdictionId];
    if (!iso) return "Filing date TBD";
    return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
}

async function loadResilient(api) {
    // TODO:
    //   1. const results = await Promise.allSettled([ api.get("/offices"), api.get("/deadlines") ])
    //   2. offices  = results[0].status === "fulfilled" ? results[0].value.data : []
    //   3. same idea for deadlines; track deadlinesFailed = results[1].status === "rejected"
    //   4. build the jurisdiction->date map from deadlines (empty if failed)
    //   5. return { items, deadlinesFailed }
    
}

// ---- tests (don't edit) ----------------------------------------------------
(async () => {
    let r, error;
    try { r = await loadResilient(api); } catch (e) { error = e.message; }
    if (error) { console.log(`\n08 — allSettled\n  ✗ loadResilient threw (it shouldn't!): ${error}`); return; }
    runTests("08 — resilient allSettled", [
        ["still returns both offices", () => r.items.map(i => i.id), ["a", "b"]],
        ["all deadlines fall back to TBD", () => r.items.every(i => i.deadline === "Filing date TBD"), true],
        ["flags the failure", () => r.deadlinesFailed, true],
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
