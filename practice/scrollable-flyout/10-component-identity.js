// ============================================================================
// PROBLEM 10 — Why the menu closed on click (component IDENTITY / remount)
// ----------------------------------------------------------------------------
// The nastiest bug in the whole build: clicking an interest closed the dropdown.
// The cause wasn't the hover logic at all — it was WHERE the child component was
// defined. `MyInterestsDropDown` was declared INSIDE `ChooseYourIssues`:
//
//     function ChooseYourIssues() {
//         function MyInterestsDropDown() { ... }   // ← new function EVERY render
//         return <MyInterestsDropDown ... />
//     }
//
// React identifies a component by its function REFERENCE. Defining it inside the
// parent creates a BRAND-NEW function on every parent render. Every `toggle`
// re-rendered the parent → a new `MyInterestsDropDown` reference → React thinks
// it's a *different component*, UNMOUNTS the old one and MOUNTS a fresh one →
// its `hovered` state resets to false → the menu vanishes.
//
// The fix: define the child at MODULE scope (stable reference), pass data via props.
//
// Model it with identity. A "render" returns the component function React will use.
//   - unstableRender(): defines Inner INSIDE, returns a NEW function each call.
//   - stableRender():   returns a function defined ONCE at module scope.
// Write sameAcrossRenders(renderFn): call renderFn() twice and return whether the
// two results are the SAME reference (===). Same ref ⇒ React keeps the instance
// (state survives). Different ref ⇒ remount (state wiped).
//
// CONCEPTS: React reconciles by component identity; a nested component definition
// changes identity every render → remount → lost state. Never define a component
// inside another component.
// ============================================================================

function unstableRender() {
    function Inner() {}     // re-created on every call — like defining it in a render
    return Inner;
}

function StableInner() {}   // defined ONCE, at module scope
function stableRender() {
    return StableInner;     // same reference every call
}

function sameAcrossRenders(renderFn) {
    // TODO: call renderFn twice; return true iff both calls return the SAME reference
}

// ---- tests (don't edit) ----------------------------------------------------
runTests("10 — component identity", [
    ["nested definition -> new ref each render (remount, state lost)",
        () => sameAcrossRenders(unstableRender), false],
    ["module-scope definition -> stable ref (state survives)",
        () => sameAcrossRenders(stableRender), true],
    ["sanity: two separate module fns differ",
        () => (function A() {}) === (function B() {}), false],
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
