# Solutions & explanations — WouldBe v2 + Qualify

Try each problem first — then check here. The *why* matters more than the code.

---

## 01 — Filter runnable

```js
function filterRunnable(offices, deadlines, today) {
    const hasAny = new Set();
    const upcoming = new Set();
    for (const d of deadlines) {
        if (!d.deadline_date) continue;
        hasAny.add(d.jurisdiction_id);
        if (String(d.deadline_date).slice(0, 10) >= today) upcoming.add(d.jurisdiction_id);
    }
    return offices.filter((o) => upcoming.has(o.jurisdiction_id) || !hasAny.has(o.jurisdiction_id));
}
```

**Two sets, three states.** A jurisdiction is in one of three buckets: has an upcoming deadline (`upcoming`), had deadlines but all past (`hasAny` but not `upcoming`), or no deadline data at all (not in `hasAny`). We keep the first and third, drop the middle. That middle case — "we *know* the window and it's closed" — is the whole point, and it's why you need `hasAny` separate from `upcoming`: `!hasAny.has(id)` ("no data") is a *different* answer from "data says closed." `Set` gives O(1) membership so the final `.filter` stays O(n). `String(d).slice(0,10) >= today` compares ISO dates lexically (works only for zero-padded `YYYY-MM-DD`); `>=` makes a same-day deadline still count as open.

---

## 02 — Label fallback

```js
function deadlineLabel(office, dlMap) {
    const iso = dlMap[office.jurisdiction_id];
    if (iso) return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    if (office.next_election_year) return `${office.next_election_year} election`;
    return "Filing date TBD";
}
```

**Ordered fallback = most specific first.** Return the moment you have the best answer; only fall through when it's missing. Order is load-bearing: an office can have *both* an upcoming date and a `next_election_year`, and the concrete date must win — so it's checked first. (`en-US` + `timeZone:"UTC"` keep the day from shifting across timezones — same gotcha as v1 problem 06.)

---

## 03 — Annotate qualifies

```js
function annotateQualifies(offices, age) {
    return offices.map((o) => ({ ...o, qualifies: o.min_age == null || age >= o.min_age }));
}
```

**This is the SQL `(min_age IS NULL OR age >= min_age)` in JS.** `.map` transforms *and copies* — `{ ...o, qualifies }` spreads the original then adds the field, so the input array is never mutated (mutating props/state → stale-UI bugs). `o.min_age == null` uses **loose** `==` on purpose: it's true for both `null` and `undefined`, so a missing age floor means "anyone qualifies."

---

## 04 — Relevance tier

```js
function tierOf(m) {
    if (m === "geocodio_district" || m === "point_in_polygon") return "district";
    if (m === "statewide") return "statewide";
    if (m === "national") return "national";
    return "other";
}
```

**A classifier.** Two resolution methods (`geocodio_district`, `point_in_polygon`) collapse to the same `'district'` tier because from the user's point of view both mean "a seat drawn around where I live." A lookup object works too:
```js
const TIER = { geocodio_district: "district", point_in_polygon: "district", statewide: "statewide", national: "national" };
const tierOf = (m) => TIER[m] ?? "other";
```
Pulling this out as its own function is what makes the grouping downstream a one-liner.

---

## 05 — Partition

```js
function partitionOffices(offices) {
    return {
        qualified: offices.filter((o) => o.qualifies),
        districtLater: offices.filter((o) => !o.qualifies && o.relevance_tier === "district"),
        stateLater: offices.filter((o) => !o.qualifies && o.relevance_tier !== "district"),
    };
}
```

**Partition = split one list into several by predicate.** Three `.filter` passes read clearly — each condition is right there. The buckets are mutually exclusive and cover everything, so every office lands in exactly one. (Three passes = three loops; problem 11 folds them into one with `reduce` — same result, different tradeoff.)

---

## 06 — Group by age

```js
function groupByAge(list) {
    const buckets = {};
    for (const o of list) { const age = o.min_age ?? 0; (buckets[age] ??= []).push(o); }
    return Object.keys(buckets).map(Number).sort((a, b) => a - b).map((age) => ({ age, list: buckets[age] }));
}
```

**Fold-into-arrays, then order the keys.** `(buckets[age] ??= []).push(o)` means "create the array if absent, then push" — the assignment returns the array either way. The subtle bug is the sort: **object keys are strings**, so `Object.keys` yields `["18","25","35"]`, and sorting those as strings puts `"100"` before `"25"`. `.map(Number)` before `.sort((a,b)=>a-b)` fixes it — always sort numeric keys numerically.

