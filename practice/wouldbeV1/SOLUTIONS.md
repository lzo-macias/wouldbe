# Solutions & explanations

Try each problem first — then check here. The *why* matters more than the code.

---

## 01 — Tally by key

```js
function countByOffice(recs) {
    const counts = {};
    for (const rec of recs) {
        counts[rec.office_id] = (counts[rec.office_id] ?? 0) + 1;
    }
    return counts;
}
```

**Why `?? 0`:** the first time you see an office_id, `counts[id]` is `undefined`. `undefined ?? 0` gives `0`, then `+ 1` = 1. Without it you'd get `undefined + 1 = NaN`. This "accumulate into an object" pattern is the workhorse for grouping/counting.

---

## 02 — Earliest per key

```js
function earliestByJurisdiction(deadlines) {
    const map = {};
    for (const d of deadlines) {
        if (!d.deadline_date) continue;              // skip missing
        const existing = map[d.jurisdiction_id];
        if (!existing || d.deadline_date < existing) {
            map[d.jurisdiction_id] = d.deadline_date;
        }
    }
    return map;
}
```

**Two ideas:** (1) `if (!x) continue` skips junk rows early so the rest of the loop stays clean. (2) `!existing || new < existing` = "take it if we have nothing yet, OR if it beats what we have." String `<` works because `"2026-03-01" < "2026-05-01"` is true in ISO format — the digits line up so lexical order = date order. (This ONLY holds for zero-padded `YYYY-MM-DD`.)

---

## 03 — Immutable sort

```js
function rankOffices(offices, counts) {
    return [...offices].sort((a, b) => {
        const diff = (counts[b.id] ?? 0) - (counts[a.id] ?? 0); // count DESC
        return diff !== 0 ? diff : a.office_name.localeCompare(b.office_name); // then name A→Z
    });
}
```

**Immutability:** `.sort()` mutates the array it's called on. In React, mutating state (or props) leads to bugs where the UI doesn't update. `[...offices]` makes a shallow copy first, so the original is untouched. (`offices.slice()` works too.)

**Comparator math:** the callback returns a number. Negative → `a` first, positive → `b` first, `0` → keep order.
- `b - a` → **descending** numbers (bigger first). `a - b` would be ascending.
- `a.localeCompare(b)` → **A→Z** strings. It returns -/0/+ just like the comparator wants.
- The `diff !== 0 ? diff : tie-break` pattern = "sort by the first key; only when it ties, fall back to the second."

---

## 04 — Nullish & optional

```js
function orDefault(value, fallback) { return value ?? fallback; }
function safeData(response)        { return response?.data ?? []; }
function countFor(counts, id)      { return counts[id] ?? 0; }
function usernameOf(rec)           { return rec?.recommender_username ?? "unknown"; }
```

**`??` vs `||`:** `??` only replaces `null`/`undefined`. `||` replaces ALL falsy values (`0`, `""`, `false`, `NaN`). If a real count is `0`, `count ?? 5` keeps `0` (correct), but `count || 5` wrongly becomes `5`. Use `??` when `0`/`""`/`false` are legitimate values.

**`?.`:** `response?.data` reads `.data` only if `response` isn't null/undefined; otherwise it short-circuits to `undefined` instead of throwing `Cannot read properties of null`. Chain them: `rec?.recommender_username ?? "unknown"` = "safely read the name, default if anything's missing." (This is exactly the crash you hit earlier — `null.map` — and `?.`/`??` is how you defend against it.)

---

## 05 — Promise.all

```js
async function loadAll() {
    const [recRes, offRes, dlRes] = await Promise.all([
        fakeApi.get("/recs"),
        fakeApi.get("/offices"),
        fakeApi.get("/deadlines"),
    ]);
    return { recs: recRes.data, offices: offRes.data, deadlines: dlRes.data };
}
```

**Parallel vs sequential:** these three calls don't depend on each other, so there's no reason to wait for one before starting the next. `Promise.all` kicks them off together; total time ≈ the **slowest** one, not the **sum**. If you instead wrote `const a = await get(); const b = await get();` they'd run back-to-back and take longer.

