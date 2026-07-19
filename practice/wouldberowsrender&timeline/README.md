# Practice — WouldBeRows **render** + the deadline **timeline**

The earlier sets (`../wouldbeV1`, `../wouldbeandqualifyv2`) drilled the *data logic*
of the feed. This set is about the **interactive card**: the hover swap, the
recommended-goal fetch, and — the star — the **deadline timeline** you build inside
the hovered card (positioning, spacing, the "you" marker, the goal tag).

Read **`EXPLAINER.pdf`** first (take notes on it), then do the problems.

Same rules as always: every `.js` file has a **stub you fill in** and **tests that
run immediately**:

```bash
node "wouldberowsrender&timeline/01-group-merge-deadlines.js"
```

(The folder name has an `&`, so quote the path.) ✓ = pass, ✗ = fail with expected
vs. got. Answers + the *why* are in `SOLUTIONS.md` — try first, peek after.

## Order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `01-group-merge-deadlines.js` | Map accumulator keyed by date; merge same-day | `byDate` in `DeadlineTimeline` |
| `02-proportional-position.js` | date → % across `[min,max]` span | the *first* spacing design |
| `03-even-spacing.js` | index → % across `n-1` gaps | the spacing we **shipped** |
| `04-format-usd.js` | cents → `$250,000` via `Intl` | `formatUSD()` (goal tag) |
| `05-collision-stagger.js` | greedy row assignment to dodge overlap | the stagger we tried, then dropped |
| `06-fold-today.js` | insert the "Today" marker into the points | the `byDate`/`isToday` fold |
| `07-capstone-timeline-model.js` | **combines 01/03/04/06** into the view-model | all of `DeadlineTimeline`'s prep |
| `react/DeadlineTimeline.jsx` | absolute + `translateX(-50%)` positioning, keys | the timeline JSX |
| `react/HoverCard.jsx` | hover state + lazy fetch + conditional render | `RenderCard` in `WouldBeRows` |

## The story the problems tell (and the PDF explains)

We tried **three** ways to lay out the deadlines, and the problems walk that arc:

1. **Proportional** (02): honest spacing, but labels bunch up and overlap.
2. **Collision stagger** (05): keep proportional, drop close labels to lower rows.
   Worked, but the card grew tall and the rows had a subtle vertical-overlap bug.
3. **Even spacing** (03): give up strict proportionality so every label fits on one
   row, no overlap, and the card stays the **fixed size of a collapsed card**.

07 assembles the shipped version (even spacing) end-to-end.

## The shared data shapes

```js
office   = { id, state_code, office_name, jurisdiction_id,
             deadlines: [ { type, date } ] }          // date = "YYYY-MM-DD"
// recommended goal comes from GET /api/offices/:id/recommended-goal
//   -> { recommended_goal_cents: 25000000 | null }   // integer CENTS

// the view-model your capstone builds:
model = { goalLabel: "$250,000" | null,
          points: [ { date, labels: [str], isToday: bool, left: 0..100 } ] }
```

## Why mostly plain `.js`

The hard part is the *layout math* (grouping, spacing, the stagger), and plain JS
lets you `node` it for instant feedback. React (`useState`, hover handlers,
conditional render, `key`s, absolute positioning) is the shell — that's the two
`react/` files, best written from memory and compared against the real components
and `EXPLAINER.pdf`.
