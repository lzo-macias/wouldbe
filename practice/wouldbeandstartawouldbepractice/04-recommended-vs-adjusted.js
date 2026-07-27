// ============================================================================
// PROBLEM 04 — recommended (fixed) vs adjusted (slider) goal
// ----------------------------------------------------------------------------
// StartAWouldBe holds TWO goal numbers and must never confuse them:
//   • recommendedGoalCents — the backend's saved goal. FIXED. The chip + the big
//     "$440,000" show this; the slider must NOT move it.
//   • goalCents — the user's slider value ("your goal"). This drives the number
//     under the slider AND the per-deadline cumulative amounts on the timeline.
//
// The per-deadline amount splits the ADJUSTED goal evenly across the real
// deadlines and accumulates, so the last deadline equals the full goal:
//     perDeadline = adjusted / count
//     amountAt(i) = round(perDeadline * (i + 1))
//
// Write:
//   recommendedGoal(originalCents, floor = 500000) -> originalCents, or floor when
//                            originalCents is null/undefined (the $5,000 seed)
//   cumulativeAmounts(adjustedCents, count) -> array of `count` cumulative cents,
//                            each rounded; [] when count is 0
//
// CONCEPTS: (1) keep the source-of-truth separate from a derived, user-editable
// copy; (2) `??` supplies the floor only for null/undefined (not for 0); (3) a
// running split that sums to the whole.
// ============================================================================

function recommendedGoal(originalCents, floor = 500000) {
    // TODO: return originalCents unless it's null/undefined, then floor.
    if (originalCents == null) return floor
        return floriginalCentsoor
}

function cumulativeAmounts(adjustedCents, count) {
    // TODO: return `count` cumulative, rounded cents. [] if count === 0.
    if (count === 0) return []
    const cumulative =  []
    // const multiplier = adjustedCents/count.lenth
    for (let x = 1; x <= count; x++){
        cumulative.push(Math.round((adjustedCents * x)/ count))
    }
    return cumulative
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("04 — recommended vs adjusted", [
    ["keeps a real recommended goal", () => recommendedGoal(44000000), 44000000],
    ["floors a null goal", () => recommendedGoal(null), 500000],
    ["floors undefined too", () => recommendedGoal(undefined), 500000],
    ["does NOT floor a zero", () => recommendedGoal(0), 0],
    ["splits evenly, sums to whole", () => cumulativeAmounts(300, 3), [100, 200, 300]],
    ["rounds each step", () => cumulativeAmounts(100, 3), [33, 67, 100]],
    ["empty when no deadlines", () => cumulativeAmounts(500, 0), []],
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
