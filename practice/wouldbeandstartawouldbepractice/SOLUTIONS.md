# Solutions + the *why*

Try each problem first. These are one correct shape; small variations that pass are fine.

---

## JS 01 — screen switch + gate

```js
function pickScreen(screens, key) {
    return screens[key] ?? screens["1"];
}
function gate(ready, content, fallback) {
    return ready ? content : fallback;
}
```

**Why.** An object literal *is* a lookup table — `screens[key]` replaces a `switch`, and
adding a step is one more key. `??` supplies the default branch. The gate is the same idea
as `individualOffice ? … : <p>Loading…</p>`: don't index into data (or read `.deadlines`)
until it exists, or the first render throws on `undefined`.

## JS 02 — load in order

```js
function sortByDate(rows) {
    return [...rows].sort((a, b) => a.deadline_date.localeCompare(b.deadline_date));
}
async function loadOffice(id, api) {
    const office = await api.getOffice(id);
    if (!office) return null;
    const jurisdiction = await api.getJurisdiction(office.jurisdiction_id);
    const deadlines = sortByDate(await api.getDeadlines(office.jurisdiction_id));
    const goalCents = await api.getGoal(office.id);
    return { ...office, jurisdiction, deadlines, goalCents };
}
```

**Why.** Each step needs the *previous result*: the office tells you the jurisdiction id.
Use the local `office`, never the React state you're about to set — `setState` is async, so
that state is still stale this pass. `[...rows]` sorts a copy so you never scramble a shared
array (dates as `YYYY-MM-DD` strings compare correctly with `localeCompare`).

## JS 03 — the cancel flag

```js
function applyIfLive(run, value) {
    if (!run.cancelled) run.applied.push(value);
}
function cancel(run) {
    run.cancelled = true;
}
```

**Why.** In the real effect, `let cancelled = false` is a closure variable and the cleanup
`() => { cancelled = true }` flips it when the effect is superseded or the component
unmounts. A fetch that resolves *after* that then no-ops instead of calling `setState` on a
dead component. It doesn't cancel the request — it ignores the *result*.

## JS 04 — recommended vs adjusted

```js
function recommendedGoal(originalCents, floor = 500000) {
    return originalCents ?? floor;
}
function cumulativeAmounts(adjustedCents, count) {
    if (count === 0) return [];
    const per = adjustedCents / count;
    return Array.from({ length: count }, (_, i) => Math.round(per * (i + 1)));
}
```

**Why.** `??` floors only `null`/`undefined` — a real `0` stays `0` (using `||` would wrongly
replace 0). The recommended value is the fixed source of truth; the slider edits a separate
`goalCents`. The cumulative split sums to the whole so the last deadline equals the full goal.

## JS 05 — rail progress %

```js
function clamp(min, max, v) { return Math.max(min, Math.min(max, v)); }
function nodeCenterPct(i, n) { return ((i + 0.5) / n) * 100; }
function railProgress(centerPct, inset = 5.5) {
    return clamp(0, 100, ((centerPct - inset) / (100 - 2 * inset)) * 100);
}
```

**Why.** Nodes are centered in equal grid cells, so node `i`'s center is `(i+0.5)/n`. The rail
is inset `5.5%` per side (width `89%`), so you remap the center from the *track* coordinate
space into the *rail* space, then clamp to `[0,100]`. That number is handed to CSS as
`--progress`.

## JS 06 — clamp + em

```js
function cssClamp(minPx, vw, maxPx, viewportPx) {
    return clamp(minPx, maxPx, (viewportPx * vw) / 100);
}
function emToPx(em, parentPx) { return em * parentPx; }
// clamp(min, max, v) = Math.max(min, Math.min(max, v))
```

**Why.** `clamp(min, pref, max)` evaluates the fluid middle (`vw%` of the viewport) then pins
it into `[min,max]`. `em` multiplies the inherited font-size, so `0.55em` of a 38px headline
is `20.9px` — change the headline and the subtitle scales with it.

## JS 07 — capstone page model

```js
function buildPageModel(input) {
    const { office, stateCode, originalGoalCents, adjustedGoalCents, today } = input;

    // group by date, merge same-day labels
    const byDate = new Map();
    for (const d of office.deadlines ?? []) {
        const date = String(d.date).slice(0, 10);
        const label = DEADLINE_LABELS_LOCAL[d.type] ?? d.type;   // or your label map
        if (byDate.has(date)) byDate.get(date).labels.push(label);
        else byDate.set(date, { date, labels: [label], isToday: false });
    }
    if (byDate.has(today)) byDate.get(today).isToday = true;
    else byDate.set(today, { date: today, labels: [], isToday: true });

    const ms = (s) => new Date(`${s}T00:00:00`).getTime();
    const all = [...byDate.values()].sort((a, b) => ms(a.date) - ms(b.date));
    const deadlines = all.filter((p) => !p.isToday);
    const amounts = cumulativeAmounts(adjustedGoalCents, deadlines.length); // from JS 04

    let di = 0;
    const points = all.map((p) => {
        if (p.isToday) return { label: "Today", date: p.date, amount: "", state: "today" };
        const amount = formatUSD(amounts[di++]);
        const state = ms(p.date) < ms(today) ? "done" : "future";
        return { label: p.labels.join(" · "), date: p.date, amount, state };
    });

    const todayIdx = all.findIndex((p) => p.isToday);
    const progress = railProgress(nodeCenterPct(todayIdx, all.length));

    return {
        headline: `a great ${stateCode} ${office.office_name} representative`,
        recommendedLabel: formatUSD(recommendedGoal(originalGoalCents)),
        yourGoalLabel: formatUSD(adjustedGoalCents),
        adjusted: recommendedGoal(originalGoalCents) !== adjustedGoalCents,
        progress,
        points,
    };
}
```

