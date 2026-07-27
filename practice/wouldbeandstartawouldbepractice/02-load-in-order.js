// ============================================================================
// PROBLEM 02 — dependent fetches, in order, using each result DIRECTLY
// ----------------------------------------------------------------------------
// StartAnOffice's loadDataV2 makes FOUR requests where each depends on the one
// before it. The office tells you which jurisdiction to load; the jurisdiction id
// drives the deadlines + goal. The rule the code follows on purpose:
//
//     use the value you JUST awaited — never the React state you just set.
//     (setState is async; `individualOffice` is still stale on this pass.)
//
// So it threads local variables through, not state:
//     const office = await api.getOffice(id)
//     const jurisdiction = await api.getJurisdiction(office.jurisdiction_id)
//     const deadlines = sortByDate(await api.getDeadlines(office.jurisdiction_id))
//     const goalCents = await api.getGoal(office.id)
//     return { ...office, jurisdiction, deadlines, goalCents }
//
// Write:
//   sortByDate(rows)      -> NEW array sorted ascending by `deadline_date`
//                            (immutably — don't mutate the input)
//   loadOffice(id, api)   -> the assembled object above, or null if no office
//
// `api` is { getOffice, getJurisdiction, getDeadlines, getGoal }, each returning
// a Promise. Await them in dependency order.
//
// CONCEPTS: (1) await serializes dependent async steps; (2) pass the awaited
// RESULT forward, not soon-to-update state; (3) sort a COPY so you never scramble
// a shared array.
// ============================================================================

function sortByDate(rows) {
    // TODO: return a new array sorted ascending by row.deadline_date (a string).
    return [...rows].sort((a, b) => 
        a.deadline_date.localeCompare(b.deadline_date))
}

async function loadOffice(id, api) {
    // TODO: office -> jurisdiction -> deadlines(sorted) -> goal, assembled.
    //       Return null if getOffice yields nothing.

    const office = await api.getOffice(id)
    if (!office) return null
    const jurisdiction = await api.getJurisdiction(office.jurisdiction_id)
    const deadlines = sortByDate(await api.getDeadlines(office.jurisdiction_id))
    const goalCents = await api.getGoal(id)

    return {office, jurisdiction, deadlines, goalCents}
}

// ---- tests (don't edit) ----------------------------------------------------
function fakeApi() {
    return {
        getOffice: async (id) => (id === 7 ? { id: 7, office_name: "US Rep LA-1", jurisdiction_id: 30 } : null),
        getJurisdiction: async (jid) => ({ id: jid, state_code: "LA", name: "District 1" }),
        getDeadlines: async (jid) => [
            { deadline_type: "general_date", deadline_date: "2026-11-03" },
            { deadline_type: "filing_close", deadline_date: "2026-08-07" },
        ],
        getGoal: async (oid) => (oid === 7 ? 44000000 : null),
    };
}
runTests("02 — load in order", [
    ["sortByDate ascending", () => sortByDate([{ deadline_date: "2026-11-03" }, { deadline_date: "2026-08-07" }]).map(r => r.deadline_date), ["2026-08-07", "2026-11-03"]],
    ["sortByDate is immutable", () => { const a = [{ deadline_date: "b" }, { deadline_date: "a" }]; sortByDate(a); return a[0].deadline_date; }, "b"],
    ["null office short-circuits", async () => await loadOffice(1, fakeApi()), null],
    ["assembles jurisdiction", async () => (await loadOffice(7, fakeApi())).jurisdiction.state_code, "LA"],
    ["deadlines are sorted", async () => (await loadOffice(7, fakeApi())).deadlines[0].deadline_type, "filing_close"],
    ["keeps office fields + goal", async () => { const o = await loadOffice(7, fakeApi()); return [o.office_name, o.goalCents]; }, ["US Rep LA-1", 44000000]],
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
