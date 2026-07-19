// ============================================================================
// PROBLEM 03 — Annotate each office with `qualifies`
// ----------------------------------------------------------------------------
// The backend's getRelevantOffices tags every office with whether the user meets
// its minimum age (null min_age = no age floor). In SQL it's:
//     (o.min_age IS NULL OR u.age >= o.min_age) AS qualifies
//
// Do the same in JS. Write annotateQualifies(offices, age): return a NEW array
// where each office has an added `qualifies` boolean.
//
// Rules:
//   - qualifies = (o.min_age == null) OR (age >= o.min_age).
//     Note `== null` (loose) matches BOTH null and undefined — intentional.
//   - Do NOT mutate the input. Return copies: offices.map(o => ({ ...o, qualifies }))
//
// Shapes:  office = { id, min_age }   // min_age may be a number or null
//
// CONCEPT: `.map` to transform-and-copy, spreading `{ ...o }` so the originals are
// untouched (the same immutability rule as v1 problem 03 — mutating props/state
// causes stale-UI bugs in React).
// ============================================================================

function annotateQualifies(offices, age) {
    // TODO
    return offices.map((office) => ({
        ...office,
        qualifies: office.min_age == null || age >= office.min_age,
    }))
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFS = [{ id: "a", min_age: 18 }, { id: "b", min_age: 25 }, { id: "c", min_age: null }, { id: "d", min_age: 30 }];

runTests("03 — annotate qualifies", [
    ["age 23 -> [T,F,T,F]", () => annotateQualifies(OFFS, 23).map((o) => o.qualifies), [true, false, true, false]],
    ["exact age qualifies", () => annotateQualifies([{ min_age: 25 }], 25)[0].qualifies, true],
    ["does not mutate input", () => { annotateQualifies(OFFS, 23); return OFFS[0].qualifies; }, undefined],
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
