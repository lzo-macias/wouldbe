import React, { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../lib/api'
import FilterPanel from './FilterPanel'
import Trophy from '../debate/Debates/Trophy'
import ExpandButton from './ExpandButton'
// NOT lazy: it is the rail's primary control and it is on screen from first
// paint, so deferring it would mean a chunk fetch before the door can be opened.
import PostMenu from './PostMenu'
import { BY_KIND } from './PostTypes'
// STATIC, unlike DebateExpanded. EntryPreview renders on the COLLAPSED card, so
// half this module is needed before the feed's first paint anyway — and a
// module that is both statically and dynamically imported gets pulled into the
// main chunk regardless, which Rollup says out loud (INEFFECTIVE_DYNAMIC_IMPORT)
// while the lazy() wrapper quietly does nothing. It is a light module: no
// bracket, no threads, no ballots.
import DebateEntry, { EntryPreview } from './DebateEntry'
// LAZY. Statically imported, opening the feed would download the bracket, the
// conversation threads and the whole application form to a visitor who is only
// scrolling — the exact unused-JavaScript problem route splitting was added to
// fix. They arrive when something opens them.
//
// Each gets its OWN Suspense boundary. App.jsx has one at the route level, and
// without a nearer boundary a chunk fetch would suspend all the way up and
// replace the entire feed with "Loading…" — every card gone because one card
// was opened.
const DebateExpanded = lazy(() => import('./DebateExpanded'))
const Composer = lazy(() => import('./Composer'))
// The grid is a whole second layout and most sessions never switch to it, so it
// is not in the initial bundle.
const FeedGrid = lazy(() => import('./FeedGrid'))
const WouldBeFlow = lazy(() => import('./WouldBeFlow'))
// The pledge → tip → card flow, REUSED from the would-be screen rather than
// rebuilt here. It already carries the parts that are easy to get wrong and
// expensive to get wrong twice: the live remaining pledge cap, the
// us_citizen_or_lpr attestation retry, and the fact that only the TIP is a real
// Stripe charge. A second implementation on this page would be a second place
// for those to drift.
const PledgeFlow = lazy(() => import('../../component/Wouldbe/WouldBeScreen/PledgeFlow'))
const DebateFlow = lazy(() => import('./DebateFlow'))
import { BRACKETS } from './debateFixture'
import { DEFAULT_FEED_FILTERS, applyFeedFilters } from '../../lib/feedFilters'
import './HomeV2.css'

/* ============================================================================
 * HomeV2 — the feed, on the "Cards · white" model. Nothing here replaces
 * Home.jsx or Grid2x; both are untouched and still serve "/". This is /homev2.
 *
 * THE CANVAS is a data attribute. It sits on the page wrapper rather than on
 * <html>, because <html> is shared by every route in this SPA and an attribute
 * set there would outlive the page that wanted it:
 *
 *     <div className="wbfeed" data-canvas="white">   ← default, what ships
 *
 * HomeV2.css also carries "paper" / "deep" (warm ground + cards) and
 * "flat" / "flat-tight" (no cards) — flip CANVAS below to see them.
 *
 * ── two invariants the design rests on ──────────────────────────────────────
 *
 * 1. --rule-strong (#DFD8C8, 1.42:1 on white) is for OUTER boundaries ONLY. On
 *    a white ground the card and the page are the same colour, so the card is a
 *    frame rather than a raised surface, and that 1px outline is the only thing
 *    separating a prompt from the page. Put a border of that weight on anything
 *    INSIDE a card and the card edge stops reading as the outer edge. Internal
 *    separators use --rule-2 (1.18:1).
 *
 * 2. --foot (#FAF5E9) is load-bearing, not decoration. It is the only fill
 *    change left on the card, and it is what gives the card a bottom edge
 *    instead of trailing off. Don't "clean it up" to white.
 *
 * ── what changed from the original screen ───────────────────────────────────
 *
 *  1. THE GRID. ~360px of dead gutter on the left, rail hanging off the right,
 *     because nothing centred the three columns as one unit. Now
 *     `208px minmax(0,1fr) 304px`, max-width 1272, margin-inline auto — and the
 *     header uses the SAME template, so the wordmark sits over the nav and the
 *     search sits over the feed.
 *
 *  2. THE DUEL. The two responses were nested chat bubbles in a flat grey box:
 *     three levels of grey, an iMessage metaphor, and no author on either side.
 *     A debate is two people opposed, so it is now two opposed columns with a
 *     hairline between them, each carrying its own author, stance, score and
 *     comment count. The grey box is gone.
 *
 *  3. VOTES HAD NO SCORE — bare arrows with nothing between them, on a product
 *     whose whole point is which argument is winning.
 *
 *  4. THE PROMPT BAR HAD VOTE ARROWS TOO, identical to the response ones.
 *     Prompt-level actions moved to a footer bar; arrows belong to responses.
 *
 *  5. TWO FILTER CONTROLS doing the same job. Kept the one next to the feed —
 *     and it is the app's REAL HomeFilter, not a second control that would have
 *     to be kept in step with the first.
 *
 *  6. THE RAIL was one card above 700px of nothing, with a stray "+" over it.
 *     Now a tighter join panel plus Closing soon — deadline pressure is the
 *     retention mechanic, so it belongs where the eye rests.
 *
 *  7. CONTRAST. The old tertiary grey #948B7C measured 3.4:1 and failed AA on
 *     every handle, timestamp and legal line. --fg-3 is #7A715F (4.8:1 on the
 *     card, 4.6:1 on the canvas), #8A8071 on dark.
 *
 * Type: Archivo for chrome, Newsreader for argument bodies (loaded in
 * index.html). The serif marks the arguments as the record and separates
 * testimony from interface.
 *
 * MONEY IS CENTS. Everywhere else in this app a prize crosses the wire as
 * `prize_pool_cents`, so the props here are `prizeCents` and the formatter
 * divides. A card that quietly wanted dollars is how a $500 prize becomes $5.
 *
 * THE CARDS ARE FIXTURES. /api/debates returns the prompt, prize, format and
 * counts but not the two responses a duel needs, so the feed below is shaped
 * like the row we will eventually be handed rather than fetched. Every control
 * is real, focusable and labelled; wiring is handing it a handler.
 * ==========================================================================*/

const CANVAS = 'white'   // 'white' | 'paper' | 'deep' | 'flat' | 'flat-tight'

/* ---------------------------------------------------------------- icons -- */
const I = {
    search: (p) => (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
            <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M13.6 13.6 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    ),
    home: (p) => (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
            <path d="M3 8.4 10 3l7 5.4V16a1 1 0 0 1-1 1h-3.5v-4.6h-5V17H4a1 1 0 0 1-1-1V8.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    ),
    chat: (p) => (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
            <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    ),
    gavel: (p) => (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
            <path d="M4 16h8M6.2 12.4 12.6 6M4.6 8.2l3.6-3.6M7 5.6l3 3M11.6 10.2l3.6-3.6M13 4.4l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    user: (p) => (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...p}>
            <circle cx="10" cy="7" r="3.1" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4 17c.6-3.2 3-4.8 6-4.8s5.4 1.6 6 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    plus: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    ),
    filter: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    ),
    grid: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            {[[2, 2], [9, 2], [2, 9], [9, 9]].map(([x, y]) => (
                <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
            ))}
        </svg>
    ),
    list: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    ),
    heart: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M8 13.4 3 8.6a2.95 2.95 0 1 1 4.2-4.15L8 5.3l.8-.85A2.95 2.95 0 1 1 13 8.6L8 13.4Z"
                  stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    ),
    // Two arrows round a loop — the shape everyone already reads as "send this
    // on". Drawn open rather than as a closed rectangle so it does not collide
    // with the save bookmark two icons along.
    repost: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M3.2 6.2V5a1.6 1.6 0 0 1 1.6-1.6h6.4M9.4 1.6l1.9 1.8-1.9 1.8"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.8 9.8V11a1.6 1.6 0 0 1-1.6 1.6H4.8M6.6 14.4l-1.9-1.8 1.9-1.8"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    comment: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.5L3.5 14v-2.5a1 1 0 0 1-.5-1v-6a1 1 0 0 1 0-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    ),
    reply: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M6 3.5 2.5 7 6 10.5M2.5 7h7.2a3.3 3.3 0 0 1 3.3 3.3V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    back: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M9.5 3.5 5 8l4.5 4.5M5 8h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    chevron: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    close: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
    ),
    save: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M4 2.8h8v10.4L8 10.4l-4 2.8V2.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    ),
    share: (p) => (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
            <path d="M8 10.6V2.6M5.2 5.2 8 2.4l2.8 2.8M3.4 9.6v3a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
}

/* ------------------------------------------------------------- primitives - */

const initials = (name = '') =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()

const nf = new Intl.NumberFormat('en-US')
const money = (cents) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(Math.round(Number(cents || 0) / 100))

