# Solutions & explanations — the Regulations panel

Try each first — then check here. The *why* matters more than the code.

---

## 01 — Read the right keys

```js
function toIdentifiers({ office, jurisdiction }) {
    return {
        title: `${office.office_name ?? ""} Regulations`,
        state: jurisdiction.state_code ?? "",
        name: office.office_name ?? "",
    };
}
```

The whole lesson: **a missing property is `undefined`, not an error.** `office.name`
didn't throw — it rendered blank, which is harder to notice than a crash. Two traps
in one: the office column is `office_name` (not `name`), and "state" isn't on the
office at all — it lives on the **jurisdiction** as `state_code` (the office only has
`jurisdiction_id`). `?? ""` turns a missing value into a clean blank instead of the
literal string `"undefined"`. When a field is blank in the UI, `console.log` the
whole object and look at the *real* keys — don't guess.

---

## 02 — First filing/petition deadline

```js
const GATING_TYPES = new Set(["filing_close", "petition_filing_deadline"]);

function firstFilingDeadline(deadlines) {
    return [...deadlines]
        .sort((a, b) => a.deadline_date.localeCompare(b.deadline_date))
        .find((d) => GATING_TYPES.has(d.deadline_type)) ?? null;
}
```

`find` returns the **first** match, so sorting ascending first means we get the
**earliest** gating deadline. A `Set` of allowed types reads better than
`d.type === "a" || d.type === "b"` and scales if the list grows. `[...deadlines]`
copies before sorting — `sort` mutates in place, and mutating a prop/state array is
a subtle bug. Normalize `find`'s `undefined` to `null` so callers have one "nothing"
value. (In the component the array is already sorted, so it's just `.find(...)`; here
we sort to make the exercise self-contained.)

---

## 03 — Deadline label lookup

```js
function deadlineLabel(type) {
    return DEADLINE_LABELS[type] ?? type;
}
```

The API sends machine codes; the words live in a frontend dictionary. There is **no
`label` field** on a deadline row — assuming one (`deadline.label`) is why that field
rendered blank. `map[key] ?? key` is the safe lookup: a known code becomes words, an
unknown code falls back to the raw code (a machine string on screen beats the word
"undefined"). Keep the enum in the data, translate only at the edge.

---

## 04 — Format a UTC timestamp, no day-slip

```js
function formatDeadlineDate(value) {
    const ymd = String(value).slice(0, 10);          // "2026-08-07"
    return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
}
```

`"2026-08-07T04:00:00.000Z"` is 4 AM **UTC**; formatted in a US timezone that lands on
**Aug 6** — the classic off-by-one. The fix is to throw away the time and keep only
the calendar date (`slice(0, 10)`), which works whether the input is a full timestamp
or a bare `YYYY-MM-DD`. For a deterministic test we pin `"en-US"` + `timeZone: "UTC"`
so the string is identical on every machine. (The real component uses the browser's
locale and `T00:00:00` local — same idea; here we pin it so tests don't flake.)

---

## 05 — Build the report description

```js
function buildReport(fieldLabel, message) {
    const trimmed = message.trim();
    if (!trimmed) return null;
    return `${fieldLabel} — ${trimmed}`;
}
```

Trim **before** validating — `"   "` is not real content, and an empty report is
worse than none. Returning `null` is a sentinel meaning "don't send"; the caller
checks it (`if (!desc) return`) instead of firing a useless request. The template
literal attaches *which field* the complaint is about, so the change-report is
actionable (`"Min age — should be 25"`).

---

## 06 — Toggle + derived label

```js
function nextEditing(prev) { return !prev; }
function editLabel(editing) { return editing ? "Exit" : "Edit"; }
```

`setEditing((v) => !v)` — the **functional updater** — computes the next value from
the *previous* one React hands you, which is correct even when updates batch. The
label is **derived** from state (`editing ? "Exit" : "Edit"`), not stored in a second
piece of state that could drift out of sync with `editing`. One source of truth.

---

## 07 — Pass a handler, don't call it

```js
function makeHandler(fn, ...args) {
    return () => fn(...args);
}
```

This is the bug we hit over and over: `onClick={onComplete()}` **calls** `onComplete`
*during render* and gives React the return value. If it sets state, React yells
("Cannot update a component while rendering") or loops forever. `makeHandler` models
the fix — it returns a **function** that fires `fn` only when *it's* called (on the
event). Building the handler doesn't run `fn`; calling the returned function does.
That's the exact difference between `onClick={fn()}` (call now) and
`onClick={() => fn()}` (call later). The closure also captures `args` for "call it
later with these."

