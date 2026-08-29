import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../../lib/api'
import { Stars, StarInput } from '../../../component/Wouldbe/WouldBeScreen/StarRating'
import './MatchVote.css'

// ============================================================================
// MatchVoteModal — the vote screen the host puts up on a bracket match.
//
// WHAT A BALLOT IS: a 1–5 on every published criterion for BOTH contestants,
// plus an optional line saying why. Nobody clicks a winner — the winner is what
// the numbers add up to (weighted by each criterion's published weight), so the
// verdict and the reasoning can never disagree. The running total is shown
// live at the bottom so a voter can see what they are about to say.
//
// FULL COVERAGE IS REQUIRED, and the API enforces it too. A ballot that scores
// one person on one criterion isn't comparable to a complete one, and averaging
// the two together would quietly give the partial one more weight per criterion.
//
// NO LIVE TALLY FOR VOTERS. The API withholds it until the host closes the
// vote, and this screen doesn't ask for it — a running count on screen tells
// people which way the room is going before they score, which is the exact
// pressure a per-criterion ballot exists to remove. The host sees the count,
// because they are the one deciding when it has run long enough.
//
// THE REVIEWS BUTTON is a different thing from the ballot and is deliberately
// kept apart from it: a ballot decides this match, a review is a lasting rating
// on that person's profile (POST /api/users/:id/reviews, one per pair, edited
// rather than stacked). You can leave one without voting and vote without
// leaving one.
// ============================================================================

const SCORES = [1, 2, 3, 4, 5]
const MAX_COMMENT = 500
const MAX_REVIEW = 5000

