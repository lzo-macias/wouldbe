import { useState } from 'react'
import MyWouldBeShare from '../../Socialshare/MyWouldBeShare'
import PledgeFlow from './PledgeFlow'
import { useFollow } from '../../../lib/useFollow'
import "./PledgeCardOverview.css"

// All money is bigint in pg, so it arrives as a STRING. Number() before any
// arithmetic — `"500000" + 100` is "500000100".
const cents = (v) => Number(v ?? 0)

const usd = (c, { compact = false } = {}) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: 0,
    }).format(cents(c) / 100)

// Whole days until a DATE column. The value is the server's local midnight
// rendered as UTC, so compare UTC calendar days — an hours-based diff is off by
// one depending on the viewer's timezone.
const daysLeft = (value) => {
    if (!value) return null
    const then = new Date(value)
    const thenDay = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate())
    const now = new Date()
    const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return Math.max(0, Math.round((thenDay - nowDay) / 86400000))
}

// Progress ring. dashoffset is the UNDRAWN portion, so it runs from the full
// circumference (0%) down to 0 (100%). Circumference is derived from the radius
// rather than hardcoded, so changing r still works.
const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function ProgressRing({ pct }) {
    return (
        <div className='ring'>
            {/* THE SVG FILLS ITS BOX rather than declaring 88px of its own. The
                label below is absolutely positioned against .ring, so a fixed
                88px circle inside a box CSS had resized to 72px put the ring and
                its percentage in two different places — which is why "0%" sat
                left of centre. Sized by the box, scaled by the viewBox, the two
                can no longer disagree. */}
            <svg width='100%' height='100%' viewBox='0 0 88 88'>
                <circle cx='44' cy='44' r={RADIUS} fill='none' stroke='var(--line)' strokeWidth='8' />
                <circle
                    cx='44' cy='44' r={RADIUS} fill='none'
                    /* --wb-gold-mark, not --wb-gold: this is a GRAPHIC that
                       carries meaning, and WCAG wants 3:1 for those. --wb-gold
                       is 2.4:1 on white; the mark is 3.9:1. */
                    stroke='var(--wb-gold-mark)' strokeWidth='8' strokeLinecap='round'
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
                    transform='rotate(-90 44 44)'
                />
            </svg>
            <div className='pct'><div><b>{pct}%</b><span>funded</span></div></div>
        </div>
    )
}