---

## 08 — Capstone: the whole view-model

```js
function toRegulationsView({ office, jurisdiction, eligibility }) {
    const filingRow = [...(office.deadlines ?? [])]
        .sort((a, b) => a.deadline_date.localeCompare(b.deadline_date))
        .find((d) => GATING_TYPES.has(d.deadline_type));

    return {
        title: `${office.office_name ?? ""} Regulations`,
        state: jurisdiction.state_code ?? "",
        name: office.office_name ?? "",
        minAge: eligibility.min_age ?? null,
        citizenship: eligibility.citizenship_requirement ?? null,
        jurisdictionType: jurisdiction.type ?? null,
        filing: filingRow
            ? {
                label: DEADLINE_LABELS[filingRow.deadline_type] ?? filingRow.deadline_type,
                date: formatDeadlineDate(filingRow.deadline_date),
              }
            : null,
        source: eligibility.eligibility_source_url ?? null,
    };
}

function formatDeadlineDate(value) {
    const ymd = String(value).slice(0, 10);
    return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
}
```

Nothing new — it's 01–04 snapped together. `office.deadlines ?? []` handles the
missing-array case so `.sort` never throws (the component writes it as
`office.deadlines?.find`). Every field defaults to `null`/`""` so the model has no
`undefined` holes. Once this exists, the JSX is almost dumb: read a field, wrap it in
`<EditableField>`, done. **That's the point** — push the "which key / which object /
how to format / guard the empties" decisions into tested plain JS, and the component
becomes a thin, predictable shell.

---

## react/EditableField.jsx & react/Regulations.jsx

No auto-tests — write from memory, then diff against
`coolpeoplev3-frontend/src/assets/component/Wouldbe/Regulations/Regulations.jsx`.
The concept-check answers:

- **Module scope:** if `EditableField` were defined *inside* `Regulations`, it'd be a
  brand-new component type on every parent render → React unmounts/remounts it →
  the `<input>` loses its state and focus mid-keystroke. Defined at module scope, it's
  the same type across renders, so its local state persists.
- **State lives in the child:** each line owns its own `hovered` + `message`. Putting
  it there means Regulations needs **zero** per-line bookkeeping (no array of hover
  booleans, no map of messages) — the wrapper encapsulates it.
- **`onMouseEnter={setHovered(true)}`** calls `setHovered(true)` *during render* →
  update-during-render loop. Must be `() => setHovered(true)`.
- **Controlled input:** `value={message}` + `onChange={(e) => setMessage(e.target.value)}`.
  The arrow must take `e` — `onChange={() => setMessage(e.target.value)}` throws
  because `e` is undefined.
- **Left vs right:** the form renders **after** `{children}` in the flex row → it sits
  to the **right**. Move it before `{children}` and it jumps left.
- **Fetch effect guard:** `if (!office?.id) return` stops a request to
  `/api/offices/undefined/eligibility` while the parent is still loading; `[office?.id]`
  makes it refetch when (and only when) the office changes. With **no** dep array it
  ran every render and looped.
- **await in effects:** you can't make the effect callback `async`; define an inner
  `async function LoadData()` and call it.
- **Edit helper visibility:** the "sometimes we make mistakes…" line shows only when
  `!editing`, so it doesn't collide with the inline edit inputs that appear in edit
  mode.
