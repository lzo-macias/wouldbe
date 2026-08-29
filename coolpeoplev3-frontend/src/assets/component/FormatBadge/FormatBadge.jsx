import React from "react"
import "./FormatBadge.css"

/**
 * FormatBadge — stream vs written, on the gold plate.
 *
 * Replaces the outline pill that used to sit on the debate tile, which measured
 * 3.09:1 on the plate (10px text needs 4.5:1) and only survived because a dark
 * scrim was painted into the tile's corner underneath it. Solid dark plate =
 * 11.5:1; the quieter written variant = 5.6:1, so the scrim is gone and the
 * gold reads clean edge to edge. The icon carries the meaning before the word
 * is read, which matters at grid size where the label is 9.5px.
 *
 * ON THE LABELS: "Stream" / "Written", not LIVE / TEXT. A LIVE badge everywhere
 * else on the web means "broadcasting right now" — ours means "this debate's
 * format is a stream", which may be scheduled for next month. The DB column is
 * still `format` = 'live' | 'typed'; the map below is the single place that
 * turns those stored values into words a reader sees, so the host form and the
 * filters can be brought onto the same vocabulary by importing this rather than
 * by restating the strings.
 */

const StreamIcon = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="6" cy="6" r="2" fill="currentColor" />
    <path d="M2.6 2.6a4.8 4.8 0 000 6.8M9.4 2.6a4.8 4.8 0 010 6.8"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

const WrittenIcon = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 3h7M2.5 6h7M2.5 9h4.5"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

// Every spelling the codebase uses for the same two things: `format` is
// 'live' | 'typed' in the DB, the debate screens say stream/text, and copy
// says written. All of them resolve here rather than at each call site.
const FORMATS = {
  live:    { label: "Stream",  Icon: StreamIcon,  tone: "strong" },
  stream:  { label: "Stream",  Icon: StreamIcon,  tone: "strong" },
  typed:   { label: "Written", Icon: WrittenIcon, tone: "quiet" },
  text:    { label: "Written", Icon: WrittenIcon, tone: "quiet" },
  written: { label: "Written", Icon: WrittenIcon, tone: "quiet" },
}

export default function FormatBadge({ format = "live", className = "" }) {
  const f = FORMATS[String(format).toLowerCase()] ?? FORMATS.live
  const { label, Icon, tone } = f
  return (
    <span className={`wb-fmt wb-fmt--${tone} ${className}`}>
      <Icon />
      {label}
    </span>
  )
}
