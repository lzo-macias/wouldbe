import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../../lib/api'
import Header from '../../component/header/Header'
import './AnyUserProfile.css'

// ============================================================================
// THE PUBLIC PROFILE — who this is, what they have argued, and how it went.
//
// This replaces the 38-line stub that used to be here and was routed nowhere.
//
// THE FEED IS REDDIT-SHAPED, and the mapping is deliberate: the DEBATE takes
// the subreddit slot, the PROMPT takes the post title, the answer is the
// comment body. That shape works here for the same reason it works there — a
// stranger's argument means nothing without the question it answers, and this
// page is nothing but strangers' arguments.
//
// EVERY ROW IS READ-ONLY. The like count and the result are shown, not offered:
// a profile is a record, and voting on somebody's argument from inside their own
// trophy case is the wrong place to do it. The row links to the debate, which is
// where acting on it belongs.
//
// PRIVACY IS THE SERVER'S JOB, not this component's. A hidden name is simply not
// in the payload, so there is no `hidden` branch to render — a greyed-out
// "hidden" row would leak the thing the setting exists to hide. All this file
// does is show the `*_private` markers when the server sends them, which it only
// ever does to the owner.
// ============================================================================

const timeAgo = (iso) => {
    if (!iso) return null
    const s = (Date.now() - new Date(iso).getTime()) / 1000
    if (s < 90) return 'just now'
    const m = s / 60
    if (m < 60) return `${Math.round(m)} min ago`
    const h = m / 60
    if (h < 24) return `${Math.round(h)} hr ago`
    const d = h / 24
    if (d < 30) return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago`
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        .format(new Date(iso))
}

const usd = (cents) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`

// The round, named the way a person says it. A bare index does not survive being
// read next to a bracket of a different size.
const roundLabel = (f) =>
    f.bracket_side === 'final' ? 'Final' : `Round ${(f.bracket_round ?? 0) + 1}`

const Lock = () => (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="3" y="6.2" width="8" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 6.2V4.6a2 2 0 014 0v1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
)
const Heart = () => (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 12S1.6 8.8 1.6 5.3A2.9 2.9 0 017 3.6a2.9 2.9 0 015.4 1.7C12.4 8.8 7 12 7 12z"
              fill="currentColor" />
    </svg>
)

const SOCIAL_LABELS = { x: 'X', instagram: 'Instagram', twitch: 'Twitch' }

function AnyUserProfile() {
    const { userId } = useParams()
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [tab, setTab] = useState('overview')

    const load = useCallback(async () => {
        try {
            const { data: d } = await api.get(`/api/users/${userId}/profile`)
            setData(d)
            setError(null)
        } catch (err) {
            setError(
                err.response?.status === 404
                    ? 'That profile does not exist.'
                    : err.response?.data?.error || 'Could not load this profile.'
            )
        }
    }, [userId])

    useEffect(() => {
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [load])

    // "Debates" is the same feed as Overview today. It is its own tab because
    // Overview will grow other kinds of activity, and this one should not have
    // to be filtered back out of it later.
    const rows = useMemo(() => (!data || tab === 'wouldbe' ? [] : data.feed), [data, tab])

    if (error) {
        return (
            <div className="wb-userpage">
                <Header />
                <div className="wb-user-wrap"><p className="up-status" role="alert">{error}</p></div>
            </div>
        )
    }
    if (!data) {
        return (
            <div className="wb-userpage">
                <Header />
                <div className="wb-user-wrap"><p className="up-status">Loading…</p></div>
            </div>
        )
    }

    const { user, stats, feed, wouldbes } = data
    const socialKeys = Object.keys(SOCIAL_LABELS).filter((k) => user.socials[k])
    const hasSocials = socialKeys.length > 0 || !!user.socials.website

    return (
        <div className="wb-userpage">
            <Header />
            <div className="wb-user-wrap">
                <section className="wb-id">
                    <span className="wb-id__avatar">
                        {user.profile_photo_url
                            ? <img src={user.profile_photo_url} alt="" />
                            : <span className="up-blank" aria-hidden="true">
                                  {(user.display_name || '?').charAt(0)}
                              </span>}
                    </span>

                    <div className="wb-id__body">
                        <div className="wb-id__names">
                            <h1 className="wb-id__name">{user.display_name}</h1>
                            {/* When the name is hidden the handle IS the heading,
                                so repeating it underneath would print it twice. */}
                            {user.handle && user.handle !== user.display_name && (
                                <span className="wb-id__handle">{user.handle}</span>
                            )}
                            {user.name_private && (
                                <span className="wb-private">
                                    <Lock /> Your name is hidden — only you see it
                                </span>
                            )}
                        </div>

                        <div className="wb-id__facts">
                            {user.state && (
                                <span className="wb-chip">
                                    {user.state}{user.state_private && <Lock />}
                                </span>
                            )}
                            <span className="wb-chip">{stats.arrows} arrows</span>
                            {stats.wins > 0 && <span className="wb-chip">{stats.wins} won</span>}
                            {stats.likes > 0 && <span className="wb-chip">{stats.likes} likes</span>}
                        </div>

                        {user.bio && <p className="wb-id__bio">{user.bio}</p>}

                        {hasSocials && (
                            <div className="wb-socials">
                                {socialKeys.map((k) => (
                                    <a key={k} className="wb-social" href={user.socials[k]}
                                       target="_blank" rel="me noopener noreferrer"
                                       aria-label={SOCIAL_LABELS[k]} title={user.socials[k]}>
                                        {SOCIAL_LABELS[k].charAt(0)}
                                    </a>
                                ))}
                                {user.socials.website && (
                                    <a className="wb-social wb-social--labelled"
                                       href={user.socials.website}
                                       target="_blank" rel="me noopener noreferrer">
                                        {String(user.socials.website).replace(/^https?:\/\//, '')}
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                <div>
                    <div className="wb-tabs" role="tablist" aria-label="Profile sections">
                        <button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
                            Overview<span className="wb-tabs__n">{feed.length}</span>
                        </button>
                        <button role="tab" aria-selected={tab === 'debates'} onClick={() => setTab('debates')}>
                            Debates<span className="wb-tabs__n">{stats.debates}</span>
                        </button>
                        <button role="tab" aria-selected={tab === 'wouldbe'} onClick={() => setTab('wouldbe')}>
                            Would be<span className="wb-tabs__n">{wouldbes.length}</span>
                        </button>
                    </div>

                    {tab === 'wouldbe' ? (
                        wouldbes.length ? (
                            <div className="wb-minilist">
                                {wouldbes.map((w) => {
                                    const pct = w.goal_cents
                                        ? Math.min(100, Math.round(
                                            (Number(w.pledged_total_cents) / Number(w.goal_cents)) * 100))
                                        : 0
                                    return (
                                        <Link className="wb-mini" to={`/wouldbe/${w.id}`} key={w.id}>
                                            <span className="wb-mini__img" aria-hidden="true" />
                                            <div className="wb-mini__body">
                                                <div className="wb-mini__top">
                                                    <h3 className="wb-mini__t">{w.title || w.office_name}</h3>
                                                    {w.launch_status !== 'active' && (
                                                        <span className="wb-role wb-role--muted">{w.launch_status}</span>
                                                    )}
                                                </div>
                                                <div className="wb-mini__meta">
                                                    <b>{usd(w.pledged_total_cents)}</b>
                                                    <span>of {usd(w.goal_cents)}</span>
                                                    <i>·</i>
                                                    <span>{w.backers} backer{w.backers === 1 ? '' : 's'}</span>
                                                </div>
                                                <div className="wb-mini__bar"><span style={{ width: `${pct}%` }} /></div>
                                            </div>
                                        </Link>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="wb-empty">
                                <span className="wb-empty__t">No campaigns yet</span>
                                When {user.display_name} starts one it shows up here, with what it has raised.
                            </div>
                        )
                    ) : rows.length ? (
                        <div className="wb-feed">
                            {rows.map((f) => (
                                <article className="wb-fitem" key={f.id}>
                                    <div className="wb-fitem__ctx">
                                        <span className="wb-fitem__thumb" aria-hidden="true" />
                                        {/* The whole row is the hit area — the ::after
                                            in the stylesheet stretches this link over it. */}
                                        <Link className="wb-fitem__title" to={`/debate/${f.debate_id}`}>
                                            {f.debate_title}
                                        </Link>
                                        <span className="wb-fitem__sep">·</span>
                                        <span className="wb-fitem__round">{roundLabel(f)}</span>
                                    </div>

                                    <div className="wb-fitem__line">
                                        {f.opponent ? <>answered <b>{f.opponent}</b></> : <>answered the prompt</>}
                                        <span className="wb-fitem__sep">·</span>
                                        <span>{timeAgo(f.submitted_at)}</span>
                                    </div>

                                    {/* Quoted, because it is somebody else's words. */}
                                    <p className="wb-fitem__prompt">{f.prompt}</p>

                                    <div className="wb-fitem__body">
                                        {String(f.body).split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
                                    </div>

                                    <div className="wb-fitem__foot">
                                        <span className="wb-vote"><Heart />{f.like_count}</span>
                                        <span className={`wb-result wb-result--${f.result}`}>
                                            {f.result === 'won' ? 'Won' : f.result === 'lost' ? 'Lost' : 'Open'}
                                        </span>
                                        <span>{f.comment_count} {f.comment_count === 1 ? 'reply' : 'replies'}</span>
                                        <Link to={`/debate/${f.debate_id}/match/${f.key}`}>Open debate</Link>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="wb-empty">
                            <span className="wb-empty__t">No responses yet</span>
                            Answers appear here once the round they were written for closes — before
                            that they are sealed, including from this page.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AnyUserProfile
