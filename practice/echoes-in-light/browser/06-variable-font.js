// ============================================================================
// BROWSER 06 — The type system: one self-hosted VARIABLE font
// ----------------------------------------------------------------------------
// Verbatim from his shipped CSS:
//
//   @font-face{
//     font-family: H;
//     src: url(/fonts/H.woff2) format("woff2-variations"),
//          url(/fonts/H.woff)  format("woff-variations");
//     font-weight: 100 900;          /* the WHOLE range in one file */
//     font-display: swap;
//   }
//
// One variable family covers every weight (100–900). `font-display:swap` paints
// fallback text immediately, then swaps to the web font — no invisible-text flash
// (FOIT). Self-hosted (`/fonts/...`), not Google Fonts — full control, one request,
// no third-party.
//
// (The real typeface name is minified to "H" and isn't recoverable from the
// compressed woff2 name table. The technique is the lesson, not the name.)
//
// CONCEPT CHECK — answer first:
//   • What does `font-weight: 100 900` in an @font-face MEAN (vs a fixed weight)?
//   • Why can a variable font ANIMATE weight cheaply (e.g. GSAP tweening
//     font-variation-settings 'wght') when static fonts can't?
//   • `font-display: swap` vs `block` vs `optional` — what does the user SEE first
//     with each, and which avoids layout shift on slow connections?
//   • Why self-host + preload the woff2 (`<link rel="preload" as="font" ... crossorigin>`)
//     for a hero headline?
// ============================================================================

// A modern helper form of the same @font-face (build-time or runtime):
export const FONT_FACE_CSS = `
@font-face {
  font-family: "AppFont";
  src: url("/fonts/AppFont.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}
:root { font-family: "AppFont", system-ui, sans-serif; }
`;

// Animating weight with a variable font (what static fonts can't do):
//   gsap.to(headline, { fontVariationSettings: '"wght" 800', duration: 0.6 });
// or CSS:  h1 { font-variation-settings: "wght" 300; transition: font-variation-settings .4s; }

// TODO: in a real page, drop FONT_FACE_CSS in your stylesheet, preload the woff2,
//       and try tweening 'wght' on a headline against scroll progress (problem 04).
