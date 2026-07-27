# Solutions & explanations — Echoes in Light breakdown

Try each first. The *why* is the point — this is how "premium motion" is actually made.

---

## 01 — lerp + damp

```js
function lerp(a, b, t) { return a + (b - a) * t; }
function damp(cur, tgt, f) { return cur + (tgt - cur) * f; }
```

`lerp` blends two values by a 0..1 weight. `damp` is the exact same math named for
the loop: "move `cur` a fraction `f` toward `tgt`." Call `damp` every frame with a
small `f` and you get **exponential easing** — each frame you close a fixed
percentage of the remaining gap, so the value flies at first and creeps in at the
end. That decel curve *is* the glide. This one line, run in a rAF, is the core of
Lenis, of `.lerp` cursors, of nearly every "smooth" thing on award-winning sites.

---

## 02 — clamp + mapRange

```js
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function mapRange(v, inMin, inMax, outMin, outMax) {
    return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}
```

`mapRange` normalizes `v` to 0..1 within its input range, then scales into the
output range. It's how one scroll progress drives *everything* — opacity, a Y
offset, a shader uniform. It naturally **inverts** when `outMin > outMax`
(progress 0..1 → 100..0 slides something up as you scroll down). `clamp` guards the
ends so a progress of 1.2 can't push opacity past 1.

---

## 03 — easing

```js
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
```

Easing reshapes *time* (0..1) into *progress* (0..1). `easeOutExpo` dumps almost
all its motion up front then feathers to a stop — reads as "responsive but elegant,"
perfect for reveals and scroll. `easeInOutCubic` is slow-fast-slow, ideal for
symmetric moves. Same duration + different curve = completely different feel; most
of "this site feels expensive" is curve choice, not duration. Note `easeOutExpo(0.1)`
is already **0.5** — half the motion in the first 10% of time.

---

## 04 — scroll progress

```js
function progress(scrollY, elementTop, elementHeight, viewportHeight) {
    const traveled = scrollY + viewportHeight - elementTop;
    return clamp(traveled / (viewportHeight + elementHeight), 0, 1);
}
```

This is ScrollTrigger's essence: convert pixel position into a **resolution-
independent 0..1**. The travel distance is `viewportHeight + elementHeight` because
the element crosses the whole screen *plus* its own height (top enters at the
bottom → bottom exits at the top). Clamping means once it's off-screen the value
pins at 0 or 1 — which is how a scrubbed animation "holds" at its start/end.

---

## 05 — frame-rate-independent damp

```js
function dampDt(current, target, lambda, dt) {
    return target + (current - target) * Math.exp(-lambda * dt);
}
```

Problem 01's `* 0.1` per **frame** runs twice as fast at 120 Hz as at 60 Hz — the
feel forks by monitor. Tying the decay to **elapsed time** with `e^(−λ·dt)` fixes
it: same real-time settle at any frame rate. `dt=0` → `e^0=1` → returns `current`
(no time, no move); larger `dt` → smaller multiplier → closer to `target`. `lambda`
is stiffness. This is why serious motion code passes `dt` (from the rAF timestamp
delta) into everything instead of hardcoding per-frame factors.

---

## 06 — single RAF loop model

```js
function stepToward(start, target, factor, frames) {
    let v = start;
    for (let i = 0; i < frames; i++) v = damp(v, target, factor);
    return v;
}
function trace(start, target, factor, frames) {
    let v = start; const out = [];
    for (let i = 0; i < frames; i++) { v = damp(v, target, factor); out.push(v); }
    return out;
}
```

An "animation" is just a value nudged toward a target once per frame in a loop —
and that loop is the rAF. His site advances the *whole system* from **one**
`gsap.ticker` callback: `lenis.raf(time*1000)` → Lenis emits `scroll` →
`ScrollTrigger.update()` → the WebGL render reads the new value, all in the same
frame, with `gsap.ticker.lagSmoothing(0)` so GSAP doesn't warp the clock after a
stall. One clock, deterministic order, nothing fighting for the frame — that's the
anti-jank.

