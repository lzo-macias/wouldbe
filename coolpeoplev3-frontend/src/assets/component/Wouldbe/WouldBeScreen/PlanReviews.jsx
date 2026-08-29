import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Plans from './Plans'
import Bio from './Bio'
import Reviews from "./Reviews"
import "./PlanReviews.css"

// Green assets, matching the leave-a-review picker. The gold Star.svg stays for
// Grid/Grid2x — recolouring that shared file in place would turn every star in the
// app green, and an <img> can't be recoloured by CSS because the fill is baked in.
const Stars = ({ rating }) => {
  const half = Math.round((Number(rating) || 0) * 2) / 2
  return (
    <span className='reviewStars' aria-hidden = 'true'>
      {[1, 2, 3, 4, 5].map((i) => (
        <img
          key = {i}
          src = {half >= i ? "/homepagegraphics/StarGreen.svg" : half >= i - 0.5 ? "/homepagegraphics/HalfstarGreen.svg" : "/homepagegraphics/StarGreen.svg"}
          className={half >= i - 0.5 ? "reviewStarOn" : "reviewStarOff"}
          alt = ""
        />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// One debate row, two shapes.
//
// /debate-history rows are keyed `debate_id` and carry `debate_status`;
// /sponsored-debates rows are `SELECT d.*`, so they are keyed `id` and carry
// `status`. The old markup read `d.id` for BOTH the React key and the link,
// which is undefined on every history row — a duplicate-key warning and a link
// to /debate/undefined. Normalised once, here, rather than at four call sites.
// ---------------------------------------------------------------------------
const debateId = (d) => d.debate_id ?? d.id

const money = (c) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(c || 0) / 100)

// Whole days to a timestamp, floored at 0 — the same arithmetic the pledge card
// uses, so "4 days left" means the same thing on both.
const daysTo = (value) => {
  if (!value) return null
  const ms = new Date(value).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.ceil(ms / 86400000))
}

// The status pill. A WIN outranks whatever the debate itself is doing: it is the
// strongest claim on this page, so it wears the plate and everything else is a
// quieter chip on the gold ground.
function debateStatus(d, won) {
  if (won) return { label: 'Won', tone: 'win' }
  const status = d.debate_status ?? d.status
  if (d.outcome === 'placed' && d.placement) return { label: `#${d.placement}`, tone: 'win' }
  if (status === 'live') return { label: 'Live', tone: 'live' }
  if (status === 'open_entry') return { label: 'Open entry', tone: '' }
  if (status === 'closed') return { label: 'Concluded', tone: '' }
  if (status === 'cancelled') return { label: 'Cancelled', tone: '' }
  if (status === 'draft') return { label: 'Draft', tone: '' }
  return { label: 'Entered', tone: '' }
}

// ============================================================================
// The campaign's case, in sections.
//
// IT LOOKS LIKE TABS AND BEHAVES LIKE ANCHORS, deliberately. Real tabs hide
// content from Ctrl+F, from a screen reader scanning the page, and from search —
// on a page whose entire job is persuasion, putting three quarters of the pitch
// behind a click is the wrong trade. Same visual, all content present, and a
// section is now something you can link somebody to.
//
// NOTHING THE CHILDREN DO HAS CHANGED. Bio still renders the owner, Plans still
// decides edit-if-mine from the owner id, Reviews still signs its composer with
// the viewer and works out your-own-profile for itself. Same components, new
// frame.
// ============================================================================

// HIDDEN FOR NOW — two flags, not two deletions. The sections, their nav
// entries and the components that fill them are all still here and still wired;
// flip these to true and they come back exactly as they were. Deleting them
// would mean rebuilding the props, the star helper and the scrollspy ids later
// from memory.
const SHOW_BIO = false
const SHOW_REVIEWS = true

// The scrollspy. IntersectionObserver rather than a scroll handler: the browser
// does the work off the main thread, where a listener firing every frame on a
// long page is exactly what makes a page feel heavy.
function useScrollSpy(ids, deps) {
  const [active, setActive] = useState(ids[0])
  const ticking = useRef(false)

  useEffect(() => {
    const seen = new Map()
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean)
    if (!els.length) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e)
        if (ticking.current) return
        ticking.current = true
        requestAnimationFrame(() => {
          ticking.current = false
          // The TOPMOST section on screen wins. Ranking by "most visible"
          // instead makes the marker jump backwards whenever a short section
          // scrolls past a long one.
          const visible = [...seen.values()]
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          if (visible[0]) setActive(visible[0].target.id)
        })
      },
      // Top-weighted: a section becomes current once its heading clears the
      // sticky nav, not when its last line finally leaves the screen.
      { rootMargin: '-64px 0px -55% 0px', threshold: [0, 0.01] }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return active
}

// `user` is the campaign OWNER — the person this whole screen is about, whose
// bio the case section renders and whose reviews are listed. `viewer` is whoever
// is logged in. They are only the same person on your own campaign.
function PlanReviews({
  plans,
  user,
  viewer,
  profileUserId,
  reviews,
  ongoingDebates = [],
  wonDebates = [],
}) {
  const positionCount = plans?.flatMap((p) => p.components ?? []).length ?? 0
  const debates = useMemo(
    () => [...(ongoingDebates || []), ...(wonDebates || [])],
    [ongoingDebates, wonDebates]
  )
  // Keyed by the NORMALISED id. `d.id` is undefined on a /debate-history row,
  // so this set was previously {undefined} and no debate was ever marked won.
  const wonIds = useMemo(
    () => new Set((wonDebates || []).map(debateId)),
    [wonDebates]
  )

  // A section is only listed once it has something in it — a nav entry that
  // scrolls you to an empty box is a promise the page does not keep.
  const sections = [
    ...(SHOW_BIO ? [{ id: 'story', label: 'The case' }] : []),
    { id: 'positions', label: 'Positions', count: positionCount },
    ...(debates.length
      ? [{ id: 'debates', label: 'Debate record', count: debates.length }]
      : []),
    ...(SHOW_REVIEWS
      ? [{ id: 'reviews', label: 'Reviews', count: reviews?.review_count }]
      : []),
  ]

  const active = useScrollSpy(
    sections.map((s) => s.id),
    [positionCount, debates.length, reviews?.review_count]
  )

  // THE NAV SCROLLS, IT DOES NOT NAVIGATE. A bare `href="#positions"` sets the
  // location hash, which is a history entry — so Back walked through every
  // section the reader had clicked, and under a router each of those is a
  // navigation the page flashes through. The <a> keeps its href (Ctrl-click and
  // "copy link address" still work, and it is still a link to a screen reader);
  // a plain left click is handled here instead.
  const jumpTo = (e, id) => {
    // Anything the browser should handle its own way — new tab, new window,
    // middle click — is left alone.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    // Honoured explicitly: `scroll-behavior: smooth` in CSS respects the OS
    // setting on its own, but scrollIntoView's `behavior` option does not.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    // Move the keyboard with the eye — otherwise Tab after a jump continues from
    // wherever focus was left, which on a long page is nowhere near the section
    // that was just asked for. preventScroll, or the focus undoes the animation.
    el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }

  return (
    <>
      <nav className='wb-secnav' aria-label='Campaign sections'>
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => jumpTo(e, s.id)}
            aria-current={active === s.id ? 'true' : 'false'}
          >
            {s.label}
            {s.count ? ` (${s.count})` : ''}
          </a>
        ))}
      </nav>

      <div className='wb-sections'>
        {SHOW_BIO && (
          <section className='wb-sec' id='story'>
            <h2 className='wb-sec__h'>The case</h2>
            <Bio user={user} reviews={reviews} Stars={Stars} />
          </section>
        )}

        <section className='wb-sec' id='positions'>
          <h2 className='wb-sec__h'>
            Positions {positionCount ? <span>{positionCount}</span> : null}
          </h2>
          {/* profileUserId is the campaign OWNER. Plans compares it to the viewer
              in localStorage to decide edit-if-mine — the same source, and for
              the same reason, as Reviews below: it is correct on the first
              render, where a prop threaded down from the page's fetch is still
              null. */}
          <Plans plans={plans} profileUserId={profileUserId} />
        </section>

        {!!debates.length && (
          <section className='wb-sec' id='debates'>
            <h2 className='wb-sec__h'>
              Debate record <span>{debates.length}</span>
            </h2>
            {/* THE PLATE, not a list of rows. A debate is the one thing on
                this page the candidate did not write about themselves — it is
                the evidence, and evidence that looks like a table of contents
                gets read like one. Same tile the debate feed uses, so a card
                means the same thing wherever it turns up. */}
            <div className='wb-grid'>
              {debates.map((d) => {
                const id = debateId(d)
                const won = wonIds.has(id)
                const { label, tone } = debateStatus(d, won)
                const prize = Number(d.prize_pool_cents ?? d.sponsor_contribution_cents ?? 0)
                const left = daysTo(d.end_date)
                return (
                  <Link key={id} to={`/debate/${id}`} className='wb-card'>
                    <div className='wb-tile'>
                      <div className='wb-tile__top'>
                        <span className={`wb-tile__status${tone ? ` wb-tile__status--${tone}` : ''}`}>
                          {label}
                        </span>
                      </div>
                      {/* The QUESTION is the tile. It clamps at three lines in
                          CSS — the wrapper owns the overflow, the <p> owns the
                          clamp, because -webkit-box and flex sizing cannot both
                          win the display property on one element. */}
                      <div className='wb-tile__body'>
                        <p className='wb-tile__q'>{d.title}</p>
                      </div>
                      {prize > 0 && (
                        <p className='wb-tile__prize'>total prize <b>{money(prize)}</b></p>
                      )}
                    </div>
                    <div className='wb-meta'>
                      {/* Competing and hosting are different claims. A sponsored
                          row has no contestant record, which is what tells them
                          apart — not a flag either endpoint sends. */}
                      <span className='wb-meta__who'>
                        {d.contestant_id ? 'Competed' : 'Hosted'}
                      </span>
                      {typeof d.total_contestants === 'number' && (
                        <><span className='wb-meta__dot' /><span>{d.total_contestants} in</span></>
                      )}
                      {left !== null && (d.debate_status ?? d.status) !== 'closed' && (
                        <><span className='wb-meta__dot' /><span>{left === 0 ? 'ends today' : `${left}d left`}</span></>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {SHOW_REVIEWS && (
        <section className='wb-sec' id='reviews'>
          <h2 className='wb-sec__h'>
            Reviews {reviews?.review_count ? <span>{reviews.review_count}</span> : null}
          </h2>
          {/* `viewer`, NOT `user` — `user` is the campaign owner, i.e. the person
              being reviewed. Reviews needs both: profileUserId to key its requests
              to, and the viewer to sign the composer and spot the caller's own row.
              It brings its own Stars (inline SVG, so a fractional average renders
              without a second asset); the img-based `Stars` above stays for Bio. */}
          <Reviews profileUserId={profileUserId} viewer={viewer} reviews={reviews} />
        </section>
        )}

      </div>
    </>
  )
}

export default PlanReviews
