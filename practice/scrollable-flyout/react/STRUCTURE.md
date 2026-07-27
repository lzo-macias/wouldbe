# How the slider + dropdown is structured (React + CSS together)

Read this once, then rebuild `CategoryFlyout.jsx` / `CategorySlider.jsx` from
memory. This is the "big picture" the numbered problems zoom into.

## The component tree

```
ChooseYourIssues                     ← owns the DATA + the toggle
│  state: allInterests[], myInterest[], allCategories[]  (the source of truth)
│  fn:    toggle(key)  ← the ONLY thing that changes myInterest
│
└── <ul class="categoryslider">      ← the horizontal scroll row (CSS §1)
     └── allCategories.map(group =>
          <MyInterestsDropDown            ← ONE per category group
             key={group}                  ← key on the OUTER mapped element
             allInterests myInterests
             category_group={group}
             toggle={toggle}>             ← data + behavior flow DOWN as props
             <li class="Category">…</li>  ← the chip, passed as `children`
          </MyInterestsDropDown>
       )

MyInterestsDropDown                   ← owns only the HOVER/position UI state
│  state: hovered, pos{top,left,minWidth}
│  refs:  wrapRef, closeTimer, overChip, overMenu
│  renders: {children}  (the chip)  +  (hovered && a PORTAL)
│
└── createPortal(
       <ul class="categoryDropdown">   ← rendered into document.body (CSS §3)
          items.map(i => <li onClick={() => toggle(i.category_key)} />)
       , document.body)
```

## Who owns what state (the important split)

- **Data lives in the parent** (`ChooseYourIssues`): the interests, the user's
  selections (`myInterest`), and `toggle`. There is ONE source of truth, and
  every flyout reads from it via props. Clicking an item calls the parent's
  `toggle`, `myInterest` updates, and every flyout re-renders with fresh props —
  so a selection made in one dropdown is reflected everywhere.
- **UI state lives in the child** (`MyInterestsDropDown`): whether ITS menu is
  open (`hovered`) and where to draw it (`pos`). This is local because it's nobody
  else's business — 15 flyouts each track their own hover independently.

Data flows **down** (props); events flow **up** (calling the `toggle` prop). The
child never owns the selection; it only *requests* a change.

## The DOM vs the React tree (the portal twist)

`createPortal(node, document.body)` renders `node` into a **different DOM
location** (`<body>`) while keeping it in the **same React tree**. So:

- **DOM-wise** the menu is a child of `<body>` → it is OUTSIDE `.categoryslider`,
  so that container's `overflow` clipping can't touch it. (This is the whole
  reason the portal exists — see CSS §1 + problem 05.)
- **React-wise** the menu is still a child of `MyInterestsDropDown` → it keeps its
  props, state, context, and event handlers as if it were inline.

Because the DOM node moved but nothing positions it anymore, WE position it:
measure the chip with `getBoundingClientRect()` (viewport coords) and set the
menu's `top`/`left` inline with `position: fixed` (problem 06 + CSS §3).

## Two bugs that are really the SAME shape (state getting wiped)

1. **Defining the child inside the parent** (problem 10). If
   `MyInterestsDropDown` is declared *inside* `ChooseYourIssues`, it's a NEW
   function every parent render → React remounts it → `hovered` resets → the menu
   closes the instant you click an item (which re-renders the parent via
   `toggle`). Fix: define it at **module scope**; pass everything via props.

2. **Closing on a spurious mouseleave** (problem 07). Even with stable identity, a
   re-render can fire a stray `mouseleave`. So closing is guarded: `overChip` and
   `overMenu` refs track where the pointer actually is, and the delayed close only
   fires `setHovered(false)` when the pointer is over **neither**. Refs (not
   state) because the timer must read their latest value without re-rendering.

## The build order, end to end

1. Parent loads data, derives `allCategories` = unique groups (problem 01).
2. Parent maps groups → a `MyInterestsDropDown` per group, passing the chip as
   `children` and `toggle` as a prop.
3. On hover, the flyout measures its chip (06) and opens; the menu is portaled to
   `<body>` (escaping the scroll clip, 05) and positioned `fixed`.
4. The menu lists that group's interests (02), each marked selected via `some`
   (03); clicking calls the parent's `toggle` (04), which updates `myInterest`.
5. Closing is delayed + guarded so clicks and re-renders don't dismiss it (07),
   and the whole child sits at module scope so it never remounts (10).

CSS and React are **two halves of one fix**: the CSS makes the row scroll (and
would clip), the React portals the menu out and positions it so it doesn't.
