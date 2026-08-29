import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import ResponseCard from './ResponseCard'
import './ResponseThread.css'

// ============================================================================
// TopResponses — the answers the platform is actually engaging with.
//
// Ranked server-side by a STORED score (comments ×3, likes ×2, profile clicks
// ×1) so every surface ranks identically and the weights live in one place —
// the generated column on response_engagement — rather than in each query that
// fancies its own formula.
//
// Only RELEASED rounds appear: an answer nobody can read has no business on a
// leaderboard, and its counters would be zero anyway.
// ============================================================================

function TopResponses({ debateId = null, limit = 5, sinceDays = null, title = 'Most talked about' }) {
    const [rows, setRows] = useState(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (cancelled) return
            try {
                const q = new URLSearchParams({ limit: String(limit) })
                if (debateId) q.set('debate_id', debateId)
                if (sinceDays) q.set('since_days', String(sinceDays))
                const { data } = await api.get(`/api/responses/top?${q}`)
                if (!cancelled) setRows(data)
            } catch (err) {
                console.error('[TopResponses] failed', err)
                if (!cancelled) setRows([])
            }
        })()
        return () => { cancelled = true }
    }, [debateId, limit, sinceDays])

    // Nothing engaged with yet is not an error and not worth a placeholder —
    // an empty "most talked about" says the opposite of what it means.
    if (!rows?.length) return null

    return (
        <section className="tr-feed">
            <div className="tr-head">
                <h2>{title}</h2>
                <span className="tr-score">
                    ranked by comments · likes · profile opens
                </span>
            </div>

            {rows.map((r) => (
                <ResponseCard
                    key={r.id}
                    response={r}
                    context={`${r.debate_title} — "${r.prompt}"`}
                />
            ))}
        </section>
    )
}

export default TopResponses
