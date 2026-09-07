import React from 'react'
import { Link } from 'react-router-dom'
import FormatBadge from '../../component/FormatBadge/FormatBadge'
import './feedgrid.css'

/* ============================================================================
 * FeedGrid — the same feed, as tiles.
 *
 * WHY A SECOND LAYOUT AT ALL. The list is for reading: one post at a time, wide
 * measure, expandable in place. The grid is for SCANNING — sixteen things at
 * once, each reduced to the one fact you would sort them by. They are not two
 * styles of the same card, they are two different questions ("what is worth my
 * time?" vs "what does this say?"), and the toolbar's view toggle is which one
 * you are asking. It used to set state that nothing read, so the button moved
 * and the feed did not.
 *
 * IT SHOWS ROWS, NOT FIXTURES. The list still leads with three authored debate
 * cards because they demonstrate an expanded state that has no data behind it
 * yet. A tile has no expanded state to demonstrate — it is a title, a number and
 * a face — so there is nothing for a fixture to stand in for, and everything
 * here comes from the API. That is also why the grid is the honest view of what
 * is actually in the database right now.
 *
 * FOUR TILE TYPES, ONE SKELETON: a square face, then a meta row under it. The
 * face is what varies, because what a face is FOR varies —
 *
 *   debate    the brushed plate, and the purse. Money is the sort key.
 *   would be  the candidate's photo, because you are backing a person.
 *   question  the question itself, set large. There is nothing else to show.
 *   artifact  the claim, in the serif the record is set in.
 *
 * The meta row never varies in shape: who put it up, one number, one clock. Four
 * tile types that each invented their own footer would not read as one grid, and
 * the eye would stop being able to compare them — which is the entire point of
 * putting them in a grid.
 *
 * THE GOLD IS THE SAME GOLD, from --wb-brushed in index.css, not a copy of it.
 * The v1 hero grid (component/grid/Grid2x.jsx) draws the same plate from the
 * same variable. Two hand-tuned gradients would drift the first time either was
 * touched.
 * ==========================================================================*/

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Postgres DATE/timestamptz arrives as a string. null (not NaN) when the column
// is null, so the caller can hide the line instead of printing "NaN days".
const daysUntil = (value) => {
    if (!value) return null
    const when = new Date(value)
    if (Number.isNaN(when.getTime())) return null
    return Math.max(0, Math.ceil((when.getTime() - Date.now()) / MS_PER_DAY))
}

// A countdown that has run out is a STATE, not a number — "0 days" reads as a
// bug even when it is accurate. Same rule as the v1 grid.
const timeLabel = (days) => {
    if (days === null) return null
    if (days === 0) return 'Ends today'
    if (days === 1) return '1 day left'
    return `${days} days left`
}

// Cents -> "$1,234". Money never crosses the wire as a float.
const money = (cents) =>
    `$${Math.round(Number(cents || 0) / 100).toLocaleString('en-US')}`

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Username first — it is what the rest of the app shows — then the real name.
// The @-strip is not cosmetic: signup accepts an email address as a username and
// several accounts have one, so without it this prints somebody's address on a
// public tile.
const posterName = (row) => {
    const raw =
        row.username
        || [row.first_name, row.last_name].filter(Boolean).join(' ')
        || 'Someone'
    return raw.includes('@') ? raw.split('@')[0] : raw
}

// Capped at 100 — a 400%-funded campaign must not render a 400% bar.
const percentOfGoal = ({ pledged_total_cents, goal_cents }) => {
    const goal = Number(goal_cents || 0)
    if (goal <= 0) return 0
    return Math.min(100, Math.round((Number(pledged_total_cents || 0) / goal) * 100))
}

/* ---- the shared furniture ------------------------------------------------ */

const Ic = ({ d, w = 12 }) => (
    <svg width={w} height={w} viewBox="0 0 16 16" fill="none" aria-hidden="true"
         className="gt__ic">
        <path d={d} stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)
