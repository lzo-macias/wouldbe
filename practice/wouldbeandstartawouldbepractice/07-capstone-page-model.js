// ============================================================================
// PROBLEM 07 — CAPSTONE: the StartAWouldBe view-model
// ----------------------------------------------------------------------------
// Combine 04 (recommended vs adjusted) + 05 (progress %) + date grouping into the
// single object the component renders. Given the raw office/goal inputs, return:
//
//   {
//     headline:         "a great LA US Representative LA-1 representative",
//     recommendedLabel: "$440,000",        // FIXED (backend goal / floor)
//     yourGoalLabel:    "$300,000",         // adjusted (slider)
//     adjusted:         true,               // your goal differs from recommended
//     progress:         57.3,               // rail % (see 05)
//     points: [ { label, date, amount, state } ]   // state: done|today|future
//   }
//
// Rules:
//   • Group deadlines by date; same-day labels merge (join with " · ").
//   • Fold in a Today point (label "Today", no amount) if today isn't already a
//     deadline date. Sort all points ascending by date.
//   • amount = cumulative split of the ADJUSTED goal across the non-today points
//     (see 04), formatted like "$146,667". Today's amount is "".
//   • state: "today" for the today point; "done" if date < today; else "future".
//   • progress: nodeCenterPct(todayIndex, n) mapped onto the inset rail (05).
//
// Helpers formatUSD, clamp, nodeCenterPct, railProgress are given. Reuse your 04
// logic for the cumulative amounts.
//
// CONCEPTS: one function turns messy inputs into a flat, render-ready shape — the
// component then only maps over `points` and drops values into class names. All
// the "thinking" lives here, testably, not in JSX.
// ============================================================================

function formatUSD(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function clamp(min, max, v) { return Math.max(min, Math.min(max, v)); }
function nodeCenterPct(i, n) { return ((i + 0.5) / n) * 100; }
function railProgress(centerPct, inset = 5.5) { return clamp(0, 100, ((centerPct - inset) / (100 - 2 * inset)) * 100); }

function buildPageModel(input) {
    // input = {
    //   office: { office_name, deadlines: [ { type, date } ] },   // date "YYYY-MM-DD"
    //   stateCode: "LA",
    //   originalGoalCents: 44000000 | null,
    //   adjustedGoalCents: 30000000,
    //   today: "2026-07-23",
    // }
    // TODO: build and return the view-model described above.
    const headline = `a great ${input.stateCode} ${input.office.office_name} representative`
    const recommendedCents = input.originalGoalCents == null ? 500000 : input.originalGoalCents
    const recommendedLabel = formatUSD(recommendedCents)
    const yourGoalLabel =rformatUSD(input.adjustedGoalCents)
    const adjusted = recommendedCents !== input.adjustedGoalCents

//clean deadlines into 1 date per deadlines
//if date doesnt exist, create it, if date does exist push into that dates array
let byDate = new Map()
for (const dl of input.office.dealines){
        if (!byDate.has(dl.date)) byDate.set(dl.date, [])
        byDate.get(dl.date).push(dl.type)
    }
if (!byDate.has(input.today)) byDate.set(input.today, ["Today"])

const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b))
const nonTodayCount = dates.filter(d => d !== input.today).length

//calculate amount per deadlline
// adjustedGoalCents loop over count of deadlines and and multiply by multiplier
let newAmount = []
for (let x = 1; x <= nonTodayCount; x++) {
        newAmount.push(formatUSD(Math.round(input.adjustedGoalCents * x / nonTodayCount)))
}

let points = []
let k = 0
for (const date of dates) {
    const isToday = date === input.today
    const state = isToday ? "today" : (date < input.today ? "done" : "future")
            points.push({
            label: byDate.get(date).join(" · "),
            date,
            amount: isToday ? "" : newAmount[k++],
            state,
        })
}
    const todayIndex = points.findIndex(p => p.state === "today")
    const progress = railProgress(nodeCenterPct(todayIndex, points.length))

    return { headline, recommendedLabel, yourGoalLabel, adjusted, progress, points }
}

// ---- tests (don't edit) ----------------------------------------------------
const INPUT = {
    office: {
        office_name: "US Representative LA-1",
        deadlines: [
            { type: "general_date", date: "2026-11-03" },
            { type: "filing_close", date: "2026-08-07" },
            { type: "fec_quarterly_q2", date: "2026-07-15" },
        ],
    },
    stateCode: "LA",
    originalGoalCents: 44000000,
    adjustedGoalCents: 30000000,
    today: "2026-07-23",
};
runTests("07 — capstone page model", [
    ["headline", () => buildPageModel(INPUT).headline, "a great LA US Representative LA-1 representative"],
    ["recommended is FIXED (not adjusted)", () => buildPageModel(INPUT).recommendedLabel, "$440,000"],
    ["your goal is the adjusted value", () => buildPageModel(INPUT).yourGoalLabel, "$300,000"],
    ["adjusted flag true when they differ", () => buildPageModel(INPUT).adjusted, true],
    ["a Today point was folded in", () => buildPageModel(INPUT).points.filter(p => p.state === "today").length, 1],
    ["points sorted, today between q2 and filing", () => buildPageModel(INPUT).points.map(p => p.state), ["done", "today", "future", "future"]],
    ["past deadline amount uses ADJUSTED goal", () => buildPageModel(INPUT).points[0].amount, "$100,000"],
    ["last amount equals full adjusted goal", () => buildPageModel(INPUT).points.at(-1).amount, "$300,000"],
    ["today has no amount", () => buildPageModel(INPUT).points.find(p => p.state === "today").amount, ""],
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