---

## 07 — capstone: mini-Lenis

```js
const makeState = (max) => ({ scroll: 0, target: 0, velocity: 0, max });
const wheel = (s, d) => ({ ...s, target: clamp(s.target + d, 0, s.max) });
const tick = (s, l) => {
    const scroll = damp(s.scroll, s.target, l);
    return { ...s, scroll, velocity: scroll - s.scroll };
};
const run = (max, deltas, ticksPer, lerp) => {
    let s = makeState(max); const out = [];
    for (const d of deltas) {
        s = wheel(s, d);
        for (let i = 0; i < ticksPer; i++) { s = tick(s, lerp); out.push(s.scroll); }
    }
    return out;
};
```

This is Lenis in miniature. **Wheel moves the target, not the scroll** — input
sets a goal and the loop chases it (that split *is* the smoothing). Target is
clamped to `[0, max]` so momentum can't fight the page bounds. `velocity` (how far
`scroll` moved this frame) decays as you approach target — and that decaying speed
is exactly what a scroll-reactive shader reads (problem `browser/03`) to add motion
blur/skew that settles when you stop. Everything you scrolled past in the other
practice sets was React re-rendering on state; **this** is what he does instead.

---

## browser/01–06 — the wiring

No auto-tests; write from memory, run in a Vite page (`npm i lenis gsap three`),
compare to the live site. Concept-check answers:

- **Lenis via gsap.ticker (01):** two independent rAF loops drift out of phase →
  the scene reads a scroll value that's one frame stale → micro-jitter.
  `lagSmoothing(0)` stops GSAP from time-warping to "catch up" after a stall (which
  would make a scroll-linked scene lurch). `lenis.on('scroll', ScrollTrigger.update)`
  keeps pinned/scrubbed triggers reading the *smoothed* position. `*1000` because
  gsap.ticker gives seconds, `lenis.raf` wants ms.
- **ScrollTrigger (02):** `scrub: 1` adds a 1s catch-up lerp *on top of* Lenis;
  animate `y`/`autoAlpha` (compositor) not `top`/`display` (layout); `pin` pins by
  fixing the element and padding the scroller — refresh on resize because pin math
  is pixel-based. `"top 80%"` = trigger's top hits 80% down the viewport.
- **Three shader (03):** planes get per-pixel effects `<img>` can't; `uniforms` are
  the JS→GPU bridge; sync the mesh to the DOM rect each frame + on resize; ortho (or
  px-tuned perspective) so 1 unit ≈ 1px.
- **Router (04):** intercept clicks so a reload doesn't destroy the WebGL context +
  scroll; fetch during the out-animation to hide latency; re-bootstrap components +
  `ScrollTrigger.refresh()` + reset scroll after swap; `popstate` must navigate
  *without* pushing a new history entry.
- **Component pattern (05):** class-per-element gives encapsulation + a `destroy()`
  the router calls to kill tweens/triggers/meshes (or you leak every navigation);
  like React mount/unmount but you mutate the real element — no VDOM, no re-render;
  `data-*` lets one class drive many blocks with per-block options.
- **Variable font (06):** `font-weight: 100 900` declares one file serves that whole
  range; you can tween `font-variation-settings "wght"` cheaply; `swap` shows
  fallback then swaps (no invisible text); self-host + preload the woff2 so a hero
  headline isn't late.

---

## The one-paragraph answer to "why is his smoother than mine?"

You use the browser's **native scroll** and repaint on React **state changes**. He
replaces scroll with a **single interpolated value** (Lenis) advanced by **one rAF**
(gsap.ticker), reads it from **every** system in that same frame (ScrollTrigger +
Three), moves things with **GPU transforms**, and tunes the **easing/lerp** for
weight. Native-stepped + layout-driven + re-render loses to interpolated +
transform-driven + one-clock on every axis. The math is problems 01–07; the wiring
is `browser/`.