---

## 07 — Resolve flow

```js
async function resolveAndLoad(api, parts) {
    const address = `${parts.street}, ${parts.city}, ${parts.state} ${parts.zip}`;
    const res = await api.post("/api/users/me/jurisdictions/resolve", { address });
    if (res.data.status === "needs_manual_pin") return { status: "needs_manual_pin" };
    const officesRes = await api.get("/api/offices/relevant");
    return { status: res.data.status, offices: officesRes.data ?? [] };
}
```

**Sequential and *dependent*.** Unlike v1's `Promise.all` (independent calls fired together), here the second call must wait for the first *and* only happens on one branch. The early `return` on `needs_manual_pin` short-circuits so the office fetch never fires when we couldn't resolve — the test proves it by asserting `getCalled === false`. Template literals assemble the address from the four fields in one readable expression.

---

## 08 — Capstone relevant view

```js
async function buildRelevantView(api, age, today) {
    const offices = (await api.get("/api/offices/relevant")).data ?? [];
    const deadlines = (await api.get("/api/deadlines")).data ?? [];

    const annotated = offices.map((o) => ({
        ...o,
        qualifies: o.min_age == null || age >= o.min_age,
        relevance_tier: tierOf(o.resolution_method),
    }));
    const anyQualified = annotated.some((o) => o.qualifies);   // BEFORE filtering

    const runnable = filterRunnable(annotated, deadlines, today);
    const p = partitionOffices(runnable);
    const groups = (list) => groupByAge(list).map((g) => ({ age: g.age, ids: g.list.map((o) => o.id) }));

    return {
        anyQualified,
        qualified: p.qualified.map((o) => o.id),
        districtGroups: groups(p.districtLater),
        stateGroups: groups(p.stateLater),
    };
}
```

**The whole feature: fetch → annotate → classify → filter → partition → group.** The one non-obvious ordering: compute `anyQualified` on the *annotated* set **before** `filterRunnable`. Otherwise a user who qualifies for a seat whose window just closed would be told "you don't qualify (by age)" — wrong. That's exactly the bug the real component avoids by tracking qualification separately from the deadline filter. Notice office `e` in the test: qualified, but its filing date is past, so it's filtered out of `qualified` yet still makes `anyQualified` true.

---

## 09 — some / every

```js
function anyQualified(offices) { return offices.some((o) => o.qualifies); }
function allQualified(offices) { return offices.every((o) => o.qualifies); }
```

**Short-circuiting predicates.** `.some` stops at the first `true`, `.every` at the first `false` — cheaper than `filter(...).length > 0`. Know the empty edge: `[].some(...)` is `false`, `[].every(...)` is `true` (vacuous truth). The feed uses `.some` precisely because an empty relevant set should read as "nothing qualifies" → `false` → show the right empty state.

---

## 10 — Rehydrate cancelled

```js
function makeRehydrate(api, setOffices) {
    let cancelled = false;
    async function run() {
        const res = await api.get("/api/offices/relevant");
        if (cancelled) return;              // resolved after unmount → do nothing
        setOffices(res.data ?? []);
    }
    return { run, cancel: () => { cancelled = true; } };
}
```

