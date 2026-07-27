# Solutions & explanations — the scrollable category flyout

Try each first — then check here. The *why* matters more than the code.

---

## 01 — Unique groups

```js
function uniqueGroups(categories) {
    return [...new Set(categories.map(c => c.category_group))];
}
```

`map` gives one group string per row, **with duplicates** (15 groups spread over
~106 rows). `new Set(...)` throws the duplicates away and, crucially, **keeps
first-insertion order**, so the row stays in a stable order. `[...set]` (or
`Array.from(set)`) turns it back into an array to `.map` over in JSX. The bug this
prevents: rendering `<li key={group}>` off the raw mapped list gives repeated keys
→ React's "each child needs a unique key" warning, and reconciliation gets
confused about which chip is which.

---

## 02 — Interests in a group

```js
function interestsInGroup(allInterests, category_group) {
    return allInterests.filter(i => i.category_group === category_group);
}
```

`filter` returns a **new** array of just the matches and never touches the source.
Straightforward — the only trap is comparing the wrong field (`category_key`
instead of `category_group`) or forgetting that no matches is a valid `[]`, not an
error.

---

## 03 — Is selected

```js
function isSelected(myInterests, key) {
    return myInterests.some(i => i.category_key === key);
}
```

`some` returns a **real boolean** and stops at the first match. The two wrong
versions we actually wrote:

- `myInterests.forEach(i => i.category_key === key)` — `forEach` **always returns
  `undefined`**. It's for side effects; used as a condition it's permanently
  falsy, so nothing ever highlighted.
- `myInterests.includes(key)` — `includes` does `===` against **whole elements**.
  The array holds **objects**, and `{…} === "mental_health"` is never true. You
  can't reach inside an object with `includes`; `some` lets you compare a field.

---

## 04 — Toggle interest

```js
function toggleInterest(prev, key, all) {
    return prev.some(i => i.category_key === key)
        ? prev.filter(i => i.category_key !== key)
        : [...prev, all.find(i => i.category_key === key)];
}
```

Three ideas: (1) decide present-or-not with `some`; (2) removing = `filter` out the
match → a **new** array; (3) adding = spread a **new** array with the object
appended. We store the **whole object** (looked up with `find`) because the UI
elsewhere reads `display_name`/`category_group` off it — but we send only the keys
to the API (`myInterest.map(i => i.category_key)`). Never `prev.push(...)`: mutating
state in place means React sees the same array reference and may skip the
re-render.

---

## 05 — Overflow clip rule

```js
function computedOverflowY(overflowX, overflowY) {
    // if the other axis is non-visible, a 'visible' here computes to 'auto'
    if (overflowX !== "visible" && overflowY === "visible") return "auto";
    return overflowY;
}

function clipsBelowFlyout(overflowX, overflowY) {
    return computedOverflowY(overflowX, overflowY) !== "visible";
}
```

This is the whole reason the dropdown disappeared. To scroll sideways the slider
needs `overflow-x: auto`. Per the CSS spec, once **one** axis is non-`visible`, a
`visible` on the **other** axis is forced to `auto` — a scroll container that
**clips** its overflow. So `overflow-x:auto; overflow-y:visible` clips anything
hanging below, including the flyout. There is **no** way to have real horizontal
scroll and a truly-visible vertical overflow on the same element — which is why the
real fix isn't a CSS tweak, it's rendering the menu **outside** this element (06 +
the portal).

---

## 06 — Menu position

```js
function menuPosition(rect) {
    return { top: rect.bottom, left: rect.left, minWidth: rect.width };
}
```

Once the menu is portaled to `<body>`, nothing positions it for us. `element
.getBoundingClientRect()` returns the chip's box in **viewport** coordinates, and
`position: fixed` is also measured against the viewport — so we can use the numbers
directly with no `scrollY`/`scrollX` math. `top = rect.bottom` sets the menu's top
edge to the chip's bottom edge (directly underneath); `minWidth = rect.width` stops
a short menu from being narrower than its chip.

> Caveat worth knowing: because we snapshot the rect on hover, the menu won't
> follow if the page scrolls while it's open. It closes on mouse-leave anyway, so
> it rarely matters; to make it bulletproof you'd recompute on `scroll`/`resize`.

---

## 07 — Hover open/close (the delay)

```js
function hoverReducer(state, action) {
    switch (action) {
        case "ENTER_CHIP": return { open: true, closeScheduled: false };
        case "ENTER_MENU": return { ...state, closeScheduled: false };
        case "LEAVE":      return { ...state, closeScheduled: true };
        case "TICK":       return state.closeScheduled
            ? { open: false, closeScheduled: false }
            : state;
        default:           return state;
    }
}
```

The menu is portaled, so it is **not** inside the chip. Moving the mouse from chip
to menu fires the chip's `mouseleave` — a naive close-on-leave would shut the menu
before you reach it. So `LEAVE` only **schedules** a close; entering the menu
(`ENTER_MENU`) **cancels** it; the timer firing (`TICK`) closes only if still
scheduled. In React this is `closeTimer.current = setTimeout(() => setOpen(false),
120)` on leave, and `clearTimeout(closeTimer.current)` on enter. The timer id lives
in a **ref** (not state) because changing it shouldn't trigger a re-render.

