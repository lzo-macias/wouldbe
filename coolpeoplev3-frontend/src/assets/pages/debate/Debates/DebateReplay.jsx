import { useEffect, useState } from 'react'
import api from '../../../lib/api'

// ============================================================================
// DebateReplay — how a finished debate was ARGUED, and the tape if there is one.
//
// WHY IT EXISTS: the concluded screen showed a winner and a bracket and never
// once said whether the thing you are reading about was typed or spoken. Those
// are two different contests — a written debate's whole substance is on the
// match pages below, a live one's happened on a broadcast that is not on this
// site at all — and "who won" means something different in each. Someone
// arriving after the fact cannot tell them apart from a bracket.
//
// So this block always states the format, and then answers the question that
// only a live debate raises: can I still watch it.
//
//   typed  — nothing to embed, by definition. Say so.
//   live   — in order of what actually plays:
//              1. the Twitch VOD (vod_video_id / vod_url) in Twitch's player
//              2. a published R2 recording, in the browser's own <video>
//              3. no tape: name the channel it ran on, so the trail isn't cold
//
// The read is GET /debates/:id/stream/public — public on purpose, because this
// screen is public, and redacted server-side (no OAuth connection id, no host
// user id, and an R2 recording only once moderation has published it).
// ============================================================================

// Twitch's player takes the VOD's numeric id. vod_video_id is written from the
// Get Videos response and turns up either bare ("123456789") or in the "v" form
// the site's own URLs use, so both are accepted; when only vod_url was attached
// the id is dug out of it. Anything else yields null and the player is skipped
// rather than rendered pointing at nothing.
const twitchVideoId = (stream) => {
    const raw = stream?.vod_video_id ? String(stream.vod_video_id).trim() : ''
    const bare = raw.replace(/^v/i, '')
    if (/^\d+$/.test(bare)) return bare
    const fromUrl = String(stream?.vod_url || '').match(/twitch\.tv\/videos\/(\d+)/i)
    return fromUrl ? fromUrl[1] : null
}

// The embed's `parent` MUST be the hostname the iframe is displayed on or Twitch
// serves a black box — the single most common reason a Twitch embed appears
// broken. It is the live hostname, not a build-time constant, so localhost, a
// preview deploy and production each satisfy it without configuration.
const embedParent = () =>
    (typeof window !== 'undefined' && window.location?.hostname) || 'localhost'

const runtime = (seconds) => {
    const total = Number(seconds || 0)
    if (!total) return null
    const h = Math.floor(total / 3600)
    const m = Math.round((total % 3600) / 60)
    return h ? `${h}h ${m}m` : `${m}m`
}

const watchedOn = (value) => {
    if (!value) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(d)
}

function DebateReplay({ debate }) {
    const debateId = debate?.id
    const isTyped = debate?.format === 'typed'
    const [stream, setStream] = useState(null)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        let cancelled = false
        // A typed debate has no stream row to fetch — asking would be a request
        // whose answer is known before it is sent. It returns above without ever
        // reading `loaded`, so leaving the flag alone here is not a stuck state;
        // setting it would only be a synchronous setState in an effect body.
        if (!debateId || isTyped) return () => { cancelled = true }
        ;(async () => {
            const { data } = await api
                .get(`/api/debates/${debateId}/stream/public`)
                .catch(() => ({ data: null }))
            if (cancelled) return
            setStream(data || null)
            setLoaded(true)
        })()
        return () => { cancelled = true }
    }, [debateId, isTyped])

    if (isTyped) {
        return (
            <div className="dbt-replay dbt-replay--typed">
                <span className="dbt-label">written debate</span>
                <p className="dbt-replay-line">
                    This one was argued in writing — no broadcast to replay. Every match
                    had its own prompt, both answers side by side and the conversation
                    underneath, and each one still reads exactly as it was voted on.
                </p>
            </div>
        )
    }

    // Held back until the read lands: a live debate that flashed "no replay" and
    // then produced one would have told the viewer the wrong thing first.
    if (!loaded) return null

    const videoId = twitchVideoId(stream)
    const recording = stream?.recording_playback_url || null
    const channel = stream?.twitch_channel || null
    const length = runtime(stream?.recording_duration_seconds)
    const aired = watchedOn(stream?.started_at || stream?.scheduled_at)

    return (
        <div className="dbt-replay">
            <div className="dbt-replay-head">
                <span className="dbt-label">live debate</span>
                <p className="dbt-replay-line">
                    This debate was argued out loud on a livestream
                    {channel ? (
                        <>
                            {' '}on{' '}
                            <a
                                href={`https://www.twitch.tv/${channel}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                twitch.tv/{channel}
                            </a>
                        </>
                    ) : null}
                    {aired ? <> — {aired}</> : null}.
                </p>
            </div>

            {videoId ? (
                <>
                    <div className="dbt-replay-frame">
                        <iframe
                            title="Debate replay"
                            src={`https://player.twitch.tv/?video=${videoId}&parent=${embedParent()}&autoplay=false`}
                            allowFullScreen
                            frameBorder="0"
                            scrolling="no"
                        />
                    </div>
                    <p className="dbt-replay-note">
                        The full broadcast, as it aired. Hosted by Twitch — if it stops
                        playing, the channel has taken the VOD down.
                    </p>
                </>
            ) : recording ? (
                <>
                    <div className="dbt-replay-frame">
                        {/* Our own copy. It exists only for a 'hybrid_record'
                            stream, and only reaches this screen once moderation
                            has published it. */}
                        <video src={recording} controls preload="metadata" />
                    </div>
                    <p className="dbt-replay-note">
                        Our recording of the broadcast{length ? ` — ${length}` : ''}. Kept for
                        the decision window, then deleted.
                    </p>
                </>
            ) : (
                <p className="dbt-replay-note dbt-replay-note--empty">
                    No replay was posted for this one
                    {channel
                        ? ', so the broadcast lives on the channel above'
                        : ', and we kept no recording of it'}
                    . The result above is the record of what it decided.
                </p>
            )}
        </div>
    )
}

export default DebateReplay