export function Avatar({ name, src, size = 34, className = '' }) {
    const cls = `av av--${size} ${className}`.trim()
    if (src) return <img className={cls} src={src} alt="" />
    return <span className={cls} aria-hidden="true">{initials(name)}</span>
}

/**
 * Actions — like, repost, reply. The three things you can do with somebody
 * else's post, and the only three.
 *
 * IT REPLACED AN UP/DOWN VOTE. Arrows were the wrong instrument here: a
 * downvote is a verdict, and this platform already has a place where verdicts
 * are cast — the ballot on a match, scored against published criteria by people
 * who read both sides. A second, frictionless verdict sitting under every
 * paragraph competes with that one and is worth less, which makes the real one
 * look like a formality. Liking, resharing and answering are the things a
 * reader does; judging happens on the ballot.
 *
 * Counts are hidden when zero rather than shown as "0" — an empty count is the
 * loudest possible way to say nobody engaged, and it is never information the
 * reader needed.
 */
export function Actions({
    likes = 0, liked = false,
    reposts = 0, reposted = false,
    replies = 0,
    onLike, onRepost, onReply,
}) {
    return (
        <div className="acts">
            <button
                type="button" className={`act2 act2--like${liked ? ' is-on' : ''}`}
                aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'}
                onClick={() => onLike?.(!liked)}
            >
                <I.heart width="15" height="15" />
                {likes > 0 && <span>{nf.format(likes)}</span>}
            </button>
            <button
                type="button" className={`act2 act2--repost${reposted ? ' is-on' : ''}`}
                aria-pressed={reposted} aria-label={reposted ? 'Undo repost' : 'Repost'}
                onClick={() => onRepost?.(!reposted)}
            >
                <I.repost width="15" height="15" />
                {reposts > 0 && <span>{nf.format(reposts)}</span>}
            </button>
            <button type="button" className="act2 act2--reply" aria-label="Reply" onClick={onReply}>
                <I.reply width="15" height="15" />
                {replies > 0 && <span>{nf.format(replies)}</span>}
            </button>
        </div>
    )
}

/* ------------------------------------------------- the shared card skeleton -
 *
 * Debate, Question, Artifact and Would be are ONE card with two variables: the
 * VALUE SLOT on the right of the head, and the PREVIEW between meta and footer.
 * Everything else is these three components. Keeping them shared is what stops
 * four post types from turning into four products.
 * -------------------------------------------------------------------------*/

/**
 * The debate lifecycle:
 *
 *   entry      seats are still being filled, nothing has been argued yet
 *   live       rounds are running right now  ← the ONLY state that says Live
 *   concluded  a winner has been decided
 *
 * Live is a claim about this moment. Putting it on a debate that has not opened,
 * or one that finished last week, makes every Live badge on the feed worth
 * nothing — so `status` drives it and there is no way to pass it in.
 */
const STATUS = {
    entry:     { cls: 'kind--entry', label: 'Open entry' },
    live:      { cls: 'kind--live',  label: 'Live', pip: true },
    concluded: { cls: 'kind--done',  label: 'Concluded' },
}

export function StatusChip({ status = 'live' }) {
    const st = STATUS[status] ?? STATUS.live
    return (
        <span className={`kind ${st.cls}`}>
            {st.pip && <span className="pip" />}
            {st.label}
        </span>
    )
}

export function KindChip({ kind }) {
    const label = { question: 'Question', artifact: 'Artifact', wouldbe: 'Would be' }[kind]
    if (!label) return null
    return <span className={`kind kind--${kind}`}>{label}</span>
}

/** The one slot whose content is the kind's headline number. */
export function ValueSlot({ n, label }) {
    if (n == null) return null
    return (
        <span className="val">
            <span className="val__n">{n}</span>
            <span className="val__l">{label}</span>
        </span>
    )
}

/**
 * `action` occupies the same slot as `value` and wins it. That slot is the top
 * right of the head, and only one thing can live there: on a would be it is the
 * funded percentage, on a debate it is now the way into the debate itself.
 */
export function CardHead({ author, onFollow, value, action }) {
    return (
        <div className="card__head">
            <Link className="who" to={author.to ?? author.href ?? '#'}>
                <Avatar name={author.name} src={author.avatarUrl} size={34} />
                <span className="who__t">
                    <span className="who__n">{author.name}</span>
                    <span className="who__m">
                        @{author.handle}{author.office ? ` · ${author.office}` : ''}
                    </span>
                </span>
            </Link>
            <button type="button" className="follow" onClick={onFollow}>Follow</button>
            {action ?? (value && <ValueSlot {...value} />)}
        </div>
    )
}

export function MetaRow({ kind, items = [], urgent, className = 'meta', children }) {
    return (
        <div className={className}>
            {children}
            {kind && <KindChip kind={kind} />}
            {items.map((m) => (
                <React.Fragment key={m}>
                    <span className="meta__dot" />
                    <span>{m}</span>
                </React.Fragment>
            ))}
            {urgent && (
                <>
                    <span className="meta__dot" />
                    <span className="meta__urgent">{urgent}</span>
                </>
            )}
        </div>
    )
}

export function CardFoot({ children, comments, to = '#' }) {
    return (
        <footer className="card__foot">
            {children}
            {comments != null && <Link className="act" to={to}>{comments}</Link>}
            <span className="sp" />
            <button type="button" className="act" aria-label="Save"><I.save width="15" height="15" /></button>
            <button type="button" className="act" aria-label="Share"><I.share width="15" height="15" /></button>
        </footer>
    )
}

/* --------------------------------------------------------------- the duel - */

/**
 * The one emphasised sentence in an argument — the line a skimmer should catch
 * if they read nothing else. Pass `pull` as the exact substring to mark; it
 * renders as <b>, which the stylesheet gives a gold wash with
 * box-decoration-break so it survives wrapping across lines.
 *
 * Silently returns the body unchanged if the substring isn't found, so a stale
 * `pull` after an edit degrades to plain text instead of throwing.
 *
 * `body` also accepts a React node directly if you'd rather mark it yourself.
 */
function withPull(body, pull) {
    if (typeof body !== 'string' || !pull) return body
    const i = body.indexOf(pull)
    if (i === -1) return body
    return (
        <>
            {body.slice(0, i)}
            <b>{pull}</b>
            {body.slice(i + pull.length)}
        </>
    )
}

/**
 * One side of the argument. `stance` is the short label the responder picked
 * ("for the cap", "against") — it is what makes two blocks of prose read as a
 * debate rather than a comment thread.
 */
export function DuelSide({
    author, stance, body, pull,
    likes = 0, liked = false, reposts = 0, reposted = false, comments = 0,
    won = false, onLike, onRepost, onReply, commentsTo = '#',
}) {
    return (
        <div className={`side${won ? ' side--won' : ''}`}>
            <div className="side__head">
                <Avatar name={author.name} src={author.avatarUrl} size={24} />
                <span className="side__n">{author.name}</span>
                {/* "Concluded" with no winner marked is a label with no payload —
                    the reader is left counting votes to work out who took it. */}
                {won && (
                    <span className="won">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="m4.2 8.2 2.4 2.4 5-5.2" stroke="currentColor" strokeWidth="2.1"
                                  strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Won
                    </span>
                )}
                {stance && <span className="stance">{stance}</span>}
            </div>
            <p className="arg">{withPull(body, pull)}</p>
            <div className="side__foot">
                <Actions
                    likes={likes} liked={liked}
                    reposts={reposts} reposted={reposted}
                    replies={comments}
                    onLike={onLike} onRepost={onRepost} onReply={onReply}
                />
            </div>
        </div>
    )
}

/** Half a duel with nobody in it yet. Shipping the state beats shipping a gap. */
export function OpenSeat({ deadlineLabel = 'Friday', onClaim }) {
    return (
        <div className="seat">
            <span className="seat__h">Second seat open</span>
            <p className="seat__p">
                No one has taken the other side yet. Claim it before {deadlineLabel} and
                your response opens the round.
            </p>
            <button
                type="button" className="btn btn--gold"
                style={{ height: 34, padding: '0 14px', fontSize: 13 }}
                onClick={onClaim}
            >
                Take this side
            </button>
        </div>
    )
}

/**
 * PromptCard — a debate. `responses` takes 0, 1 or 2 entries; a missing one
 * renders the open-seat state in its place.
 *
 * It is the shared skeleton (CardHead / MetaRow / CardFoot) plus the one thing
 * only a debate has: the duel. Question, Artifact and Would be live in
 * PostTypes.jsx and are the same card with a different preview.
 */
