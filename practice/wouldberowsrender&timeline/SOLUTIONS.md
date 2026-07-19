# Solutions & explanations — WouldBeRows render + timeline

Try each first — then check here. The *why* matters more than the code. The full
narrative (with diagrams) is in `EXPLAINER.pdf`.

---

## 01 — Group + merge deadlines

```js
function groupByDate(deadlines) {
    const byDate = new Map();
    for (const d of deadlines) {
        const label = DEADLINE_LABELS[d.type] ?? d.type;
        if (byDate.has(d.date)) byDate.get(d.date).labels.push(label);
        else byDate.set(d.date, { date: d.date, labels: [label] });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
```

**A Map keyed by date is the whole trick.** First time we see a date we `set` a fresh
entry with a one-item `labels` array; every later deadline on that same date `get`s
the existing entry and `push`es its label — that's how "Petition due" and "Filing
closes" on Aug 7 end up on **one** tick. `?? d.type` keeps an unmapped type from
becoming `undefined`. ISO dates (`"YYYY-MM-DD"`, zero-padded) sort correctly as plain
strings, so `localeCompare` needs no date parsing. A Map (not a plain object) keeps
this clean: `.has/.get/.set` read better than `obj[date] ??= …` and it preserves
insertion order.

---

## 02 — Proportional position

```js
function positionPct(dateISO, allDatesISO) {
    const ms = (iso) => new Date(`${iso}T00:00:00`).getTime();
    const times = allDatesISO.map(ms);
    const min = Math.min(...times), max = Math.max(...times);
    if (max === min) return 50;                    // span 0 -> center
    return ((ms(dateISO) - min) / (max - min)) * 100;
}
```

**Map the date onto `[min, max]` and read off the fraction.** Dates only subtract if
they're numbers, so `getTime()` first. The `T00:00:00` suffix parses as *local*
midnight — the offset is identical for every date so it cancels in the ratio, and it
sidesteps the classic "`new Date('2026-01-01')` is UTC and shows Dec 31 in the US"
bug. The `max === min` guard is the same idea as a `/0` check: an office with one
deadline (or all on one day) has no span, so we center it. This spacing is *honest*
but it's exactly what bunches labels — which is why we didn't ship it.

---

## 03 — Even spacing (shipped)

```js
function evenPct(i, n) {
    return n === 1 ? 50 : (i / (n - 1)) * 100;
}
```

**`n` points make `n-1` gaps.** Point 0 → 0%, point `n-1` → 100%, everything else
evenly between. Dividing by `n-1` (not `n`) is what pins the first and last to the
ends. The `n === 1` guard avoids `0/0`. We traded proportional truth for two wins:
labels are guaranteed far enough apart to never overlap, and the card can stay a
**fixed height** because the layout no longer depends on how the dates cluster.

---

## 04 — Format USD

```js
function formatUSD(cents) {
    return (cents / 100).toLocaleString("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
}
```

