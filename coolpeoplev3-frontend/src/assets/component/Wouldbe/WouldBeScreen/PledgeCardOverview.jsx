import React, { useState } from 'react'
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
            <svg width='88' height='88' viewBox='0 0 88 88'>
                <circle cx='44' cy='44' r={RADIUS} fill='none' stroke='var(--line)' strokeWidth='8' />
                <circle
                    cx='44' cy='44' r={RADIUS} fill='none'
                    stroke='var(--green, #34C759)' strokeWidth='8' strokeLinecap='round'
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
                    transform='rotate(-90 44 44)'
                />
            </svg>
            <div className='pct'><div><b>{pct}%</b><span>funded</span></div></div>
        </div>
    )
}

// `office` is a SEPARATE prop, not a field on wouldbe: GET /api/wouldbes/:id is a
// bare SELECT * with no joins, so office_name has never existed on that row.
// `stats` comes from GET /api/wouldbes/:id/pledge-stats.
// `children` renders at the BOTTOM of the card — AnyWouldBe passes UserOverView
// in, so the profile block sits inside this card rather than beside it.
function PledgeCardOverview({ wouldbe, office, user, differentOwner, checklist, stats, children, onPledged }) {
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
            <div className='head'>
                <img
                    src={user.profile_photo_url}
                    alt={`${user.first_name} ${user.last_name} profile photo`}
                />
                <h3>{user.first_name} for {office?.office_name}</h3>
            </div>

            <div className='hero'>
                <ProgressRing pct={pct} />
                <div className='amounts'>
                    <div className='raised'>{usd(raised)}</div>
                    <div className='goalline'>
                        raised of <b>{usd(goal)}</b> goal
                        {isEmpty && <> · <b className='beFirst'>be the first</b></>}
                    </div>
                    <div className='track'>
                        {/* A 0% fill is invisible, so an empty campaign shows a 2%
                            stub — reads as "a bar that hasn't moved" rather than a
                            missing element. */}
                        <div className='fill' style={{ width: `${isEmpty ? 2 : pct}%` }} />
                        <div className='knob' style={{ left: `${isEmpty ? 2 : pct}%` }} />
                    </div>
                </div>
            </div>

            <div className='stats'>
                <div className='stat'><b>{backers}</b><span>{backers === 1 ? "backer" : "backers"}</span></div>
                <div className='stat'><b>{days ?? "—"}</b><span>days left</span></div>
                {/* Average pledge is a division by zero with no backers — show
                    what's left to raise instead, the number that matters at $0. */}
                {backers > 0 ? (
                    <div className='stat'><b>{usd(raised / backers)}</b><span>avg pledge</span></div>
                ) : (
                    <div className='stat'><b>{usd(goal, { compact: true })}</b><span>to go</span></div>
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
