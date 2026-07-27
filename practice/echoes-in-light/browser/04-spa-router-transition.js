// ============================================================================
// BROWSER 04 — Custom SPA router + GSAP page transition (no framework)
// ----------------------------------------------------------------------------
// Confirmed on his site: `pushState`/`popstate`/`history.*`, click interception,
// `dataset.*` — a hand-rolled router (Barba-style) with animated page swaps. No
// React Router, no framework — just the History API + fetch + GSAP.
//
// CONCEPT CHECK — answer first:
//   • Why intercept `<a>` clicks with preventDefault instead of letting the browser
//     navigate? (a full reload throws away the WebGL context + scroll state; SPA
//     swap keeps them alive.)
//   • Order of a transition: animate OUT -> fetch next HTML -> swap the <main> ->
//     reset scroll/ScrollTrigger -> animate IN. Why fetch DURING the out-animation?
//   • Why must you re-run your `[data-component]` bootstrap (browser/05) after the
//     swap, and `ScrollTrigger.refresh()` + `lenis.scrollTo(0, {immediate:true})`?
//   • What does `popstate` (back/forward button) need that a click doesn't?
// ============================================================================

export function initRouter({ onLeave, onEnter, bootstrap }) {
    // TODO 1: intercept same-origin link clicks
    //   document.addEventListener("click", (e) => {
    //     const a = e.target.closest("a");
    //     if (!a || a.origin !== location.origin || a.dataset.native) return;
    //     e.preventDefault();
    //     navigate(a.href, true);
    //   });

    // TODO 2: handle back/forward
    //   window.addEventListener("popstate", () => navigate(location.href, false));

    async function navigate(url, push) {
        // TODO 3:
        //   await onLeave();                                   // GSAP animate out
        //   const html = await fetch(url).then((r) => r.text());
        //   const next = new DOMParser().parseFromString(html, "text/html");
        //   document.querySelector("main").replaceWith(next.querySelector("main"));
        //   if (push) history.pushState({}, "", url);
        //   bootstrap();                                       // re-wire components
        //   // ScrollTrigger.refresh(); lenis.scrollTo(0, { immediate: true });
        //   await onEnter();                                   // GSAP animate in
    }

    return { navigate };
}