export function PromptCard({
    to = '#',
    id,
    debateId,             // the real row this card stands for, if there is one
    entry,                // the nomination stage; used when status === 'entry'
    author,
    question,
    prizeCents,
    status = 'live',      // 'entry' | 'live' | 'concluded'
    meta = [],            // ["8 competitors", "Round 2 of 3"]
    urgent,               // "Ends in 6 hours" — --live, deliberately not gold
    responses = [],
    totalComments = 0,
    totalResponses,
    deadlineLabel,
    phaseLabel = 'debate',
    expanded = false,
    onToggleExpand,
    onFollow, onRespond, onLike, onRepost, onClaimSeat, onSignIn,
}) {
    const [a, b] = responses
    const seat = <OpenSeat deadlineLabel={deadlineLabel} onClaim={onClaimSeat} />
    // BEFORE THE FIRST ROUND there is nothing to duel over, and no bracket to
    // expand into either — an open-entry debate is a different object, not a
    // half-filled version of a live one.
    const atEntry = status === 'entry' && Boolean(entry)
    // A toggle that expands into "that debate does not exist" is worse than no
    // toggle, so a live card with no row behind it does not offer one. The entry
    // stage carries its own content, so it needs no row.
    const canOpen = Boolean(onToggleExpand) && (atEntry || Boolean(debateId))

    return (
        // data-open is what the bleed hangs off: the OPEN card grows right
        // across the rail's space.
        <article className="card" {...(canOpen && expanded ? { 'data-open': '' } : {})}>
            <div className="card__pad">
                {/* THE WAY INTO THE DEBATE, where the prize used to be.
                    A card on this feed is ONE PROMPT — one bracket's released
                    round, with the two answers to it — so the top-right slot
                    should not be a number about the tournament the prompt
                    belongs to. It should be the door to that tournament.

                    The prize did not vanish: it moved into the meta line, where
                    it sits with the other facts about the debate rather than
                    occupying the one slot on the card that can be pressed. */}
                <CardHead
                    author={author} onFollow={onFollow}
                    action={<Link className="tobig" to={to}>Debate</Link>}
                />
                {/* THE QUESTION IS THE DOOR. On a one-page feed, clicking the
                    thing you are reading should open it where it is — a
                    navigation here would throw away the column position of every
                    card above it. A real <button> when it opens in place and a
                    link when it cannot: two different promises, and the keyboard
                    should hear which. */}
                {canOpen ? (
                    <button type="button" className="q q--btn" aria-expanded={expanded} onClick={onToggleExpand}>
                        {question}
                    </button>
                ) : (
                    <Link className="q" to={to}>{question}</Link>
                )}
                <MetaRow
                    items={prizeCents > 0 ? [`${money(prizeCents)} prize`, ...meta] : meta}
                    urgent={urgent}
                >
                    <StatusChip status={status} />
                </MetaRow>
            </div>

            {atEntry ? (
                <EntryPreview
                    nominations={entry.nominations}
                    totalNominations={entry.totalNominations}
                    onNominate={entry.onNominate ?? onSignIn}
                />
            ) : (
            <div className="duel">
                {a ? (
                    <DuelSide
                        {...a}
                        onLike={(v) => onLike?.(a.id, v)}
                        onRepost={(v) => onRepost?.(a.id, v)}
                        onReply={onRespond}
                    />
                ) : seat}
                <div className="duel__rule" aria-hidden="true" />
                {b ? (
                    <DuelSide
                        {...b}
                        onLike={(v) => onLike?.(b.id, v)}
                        onRepost={(v) => onRepost?.(b.id, v)}
                        onReply={onRespond}
                    />
                ) : seat}
            </div>
            )}

            {/* THE WHOLE DEBATE, INSIDE THE CARD — on white. Reddit and Substack
                expand in place onto the SAME paper, and a colour change here
                would say "new page" about something that deliberately is not one.

                Mounted only while open: it fetches on mount, and keeping ten of
                them alive behind closed cards would be ten reads for nine
                screens nobody is looking at. */}
            {canOpen && expanded && (
                atEntry ? (
                    <DebateEntry
                        {...entry} id={id}
                        onNominate={entry.onNominate ?? onSignIn}
                        onJoin={entry.onJoin ?? onSignIn}
                        onCriteria={entry.onCriteria}
                    />
                ) : (
                    <Suspense fallback={<p className="xp__wait">Loading the debate…</p>}>
                        <DebateExpanded debateId={debateId} onSignIn={onSignIn} onAdd={onRespond} />
                    </Suspense>
                )
            )}

            {/* --foot lives here. On a white ground this bar is the only fill
                change on the card and it is what gives the card a bottom edge. */}
            {/* ONE CONTROL. The expand button carries the comment count as its
                label — a separate "Read all N comments" beside it pointed at the
                same place and read as a destination that does not exist. */}
            <CardFoot to={to}>
                {!atEntry && responses.length === 2 && (
                    <button type="button" className="respond" onClick={onRespond}>
                        <I.reply width="14" height="14" />
                        Respond
                    </button>
                )}
                {canOpen && (
                    <ExpandButton
                        id={debateId ?? id} open={expanded} onClick={onToggleExpand}
                        // RESPONSES, not comments — what opens is the rest of
                        // the field answering this prompt, and calling those
                        // comments files an entry in the bracket as a remark
                        // about it. Same word the debate screen uses.
                        label={atEntry
                            ? 'See who is in it'
                            : `Read all ${nf.format(totalResponses ?? totalComments)} responses`}
                    />
                )}
            </CardFoot>
        </article>
    )
}

/**
 * The feed is a mixed list, so it dispatches on kind. A debate is a PromptCard;
 * everything else comes from PostTypes. They all take the same expand props,
 * which is what lets FeedPage own the state in one place.
 */
export function PostCard({ kind = 'debate', ...props }) {
    const C = BY_KIND[kind]
    return C ? <C {...props} /> : <PromptCard {...props} />
}

/* ------------------------------------------------------------------ shell - */

export function Header({ me, userId, onStart, onAccount, tagline = 'candidates under 45' }) {
    const name = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || me?.username || ''
    return (
        <header className="hdr">
            <div className="wrap">
                <div className="hdr__in">
                    <Link className="mark" to="/" aria-label="would be — home">
                        {/* THE FIGURE IS THE MARK NOW. She was in the join panel
                            and the wordmark was up here; they have traded
                            places. A symbol reads faster than a word at the top
                            of a page you visit every day, and the tagline
                            underneath is still carrying the name in full. */}
                        <span className="mark__i"><Trophy size={34} /></span>
                        <span className="mark__t">{tagline}</span>
                    </Link>

                    <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
                        <I.search width="17" height="17" />
                        <input
                            id="q" type="search"
                            aria-label="Search debates, candidates, offices"
                            placeholder="Search debates, candidates, offices"
                        />
                        <span className="kbd">/</span>
                    </form>

                    <div className="hdr__r">
                        {/* START, not "New prompt". The old button named ONE of
                            the four things you can put here, in a header whose
                            own action buttons are hidden — so the slot was
                            advertising a corner of the product from the position
                            reserved for its front door. "Start" is the door: the
                            same word the join panel uses, so the two read as one
                            invitation rather than two offers.

                            No plus glyph. A plus means "one more of these", and
                            this button is not adding a thing to a list — signed
                            out it is where you begin, signed in it opens the
                            composer. */}
                        <PostMenu className="btn btn--gold hdr__start" align="right" onPick={onStart}>
                            Start
                        </PostMenu>
                        {/* Their own face once we know it. Signed out this is the
                            sign-in door rather than a hidden control — a profile
                            button that appears only after you have an account is
                            a feature nobody discovers they were missing. */}
                        {/* THREE STATES, and the third one was missing. With a
                            photo it is their face; with a name but no photo it is
                            their initials; with NEITHER — which is every
                            logged-out visitor — it used to be initials('') = an
                            empty circle, a button that looked like a rendering
                            failure in the one slot that is supposed to say "you".
                            The glyph is the answer: a face is the universal word
                            for a person, and it needs no account to draw. */}
                        <button
                            type="button" className="av av--38"
                            aria-label={userId ? 'Your account' : 'Sign in'}
                            title={userId ? 'Your account' : 'Sign in'}
                            onClick={onAccount}
                        >
                            {me?.profile_photo_url ? (
                                <img src={me.profile_photo_url} alt="" />
                            ) : name ? (
                                initials(name)
                            ) : (
                                <I.user width="19" height="19" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    )
}

// Real routes where one exists — a nav item that goes nowhere teaches people
// the nav is decorative. Search and Chat have no screen yet, so they hold this
// page rather than pretending. Profile resolves per-visitor, so it comes in as
// a prop rather than being baked into the table.
const NAV = [
    { id: 'home', label: 'Home', icon: I.home, to: '/homev2' },
    { id: 'search', label: 'Search', icon: I.search, to: '/homev2' },
    { id: 'chat', label: 'Chat', icon: I.chat, to: '/homev2' },
    { id: 'judge', label: 'Judge', icon: I.gavel, to: '/debate' },
    { id: 'profile', label: 'Profile', icon: I.user, to: null },
]

export function Nav({ current = 'home', counts = {}, profileTo = '/login', onStart }) {
    return (
        <nav className="nav" aria-label="Primary">
            <div className="nav__list">
                {NAV.map(({ id, label, icon: Icon, to }) => {
                    const on = id === current
                    const n = counts[id]
                    return (
                        <Link
                            key={id}
                            to={id === 'profile' ? profileTo : to}
                            className={`nav__i${on ? ' nav__i--on' : ''}`}
                            aria-current={on ? 'page' : undefined}
                        >
                            <Icon width="19" height="19" />
                            {label}
                            {n > 0 && <span className="nav__n">{n}</span>}
                        </Link>
                    )
                })}
            </div>

            <div className="nav__cta">
                {/* "Start a post", not "Start a debate". A debate is ONE of the
                    things you can put up here — a would be, a question and an
                    article are the others — and naming the button after one of
                    four teaches people the other three live somewhere else.

                    It opens the four AS A POPOVER on itself rather than a panel
                    in the feed: choosing a kind is not a step of writing a post,
                    it is the question of which post you are writing. */}
                <PostMenu className="btn btn--ghost btn--full" onPick={onStart}>
                    <I.plus width="15" height="15" />
                    Start a post
                </PostMenu>
            </div>

            {/* Terms and Privacy are the two that exist — the PDFs in /public.
                They open as files, so they are plain anchors, not router links. */}
            <div className="nav__foot">
                <Link to="/homev2">About</Link>
                <Link to="/homev2">Rules</Link>
                <Link to="/homev2">Judging</Link>
                <a href="/terms-of-service.pdf" target="_blank" rel="noreferrer">Terms</a>
                <a href="/privacy-policy.pdf" target="_blank" rel="noreferrer">Privacy</a>
            </div>
        </nav>
    )
}

// Following and New have nothing behind them yet — no follow graph on the feed,
// no recency sort — and a tab that changes nothing teaches people the tabs do
// nothing. Listed rather than deleted so switching one on is a flag, not a
// rewrite. A lone "For you" still earns its place: it names what the column is,
// which matters more once there is a second thing it could have been.
const SORTS = [
    ['for-you', 'For you', true],
    ['following', 'Following', false],
    ['new', 'New', false],
]

export function FeedToolbar({
    sort = 'for-you', view = 'list', onSort, onView, filters, onFiltersChange,
    expanded = false, onBack,
}) {
    const sorts = SORTS.filter(([, , on]) => on)
    return (
        <div className="bar">
            {/* THE WAY BACK, and it is the first thing in the bar because that
                is where a back control lives in every app anyone has used. It
                appears only in expand mode: a back arrow on a feed that is
                already the top of the stack points at nothing. */}
            {expanded && (
                <button type="button" className="bar__back" onClick={onBack}>
                    <I.back width="16" height="16" />
                    <span>Back</span>
                </button>
            )}
            <div className="seg" role="group" aria-label="Sort">
                {sorts.map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={sort === id} onClick={() => onSort?.(id)}>
                        {label}
                    </button>
                ))}
            </div>
            <div className="bar__sp" />
            {/* The feed's own filter — anchored to its chip, and committing on
                Apply rather than on every press. It replaced HomeFilter, which
                is the v1 grid's control and asks the v1 grid's questions:
                status, lean, a disabled "contentious" toggle, none of which
                this feed has. */}
            <FilterPanel value={filters} onApply={onFiltersChange} />
            <div className="seg seg--icon" role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => onView?.('grid')}>
                    <I.grid width="15" height="15" />
                </button>
                <button type="button" aria-pressed={view === 'list'} aria-label="List view" onClick={() => onView?.('list')}>
                    <I.list width="15" height="15" />
                </button>
            </div>
        </div>
    )
}

