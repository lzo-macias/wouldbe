# Practice — the **Regulations** panel (fetch, shapes, and the hover-to-edit UI)

The earlier sets drilled the feed's *data logic* (`../wouldbeV1`,
`../wouldbeandqualifyv2`) and the card's *layout math* (`../wouldberowsrender&timeline`).
This set is about the **Regulations panel** on the "Start an office" screen — the
one that shows an office's eligibility rules and lets a user flag anything wrong.

It's built from small, boring-but-sharp pieces we actually got wrong at least once
while building it: reading the **right keys** off the API, picking the **soonest
gating deadline**, **formatting** a UTC timestamp without slipping a day, and the
React shell — **fetch-on-mount**, **toggle state**, **per-line local state**, and
the bug we hit *five times*: **calling a handler during render instead of passing
it**.

Same rules as always: every `.js` file has a **stub you fill in** and **tests that
run immediately**:

```bash
node regulations/01-read-api-shapes.js
```

✓ = pass, ✗ = fail with expected vs. got. Answers + the *why* are in
`SOLUTIONS.md` — try first, peek after. The two `react/` files have no runner;
write them from memory, then diff against the real component.

## Order (easy → hard)

| File | Concept | Mirrors in the code |
|------|---------|---------------------|
| `01-read-api-shapes.js` | read the RIGHT keys; missing = `undefined`, not a crash | `office.office_name`, `jurisdiction.state_code` (the blank-header bug) |
| `02-first-filing-deadline.js` | Set membership + sort + `find` | `office.deadlines?.find(...)` → `filingDeadline` |
| `03-label-lookup.js` | machine code → words, `?? raw` fallback | `DEADLINE_LABELS[type]` |
| `04-format-deadline-date.js` | slice a UTC timestamp → local date, no TZ slip | `formatDeadlineDate()` |
| `05-report-description.js` | trim + guard + template the report payload | `EditableField.handleSubmit` |
| `06-toggle-and-label.js` | functional toggle + label derived from state | the Edit ⇄ Exit button |
| `07-handler-vs-call.js` | pass a function vs. CALL it during render | `onClick={() => onComplete()}` (the recurring bug) |
| `08-capstone-regulations-view.js` | **combines 01–04** into the view-model | everything the panel reads |
| `react/EditableField.jsx` | per-line local state, controlled input, module scope | the hover-to-report wrapper |
| `react/Regulations.jsx` | fetch-on-mount, guarded render, edit toggle | the whole panel shell |

## The story the problems tell

The panel *looked* simple but every field was a chance to read the wrong key:

1. **Wrong keys shipped blank** (01). `office.name`/`office.state` don't exist —
   they're `office.office_name` and (on a *different* object) `jurisdiction.state_code`.
   Reading a missing key is `undefined`, which renders as nothing — no error to
   catch, just an empty header.
2. **One deadline, the right one** (02–03). Of ~12 deadline types we only surface
   the soonest *filing/petition* one, translated to words.
3. **Dates that don't slip** (04). Postgres sent `2026-08-07T04:00:00.000Z`; naive
   formatting shows **Aug 6** in US timezones. Slice to the calendar date first.
4. **The edit affordance** (05–07 + react). Hover a line in edit mode → report
   what's wrong. Each line owns its own tiny state; the button toggles the mode;
   and every handler must be *passed*, never *called during render*.
5. **Compose it** (08). Small tested helpers snap into one view-model, so the JSX
   just reads fields.

## The shared data shapes

```js
// GET /api/offices/:id            (SELECT * FROM office)
office       = { id, office_name, jurisdiction_id,
                 deadlines?: [ { deadline_type, deadline_date } ] } // date: "YYYY-MM-DD" or full ISO

// GET /api/jurisdictions/:id
jurisdiction = { id, name, state_code, type }

// GET /api/offices/:id/eligibility
eligibility  = { min_age, citizenship_requirement, citizenship_years_required,
                 residency_requirement, residency_duration,
                 eligibility_is_encoded, eligibility_source_url, eligibility_notes }

// the view-model the capstone builds:
model = { title, state, name, minAge, citizenship, jurisdictionType,
          filing: { label, date } | null, source }
```

> ⚠️ There is **no** `office.name`, **no** `office.state`, **no** `deadline.label`.
> Those non-existent keys are exactly the bugs this set trains you to stop writing.

## Why mostly plain `.js`

The hard part isn't JSX — it's the dozen small decisions *behind* each line: which
key, which object, which deadline, how to format, what to do when it's missing.
Plain JS lets you `node` those to instant green. React (`useEffect` fetch, toggle
state, per-line state, controlled inputs, handler-vs-call) is the shell — the two
`react/` files, best written from memory and diffed against the real component.
