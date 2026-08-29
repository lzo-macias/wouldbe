import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../../lib/api'
import Header from '../../../component/header/Header'
import ResponseCard from './ResponseCard'
import './ResponseThread.css'

// ============================================================================
// MatchThread — one match of a typed debate, at /debate/:debateId/match/:key.
//
// This is where the bracket points. Clicking either contestant, or the wire
// between them, lands here: the prompt those two were given, what each of them
// wrote, and the conversation underneath.
//
// THREE STATES, and they are genuinely different screens:
//   pending   the round hasn't opened. There is nothing to show — not the
//             prompt either, or everyone would workshop an answer early.
//   open      the prompt is public, the answers are SEALED. You can see how
//             many are in, not what they say; the two contestants can see their
//             own. That seal is what makes both answers written blind.
//   released  the deadline passed, both answers published at once, comments on.
// ============================================================================

const fmt = (iso) =>
    iso
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
              .format(new Date(iso))
        : ''

// The clock people actually read: not "in 7200 seconds".
const countdown = (iso) => {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    if (ms <= 0) return null
    const h = Math.floor(ms / 3600000)
    const m = Math.round((ms % 3600000) / 60000)
    if (h >= 24) return `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}`
    if (h >= 1) return `${h}h ${m}m`
    return `${m}m`
}

const ROUND_WORD = { final: 'The Final' }

function MatchThread() {
    const { debateId, key } = useParams()
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(`/api/debates/${debateId}/matches/${key}/thread`)
            setData(data)
            setError(null)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load this match')
        }
    }, [debateId, key])

    useEffect(() => {
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [load])

    if (error) {
        return (
            <div className="dbt-page">
                <Header />
                <p className="dbt-status" role="alert">{error}</p>
            </div>
        )
    }
    if (!data) {
        return (
            <div className="dbt-page">
                <Header />
                <p className="dbt-status">Loading…</p>
            </div>
        )
    }

    const left = countdown(data.state === 'open' ? data.response_deadline : data.release_at)
    const title =
        ROUND_WORD[data.side] ||
        `Round ${data.round + 1} · ${data.side === 'left' ? 'Left' : 'Right'} · Match ${data.position + 1}`

    return (
        <div className="dbt-page">
            <Header />

            <div className="mt-page">
                <Link className="mt-back" to={`/debate/${debateId}`}>← {data.debate_title}</Link>

                <header className="mt-head">
                    <span className={`mt-state mt-state--${data.state}`}>
                        {data.state === 'pending' && 'Not open yet'}
                        {data.state === 'open' && 'Answers due'}
                        {data.state === 'released' && 'Answers in'}
                        {data.state === 'unscheduled' && 'Unscheduled'}
                    </span>
                    <h1>{title}</h1>
                    <p className="mt-when">
                        {data.state === 'pending' && <>Opens {fmt(data.release_at)}{left ? ` — in ${left}` : ''}</>}
                        {data.state === 'open' && <>Closes {fmt(data.response_deadline)}{left ? ` — ${left} left` : ''}</>}
                        {data.state === 'released' && <>Released {fmt(data.response_deadline)}</>}
                    </p>
                </header>

                {/* The prompt. Withheld entirely while the round is pending — the
                    server does not send it, and this says why rather than
                    rendering an empty quote. */}
                {data.prompt ? (
                    <blockquote className="mt-prompt">{data.prompt}</blockquote>
                ) : (
                    <p className="mt-note">
                        The question for this match is published when the round opens.
                    </p>
                )}

                {data.state === 'open' && (
                    <p className="mt-note mt-note--sealed">
                        {data.submitted_count} of 2 answers in. Both stay sealed until the
                        deadline — nobody writes theirs having read the other.
                    </p>
                )}

                <div className="mt-responses">
                    {data.responses.map((r) => (
                        <ResponseCard key={r.id} response={r} openComments={data.state === 'released'} />
                    ))}
                    {!data.responses.length && data.state === 'released' && (
                        <p className="mt-note">Nobody answered this one.</p>
                    )}
                </div>
            </div>
        </div>
    )
}

export default MatchThread
