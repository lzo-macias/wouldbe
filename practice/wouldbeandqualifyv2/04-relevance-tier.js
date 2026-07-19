// ============================================================================
// PROBLEM 04 — Map a resolution method to a relevance tier
// ----------------------------------------------------------------------------
// getRelevantOffices buckets each office by HOW it resolves to a user — which is
// exactly the three tiers the feed groups by:
//     CASE
//       WHEN resolution_method IN ('geocodio_district','point_in_polygon') THEN 'district'
//       WHEN resolution_method = 'statewide' THEN 'statewide'
//       WHEN resolution_method = 'national'  THEN 'national'
//       ELSE 'other'
//     END AS relevance_tier
//
// Write tierOf(resolutionMethod): return 'district' | 'statewide' | 'national' | 'other'.
//   - 'geocodio_district' and 'point_in_polygon'  -> 'district'  (the user's own seats)
//   - 'statewide'                                  -> 'statewide'
//   - 'national'                                   -> 'national'
//   - anything else                                -> 'other'
//
// CONCEPT: a small classification function. Two different inputs collapse to the
// same 'district' bucket — a plain `if`/`||` (or a lookup object) both read fine.
// Keeping this as its own function makes the grouping code downstream trivial.
// ============================================================================

function tierOf(resolutionMethod) {
    // TODO
    if (resolutionMethod === 'geocodio_district' || resolutionMethod === 'point_in_polygon')
        return 'district'
    else if(resolutionMethod === 'statewide')
        return 'statewide'
    else if (resolutionMethod === 'national')
        return "national"
    return "other"
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("04 — relevance tier", [
    ["geocodio_district -> district", () => tierOf("geocodio_district"), "district"],
    ["point_in_polygon -> district", () => tierOf("point_in_polygon"), "district"],
    ["statewide", () => tierOf("statewide"), "statewide"],
    ["national", () => tierOf("national"), "national"],
    ["unknown -> other", () => tierOf("magic"), "other"],
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
