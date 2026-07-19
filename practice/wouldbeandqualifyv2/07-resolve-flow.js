// ============================================================================
// PROBLEM 07 — The Qualify submit flow (async, branch on status)
// ----------------------------------------------------------------------------
// Qualify.jsx takes the address fields, POSTs them to resolve the user's
// jurisdictions, and — only if that succeeded — fetches the offices to show:
//
//     const address = `${street}, ${city}, ${state} ${zip}`;
//     const res = await api.post('/api/users/me/jurisdictions/resolve', { address });
//     if (res.data.status === 'needs_manual_pin') { setNeedsPin(true); }
//     else {
//         const officesRes = await api.get('/api/offices/relevant');
//         onQualified(officesRes.data ?? []);
//     }
//
// Write resolveAndLoad(api, parts):
//   - Build address = `${parts.street}, ${parts.city}, ${parts.state} ${parts.zip}`
//   - await api.post('/api/users/me/jurisdictions/resolve', { address })
//   - If the response's data.status === 'needs_manual_pin', return
//     { status: 'needs_manual_pin' } WITHOUT fetching offices.
//   - Otherwise await api.get('/api/offices/relevant') and return
//     { status: res.data.status, offices: officesRes.data ?? [] }
//
// CONCEPTS: (1) template literals to assemble a string from parts; (2) sequential
// DEPENDENT awaits — the second call only runs after, and depending on, the first
// (unlike v1 problem 05's independent Promise.all); (3) an early return that
// short-circuits so the office fetch never fires on the pin path.
//
// The fake `api` below records the address it received and whether .get was
// called, so the tests can check both.
// ============================================================================

async function resolveAndLoad(api, parts) {
    // TODO
    const address = `${parts.street}. ${parts.city}, ${parts.state}, ${parts.zip}`

    const result = await api.post('api/users/me/jurisdictions/resolve', { address })

    if (result.data.status === 'needs_manual_pin')
        return { status: 'needs_manual_pin' }
    else {
        const officeRes = await api.get('/api/offices/relevant')
        return {stats: result.data.stats, offices: officeRes.data ?? [] }
    }
}

// ---- tests (don't edit) ----------------------------------------------------
function makeFakeApi() {
    return {
        lastAddress: null, getCalled: false, nextStatus: "resolved",
        offices: [{ id: "o1" }, { id: "o2" }],
        async post(path, body) { this.lastAddress = body.address; return { data: { status: this.nextStatus } }; },
        async get(path) { this.getCalled = true; return { data: this.offices }; },
    };
}
const PARTS = { street: "123 Main St", city: "Springfield", state: "IL", zip: "62704" };

runTests("07 — resolve flow", [
    ["builds the address string",
        async () => { const api = makeFakeApi(); await resolveAndLoad(api, PARTS); return api.lastAddress; },
        "123 Main St, Springfield, IL 62704"],
    ["resolved -> returns offices",
        async () => { const api = makeFakeApi(); return resolveAndLoad(api, PARTS); },
        { status: "resolved", offices: [{ id: "o1" }, { id: "o2" }] }],
    ["needs_manual_pin -> short-circuits (no office fetch)",
        async () => { const api = makeFakeApi(); api.nextStatus = "needs_manual_pin"; const r = await resolveAndLoad(api, PARTS); return { r, getCalled: api.getCalled }; },
        { r: { status: "needs_manual_pin" }, getCalled: false }],
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
