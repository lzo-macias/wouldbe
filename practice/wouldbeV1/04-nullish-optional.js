// ============================================================================
// PROBLEM 04 — Nullish coalescing (??) and optional chaining (?.)
// ----------------------------------------------------------------------------
// The component leans on these constantly:  recRes.data ?? []   counts[id] ?? 0
//
// KEY IDEA — ?? only falls back on null / undefined. It does NOT fall back on
// 0, "", or false (that's the difference from ||, which falls back on ALL
// falsy values). This matters: a real count of 0 should stay 0, not become a
// default.
//
// ?. safely reads a property that might not exist: obj?.a?.b returns undefined
// instead of throwing if obj or obj.a is null/undefined.
//
// Implement the four functions below.
// ============================================================================

// (a) Return value if it is not null/undefined, otherwise fallback.
//     Must return 0 when value is 0 (do NOT use ||).
function orDefault(value, fallback) {
    // TODO
    if (value != null) return value 
        return fallback  
}

// (b) Given an api response like { data: [...] } (or {} or null), return the
//     data array, or [] if data is missing. Response itself may be null.
function safeData(response) {
    // TODO   (hint: response?.data ?? [])
    return response?.data ?? []
}

// (c) Given counts object and an id, return the count or 0 if that id isn't a key.
function countFor(counts, id) {
    // TODO
    return counts[id] ?? 0
}

// (d) Given a rec that MIGHT be null and might lack a recommender_username,
//     return the username or the string "unknown".
function usernameOf(rec) {
    // TODO   (hint: combine ?. and ??)
    // if (rec.username != null) return rec.username
    //     return "unknown"
    return rec?.recommender_username ?? "unknown"
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("04 — nullish & optional", [
    ["orDefault keeps 0", () => orDefault(0, 99), 0],
    ["orDefault keeps ''", () => orDefault("", "x"), ""],
    ["orDefault falls back on null", () => orDefault(null, 99), 99],
    ["orDefault falls back on undefined", () => orDefault(undefined, 99), 99],
    ["safeData from object", () => safeData({ data: [1, 2] }), [1, 2]],
    ["safeData from empty", () => safeData({}), []],
    ["safeData from null", () => safeData(null), []],
    ["countFor present", () => countFor({ a: 3 }, "a"), 3],
    ["countFor missing", () => countFor({ a: 3 }, "z"), 0],
    ["countFor zero stays zero", () => countFor({ a: 0 }, "a"), 0],
    ["usernameOf present", () => usernameOf({ recommender_username: "sam" }), "sam"],
    ["usernameOf missing field", () => usernameOf({}), "unknown"],
    ["usernameOf null rec", () => usernameOf(null), "unknown"],
]);

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
