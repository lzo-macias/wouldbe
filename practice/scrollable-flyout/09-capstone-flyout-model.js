// ============================================================================
// PROBLEM 09 — CAPSTONE: build the whole flyout view-model
// ----------------------------------------------------------------------------
// Snap the tested helpers together into ONE object the UI can render without any
// logic in the JSX. Reuse the ideas from 01 (unique groups), 02 (filter by
// group), 03 (is selected), 06 (menu position).
//
// buildFlyoutModel({ categories, allInterests, myInterests, activeGroup, rect }):
//   returns {
//     groups: distinct category_group strings,              // the scroll row
//     active: activeGroup == null ? null : {
//       group: activeGroup,
//       position: { top, left, minWidth },                  // from rect
//       items: [ { key, label, selected }, ... ],           // this group's interests
//     },
//   }
//
// - `groups` uses the Set dedupe from 01.
// - When nothing is hovered (activeGroup == null), `active` is null and we don't
//   touch `rect` at all.
// - `items` maps each interest in the group to { key: category_key,
//   label: display_name, selected: isSelected(myInterests, key) }.
//
// CONCEPTS: push ALL the branching into the model so the component is a dumb
// renderer; a null `active` cleanly represents "no menu open".
// ============================================================================

function buildFlyoutModel({ categories, allInterests, myInterests, activeGroup, rect }) {
    // TODO — you may re-implement the helpers inline or copy them from 01/02/03/06
}

// ---- tests (don't edit) ----------------------------------------------------
const categories = [
    { category_key: "universal_healthcare", display_name: "Universal Healthcare", category_group: "healthcare" },
    { category_key: "mental_health",        display_name: "Mental Health",        category_group: "healthcare" },
    { category_key: "k12_education",        display_name: "K-12 Education",        category_group: "education" },
];
const myInterests = [{ category_key: "mental_health", display_name: "Mental Health", category_group: "healthcare" }];
const rect = { top: 100, left: 40, right: 160, bottom: 132, width: 120, height: 32 };

runTests("09 — capstone flyout model", [
    ["groups are distinct", () => buildFlyoutModel({ categories, allInterests: categories, myInterests, activeGroup: null, rect }).groups,
        ["healthcare", "education"]],
    ["no hover -> active is null", () => buildFlyoutModel({ categories, allInterests: categories, myInterests, activeGroup: null, rect }).active, null],
    ["active items carry key+label+selected", () => buildFlyoutModel({
        categories, allInterests: categories, myInterests, activeGroup: "healthcare", rect,
    }).active.items, [
        { key: "universal_healthcare", label: "Universal Healthcare", selected: false },
        { key: "mental_health",        label: "Mental Health",        selected: true  },
    ]],
    ["active position comes from rect", () => buildFlyoutModel({
        categories, allInterests: categories, myInterests, activeGroup: "healthcare", rect,
    }).active.position, { top: 132, left: 40, minWidth: 120 }],
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