**Store cents, format at the edge.** Money is an integer of cents everywhere in the
system (floats can't represent `$0.10` exactly); we only turn it into a string for
display. `Intl` (`toLocaleString` with `style:"currency"`) gives you the `$`, the
thousands commas, and rounding for free — hand-rolling this is a bug factory.
`maximumFractionDigits: 0` drops the `.00` since goals are round.

---

## 05 — Collision stagger

```js
function assignRows(positions, minSep) {
    const rowLastCenter = [];
    return positions.map((c) => {
        for (let r = 0; r < rowLastCenter.length; r++) {
            if (c - rowLastCenter[r] >= minSep) { rowLastCenter[r] = c; return r; }
        }
        rowLastCenter.push(c);
        return rowLastCenter.length - 1;
    });
}
```

**Greedy: take the highest row that still has room, else open a new one.**
`rowLastCenter[r]` is the position of the last label already placed in row `r`; a new
label fits there only if it's `>= minSep` to the right. Because `positions` is sorted,
one left-to-right sweep is enough. The lesson the real bug taught: this solves
*horizontal* overlap, but two rows still collide *vertically* unless each row's drop
exceeds a label's height — a fix you can't see without actually rendering it. We
ultimately dropped stagger for even spacing (03) so the card could stay one row and a
fixed size.

---

## 06 — Fold Today

```js
function buildPoints(deadlines, today) {
    const byDate = new Map();
    for (const d of deadlines) {
        const label = DEADLINE_LABELS[d.type] ?? d.type;
        if (byDate.has(d.date)) byDate.get(d.date).labels.push(label);
        else byDate.set(d.date, { date: d.date, labels: [label], isToday: false });
    }
    if (byDate.has(today)) byDate.get(today).isToday = true;
    else byDate.set(today, { date: today, labels: [], isToday: true });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
```

**Today is "just another point," so the same positioning code handles it.** We reuse
01's grouping, then fold today in with the same has/get/set branch: if a deadline is
already on today's date we flag that entry `isToday` (no duplicate line); otherwise we
add a new point with an **empty** `labels` array. That empty array is the signal the
render uses — empty ⇒ draw the "Today"/"you" marker; non-empty ⇒ draw the name+date.

---

## 07 — Capstone timeline model

```js
function buildTimeline({ deadlines, today, goalCents }) {
    const points = buildPoints(deadlines, today);
    const n = points.length;
    return {
        goalLabel: goalCents == null ? null : formatUSD(goalCents),
        points: points.map((p, i) => ({ ...p, left: evenPct(i, n) })),
    };
}
```

**Build the whole view-model here so the JSX stays a dumb map.** Group → merge → fold
Today (06) → space evenly (03) → format the goal (04). Two altitude choices worth
noticing: formatting (`formatUSD`) and layout (`left`) live in the *model*, not the
render, so the component just reads `p.left` and `model.goalLabel`. And `goalCents ==
null` (loose `==`) folds `undefined` and `null` together — "not fetched yet" and "none
on record" both render as *no tag*.

---

## React A — DeadlineTimeline

```jsx
function DeadlineTimeline({ model }) {
    return (
        <div className="wouldbeTimelineWrap">
            {model.goalLabel && (
                <div className="wouldbeGoal">Recommended financing goal: {model.goalLabel}</div>
            )}
            <div className="wouldbeTimeline">
                <div className="wouldbeTimelineLine" />
                {model.points.map((p) => (
                    <div
                        key={p.date}
                        className={"wouldbeTick" + (p.isToday ? " wouldbeTickToday" : "")}
                        style={{ left: `${p.left}%` }}
                    >
                        {p.isToday && <span className="wouldbeYouBadge">you</span>}
                        <span className="wouldbeTickMark" />
                        {p.isToday ? (
                            <span className="wouldbeTodayText">Today</span>
                        ) : (
                            <span className="wouldbeTickLabel">
                                {p.labels.map((l, j) => <span key={j}>{l}</span>)}
                                <span className="wouldbeTickDate">{formatDate(p.date)}</span>
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
```

**`left: x%` + `translateX(-50%)` is the positioning core.** `left` puts the tick's
*left edge* at the percent; the `-50%` transform (in CSS) slides it back by half its
own width so the **line** lands on the date, not the box's corner. Without the
transform every label would sit to the right of its mark. The "you" badge is
`position: absolute; bottom: 100%` so it floats *above* the axis regardless of how
tall the tick is. `key={p.date}` beats the array index because dates are stable
identity — if the list reordered, index keys would make React reuse the wrong DOM.
`model.goalLabel && (…)` is the right conditional here: "show the tag **or nothing**"
(vs. a ternary, which is for "A **or** B").

---

## React B — HoverCard

```jsx
function HoverCard({ office, api, buildModel }) {
    const [hovered, setHovered] = useState(false);
    const [goalCents, setGoalCents] = useState(undefined); // undefined|null|number

    async function handleEnter() {
        setHovered(true);
        if (goalCents !== undefined) return;               // fetch once
        try {
            const res = await api.get(`/api/offices/${office.id}/recommended-goal`);
            setGoalCents(res.data?.recommended_goal_cents ?? null);
        } catch {
            setGoalCents(null);
        }
    }

    return (
        <div
            className={hovered ? "hoveredWouldBeCard" : "wouldbeCard"}
            onMouseEnter={handleEnter}
            onMouseLeave={() => setHovered(false)}
        >
            {hovered ? (
                <>
                    <h3 className="hoveredWouldBeName">{office.state_code}: {office.office_name}</h3>
                    <DeadlineTimeline model={buildModel(office, goalCents)} />
                </>
            ) : (
                <h3 className="officeOrWouldbeName">{office.state_code}: {office.office_name}</h3>
            )}
        </div>
    );
}
```

**It has to be its own component because it owns hooks.** If you rendered the card by
*calling* `RenderCard(office)` inside a `.map`, its `useState` calls would count
against the PARENT's hook list and change in number as the list grows — React throws
"rendered more hooks than during the previous render." A real `<HoverCard />` element
gives each card its own hook slot. `goalCents` is **tri-state** on purpose: `undefined`
= "haven't fetched," which is what `handleEnter` checks to fetch exactly once; `null` =
"fetched, none on record" (tag hidden); a number = show it. `hovered ? A : B` is a
ternary because it's genuinely "expanded **or** collapsed," not "show one thing or
nothing."
