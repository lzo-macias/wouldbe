// ============================================================================
// PROBLEM 01 — Read the RIGHT keys off the API shapes (the bug that ate an hour)
// ----------------------------------------------------------------------------
// The Regulations header nearly shipped blank because the JSX read keys that
// don't exist on the response objects:
//
//     <h2>{office.name} Regulations</h2>   // office has NO `name`  -> undefined
//     <h3>{office.state}</h3>              // office has NO `state`  -> undefined
//
// `GET /api/offices/:id` is `SELECT * FROM office`, whose columns are
// `office_name` and `jurisdiction_id` — there is no `name`, no `state`. State
// lives on the JURISDICTION as `state_code`. Reading a missing key isn't an
// error in JS — it's silently `undefined`, which renders as nothing. That's why
// these bugs don't throw; they just show blank.
//
// Write toIdentifiers({ office, jurisdiction }): return
//     { title, state, name }
//   - title = "<office_name> Regulations"          (from office.office_name)
//   - state = the jurisdiction's state_code
//   - name  = office.office_name
//   If a source value is missing, use "" (empty string) rather than "undefined".
//
// Shapes:
//   office        = { id, office_name, jurisdiction_id }
//   jurisdiction  = { id, name, state_code, type }
//
// CONCEPTS: (1) a missing property is `undefined`, not an error — blank UI, not a
// crash; (2) the same real-world thing ("state") can live on a DIFFERENT object
// than you expect (jurisdiction, not office); (3) `x ?? ""` to render a clean
// blank instead of the literal text "undefined".
// ============================================================================

function toIdentifiers({ office, jurisdiction }) {
    // TODO
    return (
        <>
            <h2>{`${office.office_name} Regulations` ?? ""}</h2>
            <h3>{jurisdiction.jurisdiction_id}</h3>
            <h3>{office.office_name}</h3>
        </>
    )
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFICE = { id: "o1", office_name: "US Representative LA-1", jurisdiction_id: "j1" };
const JUR = { id: "j1", name: "Louisiana's 1st congressional district", state_code: "LA", type: "congressional_district" };

runTests("01 — read the right keys", [
    ["builds identifiers from the correct keys", () => toIdentifiers({ office: OFFICE, jurisdiction: JUR }),
        { title: "US Representative LA-1 Regulations", state: "LA", name: "US Representative LA-1" }],
    ["missing jurisdiction state -> blank, not 'undefined'", () => toIdentifiers({ office: OFFICE, jurisdiction: { id: "j1" } }),
        { title: "US Representative LA-1 Regulations", state: "", name: "US Representative LA-1" }],
    ["missing office_name -> blank title stem", () => toIdentifiers({ office: { id: "o2" }, jurisdiction: JUR }),
        { title: " Regulations", state: "LA", name: "" }],
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