// `stats` comes from GET /api/wouldbes/:id/pledge-stats. (`office` used to be
// passed for the card's own heading; the heading is gone — the hero owns it —
// so the prop is no longer read here. AnyWouldBe still passes it; an unused prop
// costs nothing and keeps the call site honest about what this card is about.)
// `children` renders at the BOTTOM of the card — AnyWouldBe passes UserOverView
// in, so the profile block sits inside this card rather than beside it.
function PledgeCardOverview({ wouldbe, user, differentOwner, stats, children, onPledged }) {
    const [flowOpen, setFlowOpen] = useState(false)
    const [notice, setNotice] = useState(null)
    // Persisted on the server, not in component state — see useFollow.
    const {
        following,
        busy: followBusy,
        error: followError,
        toggle: toggleFollow,
    } = useFollow(wouldbe?.id, 'Wouldbe')

    // Hooks run before this guard, so the early return can't change hook order.
    if (!wouldbe || !user) return null

    const goal = cents(wouldbe.goal_cents)
    const raised = cents(wouldbe.pledged_total_cents)
    // Clamped: an over-funded campaign would push the knob past the right edge
    // and hand the ring a negative dashoffset. Guarded: a goal of 0 yields NaN,
    // and React renders `width: NaN%`.
    const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0

    const backers = Number(stats?.unique_pledgers ?? 0)
    const days = daysLeft(wouldbe.deadline)
    const isEmpty = raised === 0

    // Who is looking. `user` is the campaign OWNER (the card renders their name
    // and photo), NOT the viewer — so ownership is decided by the viewer's own id
    // from storage, and differentOwner from the parent when it has it.
    const viewerId = localStorage.getItem('userId')
    const isOwnCampaign =
        differentOwner === false ||
        (!!viewerId && wouldbe.user_id === viewerId)

    // Both gates are ALSO enforced server-side (isPledgeEligible refuses a
    // self-pledge, and the route is authenticated). These only save a round trip
    // and explain the refusal in place.
    function handlePledgeClick() {
        setNotice(null)
        if (!viewerId) {
            setNotice('Log in to pledge to this campaign.')
            return
        }
        if (isOwnCampaign) {
            setNotice('You cannot pledge to your own campaign.')
            return
        }
        setFlowOpen(true)
    }

    return (
        <div className='pledgeCard'>
            {/* NO HEADER. It carried the candidate's photo and "<name> for
                <office>" — and the page's own hero, three inches to the left,
                already sets that title as the <h1> AND puts the same face and
                office under the pitch. Repeating both inside a 358px rail is
                what made the top of this card look cramped: a 44px portrait and
                a two-line heading spending the card's widest, most valuable
                space saying what the reader just read. The card opens on the
                number instead, which is the only thing here the hero does not
                say. */}
            <div className='hero'>
                <ProgressRing pct={pct} />
                <div className='amounts'>
                    <div className='raised'>{usd(raised)}</div>
                    <div className='goalline'>
                        raised of <b>{usd(goal)}</b> goal
                        {isEmpty && <> · <b className='beFirst'>be the first</b></>}
                    </div>
                </div>
            </div>

            {/* FULL WIDTH, a sibling of the meter rather than a third line
                inside the amounts column. Indented behind the ring it had about
                200px to express a percentage in, and a progress bar that cannot
                use the width of its own card is a diagram of nothing. */}
            <div className='track'>
                {/* A 0% fill is invisible, so an empty campaign shows a 2% stub —
                    reads as "a bar that hasn't moved" rather than a missing
                    element. */}
                <div className='fill' style={{ width: `${isEmpty ? 2 : pct}%` }} />
                <div className='knob' style={{ left: `${isEmpty ? 2 : pct}%` }} />
            </div>

            <div className='stats'>
                <div className={`stat${backers ? "" : " stat--muted"}`}>
                    <b>{backers}</b>
                    <span>{backers === 1 ? "backer" : "backers"}</span>
                </div>
                {/* Say the state, do not print a zero. "0 days left" in a stat
                    tile reads as a bug even when it is accurate, and a bare "—"
                    under the words "days left" reads as a value that failed to
                    load rather than as a campaign with no deadline. */}
                <div className={`stat${days ? "" : " stat--muted"}`}>
                    <b>{days === null ? "—" : days}</b>
                    <span>
                        {days === null ? "no deadline" : days === 1 ? "day left" : "days left"}
                    </span>
                </div>
                {/* Average pledge is a division by zero with no backers — show
                    what's left to raise instead, the number that matters at $0. */}
                {backers > 0 ? (
                    <div className='stat'><b>{usd(raised / backers)}</b><span>avg pledge</span></div>
                ) : (
                    <div className='stat stat--muted'><b>{usd(goal, { compact: true })}</b><span>to go</span></div>
                )}
            </div>

            <div className='actions'>
                <button className='pledge' type='button' onClick={handlePledgeClick}>
                    {isEmpty ? "Be the first to pledge" : "Pledge"}
                </button>
                <button
                    className={`follow${following ? ' is-following' : ''}`}
                    type='button'
                    onClick={toggleFollow}
                    disabled={followBusy}
                    aria-pressed={following}
                >
                    {following ? 'Following' : 'Follow'}
                </button>
            </div>
            {(notice || followError) && (
                <p className='cardNotice' role='alert'>{notice || followError}</p>
            )}

            {flowOpen && (
                <PledgeFlow
                    wouldbe={wouldbe}
                    onClose={() => setFlowOpen(false)}
                    onPledged={onPledged}
                />
            )}

            <div className='share'><MyWouldBeShare /></div>

            <div className='aon'>
                <span className='tag'>⚡ All-or-nothing</span>
                <p>
                    This campaign only gets funded if {user.first_name} reaches
                    the contribution goal by the deadline.
                </p>
            </div>

            {/* Bottom-left slot. UserOverView owns the debates — its DebateSwap has
                the Active/Won toggle a flat pill row here would not, and rendering
                both would show them twice. */}
            {children && (
                <>
                    <div className='divider' />
                    <div className='cardFooter'>{children}</div>
                </>
            )}
        </div>
    )
}

export default PledgeCardOverview
