# Practice — reverse-engineering **corentinbernadou.com / "Echoes in Light"**

A study of a creative-developer portfolio page and **why its scrolling feels
buttery** compared to a default React app. Unlike the other practice sets (which
mirror *our* code), this one reverse-engineers **someone else's** — so the README
is longer: it documents the stack first, then the exercises drill the exact
techniques.

Format matches the other folders: numbered `.js` files with **stubs you fill in**
and **tests that run immediately** (`node echoes-in-light/01-lerp.js`), a
`SOLUTIONS.md`, and — instead of `react/` — a **`browser/`** folder holding the
DOM/GSAP/Lenis/Three shells (there's no React here, so the "shell" files are
vanilla-JS component/animation skeletons you write from memory).

---

## What he actually used (confirmed by inspecting the shipped bundles)

I fetched the page and its `/assets/js/*` chunks and grepped them. Evidence, not guesses:

| Layer | Tech | How I know |
|-------|------|-----------|
| **Build** | **Vite** | `/assets/js/*-[hash].js`, `modulepreload-polyfill-*.js`, code-split chunks (`vendor-*`, `NotFound-*`) |
| **UI framework** | **None** — vanilla JS/TS | `react`/`vue`/`svelte`/`preact` = **0** matches in any bundle |
| **Smooth scroll** | **Lenis** | **114** `lenis` references; config keys `lerp`, `smoothWheel`, `syncTouch`, `orientation`, `infinite`, `easing` |
| **Animation** | **GSAP + ScrollTrigger** | `gsap` ×63, `ScrollTrigger` ×31; dozens of `duration:` tweens (0.3s–2.5s) |
| **WebGL** | **Three.js** | 470 KB `three-*.js`; heavy `Texture`/`uniforms`/`Mesh`/`vec2` → textured planes + custom shaders |
| **Routing** | **Custom SPA router** | `pushState`/`popstate`/`history.*`, `addEventListener("click")` link interception, `dataset.*` |
| **Type** | **Self-hosted variable font** | `@font-face{font-family:H;src:url(/fonts/H.woff2) format("woff2-variations");font-weight:100 900;font-display:swap}` |

The page's own tagline: **"WebGL · Motion · Interaction"**, meta description
*"animation-driven interactive experiences with clean visuals and precise motion."*

### The font
One **variable** family, self-hosted, covering the **entire weight range 100–900**
in a single `woff2` (`format("woff2-variations")`), with `font-display:swap`. The
family name is minified to `H`, and the real name isn't recoverable from the
compressed `woff2` name table — but the *approach* is the lesson: creative devs
self-host **one variable grotesk** (common picks in this scene: PP Neue Montreal,
Söhne, Neue Haas Grotesk, or a custom face) and animate its weight/tracking.
`font-display:swap` shows fallback text instantly, then swaps — no invisible-text
flash. See `browser/06-variable-font.js`.

---

## Why his sliding feels smoother than a stock app (the whole point)

Your app scrolls with the **browser's native scroll** and repaints on React state
changes. His replaces native scroll with an **interpolated virtual scroll** and
drives *everything* from **one animation frame**. Five concrete reasons:

1. **Virtual scroll + per-frame interpolation (Lenis).** Native scroll snaps the
   page to the exact wheel position each event. Lenis instead keeps a `target`
   (where the wheel wants you) and an actual `scroll` that **eases toward it every
   frame** (`scroll += (target − scroll) * lerp`). That easing *is* the glide.
   → `01-lerp.js`, `07-capstone-virtual-scroll.js`

2. **Frame-rate-independent damping.** A naive `* 0.1` per frame moves twice as
   fast at 120 Hz as at 60 Hz. The fix is exponential damping with `dt`
   (`target + (cur−target) * e^(−λ·dt)`), so the *feel* is identical on any
   display. → `05-frame-rate-independent-damp.js`

3. **One synchronized RAF loop.** Lenis, ScrollTrigger, and the Three.js render are
   **all** ticked from a single `gsap.ticker` callback (`lenis.raf(t)` inside
   `gsap.ticker.add`, plus `gsap.ticker.lagSmoothing(0)` and
   `lenis.on('scroll', ScrollTrigger.update)`). Everything updates in the same
   frame → nothing desyncs, no double-rAF jank. → `06-raf-loop-model.js`,
   `browser/01-lenis-setup.js`

4. **GPU transforms, not layout.** Motion is `transform: translate3d(...)` on the
   compositor thread (with `will-change`), not top/left/scroll that trigger layout.
   The main thread stays free. → `browser/02-gsap-scrolltrigger.js`

5. **Tuned easing = "weight."** The lerp factor / easing curve is the dial between
   "instant" and "heavy glass." → `03-easing.js`

A default React app loses on *every* axis: native stepped scroll, no interpolation,
layout-driven movement, and re-renders + multiple uncoordinated timers instead of
one rAF. This set trains the math and the wiring that flip each of those.

---

## Order (easy → hard)

| File | Concept | Where it lives on his site |
|------|---------|----------------------------|
| `01-lerp.js` | linear interpolation + one-step damping | the core of Lenis' eased scroll |
| `02-clamp-map-range.js` | clamp + remap a range | scroll progress → any animated value |
| `03-easing.js` | easing curves (expo, cubic) | GSAP tween "feel", Lenis `easing` |
| `04-scroll-progress.js` | element progress through viewport | ScrollTrigger start/end → 0..1 |
| `05-frame-rate-independent-damp.js` | `dt`-corrected damping | consistent glide at 60/120 Hz |
| `06-raf-loop-model.js` | single loop stepping toward a target | the `gsap.ticker` → `lenis.raf` loop |
| `07-capstone-virtual-scroll.js` | **combines 01/05/06** into a mini-Lenis | how the whole scroll actually works |
| `browser/01-lenis-setup.js` | Lenis + gsap.ticker + ScrollTrigger wiring | the exact smooth-scroll recipe |
| `browser/02-gsap-scrolltrigger.js` | scrub/pin reveal on scroll | the section animations |
| `browser/03-three-image-shader.js` | textured plane + velocity-driven shader | the WebGL imagery |
| `browser/04-spa-router-transition.js` | pushState router + GSAP page transition | the seamless page changes |
| `browser/05-component-pattern.js` | `[data-component]` bootstrap (his "divs") | how each interactive block is wired |
| `browser/06-variable-font.js` | self-hosted variable font + `swap` | the type system |

## Why mostly plain `.js`

The *feel* is math — interpolation, damping, easing, progress mapping — which you
can `node` to instant green. The **wiring** (Lenis↔GSAP↔ScrollTrigger↔Three, the
router, the component bootstrap) is the `browser/` folder: skeletons + "CONCEPT
CHECK" prompts, written from memory and run in a real Vite page against the live
site as reference.

> Install for the `browser/` files: `npm i lenis gsap three`.
