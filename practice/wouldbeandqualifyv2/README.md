# Practice — the concepts behind WouldBe **v2** + Qualify

v1 (in `../wouldbeV1/`) drilled the original `WouldBeRows`. This set covers what we
added in v2: the **qualify-aware, tiered feed** and the **Qualify flow** — hiding
closed windows, the year fallback, age eligibility, the three relevance tiers, the
address→resolve→load flow, and persistence.

Same rules as before: every `.js` file has a **stub you fill in** and **tests that
run immediately** — no setup, just:

```bash
node wouldbeandqualifyv2/01-filter-runnable.js
```

✓ = pass, ✗ = fail (with expected vs. got). Edit the stub until all checks pass.
Answers + the *why* are in `SOLUTIONS.md` — try first, peek after.

## Order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `01-filter-runnable.js` | Two Sets + date compare: hide closed windows, keep no-data | `runnable` filter in `WouldBeRows` |
| `02-label-fallback.js` | Ordered fallback: date → year → TBD | `formatDeadline()` |
| `03-annotate-qualifies.js` | `.map` + boolean derivation + `== null` | `qualifies` in `getRelevantOffices` |
| `04-relevance-tier.js` | Classify one value into buckets | the `relevance_tier` CASE |
| `05-partition-offices.js` | Split one list into three by predicate | `qualified` / `districtLater` / `stateLater` |
| `06-group-by-age.js` | groupBy into arrays + numeric key sort | `groupByAge()` ("Eligible at 18/25/30") |
| `07-resolve-flow.js` | Sequential DEPENDENT async + status branch | `Qualify` handleSubmit |
| `08-capstone-relevant-view.js` | **Combines 01–06** into the view model | relevant-mode prep in `WouldBeRows` |
| `react/QualifyForm.jsx` | Controlled inputs + submit + branch | `Qualify.jsx` |
| `react/WouldBeRelevant.jsx` | Derived state + grouped conditional render + keys | relevant-mode JSX |

## Stretch (after you're comfortable)

| File | Concept |
|------|---------|
| `09-stretch-some-every.js` | `.some` / `.every` + the empty-array edge |
| `10-stretch-rehydrate-cancelled.js` | the `cancelled` cleanup flag that no-ops a stale `setState` |
| `11-stretch-partition-reduce.js` | do the partition in one `reduce` pass |

**Why mostly plain `.js`:** the hard part is the *data logic*, and plain JS lets you
`node` it for instant feedback. React (`useState`/controlled inputs/grouped render)
is the shell — that's the two `react/` files, best written from memory and compared
against the real components.

## The shared data shapes (same as the real backend)

```js
// from GET /api/offices/relevant — each office is pre-annotated:
office   = { id, office_name, jurisdiction_id, min_age,
             resolution_method,        // 'geocodio_district' | 'point_in_polygon' | 'statewide' | 'national'
             qualifies,                // age >= min_age (or min_age null)
             relevance_tier,           // 'district' | 'statewide' | 'national'
             next_election_year }      // e.g. 2027, or null
deadline = { jurisdiction_id, deadline_type, deadline_date } // date = "YYYY-MM-DD"
```

> Note: problems 03 and 04 have you COMPUTE `qualifies` and `relevance_tier` yourself
> (that's the SQL the backend runs). The later problems then take them as given.
