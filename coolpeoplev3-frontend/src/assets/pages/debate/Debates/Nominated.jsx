import React, { useEffect, useMemo, useState } from 'react'
import api from '../../../lib/api'

// ============================================================================
// Nominated — the public nomination tally, ranked.
//
// Rows come from GET /api/debates/:id/full → `nominations`, i.e.
// getDebateNominationCounts: one row per NOMINEE, keyed on nominee_user_id (not
// `id`), with nomination_count, the nominee's identity, their optional public
// `link`, and wouldbe_id when they have a launched campaign.
// ============================================================================

function Nominated({ nominated = [] }) {
    // wouldbe id -> campaign title. A Map, read with .get() — `map[key]` on a Map
    // is always undefined and silently renders nothing.
    const [titles, setTitles] = useState(new Map())

    // The tally is only meaningful in rank order, and the server orders by its
    // own key. Sorting a COPY: nominated is props, and Array.prototype.sort
    // mutates in place.
    const ordered = useMemo(
        () =>
            [...nominated].sort(
                (a, b) => (b.nomination_count || 0) - (a.nomination_count || 0)
            ),
        [nominated]
    )

    // Only the campaigns actually referenced by this tally, fetched once each.
    // The key is what the effect depends on: a fresh array with identical
    // contents would otherwise refetch on every parent render.
    const wouldbeKey = [
        ...new Set(nominated.map((n) => n.wouldbe_id).filter(Boolean)),
    ]
        .sort()
        .join(',')

    useEffect(() => {
        let cancelled = false
        const ids = wouldbeKey ? wouldbeKey.split(',') : []
        // Nothing to look up. Any titles already held stay put — they are keyed
        // by id and only ever read for ids in the current list, so a stale entry
        // can't surface on the wrong row.
        if (!ids.length) return
        async function loadData() {
            try {
                const results = await Promise.all(
                    ids.map((id) =>
                        api
                            .get(`/api/wouldbes/${id}`)
                            .then((res) => [id, res.data?.title])
                            // One retired or missing campaign must not blank out the
                            // titles for every other nominee.
                            .catch(() => [id, null])
                    )
                )
                if (cancelled) return
                setTitles(
                    (prev) =>
                        new Map([...prev, ...results.filter(([, title]) => title)])
                )
            } catch (err) {
                console.error(err)
            }
        }
        loadData()
        return () => {
            cancelled = true
        }
    }, [wouldbeKey])

    if (!ordered.length) return <p className="dbt-empty">No nominations yet.</p>

    return (
        <ol>
            {ordered.map((contestant, i) => (
                <li key={contestant.nominee_user_id}>
                    <span className="dbt-rank">{i + 1}</span>
                    <div className="dbt-who">
                        {contestant.profile_photo_url && (
                            <img src={contestant.profile_photo_url} alt="" />
                        )}
                        <p>
                            {[contestant.first_name, contestant.last_name]
                                .filter(Boolean)
                                .join(' ') || contestant.username}
                        </p>
                    </div>
                    <div className="dbt-tally">
                        <span>{contestant.nomination_count}</span>
                        <p>Nominations</p>
                    </div>
                    {contestant.wouldbe_id && titles.get(contestant.wouldbe_id) && (
                        <div className="dbt-links">
                            <a href={`/wouldbe/${contestant.wouldbe_id}`}>
                                {titles.get(contestant.wouldbe_id)}
                            </a>
                        </div>
                    )}
                    {contestant.link && (
                        <div className="dbt-links">
                            {/* The URL is validated to http/https on the write path;
                                rel="noopener noreferrer" is still required here. */}
                            <a
                                href={contestant.link}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {contestant.link}
                            </a>
                        </div>
                    )}
                </li>
            ))}
        </ol>
    )
}

export default Nominated
