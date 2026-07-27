// ============================================================================
// PROBLEM 05 — Build the change-report description (trim + guard + template)
// ----------------------------------------------------------------------------
// Each editable field can report what's wrong with it. The EditableField's submit
// tags the user's message with WHICH field it came from, and refuses to send a
// blank message:
//
//     function handleSubmit(e) {
//         e.preventDefault();
//         const trimmed = message.trim();
//         if (!trimmed) return;                       // ignore empty
//         onReport(`${fieldLabel} — ${trimmed}`);     // "Min age — should be 25"
//         setMessage("");
//     }
//
// Write buildReport(fieldLabel, message):
//   - Trim the message.
//   - If it's empty (or only whitespace), return null — nothing to send.
//   - Otherwise return "<fieldLabel> — <trimmed message>".
//
// CONCEPTS: (1) trim user input before validating/sending — " " is not real
// content; (2) return a sentinel (null) for "don't send" and let the caller
// decide; (3) template literals to attach context (which field) to the payload.
// ============================================================================

function buildReport(fieldLabel, message) {
    // TODO
    const trimmed = message.trim()
    if (!trimmed) return null
    return `${fieldLabel} - ${message}`
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("05 — build report description", [
    ["tags the field", () => buildReport("Min age", "should be 25"), "Min age — should be 25"],
    ["trims surrounding whitespace", () => buildReport("Source", "   wrong link  "), "Source — wrong link"],
    ["empty message -> null", () => buildReport("State", ""), null],
    ["whitespace-only -> null", () => buildReport("State", "   "), null],
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
