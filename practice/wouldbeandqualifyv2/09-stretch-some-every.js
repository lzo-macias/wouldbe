// ============================================================================
// STRETCH 09 — "does the user qualify for ANYTHING?" (.some / .every)
// ----------------------------------------------------------------------------
// The feed decides its empty-state message with a single boolean:
//     const anyQualified = offs.some((o) => o.qualifies);
// If false, it shows "you don't qualify (by age)…"; if true but nothing is open,
// it shows "you qualify, but windows have closed."
//
// Write two predicates:
//   anyQualified(offices) -> true if AT LEAST ONE office has qualifies === true
//   allQualified(offices) -> true if EVERY office has qualifies === true
//
// Shapes:  office = { qualifies: boolean }
//
// CONCEPT: `.some` short-circuits true on the first match; `.every` short-circuits
// false on the first miss — both cheaper than building a filtered array just to
// check `.length`. Know the empty-array edge: `[].some(...)` is `false`,
// `[].every(...)` is `true` (vacuous truth). That edge is why the real code uses
// `.some` here — an empty set should read as "nothing qualifies", i.e. false.
// ============================================================================

function anyQualified(offices) {
    // TODO
    return offices.some((o) => o.qualifies)
}
function allQualified(offices) {
    // TODO
    return offices.every((o) => o.qualifies)
}

// ---- tests (don't edit) ----------------------------------------------------
const MIX = [{ qualifies: false }, { qualifies: true }];
const NONE = [{ qualifies: false }, { qualifies: false }];

runTests("09 — some / every", [
    ["any: mix -> true", () => anyQualified(MIX), true],
    ["any: none -> false", () => anyQualified(NONE), false],
    ["any: empty -> false", () => anyQualified([]), false],
    ["all: mix -> false", () => allQualified(MIX), false],
    ["all: empty -> true", () => allQualified([]), true],
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