**Why.** One function turns messy inputs into a flat, render-ready object. The component then
just maps `points` and drops values into class names — all the thinking is here, tested,
outside JSX. Note recommended stays fixed while amounts use the *adjusted* goal.

---

## CSS answers (the `.yours` rules)

**01 — flex split.**
```css
.yours .split { display: flex; gap: 16px; }
.yours .panel { flex: 0 0 160px; }
.yours .feed  { flex: 1 1 0; min-width: 0; }
.yours .card a { word-break: break-word; overflow-wrap: anywhere; }
```
`flex: 0 0 160px` = fixed; `flex: 1 1 0` = fill. **`min-width: 0`** overrides the default
`min-width:auto` so the flexible column can shrink and its URL wraps instead of overflowing.

**02 — grid fr.**
```css
.yours .grid { display: grid; grid-template-columns: 305fr 280fr 377fr; gap: 24px; align-items: stretch; }
.yours .b { display: flex; flex-direction: column; justify-content: space-between; }
```
`fr` shares free space in a ratio at any width. `align-items: stretch` makes all columns the
tallest's height; `space-between` pins first-to-top, last-to-bottom.

**03 — absolute positioning.**
```css
.yours .card   { position: relative; }
.yours .chip   { position: absolute; top: 12px; right: 16px; }
.yours .rail   { position: absolute; left: 18px; right: 18px; top: 80px; height: 3px; }
.yours .marker { position: absolute; left: 40%; top: 80px; transform: translate(-50%, -50%); }
.yours .bubble { position: absolute; left: 40%; top: 44px; transform: translateX(-50%); }
```
Children anchor to the nearest positioned ancestor (`.card` is `relative`). `left:40%` puts an
*edge* at 40%; `translateX(-50%)` pulls back half its width to CENTER on the point.

**04 — vars + gradient.**
```css
.yours { --gold: #c9a437; --track: #e7e7ea; }
.yours .rail {
    background: linear-gradient(90deg,
        var(--gold) 0%, var(--gold) var(--progress),
        var(--track) var(--progress), var(--track) 100%);
}
```
Two stops at the same position (`var(--progress)`) = a hard edge. React sets `--progress`
inline; the gradient reads it.

**05 — hover + transition.**
```css
.yours .card { height: 120px; overflow: hidden; transition: height .25s ease; }
.yours .card:hover { height: 190px; }
```
`transition` goes on the **base** rule so it animates both directions; `overflow:hidden` clips
the revealed row until the height grows.

**06 — range, scoped.**
```css
.yours input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px; background: #3a3a40; outline: none; }
.yours input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #c9a437; cursor: pointer; box-shadow: 0 0 0 5px rgba(201,164,55,.22); }
.yours input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border: none; border-radius: 50%; background: #c9a437; cursor: pointer; box-shadow: 0 0 0 5px rgba(201,164,55,.22); }
```
`appearance:none` opts out of the OS look; the knob is a per-engine pseudo-element (webkit
needs its **own** `appearance:none`). Every selector is scoped under `.yours` so it can't
restyle sliders elsewhere.

**07 — sticky + clamp.**
```css
.yours .nav { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 14px; height: 58px; padding: 0 16px; background: rgba(255,255,255,.8); backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid #e7e7ea; }
.yours .search { flex: 1; max-width: 300px; }
.yours .auth { margin-left: auto; }
.yours .headline { font-size: clamp(26px, 5vw, 52px); font-style: italic; font-weight: 800; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.yours .headline .sub { font-size: .5em; font-style: normal; font-weight: 400; color: #8a8a93; }
.yours .src a { word-break: break-word; overflow-wrap: anywhere; }
```
`sticky` pins at `top:0` within the scroll container; `backdrop-filter` blurs what's behind
(needs translucency); `margin-left:auto` shoves the auth group right; `clamp()` fluidly sizes
the headline between a floor and ceiling; `.5em` keeps the subtitle proportional.

---

## React concept-check answers

**StartAnOffice.** Use the awaited `office` (state updates *after* this pass, so it's stale).
`[officeId]` re-runs the effect on navigation. The `screens` object beats a switch — one key
per step. The gate stops the first render from reading `.deadlines` off `null`.

**Wouldbe.** The blur is one className toggle on the content wrapper; `.blurred` applies a
`filter: blur()` + `pointer-events: none`. The cancel flag prevents `setState` after unmount
(the classic warning + stale flash). Waiting on `checkingJurisdictions` avoids flashing the
full list before the scoped one arrives. The modal is a **sibling**, so the wrapper's blur
never applies to it.

**StartAWouldBe.** The slider writes only `goalCents`; the recommended number is derived and
fixed — chip + big number read recommended, the "your goal" line + per-deadline amounts read
the slider. `--progress` is the clean JS→CSS boundary: JS computes the %, the gradient paints
it. `0.55em` is relative to the headline's font-size, so it tracks the headline. The grid's
`repeat(${n}, 1fr)` is inline because `n` is dynamic — a static `.css` file can't know it.

**WouldBeNavHeader.** No state → presentational; behavior comes in via `onQualifyClick`. JSX
attrs are DOM props, so `strokeWidth` (camelCase), but `viewBox` keeps its casing. A bare
`button {…}` reset from a component stylesheet is global and would restyle every button in the
app — hence scoping under `.wbNav`. `margin-left:auto` eats the free space and pushes the auth
buttons to the far right.
```