**A closure flag turns a late async result into a no-op.** `cancelled` is captured by both `run` and `cancel`; if `cancel()` runs before the awaited fetch resolves, the `if (cancelled) return` guard skips `setOffices`. This is the exact shape of `useEffect(() => { let cancelled = false; …; return () => { cancelled = true; } }, [])` — the cleanup fires on unmount/re-run and neutralizes an in-flight request so React never warns about setting state on an unmounted component (and stale responses can't clobber fresh state).

---

## 11 — Partition via reduce

```js
function partitionReduce(offices) {
    return offices.reduce((acc, o) => {
        if (o.qualifies) acc.qualified.push(o);
        else if (o.relevance_tier === "district") acc.districtLater.push(o);
        else acc.stateLater.push(o);
        return acc;
    }, { qualified: [], districtLater: [], stateLater: [] });
}
```

**One pass instead of three.** Seed the accumulator with all three arrays, push into the right one each iteration, and **return `acc` every step** (forget that and `acc` becomes `undefined` on iteration two). Same output as problem 05's three `.filter`s. Filters win on readability; `reduce` wins when you want a single traversal (huge lists, or when each pass would be expensive). Having both patterns ready is the point.

---

## React A — QualifyForm

```jsx
function QualifyForm({ onQualified }) {
    const [street, setStreet] = useState("");
    const [city, setCity] = useState("");
    const [state, setState] = useState("");
    const [zip, setZip] = useState("");
    const [needsPin, setNeedsPin] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        const address = `${street}, ${city}, ${state} ${zip}`;
        const res = await fakeApi.post("/api/users/me/jurisdictions/resolve", { address });
        if (res.data.status === "needs_manual_pin") { setNeedsPin(true); return; }
        const officesRes = await fakeApi.get("/api/offices/relevant");
        onQualified?.(officesRes.data ?? []);
    }

    if (needsPin) return <p>Drop a pin on your home to finish.</p>;

    return (
        <form onSubmit={handleSubmit}>
            <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street" />
            <input value={city}   onChange={(e) => setCity(e.target.value)}   placeholder="City" />
            <input value={state}  onChange={(e) => setState(e.target.value)}  placeholder="State" />
            <input value={zip}    onChange={(e) => setZip(e.target.value)}    placeholder="Zip" />
            <button type="submit">Find my offices</button>
        </form>
    );
}
```

**Concept-check answers:**

- **Controlled input:** React owns the value. `value={street}` makes state the single source of truth; `onChange` writes every keystroke back into state. They're a pair — set `value` without `onChange` and the field is frozen (read-only); use `onChange` without `value` and it's uncontrolled (React doesn't know the value). Both together = the input always mirrors state, and state is always the truth.
- **`e.preventDefault()`:** a `<form>` submit does a full-page navigation/reload by default, which throws away your SPA and its state. Preventing it lets you handle the submit in JS instead.
- **async function you CALL:** the submit handler *can* be `async` (that's fine for event handlers, unlike a `useEffect` callback). The rule you're half-remembering is about effects — there you declare `async function load()` inside and call it, because the effect's return value is reserved for cleanup. Here `handleSubmit` is an event handler, so `async` on it is OK.
- **office fetch in the `else`:** if resolution failed (`needs_manual_pin`), there are no jurisdictions to load offices from yet — fetching would return nothing useful. Gate it behind success, and `return` early on the pin branch so it can't fall through.

---

## React B — WouldBeRelevant

```jsx
function WouldBeRelevant({ offices = [] }) {
    const qualified = offices.filter((o) => o.qualifies);
    const districtLater = offices.filter((o) => !o.qualifies && o.relevance_tier === "district");
    const stateLater = offices.filter((o) => !o.qualifies && o.relevance_tier !== "district");

    const ageSection = (title, list) =>
        list.length > 0 && (
            <>
                <h2>{title}</h2>
                {groupByAge(list).map(({ age, list }) => (
                    <React.Fragment key={age}>
                        <h3>Eligible at age {age}</h3>
                        {list.map((o) => <Card key={o.id} office={o} />)}
                    </React.Fragment>
                ))}
            </>
        );

    return (
        <div>
            {qualified.length > 0 ? (
                <>
                    <h2>Offices you can run for</h2>
                    {qualified.map((o) => <Card key={o.id} office={o} />)}
                </>
            ) : (
                <p>You don’t qualify for any open offices yet — here’s what’s coming:</p>
            )}
            {ageSection("Not yet — in your districts", districtLater)}
            {ageSection("Statewide & national", stateLater)}
        </div>
    );
}
```

**Concept-check answers:**

- **Derived state:** `qualified` / `districtLater` / groups are *computed from* `offices`. Don't `useState` + `useEffect` to store them — that duplicates the source of truth and goes stale when the prop changes. Compute derived values in the render body; they recompute automatically every render. Reserve `useState` for things you can't derive (raw fetched data, form inputs, toggles).
- **`key`:** React matches list items to DOM nodes by `key` across renders. Without a stable, unique key it can't tell which item moved/changed, causing wrong updates and a warning. Use `o.id`, never the array index for a list that reorders.
- **`<React.Fragment key={age}>`:** the shorthand `<>…</>` can't take a `key`. When you map to a header + N cards per bucket, each bucket needs a key, so you must use the explicit `React.Fragment` form to attach `key={age}`.
- **`? :` vs `&&`:** `cond ? (<A/>) : (<B/>)` renders one of *two* things — right for "qualified list OR fallback message." `cond && (<A/>)` renders `<A/>` or nothing — right for the district/state sections, which simply vanish when empty. (Watch the `&&` footgun: `list.length && <X/>` renders a stray `0` when the list is empty because `0` is falsy-but-renderable; use `list.length > 0 && …`.)
```