// The panel keeps its shape signed in and swaps its two buttons — the page
// would go visibly lopsided if it vanished the moment somebody joined.
// `pitch` is the headline and the paragraph. Off for now: the tagline under the
// wordmark already says what this place is, and the panel repeating it two
// columns away was the same sentence twice on one screen. Kept behind a flag
// rather than deleted — the copy is the first thing that comes back if this
// panel ever has to sell rather than just let you in.
//
// With the copy gone the panel is a mark and two doors, so the mark centres:
// left-aligned it was hanging off the edge of text that is no longer there.
export function JoinPanel({ signedIn, pitch = false }) {
    return (
        <div className={`panel panel--join${pitch ? '' : ' is-bare'}`}>
            {/* AND THE WORDMARK IS HERE. The panel is where somebody decides
                whether to join, which is the one moment on this page they need
                to know what the place is CALLED — a symbol cannot be typed into
                a search box or repeated to a friend. */}
            <span className="join__mark join__mark--word">would be</span>
            {pitch && (
                <>
                    <h2 className="join__h">{signedIn ? 'Take the floor.' : 'Run the argument.'}</h2>
                    <p className="join__p">
                        Post a prompt, take a side, get judged in public. A fundraising platform
                        for candidates under 45 years old.
                    </p>
                </>
            )}
            <div className="join__btns">
                {signedIn ? (
                    <>
                        <Link className="btn btn--gold btn--full" to="/wouldbe">would be</Link>
                        <Link className="btn btn--ghost btn--full" to="/startadebate">post</Link>
                    </>
                ) : (
                    // BOTH DOORS, and this panel is where they belong: it is the
                    // one block on the page whose whole job is joining, so Start
                    // and Sign in read as a pair of choices rather than as two
                    // unrelated buttons.
                    //
                    // STILL ONE START ON SCREEN. The header's copy is hidden
                    // while this panel is visible — see .hdr__start in the CSS.
                    // The same gold word twice is not emphasis; it is two offers
                    // that turn out to be one, which is when a reader stops
                    // trusting either.
                    <>
                        <Link className="btn btn--gold btn--full" to="/signup">Start</Link>
                        <Link className="btn btn--ghost btn--full" to="/login">Sign in</Link>
                    </>
                )}
            </div>
            <p className="join__foot">would be never sells user data.</p>
        </div>
    )
}

// WHAT KIND OF THING THIS IS. Four things get posted here and they are not
// interchangeable: a would be asks for money, a debate is argued by two people,
// a question is argued by anyone, an article is read. The row says which before
// it says anything else, because the answer changes what you are being asked to
// do with it.
//
// Questions and articles are the WRITTEN forms — a question is a debate anybody
// may answer, an article is one person's case at length. Neither has a route or
// a table yet, so their rows land on this page rather than pretending to a
// screen that does not exist. Nothing here touches the backend.
const KIND = {
    debate:   'Debate',
    wouldbe:  'Would be',
    question: 'Question',
    artifact: 'Artifact',
}

/**
 * The rail's second panel. It was Closing soon — debates only, ordered by
 * deadline — and deadline pressure IS the retention mechanic, so the countdown
 * stays. What changed is that it no longer pretends debates are the only thing
 * moving: a campaign three days from its filing deadline and an article on
 * ballot access are both things a reader came here for.
 *
 * The badge holds whatever number is actually pressing on that row, and ONLY
 * the kinds that have a deadline get a countdown: a debate running against its
 * purse, a would be against a filing date. A question stays open until it stops
 * getting answers and an artifact is a thing somebody wrote — so they carry the
 * number they actually have, the answer count and the read time. Once one badge
 * is a countdown to nothing, none of them are worth reading.
 */
export function Happening({ items = [], to = '/debate' }) {
    return (
        <div className="panel">
            <h2 className="panel__h">Happening now <Link to={to}>See all</Link></h2>
            <div className="soon">
                {items.map((it) => (
                    <Link className="soon__i" key={it.id} to={it.to}>
                        <span className="soon__b">
                            <span className="soon__num">{it.n}</span>
                            <span className="soon__unit">{it.unit}</span>
                        </span>
                        <span className="soon__t">
                            <span className="soon__q">{it.title}</span>
                            <span className="soon__m">
                                <span className="soon__k">{KIND[it.kind] ?? it.kind}</span>
                                {it.stat ? <> · {it.stat}</> : null}
                            </span>
                        </span>
                    </Link>
                ))}
            </div>
        </div>
    )
}

/**
 * FeedPage — the shell. Presentational: it takes data and handlers and knows
 * nothing about where either comes from, so it can be pointed at the API later
 * without touching a line of layout.
 */
/**
 * `page` replaces the feed column entirely — the debate screen is the same app
 * (same header, same nav, same shell) one route over, and copying the chrome
 * into a second component is how two headers drift apart. The rail goes with
 * the feed when it is present: a timeline and a standings table both need the
 * width, and neither is a sidebar.
 */