const PATH = {
    people: 'M6 7.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2ZM2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6M11 4.1a1.9 1.9 0 0 1 0 3.6M12.2 12.6c0-1.4-.5-2.4-1.4-3',
    clock: 'M8 3.6v4.6l2.8 1.6M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
    money: 'M8 2.6v10.8M10.4 5.1a2.6 2.6 0 0 0-2.4-1.3c-1.4 0-2.5.8-2.5 2s1 1.8 2.5 2.1 2.6.8 2.6 2.1-1.1 2-2.6 2a2.7 2.7 0 0 1-2.5-1.4',
}

// A face is never blank. No photo on file still gets a disc with an initial, so
// the meta row keeps its height and the grid keeps its baseline.
function Face({ src, name }) {
    return src
        ? <img className="gt__av" src={src} alt="" />
        : <span className="gt__av gt__av--i" aria-hidden="true">
              {String(name || '?').charAt(0).toUpperCase()}
          </span>
}

// The meta row, identical for all four kinds: who, one number, one clock. `time`
// is dropped when there is nothing running — a question has no deadline and an
// artifact is a thing somebody wrote, and inventing a clock for either would be
// the tile lying to make the row line up.
function Meta({ photo, name, stat, statIcon, time }) {
    return (
        <div className="gt__meta">
            <span className="gt__who" title={name}>
                <Face src={photo} name={name} />
                <span className="gt__nm">{name}</span>
            </span>
            {stat && <span className="gt__st"><Ic d={statIcon} />{stat}</span>}
            {time && <span className="gt__st"><Ic d={PATH.clock} />{time}</span>}
        </div>
    )
}

/* ---- the four tiles ------------------------------------------------------ */

function DebateTile({ d }) {
    const sponsor = d.sponsor_username || d.sponsor_name || 'A sponsor'
    // prize_is_cash false => the prize is prose (prize_description) and
    // prize_pool_cents is meaningless.
    const isCash = d.prize_is_cash !== false
    return (
        <Link to={`/debate/${d.id}`} className="gt" title={d.title}>
            <span className="gt__face gt__face--gold">
                <FormatBadge format={d.format} />
                <span className="gt__q">{d.title}</span>
                {/* A FOR-FUN DEBATE HAS NO PLAQUE, and nothing in its place. It
                    is not a debate with a zero prize — there is nothing at stake
                    but a standing arrow, and "$0" or "no prize" would make the
                    absence the loudest thing on the tile. The space goes back to
                    the question. */}
                {!d.is_for_fun && (
                    <span className="gt__prize">
                        <em>{isCash ? 'total prize' : 'the prize'}</em>
                        <b>{isCash ? money(d.prize_pool_cents) : (d.prize_description || 'Announced soon')}</b>
                    </span>
                )}
            </span>
            <Meta
                photo={d.sponsor_photo_url} name={sponsor} statIcon={PATH.people}
                // A for-fun debate has no bracket, so nobody in it is competing
                // with anybody — they answered a question. "6 competitors"
                // would describe a contest that is not happening.
                stat={d.is_for_fun
                    ? plural(d.total_responses ?? 0, 'response', 'responses')
                    : plural(d.total_contestants ?? 0, 'competitor', 'competitors')}
                time={timeLabel(daysUntil(d.start_date))}
            />
        </Link>
    )
}

