// ============================================================================
// PROBLEM 08 — CAPSTONE: build the whole relevant-mode view (combines 01–06)
// ----------------------------------------------------------------------------
// This is WouldBeRows' relevant-mode data prep, minus React. Given the raw
// offices + deadlines from the API, produce everything the render needs.
//
// Write buildRelevantView(api, age, today):
//   1. offices   = (await api.get('/api/offices/relevant')).data ?? []
//      deadlines = (await api.get('/api/deadlines')).data ?? []
//      (each office = { id, min_age, resolution_method, jurisdiction_id })
//   2. Annotate each office with `qualifies` (problem 03) and
//      `relevance_tier` (problem 04, from resolution_method).
//   3. anyQualified = does ANY annotated office qualify? (compute BEFORE filtering,
//      so it reflects age, not open windows — see the real component).
//   4. Keep only runnable offices (problem 01, using deadlines + today).
//   5. Partition the runnable set (problem 05).
//   6. Group districtLater and stateLater by age (problem 06), but emit ids:
//         [{ age, ids: [...] }]
//   Return:
//     { anyQualified, qualified: [ids…], districtGroups: [{age,ids}], stateGroups: [{age,ids}] }
//
// This is the shape of the feature: fetch -> annotate -> classify -> filter ->
// partition -> group. Build the lookups/annotations first, then read from them —
// same discipline as v1's capstone.
// ============================================================================

function tierOf(m) {
    if (m === "geocodio_district" || m === "point_in_polygon") return "district";
    if (m === "statewide") return "statewide";
    if (m === "national") return "national";
    return "other";
}

async function buildRelevantView(api, age, today) {
    // TODO — reuse the ideas from 01–06 (tierOf above is provided)
    const offices = (await api.get('api/offices/relevant')).data ?? []
    const deadlines = (await api.get("api/deadlines")).data ?? []

    const annotatedOffices = 
        offices.map((office) => ({
            ...office,
            qualified: office.min_age == null || office.min_age <= age,
            relevanceTier: tierOf(office.resolution_method)
        }))

    //checks soley if our logged in user is qualified to run for an office based on their age...no election 
    const anyQualified = annotatedOffices.some((o) => o.qualified)

    // const dlMap = {}
    // const hasAny = new Set()
    // const runnable = []
    // for (const dl of deadlines) {
    //     if (!dl.deadline_date && dl.jurisdiction_id)
    //         continue
    //     hasAny.add(dl.jurisdiction_id)
    //     if (String(dl.deadline_date).slice(0,10) < today)
    //         continue
    //     const existing = dlMap[dl.jurisdiction_id] 
    //     if (!existing || dl.deadline_date < existing) 
    //         dlMap[dl.jurisdiction_id] = dl.deadline_date
    // }
    // for (const office of annotatedOffices){
    //     if (dlMap[office.jurisdiction_id] || !hasAny.has(office.jurisdiction_id))
    //         runnable.push(office)
    // }

    const hasDeadline = new Set(deadlines.map((d) => d.jurisdiction_id))
    const openJur = new Set (
        deadlines
            .filter((d) => d.deadline_date && String(d.deadline_date).slice(0, 10) >= today)
            .map((d) => d.jurisdiction_id) //so the arrat thats returned into open jur only holds jurisdiction_id not deadline_date?
    )

    const runnable = annotatedOffices.filter(
        (o) => openJur.has(o.jurisdiction_id) || !hasDeadline.has(o.jurisdiction_id)
    )

    const qualified = runnable.filter((r) => r.qualified)
    const districtLater = runnable.filter((r) => !r.qualified && r.relevanceTier === "district")
    const stateLater = runnable.filter((r) => !r.qualified && r.relevanceTier !== "district" )
    //how do we address nationwide? how does district cover nationwide?

    // const districtAgeBucket = {}
    // for (const o of districtLater) {
    //     if (!districtAgeBucket[o.min_age]){
    //         districtAgeBucket[o.min_age] = []
    //     }
    //     districtAgeBucket[o.min_age].push(o) 
    // }
    // const ageKeyedDistrict = Object.keys(districtAgeBucket)
    //     .sort((a,b) => (a-b))
    //     .map((age) => ({ age: Number(age), ids: districtAgeBucket[age].map((o) => o.id)}))

    // const stateAgeBucket = {}
    // for (const o of stateLater) {
    //     if (!stateAgeBucket[o.min_age]){
    //         stateAgeBucket[o.min_age] = []
    //     }
    //     stateAgeBucket[o.min_age].push(o)
    // }
    // const ageKeyedState = Object.keys(stateAgeBucket)
    //     .sort((a,b) => (a-b))
    //     .map((age) => ({ age: Number(age), ids: stateAgeBucket[age].map((o) => o.id)}))

    const groupByAge = (list) => {
        const buckets = new Map() //what does new map do?
        for (const o of list){
            if (!buckets.has(o.min_age)) buckets.set(o.min_age, [])
            buckets.get(o.min_age).push(o.id) //what is .get() what does it do, does it only pertain to new Map or also works on new Set
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => a - b)
            .map(([age, ids]) => ({age, ids}))
    }

    // return {
    //     anyQualified,
    //     qualified: qualified.map((o) => o.id),
    //     districtGroups: ageKeyedDistrict,
    //     stateGroups: ageKeyedState,
    // }
    return {
        anyQualified,
        qualified: qualified.map((o) => o.id),
        districtGroups: groupByAge(districtLater),
        stateGroups: groupByAge(stateLater),
    }
    
}

// ---- tests (don't edit) ----------------------------------------------------
const RELEVANT = [
    { id: "a", min_age: 18, resolution_method: "geocodio_district", jurisdiction_id: "j1" }, // qualifies, upcoming
    { id: "b", min_age: 25, resolution_method: "geocodio_district", jurisdiction_id: "j2" }, // not yet, district, upcoming
    { id: "c", min_age: 30, resolution_method: "statewide", jurisdiction_id: "j3" },        // not yet, state, no deadline data
    { id: "d", min_age: 35, resolution_method: "national", jurisdiction_id: "j4" },         // not yet, national, no deadline data
    { id: "e", min_age: 18, resolution_method: "geocodio_district", jurisdiction_id: "j5" }, // qualifies BUT filing passed -> filtered out
];
const DEADLINES = [
    { jurisdiction_id: "j1", deadline_date: "2026-09-01" },
    { jurisdiction_id: "j2", deadline_date: "2026-10-01" },
    { jurisdiction_id: "j5", deadline_date: "2026-01-01" }, // past
];
const API = { async get(path) { return { data: path.includes("relevant") ? RELEVANT : DEADLINES }; } };

runTests("08 — capstone relevant view", [
    ["full pipeline, age 23",
        () => buildRelevantView(API, 23, "2026-07-13"),
        { anyQualified: true, qualified: ["a"], districtGroups: [{ age: 25, ids: ["b"] }], stateGroups: [{ age: 30, ids: ["c"] }, { age: 35, ids: ["d"] }] }],
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
