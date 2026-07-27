// ============================================================================
// PROBLEM 03 — Human label for a deadline_type (lookup map + fallback)
// ----------------------------------------------------------------------------
// The API gives machine codes ("filing_close"); the UI shows words
// ("Filing closes"). There is no `label` field on a deadline row — the label is a
// FRONTEND lookup, shared from `deadlineFormat.js`:
//
//     {DEADLINE_LABELS[filingDeadline.deadline_type]}
//
// A common bug is assuming the API sends a `.label` — it doesn't, so `.label` is
// undefined. The label comes from mapping the TYPE through a dictionary.
//
// Write deadlineLabel(type):
//   - Return the human label from DEADLINE_LABELS.
//   - If the type isn't in the map, fall back to the raw `type` string (better a
//     machine code on screen than the word "undefined").
//
// CONCEPTS: (1) map machine enum -> display string at the edge, keep the enum in
// data; (2) `map[key] ?? key` is the safe lookup-with-fallback; (3) the data has
// no display strings — the frontend owns them (one source of truth to translate).
// ============================================================================

const DEADLINE_LABELS = {
    petition_circulation_start: "Petitioning opens",
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
};

function deadlineLabel(type) {
    // TODO
    return DEADLINE_LABELS[type] ?? type
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("03 — deadline label lookup", [
    ["known type -> words", () => deadlineLabel("filing_close"), "Filing closes"],
    ["another known type", () => deadlineLabel("petition_filing_deadline"), "Petition due"],
    ["unknown type -> raw fallback", () => deadlineLabel("fec_year_end"), "fec_year_end"],
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