---

## 08 — Handler vs call

```js
function passHandler(fn) { return fn; }      // hand back the reference
function callHandler(fn) { return fn(); }    // CALL it now (the bug)
```

An event prop wants a function to invoke **later**. `onMouseEnter={open}` passes the
reference. `onMouseEnter={open()}` **evaluates `open()` during render** and passes
its return value as the "handler." When `open` (or `setHovered(true)`) sets state,
that state change re-renders, which calls it again → **"Too many re-renders."** The
safe forms are a bare reference (`{open}`) or a fresh wrapper (`{() => open()}`),
which creates a function that calls `open` only when the event fires.

---

## 09 — Capstone: the flyout view-model

```js
function buildFlyoutModel({ categories, allInterests, myInterests, activeGroup, rect }) {
    const groups = [...new Set(categories.map(c => c.category_group))];      // 01
    if (activeGroup == null) return { groups, active: null };

    const items = allInterests
        .filter(i => i.category_group === activeGroup)                       // 02
        .map(i => ({
            key: i.category_key,
            label: i.display_name,
            selected: myInterests.some(m => m.category_key === i.category_key), // 03
        }));

    return {
        groups,
        active: {
            group: activeGroup,
            position: { top: rect.bottom, left: rect.left, minWidth: rect.width }, // 06
            items,
        },
    };
}
```

Everything the UI needs, pre-computed: the distinct `groups` for the scroll row,
and — only when something is hovered — an `active` block with the menu's
`position` and its `items` already marked `selected`. `activeGroup == null` cleanly
means "no menu open," and in that branch we never touch `rect`. The payoff: the
component becomes a dumb renderer — map `groups` to chips, and if `active`, render
a fixed `<ul>` at `active.position` from `active.items`.

---

## 10 — Component identity (why the menu closed on click)

```js
function sameAcrossRenders(renderFn) {
    return renderFn() === renderFn();
}
```

`unstableRender` defines `Inner` inside itself, so each call returns a **different
function object** → `false`. `stableRender` returns a module-scope function, so
every call is the **same reference** → `true`.

Map that back to the bug: `MyInterestsDropDown` was declared inside
`ChooseYourIssues`. React reconciles by **component identity** (the function
reference). A new reference every parent render reads as a *different component
type*, so React **unmounts the old subtree and mounts a new one** — throwing away
`hovered`, `pos`, and the refs. Since clicking an interest calls `toggle`, which
updates `myInterest`, which re-renders the parent... every click remounted the
flyout with `hovered = false`. No hover-tracking can survive a remount.

**The fix:** move the component to **module scope** and pass everything it needs via
props (`allInterests`, `toggle`, …). Stable reference → React keeps the instance →
state survives across parent re-renders. **Rule: never define a component inside
another component's body.**

---

## The CSS (`react/flyout.css`)

The CSS is the other half of the portal fix. Three rules matter:

- **`.categoryslider { overflow-x: auto }`** makes the row scroll — and is exactly
  what would clip a normal (inline) dropdown. You can't pair scroll on one axis
  with visible overflow on the other (problem 05), so the menu has to leave.
- **`.categoryslider > * { flex: 0 0 auto }`** stops flex from shrinking the chips
  to fit; without it they'd compress instead of overflowing, and nothing would
  scroll.
- **`.categoryDropdown { position: fixed }`** — the portaled menu is positioned by
  JS from the chip's `getBoundingClientRect()` (viewport coords), which `fixed`
  matches directly. The rest (`max-height` + `overflow-y: auto`, border, shadow) is
  just making it read as a floating card.

The `.categoryDropdownWrap` no longer *needs* `position: relative` (the menu isn't
anchored to it anymore — it's `fixed`, placed by JS); it's just the hover boundary.

---

## React A & B — the portal shell

The pieces, assembled:

- **`useRef` on the chip** (`wrapRef`) so we can measure it: `wrapRef.current
  .getBoundingClientRect()`.
- **`createPortal(<ul/>, document.body)`** renders the menu at the end of `<body>`,
  physically outside `.categoryslider`, so the scroll container's clipping (05) can
  never touch it. The portal keeps the `<ul>` in *this* component's tree for
  state/props/events — only its **DOM location** moves.
- **`position: fixed`** + the rect coords (06) place it under the chip.
- **The close delay** (07): `onMouseLeave` on both the chip and the menu schedules
  a close; `onMouseEnter` on the menu cancels it; the timer id is a ref.
- **Pass, don't call** (08): `onMouseEnter={handleOpen}`, never `handleOpen()`.
- **`children`**: the chip `<li>` is written between `<CategoryFlyout>…</CategoryFlyout>`
  and rendered via `{children}` — that's how the wrapper decorates a chip it doesn't
  own.
- **The key** goes on the outer `<CategoryFlyout>` (the element `.map` returns),
  not the inner `<li>`.

The one-line summary of the whole feature: **a portal lets a menu live in the React
tree while its DOM escapes the scroll container that would otherwise clip it — and
everything else (rect → coords, hover delay, pass-not-call) is what makes that
escaped menu behave.**
