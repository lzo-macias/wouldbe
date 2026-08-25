import React from 'react'
import MyWouldBeShare from '../../../component/Socialshare/MyWouldBeShare'
import { useFollow } from '../../../lib/useFollow'
import './DebateCards.css'

// ============================================================================
// NominateCard — the pre-debate hero card: title, start time, prize, a peek at
// who's been nominated, and the three calls to action.
//
// Everything below is a pure helper or a leaf component, so it lives at module
// scope. Declaring them INSIDE NominateCard would rebuild the function on every
// render, which also remounts NominatedDiv (React sees a brand-new component
// type) and throws away its DOM each time the parent re-renders.
// ============================================================================

const money = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
        .format(Number(cents || 0) / 100)

// formatStartDate — the debate's start instant, rendered in the zone the
// sponsor actually scheduled in.
//
// The instant alone is not enough: "8pm ET" and "5pm PT" are the same moment,
// and only one of them is what the sponsor picked. debates.start_timezone is the
// IANA name that goes with start_at, so it is passed straight to
// Intl.DateTimeFormat. With no zone stored we fall back to the viewer's own,
// which is the only honest guess available.
const formatStartDate = (value, timeZone) => {
    if (!value) return null
    const when = new Date(value)
    if (Number.isNaN(when.getTime())) return null
    try {
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZoneName: 'short',
            ...(timeZone ? { timeZone } : {}),
        }).format(when)
    } catch {
        // An unrecognised zone name would otherwise throw a RangeError mid-render
        // and take the whole page down over a display detail.
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(when)
    }
}

const PREVIEW_LIMIT = 4

// NominatedDiv — the stacked avatars plus the headcount.
function NominatedDiv({ nominated }) {
    if (!nominated.length) return null

    const visible = nominated.slice(0, PREVIEW_LIMIT)
    const overflow = nominated.length - visible.length

    return (
        <div className="dbt-nominated">
            <div className="dbt-avatars">
                {visible.map((element, i) => (
                    <img
                        // A stable identity, not crypto.randomUUID (which was being
                        // passed as a FUNCTION, so every avatar shared the same key
                        // — React then reuses the wrong <img> when the list moves).
                        key={element.nominee_user_id || i}
                        src={element.profile_photo_url}
                        alt=""
                    />
                ))}
                {overflow > 0 && <span className="dbt-more">+{overflow}</span>}
            </div>
            <div className="dbt-count">
                <span>{nominated.length}</span>
                <p>{nominated.length === 1 ? 'contestant' : 'contestants'}</p>
            </div>
        </div>
    )
}

function NominateCard({
    debate,
    nominated = [],
    onRequireAuth,
    onNominate,
    onJoin,
}) {
    // Follow state is READ FROM THE SERVER, not held locally — see useFollow.
    // The hook runs before the guard below so hook order stays stable across
    // the null-payload render.
    const {
        following,
        busy: followBusy,
        error: followError,
        toggle: toggleFollow,
    } = useFollow(debate?.id, 'Debate')

    // The card renders from a payload that arrives asynchronously; until it does,
    // `debate` is null and every field read below would throw.
    if (!debate || !debate.id) return null

    const startsAt = formatStartDate(
        debate.start_at || debate.start_date,
        debate.start_timezone
    )

    // The share link is built from the origin + the debate's own route so it is
    // stable wherever the card is rendered from.
    const shareUrl =
        typeof window !== 'undefined'
            ? `${window.location.origin}/debate/${debate.id}`
            : undefined

    // prize_type is the source of truth ('cash' | 'non_cash' | 'both'), enforced
    // by debates_prize_shape_chk. There is no `cash_prize` column.
    const hasCash = debate.prize_type === 'cash' || debate.prize_type === 'both'
    const hasDescription =
        debate.prize_type === 'non_cash' || debate.prize_type === 'both'
    const poolCents = debate.prize_pool_cents ?? debate.sponsor_contribution_cents

    return (
        <div className="dbt-card">
            <button
                type="button"
                className={`dbt-follow${following ? ' is-following' : ''}`}
                onClick={toggleFollow}
                disabled={followBusy}
                aria-pressed={following}
            >
                {following ? 'following' : 'follow'}
            </button>

            <div className="dbt-titlebar">
                <h1>{debate.title}</h1>
            </div>
            <span className="dbt-ribbon">Debate</span>

            <div className="dbt-body">
                {followError && <p className="dbt-error" role="alert">{followError}</p>}

                {startsAt && (
                    <div className="dbt-when">
                        <span className="dbt-label">start date</span>
                        <p>{startsAt}</p>
                    </div>
                )}

                {hasCash ? (
                    <div className="dbt-prize">
                        <span className="dbt-label">total cash prize</span>
                        <p className="dbt-prize-amt">{money(poolCents)}</p>
                        {hasDescription && debate.prize_description && (
                            <p className="dbt-prize-note">{debate.prize_description}</p>
                        )}
                    </div>
                ) : (
                    debate.prize_description && (
                        <div className="dbt-prize">
                            <span className="dbt-label">prize</span>
                            <p className="dbt-prize-amt">{debate.prize_description}</p>
                        </div>
                    )
                )}

                <NominatedDiv nominated={nominated} />

                <div className="dbt-actions">
                    <button
                        type="button"
                        className="dbt-btn dbt-btn--gold"
                        onClick={onNominate}
                    >
                        <img src="/debate/goldministar.svg" alt="" />
                        Nominate
                    </button>
                    <button
                        type="button"
                        className="dbt-btn dbt-btn--outline"
                        onClick={onJoin}
                    >
                        <img src="/homepagegraphics/Plus.svg" alt="" />
                        Join the Debate
                    </button>
                    <div className="dbt-share">
                        {/* The canonical debate URL, not window.location.href:
                            the address bar may carry a tracking query or a hash,
                            and that is not the link anyone should be sharing. */}
                        <MyWouldBeShare
                            url={shareUrl}
                            title={debate.title}
                            text={`${debate.title} — join the debate on CoolPeople`}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default NominateCard