const displayName = (c) =>
    [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.username || 'Contestant'
const firstName = (c) => c?.first_name || c?.username || 'this contestant'

const roundLabel = (match) => {
    if (!match) return ''
    if (match.side === 'final') return 'The final'
    return `Round ${match.round + 1} · Match ${match.position + 1}`
}

// Avatar, or the initial on a tinted disc when there is no photo. Same fallback
// the bracket uses, so the same person doesn't change appearance between the
// two views.
function Face({ contestant, size = 56 }) {
    const name = displayName(contestant)
    return contestant?.profile_photo_url ? (
        <img
            className="mv-face"
            style={{ width: size, height: size }}
            src={contestant.profile_photo_url}
            alt=""
        />
    ) : (
        <span className="mv-face mv-face--blank" style={{ width: size, height: size }} aria-hidden="true">
            {name.charAt(0)}
        </span>
    )
}

/* ------------------------------------------------------------------ */
/* the review composer                                                 */
/* ------------------------------------------------------------------ */

// ReviewPanel — what the "Reviews" button opens, for ONE contestant.
//
// Loads their public summary plus (when signed in) the caller's own existing
// review, because the API upserts: a second submit EDITS the first rather than
// stacking, and a form that didn't show the existing text would look like it had
// silently lost it.
function ReviewPanel({ contestant, onClose }) {
    const [summary, setSummary] = useState(null)
    const [rating, setRating] = useState(0)
    const [body, setBody] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [saved, setSaved] = useState(false)

    const userId = contestant?.user_id
    const meId = localStorage.getItem('userId')
    const signedIn = !!localStorage.getItem('token')
    const isSelf = !!meId && meId === userId

    const load = useCallback(async () => {
        if (!userId) return
        try {
            const { data } = await api.get(`/api/users/${userId}/reviews?limit=5`)
            setSummary(data)
            if (data?.my_review) {
                setRating(data.my_review.rating)
                setBody(data.my_review.body || '')
            }
        } catch (err) {
            console.error('[MatchVoteModal] review load failed', err)
        }
    }, [userId])

    // The load is wrapped rather than called bare: an effect body that calls a
    // setState-ing function directly is what the react-hooks rule flags, and the
    // async IIFE is the pattern the rest of this codebase already uses.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (!cancelled) await load()
        })()
        return () => { cancelled = true }
    }, [load])

    const submit = async () => {
        setError(null)
        if (!rating) return setError('Pick a rating first.')
        if (!body.trim()) return setError('Say something about why — a rating on its own is not a review.')
        setBusy(true)
        try {
            await api.post(`/api/users/${userId}/reviews`, { rating, body: body.trim() })
            setSaved(true)
            await load()
        } catch (err) {
            setError(err.response?.data?.error || 'Could not save that review.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="mv-review">
            <div className="mv-review-head">
                <div>
                    <span className="dbt-label">reviews</span>
                    <h4>{displayName(contestant)}</h4>
                </div>
                <button type="button" className="dbt-popup-close mv-review-close" onClick={onClose}>
                    x
                </button>
            </div>

            <div className="mv-review-summary">
                <Stars value={summary?.average_rating} size={16} />
                <span>
                    {summary?.review_count
                        ? `${Number(summary.average_rating).toFixed(1)} · ${summary.review_count} review${
                              summary.review_count === 1 ? '' : 's'
                          }`
                        : 'No reviews yet'}
                </span>
            </div>

            {/* A review is a permanent rating on someone's profile, not part of
                deciding this match. Saying so stops the two being confused. */}
            <p className="mv-review-note">
                This goes on {firstName(contestant)}'s profile and stays there. It does not
                count toward who wins this match.
            </p>

            {isSelf ? (
                <p className="mv-note">You can't review yourself.</p>
            ) : !signedIn ? (
                <div className="dbt-popup-actions mv-review-auth">
                    <a href="/signup">Sign up to review</a>
                    <a href="/login">Log in</a>
                </div>
            ) : (
                <>
                    <div className="mv-review-form">
                        <span className="dbt-label" id={`mv-rate-${userId}`}>
                            {summary?.my_review ? 'your rating' : 'your rating'}
                        </span>
                        <StarInput
                            value={rating}
                            onChange={(n) => { setRating(n); setSaved(false) }}
                            size={26}
                            labelledBy={`mv-rate-${userId}`}
                        />
                        <textarea
                            className="mv-textarea"
                            rows={4}
                            maxLength={MAX_REVIEW}
                            placeholder={`What should people know about ${firstName(contestant)}?`}
                            value={body}
                            onChange={(e) => { setBody(e.target.value); setSaved(false) }}
                        />
                        <div className="mv-count">{body.length}/{MAX_REVIEW}</div>
                    </div>

                    {error && <p className="dbt-error" role="alert">{error}</p>}
                    {saved && <p className="mv-saved">Saved to their profile.</p>}

                    <button
                        type="button"
                        className="dbt-btn dbt-btn--gold"
                        onClick={submit}
                        disabled={busy}
                    >
                        {busy
                            ? 'Saving…'
                            : summary?.my_review
                              ? 'Update my review'
                              : 'Post review'}
                    </button>
                </>
            )}

            {!!summary?.reviews?.length && (
                <ul className="mv-review-list">
                    {summary.reviews.slice(0, 3).map((r) => (
                        <li key={r.id}>
                            <Stars value={r.rating} size={12} />
                            <p>{r.body}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* the results panel                                                   */
/* ------------------------------------------------------------------ */

function Results({ match, criteria, tally, seats }) {
    const byId = useMemo(() => {
        const m = {}
        for (const row of tally?.counts || []) m[row.contestant_id] = row
        return m
    }, [tally])

    const avg = useMemo(() => {
        const m = {}
        for (const row of tally?.averages || []) {
            m[`${row.contestant_id}:${row.criterion_id}`] = row.avg_score
        }
        return m
    }, [tally])

    const winner = seats.find((s) => s.contestant_id === match.winner_contestant_id)
    const total = tally?.total_ballots || 0

    return (
        <div className="mv-results">
            <div className={`mv-verdict ${winner ? 'is-decided' : ''}`}>
                {winner ? (
                    <>
                        <Face contestant={winner} size={44} />
                        <div>
                            <span className="dbt-label">
                                {match.decided_by_host ? 'called by the host' : 'the room decided'}
                            </span>
                            <h4>{displayName(winner)} advances</h4>
                        </div>
                    </>
                ) : (
                    <div>
                        <span className="dbt-label">too close to call</span>
                        <h4>The room split evenly — the host has to break it</h4>
                    </div>
                )}
            </div>

            <div className="mv-tallyrow">
                {seats.map((s) => (
                    <div key={s.contestant_id} className="mv-tallycell">
                        <span className="mv-tallynum">{byId[s.contestant_id]?.votes ?? 0}</span>
                        <span className="dbt-label">{firstName(s)}</span>
                    </div>
                ))}
            </div>
            <p className="mv-note">
                {total} ballot{total === 1 ? '' : 's'}
                {tally?.draws ? `, ${tally.draws} scored it a draw` : ''}
            </p>

            {!!criteria.length && (
                <table className="mv-avg">
                    <thead>
                        <tr>
                            <th>average score</th>
                            {seats.map((s) => <th key={s.contestant_id}>{firstName(s)}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {criteria.map((c) => (
                            <tr key={c.criterion_id}>
                                <td>{c.display_name}</td>
                                {seats.map((s) => {
                                    const v = avg[`${s.contestant_id}:${c.criterion_id}`]
                                    return (
                                        <td key={s.contestant_id}>
                                            {v == null ? '—' : v.toFixed(2)}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {!!tally?.comments?.length && (
                <ul className="mv-comments">
                    {tally.comments.map((c) => {
                        const who = seats.find((s) => s.contestant_id === c.contestant_id)
                        return (
                            <li key={c.vote_id}>
                                <span className="dbt-label">
                                    {who ? `scored it for ${firstName(who)}` : 'scored it a draw'}
                                </span>
                                <p>{c.comment}</p>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* the modal                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {object}   debate        the debate row (for title + rules version)
 * @param {object}   match         the open (or just-closed) match
 * @param {array}    criteria      debate_judging_criteria, in display order
 * @param {object}   myVote        the caller's existing ballot, or null
 * @param {object}   tally         host-only live count, or the closed result
 * @param {boolean}  isHost        may close the vote / break a tie
 * @param {Function} onClose       dismiss the screen
 * @param {Function} onVoted       a ballot landed — parent re-reads
 * @param {Function} onCloseVoting host closed it — parent re-reads the bracket
 */
function MatchVoteModal({
    debate,
    match,
    criteria = [],
    myVote = null,
    tally = null,
    isHost = false,
    onClose,
    onVoted,
    onCloseVoting,
}) {
    // Memoised: `match?.contestants || []` is a fresh array on every render when
    // match is null, which would make every useMemo below recompute each time.
    const seats = useMemo(() => match?.contestants || [], [match])
    // scores[contestant_id][criterion_id] = 1..5
    const [scores, setScores] = useState({})
    const [comment, setComment] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [reviewing, setReviewing] = useState(null) // contestant_id | null
    // TYPED BALLOT ONLY: who the voter says won, and whether they have chosen to
    // score the one they did not pick.
    const [pick, setPick] = useState(null)
    const [rateOther, setRateOther] = useState(false)
    const [closedResult, setClosedResult] = useState(null)

    const signedIn = !!localStorage.getItem('token')
    // A WRITTEN debate is voted the other way round from a live one: you have
    // read two answers and already know which was better, so the pick is the
    // input and the rubric explains it. Deriving the winner from ten sliders
    // would be asking someone to reverse-engineer their own conclusion.
    const isTyped = debate?.format === 'typed'
    const meId = localStorage.getItem('userId')
    const inThisMatch = seats.some((s) => s.user_id === meId)
    const alreadyVoted = !!myVote

    // Escape closes it, like every other dialog on the page.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const setScore = (contestantId, criterionId, value) => {
        setScores((prev) => ({
            ...prev,
            [contestantId]: { ...(prev[contestantId] || {}), [criterionId]: value },
        }))
    }

    const filled = seats.reduce(
        (n, s) => n + criteria.filter((c) => scores[s.contestant_id]?.[c.criterion_id]).length,
        0
    )
    const needed = criteria.length * seats.length

    // What "finished" means in each mode.
    //   live   every criterion for both people
    //   typed  every criterion for the person you PICKED; the other is optional,
    //          but all-or-nothing — a half-scored opponent is not comparable to a
    //          fully scored one and would drag their average down on the criteria
    //          the voter skipped rather than the ones they thought were weak.
    const other = seats.find((s) => s.contestant_id !== pick)
    // Typed: only the picked contestant, until the voter opts into scoring the
    // other. Live: both, always.
    const shownSeats = !isTyped
        ? seats
        : rateOther
          ? seats
          : seats.filter((s) => s.contestant_id === pick)
    const pickFilled = criteria.filter((c) => scores[pick]?.[c.criterion_id]).length
    const otherFilled = other
        ? criteria.filter((c) => scores[other.contestant_id]?.[c.criterion_id]).length
        : 0
    const complete = isTyped
        ? !!pick &&
          pickFilled === criteria.length &&
          (otherFilled === 0 || otherFilled === criteria.length)
        : needed > 0 && filled === needed

    // The same weighted sum the server uses, run locally so the voter can see
    // what their scores are saying before they commit to them. It is a PREVIEW —
    // the number that counts is the one the API derives from the stored scores.
    const totals = useMemo(() => {
        const out = {}
        for (const s of seats) {
            out[s.contestant_id] = criteria.reduce((sum, c) => {
                const v = scores[s.contestant_id]?.[c.criterion_id]
                return v ? sum + Number(c.weight || 0) * v : sum
            }, 0)
        }
        return out
    }, [scores, criteria, seats])

    const leader = useMemo(() => {
        if (!complete || seats.length !== 2) return null
        const [a, b] = seats
        if (totals[a.contestant_id] === totals[b.contestant_id]) return 'draw'
        return totals[a.contestant_id] > totals[b.contestant_id] ? a : b
    }, [complete, totals, seats])

    const submit = async () => {
        setError(null)
        if (!complete) {
            return setError(
                isTyped
                    ? !pick
                        ? 'Pick who won this match first.'
                        : 'Score the contestant you picked on every criterion.'
                    : 'Score every criterion for both contestants first.'
            )
        }
        setBusy(true)
        try {
            // Only the rows that were actually scored are sent. In a typed
            // ballot the skipped contestant contributes nothing, which is what
            // "optional" has to mean in the data as well as on screen.
            const payload = {
                scores: seats.flatMap((s) =>
                    criteria
                        .filter((c) => scores[s.contestant_id]?.[c.criterion_id])
                        .map((c) => ({
                            contestant_id: s.contestant_id,
                            criterion_id: c.criterion_id,
                            score: scores[s.contestant_id][c.criterion_id],
                        }))
                ),
                winner_contestant_id: isTyped ? pick : undefined,
                comment: comment.trim() || null,
                rules_version_seen: debate?.rules_version || null,
            }
            await api.post(
                `/api/debates/${match.debate_id}/matches/${match.id}/votes`,
                payload
            )
            onVoted?.()
        } catch (err) {
            setError(err.response?.data?.error || 'Could not record that ballot.')
        } finally {
            setBusy(false)
        }
    }

    // Host: take the screen down and let the count decide. A tie comes back
    // undecided rather than resolved at random, and the host is then asked.
    const closeVoting = async (winner_contestant_id = null) => {
        setError(null)
        setBusy(true)
        try {
            const { data } = await api.post(
                `/api/debates/${match.debate_id}/matches/${match.id}/close`,
                winner_contestant_id ? { winner_contestant_id } : {}
            )
            setClosedResult(data)
            onCloseVoting?.(data)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not close the vote.')
        } finally {
            setBusy(false)
        }
    }

    const breakTie = async (winner_contestant_id) => {
        setError(null)
        setBusy(true)
        try {
            // { match, result } — `result` is the debate_results row when the
            // match settled was the FINAL, i.e. this click just crowned the
            // debate. The parent re-reads on it and the page moves on.
            const { data } = await api.post(
                `/api/debates/${match.debate_id}/matches/${match.id}/winner`,
                { winner_contestant_id }
            )
            setClosedResult((prev) => ({ ...(prev || {}), match: data.match }))
            onCloseVoting?.(data)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not set the winner.')
        } finally {
            setBusy(false)
        }
    }

    if (!match) return null

    const shownMatch = closedResult?.match || match
    const shownTally = closedResult?.tally || tally
    const isClosed = shownMatch.voting_state === 'closed'
    const reviewSeat = seats.find((s) => s.contestant_id === reviewing)

    return (
        <div className="dbt-scrim mv-scrim" onClick={onClose}>
            <div
                className="dbt-popup dbt-popup--wide mv-panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Match vote"
            >
                <button type="button" className="dbt-popup-close" onClick={onClose}>x</button>

                <span className="dbt-label mv-kicker">
                    {isClosed ? 'result' : <span className="mv-live">voting open</span>}
                    {' · '}{roundLabel(shownMatch)}
                </span>
                <h3 className="dbt-modal-title">
                    {isClosed ? 'How the room scored it' : 'Who won this match?'}
                </h3>

                {/* The two people, always visible — they are the subject of every
                    control below, including the Reviews button. */}
                <div className="mv-seats">
                    {seats.map((s) => (
                        <div key={s.contestant_id} className="mv-seat">
                            <Face contestant={s} />
                            <div className="mv-seat-id">
                                <strong>{displayName(s)}</strong>
                                {s.username && <span>@{s.username}</span>}
                            </div>
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--outline mv-reviewbtn"
                                onClick={() =>
                                    setReviewing((cur) =>
                                        cur === s.contestant_id ? null : s.contestant_id
                                    )
                                }
                            >
                                Reviews
                            </button>
                        </div>
                    ))}
                </div>

                {reviewSeat && (
                    <ReviewPanel contestant={reviewSeat} onClose={() => setReviewing(null)} />
                )}

                {isClosed ? (
                    <Results
                        match={shownMatch}
                        criteria={criteria}
                        tally={shownTally}
                        seats={seats}
                    />
                ) : alreadyVoted ? (
                    // Ballot's in. It is NOT re-openable: one ballot per person
                    // per match is the DB's rule, so offering an edit here would
                    // only produce a 409 at the end of it.
                    <div className="mv-done">
                        <p className="mv-done-lede">Your ballot is in.</p>
                        <p className="mv-note">
                            {myVote.contestant_id
                                ? `You scored it for ${firstName(
                                      seats.find((s) => s.contestant_id === myVote.contestant_id)
                                  )}.`
                                : 'You scored them level.'}{' '}
                            The result is published when the host closes the vote.
                        </p>
                        {myVote.comment && <p className="mv-quote">“{myVote.comment}”</p>}
                    </div>
                ) : inThisMatch ? (
                    <p className="mv-note mv-note--pad">
                        You're in this match, so you can't score it. The room decides this one.
                    </p>
                ) : !signedIn ? (
                    <>
                        <p className="mv-note mv-note--pad">
                            Voting is open. You need an account to score this match.
                        </p>
                        <div className="dbt-popup-actions">
                            <a href="/signup">Sign up to vote</a>
                            <a href="/login">Log in</a>
                        </div>
                    </>
                ) : !criteria.length ? (
                    <p className="mv-note mv-note--pad">
                        This debate has no judging criteria published, so there is nothing to
                        score yet.
                    </p>
                ) : (
                    <>
                        <p className="mv-lede">
                            {isTyped ? (
                                <>
                                    Pick who won, then say why on the criteria this debate
                                    published. Scoring the other one is optional.
                                </>
                            ) : (
                                <>
                                    Score both of them 1–5 on every criterion. The winner is
                                    whatever your scores add up to — each criterion counts for
                                    the share the debate published.
                                </>
                            )}
                        </p>

                        {/* STEP ONE, and until it is answered there is nothing to
                            score: the rubric below is about the person you picked. */}
                        {isTyped && (
                            <div className="mv-pick">
                                <span className="dbt-label">who won?</span>
                                <div className="mv-pick-row">
                                    {seats.map((s) => (
                                        <button
                                            key={s.contestant_id}
                                            type="button"
                                            className={`mv-pick-card${
                                                pick === s.contestant_id ? ' is-picked' : ''
                                            }`}
                                            onClick={() => {
                                                setPick(s.contestant_id)
                                                // Changing your mind must not
                                                // silently keep the other person
                                                // marked "also rated".
                                                setRateOther(false)
                                            }}
                                        >
                                            <Face contestant={s} size={40} />
                                            <strong>{displayName(s)}</strong>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(!isTyped || pick) && (
                        <div className="mv-grid">
                            <div
                                className={`mv-grid-head${
                                    isTyped && !rateOther ? ' is-single' : ''
                                }`}
                            >
                                <span className="dbt-label">criterion</span>
                                {shownSeats.map((s) => (
                                    <span key={s.contestant_id} className="dbt-label">
                                        {firstName(s)}
                                    </span>
                                ))}
                            </div>

                            {criteria.map((c) => (
                                <div
                                    className={`mv-crit${
                                        isTyped && !rateOther ? ' is-single' : ''
                                    }`}
                                    key={c.criterion_id}
                                >
                                    <div className="mv-crit-id">
                                        <strong>{c.display_name}</strong>
                                        <span className="mv-crit-weight">
                                            {Math.round(Number(c.weight) * 100)}%
                                        </span>
                                        <p>{c.description}</p>
                                    </div>
                                    {shownSeats.map((s) => (
                                        <div key={s.contestant_id} className="mv-scale">
                                            {/* The name repeats on every row on
                                                purpose: on a phone these stack,
                                                and a bare row of 1–5s with the
                                                header scrolled away is a ballot
                                                you can fill in for the wrong
                                                person. */}
                                            <span className="mv-scale-who">{firstName(s)}</span>
                                            <div
                                                className="mv-scale-btns"
                                                role="radiogroup"
                                                aria-label={`${c.display_name} — ${displayName(s)}`}
                                            >
                                                {SCORES.map((n) => {
                                                    const on =
                                                        scores[s.contestant_id]?.[c.criterion_id] === n
                                                    return (
                                                        <button
                                                            key={n}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={on}
                                                            className={`mv-score ${on ? 'is-on' : ''}`}
                                                            onClick={() =>
                                                                setScore(
                                                                    s.contestant_id,
                                                                    c.criterion_id,
                                                                    n
                                                                )
                                                            }
                                                        >
                                                            {n}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                        )}

                        {/* The person you did not pick. Optional, and OPT-IN:
                            rendering ten more sliders unasked is how a two-click
                            ballot becomes one nobody finishes. All-or-nothing, so
                            a half-filled column cannot drag an average down on the
                            criteria a voter skipped rather than the ones they
                            thought were weak. */}
                        {isTyped && pick && !rateOther && (
                            <button
                                type="button"
                                className="mv-rate-other"
                                onClick={() => setRateOther(true)}
                            >
                                + Also score {firstName(other)} <span>optional</span>
                            </button>
                        )}
                        {isTyped && pick && rateOther && (
                            <p className="mv-note mv-note--pad">
                                Scoring {firstName(other)} too — leave them blank and press
                                skip if you would rather not.
                                <button
                                    type="button"
                                    className="mv-skip"
                                    onClick={() => {
                                        setRateOther(false)
                                        // Blank them out, or a half-finished
                                        // column would block the submit the skip
                                        // was supposed to unblock.
                                        setScores((prev) => ({ ...prev, [other.contestant_id]: {} }))
                                    }}
                                >
                                    skip
                                </button>
                            </p>
                        )}

                        <label className="mv-field">
                            <span className="dbt-label">why (optional)</span>
                            <textarea
                                className="mv-textarea"
                                rows={3}
                                maxLength={MAX_COMMENT}
                                placeholder="One line on what decided it for you."
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                            />
                            <span className="mv-count">{comment.length}/{MAX_COMMENT}</span>
                        </label>

                        {/* What the scores currently say, before they are sent.
                            Shown only once the ballot is complete — a running
                            leader from a half-filled ballot would be noise. */}
                        {complete && !isTyped && (
                            <p className="mv-preview">
                                {leader === 'draw'
                                    ? 'Your scores have them level — that submits as a draw.'
                                    : `Your scores give it to ${firstName(leader)} (${totals[
                                          leader.contestant_id
                                      ].toFixed(2)} to ${Math.min(
                                          ...seats
                                              .filter((s) => s.contestant_id !== leader.contestant_id)
                                              .map((s) => totals[s.contestant_id])
                                      ).toFixed(2)}).`}
                            </p>
                        )}

                        {error && <p className="dbt-error" role="alert">{error}</p>}

                        <div className="dbt-modal-foot">
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--outline"
                                onClick={onClose}
                            >
                                Not now
                            </button>
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--gold"
                                onClick={submit}
                                disabled={!complete || busy}
                            >
                                {busy
                                    ? 'Submitting…'
                                    : complete
                                      ? isTyped
                                        ? `Submit — ${firstName(seats.find((s) => s.contestant_id === pick))} won`
                                        : 'Submit ballot'
                                      : isTyped
                                        ? pick
                                          ? `${pickFilled}/${criteria.length} scored`
                                          : 'Pick a winner'
                                        : `${filled}/${needed} scored`}
                            </button>
                        </div>
                    </>
                )}

                {/* ---- the host's own controls, below everyone else's ballot --- */}
                {isHost && (
                    <div className="mv-hostbar">
                        <span className="dbt-label">host controls</span>
                        {shownTally && (
                            <p className="mv-note">
                                {shownTally.total_ballots} ballot
                                {shownTally.total_ballots === 1 ? '' : 's'} in
                                {shownTally.counts?.length
                                    ? ` — ${shownTally.counts
                                          .map((row) => {
                                              const who = seats.find(
                                                  (s) => s.contestant_id === row.contestant_id
                                              )
                                              return `${firstName(who)} ${row.votes}`
                                          })
                                          .join(', ')}`
                                    : ''}
                            </p>
                        )}
                        {!isClosed ? (
                            <button
                                type="button"
                                className="dbt-btn dbt-btn--gold"
                                onClick={() => closeVoting()}
                                disabled={busy}
                            >
                                {busy ? 'Closing…' : 'Close the vote & advance the winner'}
                            </button>
                        ) : !shownMatch.winner_contestant_id ? (
                            <>
                                <p className="mv-note">
                                    It's tied. Nobody advances until you call it.
                                </p>
                                <div className="mv-tiebreak">
                                    {seats.map((s) => (
                                        <button
                                            key={s.contestant_id}
                                            type="button"
                                            className="dbt-btn dbt-btn--outline"
                                            onClick={() => breakTie(s.contestant_id)}
                                            disabled={busy}
                                        >
                                            {firstName(s)} won
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="mv-note">
                                Closed.{' '}
                                {displayName(
                                    seats.find(
                                        (s) => s.contestant_id === shownMatch.winner_contestant_id
                                    )
                                )}{' '}
                                advances.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export default MatchVoteModal