export function FeedPage({
    me, userId, signedIn, prompts = [], happening = [], navCounts = {},
    current = 'home', canvas = CANVAS, tagline, profileTo, filters, onFiltersChange,
    openId, onOpen, composer, onComposer, page, ...h
}) {
    return (
        // data-expanded lives on BOTH the root and .app. The rail hides off
        // .app; the header sits outside it, so the header's Start needs the flag
        // somewhere it can actually reach.
        <div className="wbfeed" data-canvas={canvas} data-expanded={openId ? '' : undefined}>
            <Header
                me={me} userId={userId} tagline={tagline}
                onStart={h.onStart} onAccount={h.onAccount}
            />
            <div className="wrap">
                {/* data-expanded is read by ONE rule: it hides the rail with
                    visibility, not display, so the rail keeps its grid column
                    and the two columns to its left do not reflow. Only the open
                    card grows over it. */}
                <div
                    className={`app${page ? ' app--debate' : ''}`}
                    data-expanded={
                        openId || composer === 'wouldbe' || composer === 'debate' ? '' : undefined
                    }
                    // THE GRID TAKES THE RAIL'S COLUMN. Not the same move as
                    // data-expanded, which only hides the rail so one opening
                    // card can grow over it — this is a change of layout, so the
                    // track genuinely goes and four tiles fit across where two
                    // did.
                    data-view={h.view === 'grid' ? 'grid' : undefined}
                >
                    <Nav
                        current={current} counts={navCounts}
                        profileTo={profileTo} onStart={h.onNewPrompt}
                    />
                    <main>
                        {/* One route over, the same shell. `page` replaces the
                            feed column entirely rather than the debate screen
                            carrying its own header and nav — two copies of the
                            chrome is how two headers drift apart. */}
                        {page ?? (<>
                        <FeedToolbar
                            sort={h.sort} view={h.view}
                            onSort={h.onSort} onView={h.onView}
                            filters={filters} onFiltersChange={onFiltersChange}
                            expanded={Boolean(openId)} onBack={() => onOpen?.(null)}
                        />
                        {/* STARTING A POST HAPPENS HERE TOO. The form used to be
                            a route, which meant leaving the feed to write and
                            coming back to a page scrolled to the top. Inline, it
                            opens above the cards — the thing you are adding to
                            the column, at the head of the column. */}
                        {/* STARTING A POST HAPPENS HERE. The form used to be a
                            route, which meant leaving the feed to write and
                            coming back to a page scrolled to the top. Inline, it
                            opens above the cards — the thing you are adding to
                            the column, at the head of the column. */}
                        {/* A WOULD BE TAKES THE COLUMN. Picking a seat is a
                            list of forty offices and then a multi-screen form —
                            it is not something you do in a box above your feed
                            while the feed waits underneath. The other three are
                            short enough to sit at the head of the column with
                            the cards still visible below them. */}
                        {composer === 'wouldbe' ? (
                            <Suspense fallback={<p className="cmp__wait">Loading…</p>}>
                                <WouldBeFlow onClose={() => onComposer?.(false)} />
                            </Suspense>
                        ) : composer === 'debate' ? (
                            <Suspense fallback={<p className="cmp__wait">Loading…</p>}>
                                <DebateFlow onClose={() => onComposer?.(false)} />
                            </Suspense>
                        ) : composer ? (
                            <Suspense fallback={<p className="cmp__wait">Loading…</p>}>
                                <Composer
                                    me={me}
                                    kind={composer}
                                    onPost={h.onPost}
                                    onClose={() => onComposer?.(false)}
                                />
                            </Suspense>
                        ) : null}

                        {/* TWO LAYOUTS, ONE FEED. The toggle in the bar used to
                            set state nothing read — it moved and the column did
                            not. The grid is for scanning (sixteen things, each
                            reduced to the number you would sort them by); the
                            list is for reading. Both obey the same kind filter,
                            so switching view never changes WHAT is in the feed,
                            only its shape. */}
                        {h.view === 'grid' ? (
                            <Suspense fallback={<p className="cmp__wait">Loading…</p>}>
                                <FeedGrid
                                    debates={h.gridDebates}
                                    wouldbes={h.gridWouldbes}
                                    written={h.gridWritten}
                                    kinds={filters?.kinds}
                                    onOpenPost={h.onOpenPost}
                                />
                            </Suspense>
                        ) : (
                        <div className="feed" hidden={composer === 'wouldbe' || composer === 'debate'}>
                            {prompts.map((p) => (
                                <PostCard
                                    key={p.id} {...p}
                                    expanded={openId === p.id}
                                    onToggleExpand={() => onOpen?.(openId === p.id ? null : p.id)}
                                    me={me}
                                    signedIn={signedIn}
                                    onSignIn={h.onSignIn}
                                    onLike={h.onLike}
                                    onRepost={h.onRepost}
                                    onRespond={() => h.onRespond?.(p.id)}
                                    onAnswer={() => h.onRespond?.(p.id)}
                                    onPledge={() => h.onPledge?.(p.id)}
                                    onChallenge={() => h.onRespond?.(p.id)}
                                    onFollow={() => h.onFollow?.(p.author.handle)}
                                    onClaimSeat={() => h.onClaimSeat?.(p.id)}
                                />
                            ))}
                        </div>
                        )}
                        </>)}
                    </main>
                    {/* No rail on the debate page: a timeline and a standings
                        table both need the width, and neither is a sidebar. */}
                    {!page && (
                        <aside className="rail" aria-label="Sidebar">
                            <JoinPanel signedIn={signedIn} />
                            <Happening items={happening} />
                        </aside>
                    )}
                </div>
            </div>
        </div>
    )
}

/* ----------------------------------------------------------- the fixtures - */

const PROMPTS = [
    {
        id: 'p1',
        to: '/debate',
        author: { name: 'Farrah Lindqvist', handle: 'farrahl', office: 'City Council D3, Portland OR', to: '/debate' },
        question: 'Should a city be allowed to cap the rent on units it did not build? Make the strongest case for the side you did not expect to argue.',
        prizeCents: 50000,
        format: 'live',
        meta: ['8 competitors', 'Round 2 of 3'],
        urgent: 'Ends in 6 hours',
        totalComments: 222,
        responses: [
            {
                id: 'p1a', liked: true, likes: 1284, reposts: 179, comments: 128, stance: 'for the cap',
                author: { name: 'Rosa Mbeki' },
                body: 'Rent stabilization is the only lever a council actually holds in the year a family is being priced out. Supply arrives on a five-year clock; an eviction arrives on a thirty-day one. A cap is not a housing policy, it is a bridge to one — and refusing to build the bridge because you prefer the destination leaves people in the river.',
                pull: 'Supply arrives on a five-year clock; an eviction arrives on a thirty-day one.',
            },
            {
                id: 'p1b', liked: false, likes: 1109, reposts: 121, comments: 94, stance: 'against',
                author: { name: 'Dev Okonkwo' },
                body: 'A cap on a unit the city did not build is a tax on the only people still willing to build. Every dollar of it is priced into the next pro forma, and the next building is the one that never breaks ground. The tenant you protect this year is the tenant who cannot find a unit in six.',
                pull: 'The tenant you protect this year is the tenant who cannot find a unit in six.',
            },
        ],
    },
    {
        id: 'p2',
        to: '/debate',
        author: { name: 'Theo Baptiste', handle: 'theob', office: 'School Board At-Large, Newark NJ', to: '/debate' },
        question: 'Your city can afford to run exactly one bus line all night. Which corridor gets it — and who do you tell no?',
        prizeCents: 120000,
        format: 'live',
        meta: ['12 competitors', 'Semifinal', '2 days left'],
        totalComments: 148,
        responses: [
            {
                id: 'p2a', liked: false, likes: 642, reposts: 70, comments: 61, stance: 'third shift',
                author: { name: 'Adaeze Nwosu' },
                body: 'Run it where the third-shift workers are, not where the riders are. Ridership at 2 a.m. measures who has already given up on the bus — it is a record of a service that does not exist. Route to the warehouses and the hospital laundries, and the count writes itself in a month.',
                pull: 'Ridership at 2 a.m. measures who has already given up on the bus',
            },
            {
                id: 'p2b', liked: true, likes: 718, reposts: 100, comments: 87, stance: 'the spine',
                author: { name: 'Marisol Kim' },
                body: 'One line cannot be a favor to anyone, so it has to be the spine. Put it on the corridor that already touches four transfer points, and every neighborhood gets a worse ride to a real one. A perfect route for one district is a broken network for the city.',
                pull: 'A perfect route for one district is a broken network for the city.',
            },
        ],
    },
    {
        id: 'p3',
        to: '/debate',
        author: { name: 'June Vasquez', handle: 'junev', office: 'State House 41, Tucson AZ', to: '/debate' },
        question: 'Should a candidate publish every donor over $200 in a race where no law requires it?',
        prizeCents: 75000,
        format: 'typed',
        meta: ['1 of 2 seats filled', 'Opens to the public Friday'],
        totalComments: 12,
        deadlineLabel: 'Friday',
        // THE ENTRY STAGE. Present here rather than derived from the debate row
        // because /api/debates/:id/full carries the nominations but every
        // open_entry row in this database is a "test" with none — and both
        // states of this screen are worth being able to look at. Empty the
        // `nominations` array to see the other one; the components ship both.
        entry: {
            startDate: 'Friday, Sep 5, 2026 · 7:00 PM EDT',
            prizeCents: 75000,
            seats: 8,
            seatsTaken: 1,
            promptsPublished: false,
            prompts: [],
            totalNominations: 34,
            nominations: [
                { name: 'Hana Sørensen', count: 12, to: '/homev2' },
                { name: 'Marisol Ferrer', count: 9, to: '/homev2' },
                { name: 'Dev Okonkwo', count: 6, to: '/homev2' },
                { name: 'Adaeze Nwosu', count: 4, to: '/homev2' },
                { name: 'Cassius Moreau', count: 3, to: '/homev2' },
            ],
        },
        responses: [
            {
                id: 'p3a', liked: false, likes: 96, reposts: 10, comments: 12, stance: 'publish it',
                author: { name: 'Hana Sørensen' },
                body: 'The law sets a floor, not a standard. If a disclosure would embarrass you, the voters have already learned the thing you were hoping the threshold would hide. Publishing early costs one uncomfortable week; being found out costs the seat.',
                pull: 'Publishing early costs one uncomfortable week; being found out costs the seat.',
            },
        ],
    },
]

