// ============================================================================
// PROBLEM 06 — Group offices by required age (the "Eligible at 18 / 25 / 30" rows)
// ----------------------------------------------------------------------------
// The feed shows the not-yet-eligible offices under age sub-headers. That's this
// helper from WouldBeRows:
//     function groupByAge(list) {
//         const buckets = {};
//         for (const o of list) {
//             const age = o.min_age ?? 0;
//             (buckets[age] ||= []).push(o);
//         }
//         return Object.keys(buckets).map(Number).sort((a,b) => a - b)
//                      .map((age) => ({ age, list: buckets[age] }));
//     }
//
// Write groupByAge(list): return an array of { age, list } sorted by age ASCENDING.
//
// Rules:
//   - Bucket by o.min_age; treat a missing min_age as 0 (o.min_age ?? 0).
//   - Return [{ age, list }, …] sorted by age ascending (18 before 25 before 30).
//   - Empty input -> [].
//
// Shapes:  office = { id, min_age }
//
// TWO GOTCHAS:
//   - Object keys are always STRINGS, so `Object.keys(buckets)` gives ["18","25"].
//     Map them through Number BEFORE sorting, or "100" sorts before "25".
//   - `(buckets[age] ??= []).push(o)` = "make the array if absent, then push" in
//     one line (same fold-into-arrays trick as v1 problem 09's groupBy).
// ============================================================================

function groupByAge(list) {
    // TODO
    const ageBucket = {}
    for (const item of list){
        if (!ageBucket[item.min_age])
            ageBucket[item.min_age] = []
        ageBucket[item.min_age].push(item)
    }
//object.keys pulls out keys of an object into an array
//sorts the keys in ascending
//map return an array with the property and values of ageBucket
    return Object.keys(ageBucket)
        .sort((a, b) => a - b)
        .map((age) => [Number(age), ageBucket[age]])
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFS = [{ id: "a", min_age: 25 }, { id: "b", min_age: 18 }, { id: "c", min_age: 25 }, { id: "d", min_age: 35 }];
const shape = () => groupByAge(OFFS).map((g) => ({ age: g.age, ids: g.list.map((o) => o.id) }));

runTests("06 — group by age", [
    ["ascending age buckets", shape, [{ age: 18, ids: ["b"] }, { age: 25, ids: ["a", "c"] }, { age: 35, ids: ["d"] }]],
    ["empty -> []", () => groupByAge([]), []],
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
