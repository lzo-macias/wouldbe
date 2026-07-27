// ============================================================================
// PROBLEM 08 — CAPSTONE: build the whole Regulations view-model
// ----------------------------------------------------------------------------
// Combine 01 (right keys), 02 (first filing deadline), 03 (label), and 04 (date)
// into the single object the component renders. Given the three raw API objects,
// produce a flat, render-ready model — no undefined keys, no crashes on missing
// data.
//
// Write toRegulationsView({ office, jurisdiction, eligibility }): return
//   {
//     title,                       // "<office_name> Regulations"
//     state,                       // jurisdiction.state_code   ("" if missing)
//     name,                        // office.office_name        ("" if missing)
//     minAge,                      // eligibility.min_age ?? null
//     citizenship,                 // eligibility.citizenship_requirement ?? null
//     jurisdictionType,            // jurisdiction.type ?? null
//     filing,                      // { label, date } for the soonest filing/
//                                  //   petition deadline, or null if none
//     source,                      // eligibility.eligibility_source_url ?? null
//   }
//
// Rules:
//   - Reuse the SAME logic as the earlier problems (right keys; gating-type Set +
//     sort + find; label lookup with raw fallback; date slice + format).
//   - `office.deadlines` may be undefined — treat that as "no deadlines" (filing:
//     null), don't throw. (In the app it's `office.deadlines?.find(...)`.)
//   - filing.label uses DEADLINE_LABELS (raw fallback); filing.date is formatted
//     like "Aug 7, 2026" (UTC-pinned as in problem 04).
//
// Shapes:
//   office       = { id, office_name, jurisdiction_id, deadlines?: [ { deadline_type, deadline_date } ] }
//   jurisdiction = { id, name, state_code, type }
//   eligibility  = { min_age, citizenship_requirement, eligibility_source_url, ... }
//
// CONCEPTS: composition — small, tested helpers snap together into a view-model;
// the component then does almost nothing but read fields and map. All the "what
// key / which object / how to format / guard the empties" decisions live HERE,
// in plain testable JS, not scattered through JSX.
// ============================================================================

const DEADLINE_LABELS = {
    petition_circulation_start: "Petitioning opens",
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
};
const GATING_TYPES = new Set(["filing_close", "petition_filing_deadline"]);

function toRegulationsView({ office, jurisdiction, eligibility }) {
    // date formatter from problem 04 (UTC-pinned so the test is deterministic)
    const formatDeadlineDate = (value) => {
        const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
        return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    }

    const title = `${office.office_name ?? ""} Regulations`
    const state = jurisdiction.state_code ?? ""
    const name = office.office_name ?? ""
    const minAge = eligibility.min_age ?? null
    const citizenship = eligibility.citizenship_requirement ?? null
    const jurisdictionType = jurisdiction.type ?? null
    const source = eligibility.eligibility_source_url ?? null

    // deadlines live on office and may be undefined; copy before sorting
    const sorted = [...(office.deadlines ?? [])].sort(
        (a, b) => a.deadline_date.localeCompare(b.deadline_date)
    )
    const match = sorted.find((d) => GATING_TYPES.has(d.deadline_type))
    const filing = match
        ? {
              label: DEADLINE_LABELS[match.deadline_type] ?? match.deadline_type,
              date: formatDeadlineDate(match.deadline_date),
          }
        : null

    return { title, state, name, minAge, citizenship, jurisdictionType, filing, source }
}

// ---- tests (don't edit) ----------------------------------------------------
const OFFICE = {
    id: "o1",
    office_name: "US Representative LA-1",
    jurisdiction_id: "j1",
    deadlines: [
        { deadline_type: "general_date", deadline_date: "2026-11-03" },
        { deadline_type: "filing_close", deadline_date: "2026-08-07T04:00:00.000Z" },
        { deadline_type: "primary_date", deadline_date: "2026-09-01" },
    ],
};
const JUR = { id: "j1", name: "Louisiana's 1st", state_code: "LA", type: "congressional_district" };
const ELIG = { min_age: 25, citizenship_requirement: "us_citizen", eligibility_source_url: "https://constitution.congress.gov/" };

runTests("08 — capstone regulations view", [
    ["full model", () => toRegulationsView({ office: OFFICE, jurisdiction: JUR, eligibility: ELIG }),
        {
            title: "US Representative LA-1 Regulations",
            state: "LA",
            name: "US Representative LA-1",
            minAge: 25,
            citizenship: "us_citizen",
            jurisdictionType: "congressional_district",
            filing: { label: "Filing closes", date: "Aug 7, 2026" },
            source: "https://constitution.congress.gov/",
        }],
    ["no deadlines -> filing null, no throw", () => toRegulationsView({
        office: { office_name: "Mayor", jurisdiction_id: "j2" },
        jurisdiction: { state_code: "NY", type: "municipality" },
        eligibility: { min_age: 18 },
    }), {
        title: "Mayor Regulations",
        state: "NY",
        name: "Mayor",
        minAge: 18,
        citizenship: null,
        jurisdictionType: "municipality",
        filing: null,
        source: null,
    }],
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
