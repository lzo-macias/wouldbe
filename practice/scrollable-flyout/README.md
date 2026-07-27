# Practice — the **scrollable category flyout** (portal, clipping, hover menus)

This set rebuilds the thing we just fought with on the "plan of action" screen:
a **horizontally-scrolling row of category chips**, where **hovering a chip opens
a dropdown** of the interests in that category — and the dropdown has to appear
**under the chip without being clipped** by the scroll container.

It's built from the small pieces we actually got wrong at least once: **deduping
the groups** (duplicate React keys), **`some` vs `forEach`/`includes`** for
"is it selected", **immutably toggling** the selected set, the **CSS `overflow`
rule** that was silently clipping the menu, turning a **DOM rect into fixed
coordinates**, the **hover open/close delay**, the recurring **call-vs-pass a
handler** bug — and the React shell that ties it together with **`createPortal`**.

Same rules as always: every `.js` file has a **stub you fill in** and **tests that
run immediately**:

```bash
node scrollable-flyout/01-unique-groups.js
```

✓ = pass, ✗ = fail with expected vs. got. Answers + the *why* are in
`SOLUTIONS.md` — try first, peek after. The two `react/` files have no runner;
fill in the TODOs from memory, then diff against the real component at
`coolpeoplev3-frontend/src/assets/component/Wouldbe/ChooseYourIssues/ChooseYourIssues.jsx`
(the `MyInterestsDropDown` function + the `.categoryslider` map).

## Order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `01-unique-groups.js` | `Set` dedupe → distinct groups | `[...new Set(data.map(c => c.category_group))]` |
| `02-interests-in-group.js` | `filter` a list by a field | `allInterests.filter(i => i.category_group === group)` |
| `03-is-selected.js` | `some` returns a boolean (not `forEach`) | `myInterests.some(i => i.category_key === key)` |
| `04-toggle-interest.js` | immutable add/remove the whole object | `toggle()` |
| `05-overflow-clip-rule.js` | why `overflow-x:auto` clips the menu | `.categoryslider` overflow |
| `06-menu-position.js` | a rect → `position:fixed` coordinates | `getBoundingClientRect()` → `pos` |
| `07-hover-open-close.js` | the close **delay** state machine | `open` / `scheduleClose` / `closeTimer` |
| `08-handler-vs-call.js` | pass a function vs CALL it | `onMouseEnter={open}` (the re-render bug) |
| `09-capstone-flyout-model.js` | **combines 01·02·03·06** into a view-model | everything the flyout renders |
| `10-component-identity.js` | nested component = new ref = remount = state wiped | why clicking closed the menu |
| `react/STRUCTURE.md` | **read this** — the component tree, who owns state, DOM-vs-React | the whole picture |
| `react/CategoryFlyout.jsx` | `createPortal` + ref + guarded hover close | `MyInterestsDropDown` |
| `react/CategorySlider.jsx` | scroll row + `children` chip | the `.categoryslider` map |
| `react/flyout.css` | the CSS half — scroll row, portaled menu, chips | `.categoryslider`, `.categoryDropdown*` |

## The story the problems tell

1. **Distinct groups, or duplicate keys** (01). The API returns ~106 rows; each has
   a `category_group` and 15 groups repeat across them. Mapping gives duplicates →
   React's "each child needs a unique key" warning. `new Set` collapses them.
2. **Which interests, is it on** (02–03). Filter the interests down to one group,
   and decide "selected" with `some` (a real boolean) — **not** `forEach` (always
   `undefined`) and **not** `includes` (can't reach inside an object).
3. **Toggle without mutating** (04). Clicking a chip returns a *new* array: drop it
   if present, add the whole object if not.
4. **Why the menu vanished** (05). `overflow-x: auto` for horizontal scroll forces
   `overflow-y` to compute to `auto`, which **clips** anything hanging below — the
   dropdown. You can't have scroll on one axis and truly-visible on the other.
5. **Place it by hand** (06). Since we escape the clip by portaling the menu to
   `<body>`, it's no longer positioned by the chip automatically — we read the
   chip's `getBoundingClientRect()` (viewport coords) and drop the menu there with
   `position: fixed`.
6. **Don't snap shut** (07). The menu is no longer a DOM child of the chip, so
   moving the mouse from chip → menu fires the chip's `mouseleave`. A short
   **close delay** (cancelled when you enter the menu) keeps it open.
7. **Pass, don't call** (08). `onMouseEnter={open}` hands React the function;
   `onMouseEnter={open()}` **runs it during render** — and if it calls `setState`,
   that's the "Too many re-renders" crash.
8. **The menu closed on click** (10). The real killer: `MyInterestsDropDown` was
   defined *inside* the parent, so every `toggle` re-render made a new function →
   React remounted it → `hovered` reset → menu gone. Hoisting it to module scope
   fixed it. State-getting-wiped and the hover-close (07) are the two "why did it
   vanish" bugs.
9. **Compose + portal** (09 + react). The tested helpers become one view-model, and
   `createPortal` renders the menu outside the scroll container so nothing clips it.

## Read `react/STRUCTURE.md` first for the React shell

The `.js` problems drill the pieces; `react/STRUCTURE.md` shows how they assemble —
the component tree, **who owns which state** (data in the parent, hover in the
child), the **DOM-vs-React** portal twist, and why the two "state got wiped" bugs
happen. `react/flyout.css` is the styling half, annotated rule-by-rule. The React
and the CSS are **two halves of one fix**: the CSS makes the row scroll (and would
clip the menu); the portal takes the menu out and positions it so it doesn't.

## The shared data shapes

```js
// GET /api/categories  (rows of the issue taxonomy)
category = { category_key, display_name, category_group, sort_order, is_active }
// e.g. { category_key: "mental_health", display_name: "Mental Health",
//        category_group: "healthcare", ... }

myInterests = [ ...category ]   // the FULL objects the user has selected

// a DOM rect (from element.getBoundingClientRect()) — viewport-relative:
rect = { top, left, right, bottom, width, height }

// the view-model the capstone builds when a group is hovered:
model = {
  groups: ["healthcare", "education", ...],           // distinct, for the row
  active: {
    group: "healthcare",
    position: { top, left, minWidth },                // for the fixed menu
    items: [ { key, label, selected }, ... ],         // the dropdown list
  } | null,                                            // null = nothing hovered
}
```

## Why mostly plain `.js`

The portal itself is two lines of React. The *bugs* were all in the small logic
around it — dedupe, `some` vs `forEach`, immutability, the overflow rule, rect →
coords, the hover-timer, pass-vs-call. Plain JS lets you `node` those to instant
green. The `react/` files are the shell: `createPortal`, a `useRef` to the chip,
`getBoundingClientRect` on hover, and the close-delay — best written from memory,
then diffed against the real component.
