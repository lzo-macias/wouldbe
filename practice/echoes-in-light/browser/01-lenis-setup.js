// ============================================================================
// BROWSER 01 — The exact smooth-scroll recipe (Lenis + GSAP + ScrollTrigger)
// ----------------------------------------------------------------------------
// This is THE reason his scroll beats yours. Confirmed on his site: Lenis (114
// refs), driven by gsap.ticker, with ScrollTrigger.update on every Lenis scroll.
// Write it from memory, then run it in a Vite page.  npm i lenis gsap
//
// CONCEPT CHECK — answer first:
//   • Why drive Lenis from `gsap.ticker` instead of its own `requestAnimationFrame`
//     loop? (What desyncs if Lenis and GSAP each run their own rAF?)
//   • What does `gsap.ticker.lagSmoothing(0)` prevent? (GSAP normally "catches up"
//     after a stall by warping time — why is that bad for a scroll-linked scene?)
//   • Why `lenis.on('scroll', ScrollTrigger.update)`? What goes stale without it?
//   • Lenis multiplies time by 1000 in `raf` — why? (gsap.ticker gives SECONDS,
//     lenis.raf wants MILLISECONDS.)
//   • `lerp` (or `duration`+`easing`) is the "weight" dial. What does lerp: 0.05
//     feel like vs 0.2?
// ============================================================================

import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function initSmoothScroll() {
    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
        // TODO: tune the feel. Common creative-dev config:
        //   lerp: 0.1,            // interpolation weight (lower = heavier glide)
        //   smoothWheel: true,    // ease wheel input
        //   // or use: duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 3),
        
    });

    // TODO 1: on every Lenis scroll, refresh ScrollTrigger so pinned/scrubbed
    //         animations track the smoothed position:
    //   lenis.on("scroll", ScrollTrigger.update);

    // TODO 2: advance Lenis from the SINGLE gsap clock (seconds -> ms):
    //   gsap.ticker.add((time) => lenis.raf(time * 1000));

    // TODO 3: stop gsap from time-warping after a frame stall:
    //   gsap.ticker.lagSmoothing(0);

    return lenis;
}

// Why this is smoother than a stock React app, in one breath:
//   native scroll = stepped, event-driven, layout-linked, and your components
//   re-render on state; here scroll is a single interpolated value advanced once
//   per frame, and EVERY animated system reads it in that same frame.
