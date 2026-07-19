# Practice — the concepts behind `WouldBeRows`

Each file below isolates ONE technique from the `WouldBeRows` component so you can
drill it on its own. Every `.js` problem has a **stub you fill in** and **tests that
run immediately** — no setup, just:

```bash
node practice/01-tally-by-key.js
```

You'll see ✓ (pass) or ✗ (fail with expected vs. got). Keep editing the stub until
all checks pass. Answers + explanations are in `SOLUTIONS.md` — try first, peek after.

## Order (easy → hard)

| File | Concept | Mirrors in the component |
|------|---------|--------------------------|
| `01-tally-by-key.js` | Count occurrences into an object | `officeCounts` (recs per office) |
| `02-earliest-per-key.js` | Keep the min value per key | `dlMap` (soonest filing date per jurisdiction) |
| `03-immutable-sort.js` | Copy-then-sort, comparator, tie-break, `localeCompare` | `ranked` offices |
| `04-nullish-optional.js` | `??` and `?.` | `?? 0`, `?? []` everywhere |
| `05-promise-all.js` | Parallel async + array destructuring | the `Promise.all([...])` fetch |
| `06-format-date.js` | Lookup + date formatting + fallback | `formatDeadline()` |
| `07-capstone-pipeline.js` | **Combines 01–06** in one tested async function | the whole `loadData()` |
| `react/OfficeList.jsx` | useState + useEffect + render | the whole component (React shell) |

## Stretch (after you're comfortable)

| File | Concept |
|------|---------|
| `08-stretch-allsettled.js` | `Promise.allSettled` — show partial data when one request fails |
| `09-stretch-groupby.js` | `groupBy` — bucket items into arrays (vs. just counting) |
| `10-stretch-upcoming.js` | filter to future deadlines + sort soonest-first |

**Not all React on purpose:** 01–10 are plain `.js` because the tricky part of the
component is the *data logic*, and plain JS lets you `node` it for instant feedback.
React (`useState`/`useEffect`/rendering) is just the shell — that's `07-capstone` (the
logic) plus `react/OfficeList.jsx` (the shell). Do the logic first; the React gets easy.

## The shared data shapes (same as the real backend)

```js
recommendation = { id, office_id, recommender_username }
office         = { id, office_name, office_type, jurisdiction_id }
deadline       = { jurisdiction_id, deadline_type, deadline_date } // date = "YYYY-MM-DD"
```
