// ============================================================================
// BROWSER 02 — Scroll-triggered reveals + scrub + pin (the section motion)
// ----------------------------------------------------------------------------
// With Lenis feeding ScrollTrigger, animations "scrub" against the smoothed
// scroll. Two patterns cover most of his page: (a) a one-shot reveal when a block
// enters, (b) a scrubbed transform tied to scroll progress (your problem 04 math,
// but GSAP computes it).
//
// CONCEPT CHECK — answer first:
//   • `scrub: true` vs `scrub: 1` — what does the number add? (a catch-up lerp on
//     the scrubbed timeline — extra smoothness on top of Lenis.)
//   • Why animate `y`/`autoAlpha` (transform + opacity) instead of `top`/`display`?
//     (compositor vs layout — the whole perf story.)
//   • `pin: true` — what does ScrollTrigger do to the DOM to hold an element
//     while the page scrolls "through" it, and why must you refresh on resize?
//   • `start: "top 80%"` — read it out loud: which edge of the trigger meets which
//     line of the viewport?
// ============================================================================

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function revealOnEnter(el) {
    gsap.registerPlugin(ScrollTrigger);
    // TODO: from y:40, autoAlpha:0  ->  y:0, autoAlpha:1, ease "power3.out",
    //   with scrollTrigger { trigger: el, start: "top 80%" } (one-shot reveal).
}

export function scrubParallax(el) {
    // TODO: as the element travels the viewport, move it on a transform.
    //   gsap.to(el, {
    //     yPercent: -20, ease: "none",
    //     scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 1 },
    //   });
}

// NOTE: everything here is transform/opacity only — GPU compositor work. That's
// why it stays 60/120fps while the main thread is busy. `top`/`left`/`height`
// would trigger layout every frame and stutter.
