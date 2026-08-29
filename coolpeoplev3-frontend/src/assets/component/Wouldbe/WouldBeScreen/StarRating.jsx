import { useState } from 'react'
import './StarRating.css'

// One path, shared by the read-only display and the input, so a star is never
// two slightly different shapes on the same screen.
const PATH = 'M10 1.6 12.5 6.9l5.8.84-4.2 4.06 1 5.76L10 14.85 4.9 17.56l1-5.76L1.7 7.74l5.8-.84z'

// Inline <svg>, NOT the /homepagegraphics/StarGreen.svg <img> the old component
// used. An <img> can't be recoloured by CSS — the fill is baked into the file —
// which is why "on" and "off" had to be faked with opacity, and why a fractional
// average needed a whole second asset (HalfstarGreen.svg). A path takes `fill`
// from a class, so on/off/partial are all one file.
//
// Green is the RATING colour. Gold is the ACTION colour (the post button, the
// avatar ring, the just-posted highlight). Nothing else competes for either.
const Glyph = ({ size, on }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="rvStarGlyph">
    <path d={PATH} className={on ? 'rvStarOn' : 'rvStarOff'} />
  </svg>
)

/**
 * Read-only star display. Accepts a fraction — 4.3 renders as 4.3 stars, not a
 * rounded 4 — because that is what getReviewSummary returns.
 *
 * `value` of null/undefined means NOT YET RATED, which is different from 0. The
 * summary endpoint deliberately returns null rather than 0 when nobody has
 * reviewed, so rendering it as an empty row of stars would be a claim we haven't
 * earned. Guard at the call site if you want to hide the row entirely.
 */
export function Stars({ value, size = 14, max = 5, className = '' }) {
  const n = Number(value)
  const rated = value != null && Number.isFinite(n)
  const safe = rated ? Math.max(0, Math.min(max, n)) : 0

  return (
    <span
      className={`rvStars ${className}`}
      style={{ '--rv-fill': `${(safe / max) * 100}%` }}
    >
      <span className="rvStarsRow" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => <Glyph key={i} size={size} on={false} />)}
      </span>
      {/* Absolutely positioned, clipped to --rv-fill. This is what makes a
          partial star possible without a second asset. */}
      <span className="rvStarsRow rvStarsRowOn" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => <Glyph key={i} size={size} on />)}
      </span>
      <span className="rvSrOnly">
        {rated ? `${safe} out of ${max} stars` : 'Not yet rated'}
      </span>
    </span>
  )
}

/**
 * Interactive rating input. A real radiogroup: arrow keys move the selection,
 * hover previews it, and each star carries its own label so a screen reader
 * announces "3 stars" rather than "button".
 *
 * The old picker lit EVERY star on hover — `(star <= newReviewStars || hovered)`
 * is true for all five as soon as `hovered` is any truthy number, so it was
 * impossible to see what you were about to pick. Here the preview is
 * `n <= (hover || value)`, which fills up to the star under the cursor.
 *
 * @param {number}   value       current rating, 0 = unset
 * @param {Function} onChange    (next: number) => void
 * @param {string}   labelledBy  id of the visible label
 */
export function StarInput({ value = 0, onChange, size = 30, max = 5, labelledBy }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(Math.min(max, (value || 0) + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(Math.max(1, (value || 1) - 1))
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(0)}
      className="rvStarInput"
    >
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            /* Exactly one star is tabbable, so Tab enters the group once and
               arrow keys move within it — the standard radiogroup contract. */
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onClick={() => onChange(n)}
            className="rvStarButton"
          >
            <Glyph size={size} on={n <= shown} />
          </button>
        )
      })}
    </div>
  )
}
