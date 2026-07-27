# Practice — the **Wouldbe** + **StartAnOffice** pages (React **and** CSS)

The earlier sets drilled the *data logic* behind the feed. This one steps up to the
**two whole pages** and — new this time — the **CSS that builds them**. You'll practice
the layout tools (flexbox, grid, positioning, variables, gradients, transitions,
responsive units) as *building blocks*, then see how they stack up into the real pages.

Goal: master the pieces here, then rebuild `Wouldbe.jsx`, `StartAnOffice.jsx`,
`StartAWouldBe.jsx`, and their CSS from memory.

> **Read `CSS-EXPLAINER.pdf` first** — it's the detailed concept-and-command reference
> for everything the CSS challenges exercise. Take notes, then do the problems.

## What's in here

```
01..07-*.js     JS logic + the math that DRIVES the css (node-runnable, self-testing)
css/NN-*.html   a CSS challenge page: a Target beside a Yours you make match
css/NN-*.css    the stub you fill in for that challenge (this is the file you edit)
react/*.jsx     write-from-memory shells of the 2 pages + 2 components
CSS-EXPLAINER.pdf   the detailed CSS breakdown
SOLUTIONS.md    answers + the "why" for every problem
```

## How to run

**JS problems** — fill the TODOs, then:

```bash
node wouldbeandstartawouldbepractice/01-screen-switch.js
```

`✓` = pass, `✗` = fail with expected-vs-got. Do them in order; 07 is the capstone.

**CSS challenges** — open the `.html` in a browser (double-click, or
`open wouldbeandstartawouldbepractice/css/01-flex-split-minwidth.html`). Each page shows a
**Target** (the reference) next to **Yours**. Edit the matching `.css` file, refresh,
and make **Yours** match **Target**. Style only under `.yours` so you never touch the
Target. (The Target's rules live in the HTML's `<style>` — peeking there is like reading
`SOLUTIONS`: try first.)

**React shells** — write the TODOs from memory, then diff against the real components
listed at the top of each file.

## JS order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `01-screen-switch.js` | object-as-switch + the "ready?" gate | `screens[screen]` / `individualOffice ? … : Loading` |
| `02-load-in-order.js` | dependent awaits; use the result, not stale state | `loadDataV2` in StartAnOffice |
| `03-cancelled-effect.js` | the cancel flag that drops stale async results | Wouldbe's `rehydrate` cleanup |
| `04-recommended-vs-adjusted.js` | fixed source-of-truth vs derived slider value | recommended vs `goalCents` |
| `05-rail-progress-percent.js` | data → a CSS variable (`--progress`) | the rail fill math |
| `06-clamp-and-em.js` | responsive units as numbers | `clamp()` headline, `0.55em` subtitle |
| `07-capstone-page-model.js` | **combines 04+05+grouping** into the view-model | all of StartAWouldBe's prep |

## CSS order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `css/01-flex-split-minwidth` | `flex: g s b`, the `min-width:0` shrink fix | `.mainContainer` split |
| `css/02-grid-fr-columns` | grid `fr` ratios, `gap`, equal-height, space-between | `.threepiece` / `.grid` |
| `css/03-absolute-pins` | absolute-in-relative, `translate(-50%,-50%)` centering | rail pin, YOU flag, corner chip |
| `css/04-vars-gradient-rail` | custom properties + gradient hard stops | the progress rail |
| `css/05-hover-transition` | `transition` + `:hover`, `overflow:hidden` reveal | the card's sleek expand |
| `css/06-range-scoped` | range pseudo-elements + scoping to avoid leaks | the goal slider |
| `css/07-sticky-clamp-capstone` | `position:sticky`, `backdrop-filter`, `clamp()`, wrap | the nav + hero |

## How the concepts stack into the pages

- **Wouldbe.jsx** = a `position:relative` page holding a **flex split** (01): fixed
  regulations panel + scrollable card feed. The Qualify modal is a *sibling* that
  toggles a `.blurred` class (a `filter`, not `backdrop-filter`) on the content. Each
  card **expands on hover** (05) to reveal a **positioned** (03) timeline whose rail is a
  **variable-driven gradient** (04).
- **StartAnOffice.jsx** = a thin shell: read the id, **load in order** (02), **gate** the
  render (01), and switch screens from an object map.
- **StartAWouldBe.jsx** = a hero with a **clamp()** headline (06/07), a **grid** of three
  proportional columns (02), a **scoped, restyled slider** (06), and the same
  positioned + variable-driven timeline. It keeps the **recommended goal fixed** while the
  **slider drives** the per-deadline amounts (04) and the rail (05).

## Shared data shapes

```js
office = { id, office_name, jurisdiction_id, goalCents,
           deadlines: [ { type, date } ] }              // date = "YYYY-MM-DD"
jurisdiction = { state_code, name, type }
// recommended goal: GET /api/offices/:id/recommended-goal -> { recommended_goal_cents } (CENTS)

// the CSS boundary: layout math becomes a variable
<div className="rail" style={{ '--progress': `${progress}%` }} />
```