/* ==========================================================================
   REAL WRITTEN POSTS — questions and artifacts, out of the database.

   These two used to be fixtures next to the debates, and anything somebody
   actually wrote lived in React state until they reloaded. They are `posts`
   rows now (migration 1784300000000), and GET /api/posts returns them newest
   first with the author joined on.

   ONE MAPPER, because the cards do not know about the API and should not. A row
   arrives as post_type/title/body/author_first_name; a card wants kind/question
   or title/author{}. Translating at the boundary keeps every PostTypes prop the
   same shape whether it came from a fixture or from Postgres — which is the only
   reason the fixtures can keep sitting in the same list.
   ========================================================================== */

// "Aug 30" for anything older than today, "Just now" / "4h ago" for today. The
// feed is mostly same-day, and a date stamp on something posted four minutes ago
// reads as older than it is.
const when = (iso) => {
    if (!iso) return 'Just now'
    const then = new Date(iso)
    const mins = Math.round((Date.now() - then.getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A body is stored as one string and read as paragraphs. Splitting on blank
// lines is what the writer meant by pressing enter twice; a single newline stays
// inside its paragraph, the way it does everywhere else prose is typed.
const paragraphs = (body) =>
    String(body || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// toCard — one row → the props its card already takes. `preview` is a local
// object URL passed only for a post THIS session just made: the server's
// image_url is null until moderation clears the image, and showing nothing to
// the person who just attached one reads as the attachment having been dropped.
export const toCard = (row, preview) => {
    const name = [row.author_first_name, row.author_last_name].filter(Boolean).join(' ')
        || row.author_username
        || 'Someone'
    const author = {
        name,
        handle: row.author_username || 'member',
        avatarUrl: row.author_photo_url || undefined,
        office: when(row.created_at),
        to: row.author_id ? `/u/${row.author_id}` : '/homev2',
    }
    const comments = plural(row.comment_count || 0, 'comment', 'comments')
    const base = {
        id: row.id,
        kind: row.post_type,
        to: '/homev2',
        author,
        imageUrl: row.image_url || preview || undefined,
        totalComments: row.comment_count ? `Read all ${comments}` : 'No comments yet',
    }

    if (row.post_type === 'question') {
        return {
            ...base,
            question: row.title,
            // No clock and no prize, so the meta line carries the two facts a
            // question has: how many answers, and who may write one.
            meta: [plural(row.comment_count || 0, 'answer', 'answers'), 'Open to anyone', when(row.created_at)],
            answers: [],
            total: row.comment_count || 0,
            lede: row.body || undefined,
            stats: [],
        }
    }
    return {
        ...base,
        title: row.title,
        meta: [when(row.created_at)],
        body: paragraphs(row.body),
        sources: [],
        comments: [],
    }
}

// Mixed on purpose, and ordered by how soon it matters rather than by kind —
// grouping them would turn one list into four short ones and lose the only
// ranking a reader actually wants.
// The other three kinds. Each is shaped like the row its API will eventually
// return — nothing here is a placeholder LAYOUT any more, only placeholder
// content: questions and artifacts have no table yet, and the would be is
// carrying figures rather than reading them off /api/wouldbes.
//
// MONEY IS CENTS, as it is everywhere else in this app.
const POSTS = [
    {
        id: 'w1',
        kind: 'wouldbe',
        to: '/wouldbe/4e83425a-d21c-46bc-9bd7-ba97ddf55185',
        author: {
            name: 'Lorenzo Macias', handle: 'lorenzo',
            office: 'NY State Senator District 59 · NY-SD-59',
            to: '/homev2',
        },
        title: 'a great NY State Senator District 59 representative',
        meta: ['All-or-nothing', 'NY State Senate 59'],
        urgent: '12 days left',
        totalComments: 'Read all 18 comments',
        funding: {
            raised: 330000, goal: 3500000, backers: 47, days: 12, avg: 7000,
        },
        // The eyebrow is the SEAT, not a section title: it is the one fact that
        // makes the pitch above it mean anything.
        eyebrow: 'New York State Senate · District 59',
        pitch: 'Twenty-nine, no landlord money, and a review-board plan that fits on one page.',
        // The four categories this campaign actually published, in the order it
        // published them.
        positions: [
            {
                title: 'Civil Rights Equity',
                added: 'Added Aug 13, 2026',
                body: "Restore the review board's subpoena power and publish every disposition inside thirty days. A board that cannot compel testimony is a comment box with a letterhead.",
            },
            {
                title: 'LGBTQ+ Rights',
                added: 'Added Aug 13, 2026',
                body: "Write the care protections into statute so they stop depending on which party holds the governor's office, and extend shield coverage to out-of-state patients and the clinicians who treat them.",
            },
            {
                title: 'Immigration Reform',
                added: 'Added Aug 14, 2026',
                body: 'Fund legal representation at the county level. Represented respondents win at many times the rate of unrepresented ones, and that gap is a counsel gap, not a merits gap.',
            },
            {
                title: 'Religious Freedom',
                added: 'Added Aug 16, 2026',
                body: 'Protect worship, and protect the people worship is sometimes used against. Same bill, same enforcement, so neither half can be traded away later.',
            },
        ],
        record: [
            {
                badge: 'Won', to: '/debate', prizeCents: 50000,
                question: 'Should a city be allowed to cap the rent on units it did not build?',
                meta: 'Round 2 of 3 · 1,284 votes · Aug 2026',
            },
        ],
        reviews: {
            avg: '4.6', count: 0,
            buckets: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
            emptyNote: 'Reviews open once a backer has been on the list for a week.',
        },
    },
    {
        id: 'q1',
        kind: 'question',
        to: '/homev2',
        author: {
            name: 'Theo Baptiste', handle: 'theob',
            office: 'School Board At-Large, Newark NJ', to: '/homev2',
        },
        question: 'Name one thing your own party gets wrong about public safety.',
        // NO CLOCK. A question has no prize and no filing window, so there is
        // nothing for a deadline to be the deadline OF — it stays open and the
        // answers accumulate. Only a debate with a purse and a would be with a
        // filing date are running against time.
        meta: ['41 answers', 'Open to anyone', 'Asked Aug 30'],
        totalComments: 'Read all 88 comments',
        total: 41,
        lede: 'A question is a debate with the bracket taken out: everyone answers the same prompt, nobody is eliminated, and it stays open — the room decides which answer was worth the cost of saying it.',
        stats: [
            { label: 'Answers', value: '41', sub: 'from 12 candidates' },
            { label: 'Asked', value: 'Aug 30' },
            { label: 'Entry', value: 'Free', sub: 'no nomination needed' },
        ],
        answers: [
            {
                name: 'Adaeze Nwosu', office: 'City Council D7, Newark NJ', when: '4h ago',
                likes: 312, liked: true, reposts: 46, replies: 18, top: true,
                body: 'That a response time is a safety outcome. It is a logistics number, and we report it because it is the one we can move without arguing with anybody. The measure that matters is whether the second call ever comes, and we do not publish it because it would make us look worse.',
                thread: [
                    {
                        name: 'Marisol Kim', when: '2h ago', likes: 41, replies: 0,
                        body: 'The second-call rate exists in the CAD data already. It has never been in a public dashboard in this county.',
                    },
                ],
            },
            {
                name: 'Dev Okonkwo', office: 'State House 12, Trenton NJ', when: '6h ago',
                likes: 204, liked: false, reposts: 20, replies: 9,
                body: 'That more officers and better policing are the same sentence. My side says the first and means the second, and when the first arrives without the second we are surprised, every time, in public.',
            },
        ],
    },
    {
        id: 'a1',
        kind: 'artifact',
        to: '/homev2',
        author: {
            name: 'June Vasquez', handle: 'junev',
            office: 'State House 41, Tucson AZ', to: '/homev2',
        },
        meta: ['Ballot access', '3 sources', 'Aug 28'],
        totalComments: 'Read all 12 comments',
        // The title is the claim, in one pass. The body is why they will stand
        // behind it — which is what "See more" is for.
        title: 'The petition requirement ends more campaigns than the filing deadline does.',
        body: [
            'Eleven states closed their 2026 filing windows before most first-time candidates had a committee. I am putting my name to this: in four of them it was not the date that ended the campaign. It was the signatures.',
            'A deadline is one number and it gets printed everywhere. A signature threshold is a percentage of a turnout figure from a race two cycles ago, it moves every year, and nobody re-checks it until somebody comes up four hundred short in the last week. Two of the four withdrawals I can name had three weeks still on the clock.',
            'I would rather be wrong about this in public than have another first-time candidate find it out privately, in March, with a folder of unusable pages.',
        ],
        sources: [
            { title: 'FEC 2026 filing calendar, consolidated', href: '#' },
            { title: 'State petition requirements by office, 2026 cycle', href: '#' },
            { title: 'Ballotpedia — signature thresholds, state legislature', href: '#' },
        ],
        comments: [
            {
                name: 'Hana Sørensen', when: '1d ago', likes: 22, replies: 0,
                body: 'This matches what we saw in AZ-6. Two of our four withdrawals were signature shortfalls with three weeks still on the clock.',
            },
            {
                name: 'Cassius Moreau', when: '22h ago', likes: 8, replies: 0,
                body: 'Worth separating the states where the threshold is a percentage of turnout — those move every cycle and nobody re-checks them.',
            },
        ],
    },
]

// WHAT THE BADGE HOLDS. A countdown belongs to the kinds that are running
// against something: a debate against its purse's deadline, a would be against
// a filing date. A question is open until it stops getting answers and an
// artifact is a thing somebody wrote — putting hours on either invents a
// deadline the product does not have, and once one badge is fiction none of
// them are worth reading. Those two carry their own honest number instead:
// how many answers, and how long it takes to read.
const HAPPENING = [
    {
        id: 'h1', kind: 'debate', to: '/debate', n: 6, unit: 'hrs',
        title: 'Should a city be allowed to cap the rent on units it did not build?',
        stat: '$500 · 8 competitors',
    },
    {
        id: 'h2', kind: 'wouldbe', to: '/wouldbe', n: 3, unit: 'days',
        title: 'Priya Raman — City Council, District 3, Portland OR',
        stat: '62% of $12,000',
    },
    {
        id: 'h3', kind: 'question', to: '/homev2', n: 41, unit: 'answers',
        title: 'Name one thing your own party gets wrong about public safety.',
        stat: 'Open to anyone',
    },
    {
        id: 'h4', kind: 'artifact', to: '/homev2', n: 4, unit: 'min read',
        title: 'The petition requirement ends more campaigns than the filing deadline does.',
        stat: 'Ballot access · 3 sources',
    },
    {
        id: 'h5', kind: 'debate', to: '/debate', n: 2, unit: 'days',
        title: 'Your city can afford one all-night bus line. Which corridor?',
        stat: '$1,200 · 12 competitors',
    },
    {
        id: 'h6', kind: 'wouldbe', to: '/wouldbe', n: 9, unit: 'days',
        title: 'Marcus Ellery — State House 41, Tucson AZ',
        stat: '18% of $30,000',
    },
]

/* ------------------------------------------------------------- the route - */

// WHICH SCREEN IS BEHIND THE BUTTON. The three debate phases are three
// different things to open, so the toggle says which one rather than promising
// "the rest" three times over. Same status map AnyDebate routes on — one source
// for the lifecycle, or the feed and the page disagree about what a debate is.
const PHASE_LABEL = {
    draft: 'upcoming debate',
    open_entry: 'upcoming debate',
    live: 'live debate',
    no_posting: 'live debate',
    closed: 'finished debate',
    cancelled: 'finished debate',
}
// The chip's three states, from the row's own status. Live is a claim about
// THIS MOMENT — putting it on a debate that has not opened, or one that
// finished last week, makes every Live badge on the feed worth nothing.
const PHASE_STATUS = {
    draft: 'entry',
    open_entry: 'entry',
    live: 'live',
    no_posting: 'live',
    closed: 'concluded',
    cancelled: 'concluded',
}

const PHASE_WORD = {
    draft: 'Not open yet',
    open_entry: 'Entry open',
    live: 'Live now',
    no_posting: 'Live now',
    closed: 'Finished',
    cancelled: 'Cancelled',
}

// The bracket a debate card is currently showing. One is open at a time, which
// is the format rather than a display choice, so the card's response count and
// its expansion are both about that one.
const BRACKET_NOW =
    BRACKETS.find((b) => b.state === 'open')
    ?? [...BRACKETS].reverse().find((b) => b.seats)
    ?? null

const MS_DAY = 86400000
// What is pressing on this debate, in the largest honest unit. Returns null
// rather than "0 days" — a countdown that has run out is a STATE, not a number,
// and the phase word already says which state.
const pressure = (endDate) => {
    if (!endDate) return null
    const ms = new Date(endDate).getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0) return null
    const days = Math.ceil(ms / MS_DAY)
    if (days > 1) return `${days} days left`
    const hours = Math.max(1, Math.ceil(ms / 3600000))
    return `Ends in ${hours} hour${hours === 1 ? '' : 's'}`
}

// The card wears the REAL debate it opens: title, sponsor, prize, format,
// competitor count and clock all come from the row, so what the header claims
// and what the expanded panel shows are the same debate.
//
// What stays fixture is the DUEL PROSE. The list endpoint returns a debate, not
// its arguments — for a live debate they are on the stream, for a typed one
// they live in per-match answers — so the two columns keep their placeholder
// text until we add that read. Everything above and below them is live.
const bindDebate = (card, d) => {
    if (!d) return card
    const sponsor = d.sponsor_username || d.sponsor_name
    return {
        ...card,
        debateId: d.id,
        to: `/debate/${d.id}`,
        question: d.title || card.question,
        prizeCents: d.prize_is_cash === false ? 0 : Number(d.prize_pool_cents || 0),
        status: PHASE_STATUS[d.status] ?? 'live',
        phaseLabel: PHASE_LABEL[d.status] ?? 'debate',
        author: sponsor
            ? {
                name: d.sponsor_name || d.sponsor_username,
                handle: d.sponsor_username || 'sponsor',
                avatarUrl: d.sponsor_photo_url || undefined,
                office: PHASE_WORD[d.status],
                to: '/homev2',
            }
            : card.author,
        meta: [
            d.is_for_fun
                ? `${d.total_responses ?? 0} responses`
                : `${d.total_contestants ?? 0} competitors`,
        ],
        // How many answered THIS bracket, which is what the expander opens —
        // not how many are in the tournament.
        totalResponses: (BRACKET_NOW?.seats?.length ?? 0) + (BRACKET_NOW?.field?.length ?? 0),
        urgent: pressure(d.end_date),
    }
}

// One debate per phase, so all three screens are reachable from the feed
// without hunting. Within a phase, the one with the most contestants wins —
// on this database that is reliably the seeded debate rather than a "test" row.
const pickByStatus = (rows, statuses) => {
    const pool = rows.filter((r) => statuses.includes(r.status))
    if (!pool.length) return null
    return [...pool].sort(
        (x, y) => (y.total_contestants ?? 0) - (x.total_contestants ?? 0)
    )[0]
}

function HomeV2() {
    const [filters, setFilters] = useState(DEFAULT_FEED_FILTERS)
    const [sort, setSort] = useState('for-you')
    const [view, setView] = useState('list')
    const [me, setMe] = useState(null)
    const [debates, setDebates] = useState([])
    // The campaigns. The list view has never shown a real one — its would-be
    // card is still a fixture — but the grid is all rows, so this is the first
    // place they are actually fetched on this page.
    const [wouldbes, setWouldbes] = useState([])
    // WHICH CARD IS OPEN — one id, not a set. Two debates expanded at once is
    // two dark panels fighting for the same column, and the second one is
    // always below the fold anyway.
    const [openId, setOpenId] = useState(null)
    // The composer, on the same page. A route would have thrown away the feed.
    // It holds the CHOSEN KIND rather than a boolean: the menu already asked
    // which, and a composer that has to ask again is a second chooser.
    const [composer, setComposer] = useState(null)
    // THE WRITTEN FEED — every question and artifact, from the database. It used
    // to be a `drafts` array that held whatever you had typed since the last
    // reload; these are rows now, so what you post is still here tomorrow and so
    // is everyone else's.
    const [written, setWritten] = useState([])
    // WHAT YOU LIKED AND RESHARED, keyed by response id. Local rather than
    // posted: there is no engagement endpoint for the feed yet, and a control
    // that looks dead until one exists teaches people it does nothing. The count
    // moves with the click so the glyph tells the truth about what you just did.
    const [acts, setActs] = useState({})
    // THE PLEDGE MODAL. Holds the campaign being pledged to, or null. It carries
    // `cardId` alongside the would-be's own id because the two are different
    // things: the id in the URL is the campaign, the id on the card is the feed
    // post, and the optimistic bump below has to land on the card.
    const [pledging, setPledging] = useState(null)
    // Cents added locally by a pledge made in this session, keyed by card id.
    // The pledge is already committed server-side by the time this is set; this
    // exists so the progress bar moves the instant it happens rather than after
    // a reload. It is ADDITIVE to the card's own figure, never a replacement —
    // overwriting would make a stale fixture look authoritative.
    const [pledgeBumps, setPledgeBumps] = useState({})
    const navigate = useNavigate()
    const [params] = useSearchParams()

    const userId = localStorage.getItem('userId')
    // ?signedin=1 forces the signed-in face so that state can be reviewed
    // without an account. It reads the URL and never writes auth.
    const signedIn = params.get('signedin') === '1' || Boolean(localStorage.getItem('token'))

    // Whose face goes on the account button. Deliberately silent on failure: a
    // header that logs an error every time a logged-out visitor loads the home
    // page is noise, and the initials fallback is a perfectly good answer.
    useEffect(() => {
        let cancelled = false
        if (!localStorage.getItem('token')) return undefined
        api.get('/api/auth/me')
            .then(({ data }) => { if (!cancelled) setMe(data) })
            .catch(() => { if (!cancelled) setMe(null) })
        return () => { cancelled = true }
    }, [])

    // The questions and artifacts. Same failure posture as the debates below: an
    // empty list leaves the fixtures standing on their own rather than putting an
    // error where a feed should be.
    useEffect(() => {
        let cancelled = false
        api.get('/api/posts', { params: { limit: 30 } })
            .then(({ data }) => {
                if (!cancelled) setWritten(Array.isArray(data) ? data.map((r) => toCard(r)) : [])
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

    // The real debates behind the cards. A failure leaves `debates` empty,
    // which leaves the fixtures un-bound and the toggle hidden — the feed still
    // renders rather than showing an error where a design should be.
    useEffect(() => {
        let cancelled = false
        api.get('/api/debates', { params: { limit: 20 } })
            .then(({ data }) => { if (!cancelled) setDebates(Array.isArray(data) ? data : []) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

    // The campaigns, for the grid. Fetched on mount rather than on the first
    // switch to grid view: it is one small request, and paying for it when
    // somebody presses the toggle would make the button feel like it loads a
    // page instead of changing a layout.
    useEffect(() => {
        let cancelled = false
        api.get('/api/wouldbes', { params: { limit: 24 } })
            .then(({ data }) => { if (!cancelled) setWouldbes(Array.isArray(data) ? data : []) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

    // The fixture's own state is the starting point; `acts` overrides it once the
    // reader has touched a control. The counts are DERIVED from the two, never
    // stored twice — a count kept alongside the flag drifts the moment one
    // update misses the other.
    const withActs = (p) => ({
        ...p,
        responses: p.responses.map((r) => {
            const mine = acts[r.id] ?? {}
            const liked = mine.liked ?? r.liked ?? false
            const reposted = mine.reposted ?? r.reposted ?? false
            return {
                ...r,
                liked,
                reposted,
                likes: (r.likes ?? 0) + (liked ? 1 : 0) - (r.liked ? 1 : 0),
                reposts: (r.reposts ?? 0) + (reposted ? 1 : 0) - (r.reposted ? 1 : 0),
            }
        }),
    })

    // Card 1 opens onto a live debate, card 2 onto a finished one, card 3 onto
    // one still taking entries — the three phases, in the order a reader cares
    // about them.
    const bound = [
        bindDebate(PROMPTS[0], pickByStatus(debates, ['live', 'no_posting'])),
        bindDebate(PROMPTS[1], pickByStatus(debates, ['closed', 'cancelled'])),
        bindDebate(PROMPTS[2], pickByStatus(debates, ['open_entry', 'draft'])),
    ].map(withActs)

    // FILTERED AND ORDERED HERE, over the whole mixed list — kind, money, the
    // clock and engagement are all properties of the post rather than of an
    // endpoint, so the panel works today against fixtures and will work
    // unchanged against rows.
    const feed = applyFeedFilters([...written, ...bound, ...POSTS], filters)
        .map((p) => {
            const bump = pledgeBumps[p.id]
            if (!bump || !p.funding) return p
            return {
                ...p,
                funding: {
                    ...p.funding,
                    raised: (p.funding.raised ?? 0) + bump,
                    backers: (p.funding.backers ?? 0) + 1,
                },
            }
        })

    const openComposer = (kind) => { setComposer(kind); setOpenId(null) }

    // WHAT COMES BACK IS WHAT GOES IN THE FEED. The composer has already written
    // the row and hands back the server's own copy of it, so the card is built
    // from the same fields a reload would produce — no locally-invented id, no
    // author assembled from `me`, nothing that could disagree with the row the
    // moment anybody refreshes.
    //
    // The image is the one exception, and deliberately: the server returns
    // image_url null until moderation clears it, so the local preview stands in
    // for it on the author's own screen. Showing nothing to the person who just
    // attached a photo reads as the attachment having been silently dropped.
    const publish = (row, image) => {
        setWritten((w) => [toCard(row, image?.previewUrl), ...w])
        setComposer(null)
    }

    return (
        <>
        <FeedPage
            me={me}
            userId={userId}
            signedIn={signedIn}
            tagline="a fundraising platform for candidates under 45 years old"
            profileTo={userId ? `/u/${userId}` : '/login'}
            prompts={feed}
            happening={HAPPENING}
            navCounts={{ chat: 3 }}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort} view={view}
            onSort={setSort} onView={setView}
            // THE GRID GETS ROWS, NOT THE BOUND FIXTURES. A tile has no expanded
            // state, so there is nothing for a fixture to stand in for — and
            // that makes the grid the honest view of what is actually in the
            // database right now.
            gridDebates={debates}
            gridWouldbes={wouldbes}
            gridWritten={written}
            // Opening a post from a tile drops back into the reading layout with
            // that card expanded. The grid is for choosing; it has nowhere to
            // put an answer thread, so staying here to open one would mean
            // expanding a card the reader cannot see.
            onOpenPost={(id) => { setView('list'); setOpenId(id) }}
            openId={openId} onOpen={setOpenId}
            composer={composer} onComposer={(v) => setComposer(v ? composer : null)}
            onPost={publish}
            onLike={(id, next) => setActs((a) => ({ ...a, [id]: { ...a[id], liked: next } }))}
            onRepost={(id, next) => setActs((a) => ({ ...a, [id]: { ...a[id], reposted: next } }))}
            // The rail's "Start a post" opens the composer. Signed out it still
            // sends them to sign in first — the form's first request is
            // authenticated, and an unauthenticated draft is a form that throws
            // at submit.
            onNewPrompt={(kind) => (signedIn ? openComposer(kind) : navigate('/login'))}
            // The header's Start is the FRONT DOOR, so signed out it goes to
            // signup rather than login: somebody pressing "Start" on a page they
            // have never been signed into is beginning, not returning. Signed in
            // there is nothing left to sign up for, so it opens the composer —
            // the same place the rail's button goes.
            onStart={(kind) => (signedIn ? openComposer(kind) : navigate('/signup'))}
            onAccount={() => navigate(userId ? `/u/${userId}` : '/login')}
            // Responding and claiming a seat both live inside the debate itself,
            // so both open the card rather than navigating.
            onRespond={(id) => (signedIn ? setOpenId(id) : navigate('/login'))}
            onClaimSeat={(id) => (signedIn ? setOpenId(id) : navigate('/login'))}
            onFollow={() => (signedIn ? null : navigate('/login'))}
            onSignIn={() => navigate('/login')}
            // PLEDGE. This button did nothing on this page — no onPledge was
            // passed at all, so the handler chained off into undefined and the
            // card's primary action was dead.
            //
            // The campaign id comes from the card's own `to` (/wouldbe/:id)
            // rather than from its feed id, because those are not the same
            // thing: the list's would-be is still a fixture whose `id` is 'w1',
            // while `to` points at the real row the pledge has to be written
            // against. A card without one cannot be pledged to and does not
            // open the modal — better a button that stays put than one that
            // opens a form which 404s on submit.
            onPledge={(id) => {
                if (!signedIn) return navigate('/login')
                const card = feed.find((c) => c.id === id)
                const wouldbeId =
                    card?.wouldbeId ||
                    card?.to?.match(/\/wouldbe\/([0-9a-f-]{36})/i)?.[1]
                if (!wouldbeId) return
                setPledging({ id: wouldbeId, title: card.title, cardId: id })
            }}
        />
        {/* Its own Suspense boundary, and no fallback: the flow is opened by a
            click, so a spinner in the page body would appear somewhere the
            reader is not looking. The modal arrives when its chunk does. */}
        {pledging && (
            <Suspense fallback={null}>
                <PledgeFlow
                    wouldbe={pledging}
                    onClose={() => setPledging(null)}
                    onPledged={(cents) =>
                        setPledgeBumps((b) => ({
                            ...b,
                            [pledging.cardId]: (b[pledging.cardId] ?? 0) + cents,
                        }))
                    }
                />
            </Suspense>
        )}
        </>
    )
}

export default HomeV2