**Order is preserved:** `Promise.all([p1, p2, p3])` resolves to `[r1, r2, r3]` in input order, no matter which finished first — that's why array destructuring lines up correctly.

**Caveat (not tested, but know it):** if ANY promise rejects, `Promise.all` rejects immediately. That's why the real component wraps it in `try/catch`. (`Promise.allSettled` is the variant that waits for all and reports each success/failure.)

---

## 06 — Format date

```js
function formatDeadline(map, jurisdictionId) {
    const iso = map[jurisdictionId];
    if (!iso) return "Filing date TBD";
    return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
}
```

**Guard first:** look it up, bail to a friendly fallback if missing. Rendering `undefined` or a broken date is worse than "TBD".

**`toLocaleDateString`:** turns a `Date` into a human string. `month: "short"` → "Mar", `"numeric"` → 3, `"long"` → "March". The first arg is the locale ("en-US" for deterministic output; `undefined` = the user's browser locale, which is what you usually want in production).

**The timezone gotcha:** `new Date("2026-03-15")` is UTC midnight. If your machine is UTC-5, that instant is `Mar 14, 7pm` locally, so it'd print "Mar 14". Passing `timeZone: "UTC"` pins the display to the date you actually stored. Good to know for any date-only value.

---

## 07 — The React component

```jsx
function OfficeList() {
    const [offices, setOffices] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [offRes, recRes] = await Promise.all([
                    fakeApi.get("/offices"),
                    fakeApi.get("/recs"),
                ]);
                const offs = offRes.data ?? [];
                const recs = recRes.data ?? [];

                const counts = {};
                for (const r of recs) counts[r.office_id] = (counts[r.office_id] ?? 0) + 1;

                const ranked = [...offs]
                    .map((o) => ({ ...o, count: counts[o.id] ?? 0 }))
                    .sort((a, b) => b.count - a.count);

                setOffices(ranked);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    if (loading) return <p>Loading…</p>;

    return (
        <ul>
            {offices.map((o) => (
                <li key={o.id}>{o.office_name} — {o.count} recs</li>
            ))}
        </ul>
    );
}
```

**Answers to the concept-check questions:**

- **`useState(true)` vs `useState([])`:** initial value = the shape you'll use *before data arrives*. `loading` is a boolean flag → `true`. `offices` gets `.map()`-ed in render → must be an array from frame one, or `offices.map` throws on the first render (exactly the `null.map` crash from before). Never init a value you'll `.map()` as `null`.

- **Why `[]` deps (not omitted):** the dependency array controls *when the effect re-runs*. `[]` = run **once**, after the first render (on mount). **Omitting** it = run after **every** render — and since the effect calls `setOffices`, that would trigger another render, another effect, another fetch… an infinite loop. Empty array = "no dependencies, so never re-run."

- **Why the async function is declared *inside*:** the `useEffect` callback's return value is reserved for a **cleanup function**. If you make the callback itself `async`, it returns a Promise, and React would try to call that Promise as cleanup → bug/warning. So you declare `async function load()` inside and call it, keeping the effect callback synchronous.

- **Why `key`:** React uses `key` to match list items to DOM nodes across re-renders. Without a stable, unique key it can't tell which item changed/moved, leading to wrong updates and a console warning. Use a stable id (`o.id`), never the array index if the list can reorder.
```

---

## 07 — Capstone pipeline

```js
async function buildOfficeView(api) {
    const [recRes, offRes, dlRes] = await Promise.all([
        api.get("/recs"), api.get("/offices"), api.get("/deadlines"),
    ]);
    const recs = recRes.data ?? [];
    const offs = offRes.data ?? [];
    const deadlines = dlRes.data ?? [];

    const counts = {};
    for (const r of recs) counts[r.office_id] = (counts[r.office_id] ?? 0) + 1;

    const dlMap = {};
    for (const d of deadlines) {
        if (!d.deadline_date) continue;
        if (!dlMap[d.jurisdiction_id] || d.deadline_date < dlMap[d.jurisdiction_id]) {
            dlMap[d.jurisdiction_id] = d.deadline_date;
        }
    }
    const fmt = (iso) => iso
        ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
        : "Filing date TBD";

    return [...offs]
        .map((o) => ({ id: o.id, office_name: o.office_name, count: counts[o.id] ?? 0, deadline: fmt(dlMap[o.jurisdiction_id]) }))
        .sort((a, b) => (b.count - a.count) || a.office_name.localeCompare(b.office_name));
}
```

**This is `loadData()` minus React.** Notice the shape: fetch (parallel) → derive lookups (`counts`, `dlMap`) → `map` each office into a view-model → `sort`. Building the lookups *first*, then reading from them in the map, is what keeps it O(n) instead of re-scanning arrays inside the loop. The `(b.count - a.count) || a.name.localeCompare(b.name)` trick works because `0` (a tie) is falsy, so `||` falls through to the tie-breaker.

---

## 08 — Resilient allSettled

```js
async function loadResilient(api) {
    const [offR, dlR] = await Promise.allSettled([api.get("/offices"), api.get("/deadlines")]);
    const offices = offR.status === "fulfilled" ? (offR.value.data ?? []) : [];
    const deadlines = dlR.status === "fulfilled" ? (dlR.value.data ?? []) : [];
    const deadlinesFailed = dlR.status === "rejected";

    const dlMap = {};
    for (const d of deadlines) {
        if (!d.deadline_date) continue;
        if (!dlMap[d.jurisdiction_id] || d.deadline_date < dlMap[d.jurisdiction_id]) {
            dlMap[d.jurisdiction_id] = d.deadline_date;
        }
    }
    const items = offices.map((o) => ({
        id: o.id, office_name: o.office_name, deadline: formatDeadline(dlMap, o.jurisdiction_id),
    }));
    return { items, deadlinesFailed };
}
```

**`all` vs `allSettled`:** `Promise.all` is all-or-nothing — one rejection kills everything. `allSettled` always resolves; you get `{status, value}` or `{status, reason}` per item and decide per-request how to degrade. Here, a dead deadlines API still lets offices render (with "TBD"). Use `all` when you truly need every piece; `allSettled` when partial results are useful.

---

## 09 — groupBy

```js
function groupBy(items, keyFn) {
    const acc = {};
    for (const item of items) {
        const k = keyFn(item);
        (acc[k] ??= []).push(item);
    }
    return acc;
}
function groupOfficesByType(offices) {
    return groupBy(offices, (o) => o.office_type);
}
```

**Count vs collect:** Problem 01 did `acc[k] = (acc[k] ?? 0) + 1` (accumulate a *number*). groupBy does `(acc[k] ??= []).push(item)` (accumulate an *array*). Same "fold into an object" skeleton. `acc[k] ??= []` means "if `acc[k]` is null/undefined, set it to `[]`" — and the expression returns the array either way, so you can `.push()` onto it in the same line. Passing a **keyFn** makes it reusable for any bucketing (by type, by state, by first letter…).

---

## 10 — Upcoming, soonest first

```js
function upcomingOffices(offices, deadlines, today) {
    const dlMap = {};
    for (const d of deadlines) {
        if (!d.deadline_date) continue;
        if (!dlMap[d.jurisdiction_id] || d.deadline_date < dlMap[d.jurisdiction_id]) {
            dlMap[d.jurisdiction_id] = d.deadline_date;
        }
    }
    return offices
        .map((o) => ({ id: o.id, office_name: o.office_name, deadline: dlMap[o.jurisdiction_id] }))
        .filter((o) => o.deadline && o.deadline > today)
        .sort((a, b) => a.deadline.localeCompare(b.deadline));
}
```

**The map → filter → sort chain:** each step does one job. `map` attaches the resolved date, `filter` drops anything with no date or a past date (`o.deadline && o.deadline > today` — the `&&` guards against `undefined`, which would otherwise compare weirdly), `sort` orders ascending (soonest first) via `localeCompare` on the ISO strings. Order matters: filter *before* sort so you're not sorting rows you're about to throw away. This is the same toolkit as the capstone, just arranged for a different question.
```