function WouldbeTile({ w }) {
    // No image column on `wouldbe` yet, so the poster's own avatar is the live
    // path and the title-only face is the exception.
    const photo = w.profile_photo || w.image_url || w.poster_photo_url || null
    const name = posterName(w)
    return (
        <Link to={`/wouldbe/${w.id}`} className="gt" title={w.title}
              aria-label={w.title}>
            <span className="gt__face gt__face--wb">
                {photo && <img className="gt__img" src={photo} alt="" />}
                {/* Over the photo, and the whole face without one — so a hovered
                    image tile and a photoless one read as the same object. It is
                    always in the DOM so it can fade rather than pop, and so the
                    title is there for find-in-page either way. */}
                <span className={`gt__scrim${photo ? '' : ' gt__scrim--flat'}`}>
                    <span className="gt__q">{w.title}</span>
                    {w.office_name && (
                        <span className="gt__office">
                            {w.office_name}{w.state_code ? ` · ${w.state_code}` : ''}
                        </span>
                    )}
                </span>
            </span>
            <Meta
                photo={w.poster_photo_url} name={name}
                stat={`${percentOfGoal(w)}% of goal`} statIcon={PATH.money}
                time={timeLabel(daysUntil(w.deadline))}
            />
        </Link>
    )
}

// Question and artifact share a tile for the same reason they share a form: they
// are the same object with a different pair of fields. The chip and the type-face
// are the whole difference — a question is asked, so it is set in the sans the
// interface speaks in; an artifact is a claim somebody is standing behind, so it
// takes the serif this feed sets the record in.
function WrittenTile({ p, onOpen }) {
    const isQ = p.kind === 'question'
    const text = isQ ? p.question : p.title
    return (
        <button type="button" className="gt" title={text} onClick={() => onOpen?.(p.id)}>
            <span className={`gt__face gt__face--${p.kind}`}>
                <span className="gt__chip">{isQ ? 'Question' : 'Artifact'}</span>
                <span className={`gt__q${isQ ? '' : ' gt__q--serif'}`}>{text}</span>
                {p.imageUrl && <img className="gt__thumb" src={p.imageUrl} alt="" />}
            </span>
            <Meta
                photo={p.author?.avatarUrl} name={p.author?.name}
                stat={p.meta?.[0]} statIcon={PATH.people}
            />
        </button>
    )
}

/* ---- the grid ------------------------------------------------------------ */

// A debate after every third campaign, so a long would-be feed cannot bury them
// and a short one cannot swallow the debates. The cadence is a CONSTANT: the v1
// grid once used a random divisor here and it laid out differently on every load
// (and hit `n % 0` — NaN, never === 0 — a third of the time).
const DEBATE_EVERY = 3

const interleave = (wouldbes, debates, written) => {
    const out = []
    let d = 0
    wouldbes.forEach((item, i) => {
        out.push({ k: 'wouldbe', item })
        if ((i + 1) % DEBATE_EVERY === 0 && d < debates.length) {
            out.push({ k: 'debate', item: debates[d++] })
        }
    })
    while (d < debates.length) out.push({ k: 'debate', item: debates[d++] })
    // The written posts tail the grid rather than mixing in. They are the only
    // kind with no money and no clock on the tile, so interleaved they read as
    // holes in a grid whose whole rhythm is a number in the corner.
    written.forEach((item) => out.push({ k: 'written', item }))
    return out
}

export default function FeedGrid({
    debates = [], wouldbes = [], written = [],
    kinds = ['debate', 'wouldbe', 'question', 'artifact'],
    onOpenPost,
}) {
    // The kind filter is the SAME control the list obeys. A view toggle that
    // quietly widened the filter would make the two layouts disagree about what
    // the feed contains, and the reader would have no way to tell which was
    // right.
    const tiles = interleave(
        kinds.includes('wouldbe') ? wouldbes : [],
        kinds.includes('debate') ? debates : [],
        written.filter((p) => kinds.includes(p.kind)),
    )

    if (!tiles.length) {
        return (
            <p className="grid__empty">
                Nothing to show here yet — try widening the filter.
            </p>
        )
    }

    return (
        <div className="grid">
            {tiles.map(({ k, item }) => (
                k === 'debate' ? <DebateTile key={`d-${item.id}`} d={item} />
                    : k === 'wouldbe' ? <WouldbeTile key={`w-${item.id}`} w={item} />
                        : <WrittenTile key={`p-${item.id}`} p={item} onOpen={onOpenPost} />
            ))}
            <span className="grid__note">would be never sells any user data</span>
        </div>
    )
}
