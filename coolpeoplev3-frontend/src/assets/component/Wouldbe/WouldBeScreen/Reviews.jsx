import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../../lib/api'
import { Stars, StarInput } from './StarRating'
import './Reviews.css'

/**
 * Reviews — the summary, then the feed.
 *
 * THE SHAPE: a summary block (average, the distribution, one call to action),
 * the composer only once it is asked for, then the reviews themselves. The
 * previous version led with a profile card repeating the candidate's face, name,
 * age, state and college — all of which the page already says twice above this
 * section, in the hero and in the funding rail. A section about what OTHER
 * people said should not open with another portrait of the subject, so that card
 * and its extra GET /api/users/:id are gone.
 *
 * COLOUR: gold is the RATING now — stars and the distribution bars. That is the
 * swap the gold system calls for: gold has to carry meaning, and a star is the
 * one graphic on this page that is nothing but meaning. (It used to be green,
 * with gold reserved for actions; the buttons still wear the plate, so the two
 * are told apart by shape rather than hue.)
 *
 * WHO IS BEING REVIEWED: `profileUserId`, the WouldBe's OWNER — not the viewer.
 * Every request is keyed to it; posting to the viewer's own id is a self-review,
 * which the API rejects with a 400 by CHECK constraint.
 *
 * ENDPOINTS
 *   GET    /api/users/:id/reviews     -> { average_rating, review_count,
 *                                          five_star…one_star, reviews[], my_review }
 *   POST   /api/users/:id/reviews     -> { rating, body }; UPSERT, one per pair
 *   DELETE /api/reviews/:id           -> author withdraws their own
 *   POST   /api/reviews/:id/report    -> { report_category, description }
 *
 * @param {string} profileUserId  the user being reviewed (wouldbe.user_id)
 * @param {object} viewer         the logged-in user, for "posted as" + my_review
 * @param {object} reviews        the summary AnyWouldBe already fetched, used as
 *                                seed data so the section paints before our load
 */

// Must match REPORT_CATEGORIES in API/platform/reviewsRoutes.js — the route
// 400s on anything outside this list.
const REPORT_CATEGORIES = [
  ['harassment', 'Harassment'],
  ['hate_speech', 'Hate speech'],
  ['threats', 'Threats'],
  ['impersonation', 'Impersonation'],
  ['spam', 'Spam'],
  ['doxxing', 'Doxxing'],
  ['election_misinformation', 'Election misinformation'],
  ['other', 'Something else'],
]

// The API caps a review body at 5000 characters. Enforced here too so a long
// write is stopped at the keystroke rather than thrown away by a 400 on submit.
const MAX_BODY = 5000

// The word for a rating, so a 4 isn't left ambiguous next to the stars.
const WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Outstanding']
const ratingWord = (n) => WORDS[n] ?? ''

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const wks = Math.round(days / 7)
  if (wks < 5) return `${wks} week${wks === 1 ? '' : 's'} ago`
  // `dateStyle` cannot be combined with the individual date fields, and it
  // throws rather than ignoring the conflict — see DebateHeadline.
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

// Deterministic avatar tint for people with no photo, so the same person is the
// same colour on every render, and all four sit in the gold family — an avatar
// is identity, and identity should not read as a rating.
const TINTS = ['#a87a1e', '#8e6716', '#c9a94e', '#b4842a']
const tintFor = (name = '') =>
  TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length]

const displayName = (r) =>
  [r.reviewer_first_name, r.reviewer_last_name].filter(Boolean).join(' ') ||
  r.reviewer_username ||
  'Someone'

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */

// The distribution is the reason this block exists. An average alone cannot tell
// four 5s from a 5 and a 3.5 average made of 1s and 5s — the bars can, at a
// glance, and they are the one place a reader learns whether the number is
// consensus or an argument.
function Summary({ summary, children }) {
  const rated = summary.total > 0 && summary.avg != null

  return (
    <div className="wb-rev-summary">
      <div className="wb-rev-score">
        {/* An em dash, not 0.0 — average_rating is null (not 0) when nobody has
            reviewed, and a zero-star score is a claim we have not earned. */}
        <div className="wb-rev-score__n">{rated ? Number(summary.avg).toFixed(1) : '—'}</div>
        <Stars value={rated ? summary.avg : null} size={17} />
        <div className="wb-rev-score__c">
          {summary.total} review{summary.total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="wb-rev-dist">
        {[5, 4, 3, 2, 1].map((s) => (
          <div className="wb-rev-row" key={s}>
            <span className="wb-rev-row__s">{s}</span>
            <span className="wb-rev-bar">
              <i style={{ width: summary.total ? `${(summary.counts[s] / summary.total) * 100}%` : 0 }} />
            </span>
            <span className="wb-rev-row__n">{summary.counts[s]}</span>
          </div>
        ))}
      </div>

      <div className="wb-rev-act">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

/**
 * The composer OWNS its draft. It is keyed by the caller's review id in the
 * parent (`myReview?.id ?? 'new'`), so React remounts it with fresh initial
 * values whenever that identity changes — posting a first review, or deleting
 * one. That is deliberately NOT an effect syncing props into state: a refetch
 * fires on every submit, and an effect would overwrite whatever the user had
 * typed since. A key resets the draft exactly when the underlying review
 * changes, and never while they are mid-sentence.
 *
 * onSubmit must THROW on failure — that is how the inline error appears here
 * while the parent still owns the optimistic card and the refetch.
 */
function ReviewComposer({
  composerRef, viewerName, editing, initialRating = 0, initialText = '',
  minLength, onSubmit, onCancel,
}) {
  const [rating, setRating] = useState(initialRating)
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const len = text.trim().length
  const ready = rating > 0 && len >= minLength && len <= MAX_BODY && !busy

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ rating, body: text.trim() })
    } catch (err) {
      setError(err?.response?.data?.error || 'That did not post. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rvComposer" ref={composerRef}>
      <div className="rvComposerHead">
        <h3>{editing ? 'Edit your review' : 'Leave a review'}</h3>
        <p>
          {editing
            ? 'You have already reviewed this person. Saving replaces what you wrote — it does not add a second review.'
            : 'Reviews help people decide who to back. Be specific about what you saw.'}
        </p>
      </div>

      <div className="rvField">
        <div className="rvFieldHead">
          <span id="rvRatingLabel" className="rvFieldLabel">Your rating</span>
          <span className="rvFieldWord">{rating ? ratingWord(rating) : 'Tap a star'}</span>
        </div>
        <StarInput value={rating} onChange={setRating} labelledBy="rvRatingLabel" />
      </div>

      <div className="rvField">
        <div className="rvFieldHead">
          <label className="rvFieldLabel" htmlFor="rvReviewBody">Your review</label>
          <span className={`rvCounter ${len < minLength ? 'rvCounterShort' : ''}`}>
            {len < minLength ? `${len} / ${minLength} minimum` : `${len} characters`}
          </span>
        </div>
        <textarea
          id="rvReviewBody"
          className="rvTextarea"
          value={text}
          maxLength={MAX_BODY}
          onChange={(e) => setText(e.target.value)}
          placeholder="What stood out? How did they handle questions, follow through, or respond under pressure?"
        />
      </div>

      {error && <p className="rvError">{error}</p>}

      <div className="rvComposerFoot">
        <span className="rvPostedAs">
          Posted as <strong>{viewerName}</strong>. Reviews are public and tied to your account.
        </span>
        <button type="button" className="wb-btn wb-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="wb-btn wb-btn--primary" onClick={submit} disabled={!ready}>
          {busy ? 'Posting…' : editing ? 'Update review' : 'Post review'}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* one review                                                          */
/* ------------------------------------------------------------------ */

function ReviewCard({ review, isMine, onEdit, onDelete, onReport }) {
  const [reporting, setReporting] = useState(false)
  const [category, setCategory] = useState('other')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const name = displayName(review)
  const moderated = isMine && review.status && review.status !== 'visible'

  const submitReport = async () => {
    setBusy(true)
    setNote(null)
    try {
      await onReport(review.id, { report_category: category, description: why.trim() })
      setReporting(false)
      setWhy('')
      setNote({ ok: true, text: 'Reported. A moderator will take a look.' })
    } catch (err) {
      setNote({ ok: false, text: err?.response?.data?.error || 'That report did not send. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`wb-review${review.isPending ? ' is-pending' : ''}`}>
      <div className="wb-review__head">
        {review.reviewer_photo_url ? (
          <img className="wb-review__av" src={review.reviewer_photo_url} alt="" />
        ) : (
          <span
            className="wb-review__av wb-review__av--fallback"
            style={{ background: tintFor(name) }}
            aria-hidden="true"
          >
            {name.charAt(0)}
          </span>
        )}

        <span className="wb-review__who">
          <span className="wb-review__name">
            {name}
            {isMine && <span className="wb-badge wb-badge--wash">Your review</span>}
            {/* The author of a moderated review still sees it, with the reason —
                the API returns it in my_review rather than letting it vanish. */}
            {moderated && (
              <span className="wb-badge wb-badge--outline">
                {review.status === 'removed' ? 'Removed' : 'Under review'}
              </span>
            )}
          </span>
          <span className="wb-review__meta">
            {relativeTime(review.created_at)}
            {review.edited_at && ' · edited'}
          </span>
        </span>

        <Stars value={review.rating} size={15} />
      </div>

      <p className="wb-review__b">{review.body}</p>

      {!review.isPending && (
        <div className="wb-review__act">
          {isMine ? (
            <>
              <button type="button" className="rvLinkButton" onClick={onEdit}>Edit</button>
              <button
                type="button"
                className="rvLinkButton rvLinkDanger"
                onClick={() => onDelete(review.id)}
              >
                Delete
              </button>
            </>
          ) : (
            <button type="button" className="rvLinkButton" onClick={() => setReporting((r) => !r)}>
              {reporting ? 'Cancel' : 'Report'}
            </button>
          )}
        </div>
      )}

      {/* The report endpoint requires BOTH a category and a written reason, so
          the button opens a form rather than firing a bare POST that would 400. */}
      {reporting && (
        <div className="rvReport">
          <label className="rvFieldLabel" htmlFor={`rvCat-${review.id}`}>
            Why should this come down?
          </label>
          <select
            id={`rvCat-${review.id}`}
            className="rvSelect"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {REPORT_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <textarea
            className="rvTextarea rvTextareaSmall"
            value={why}
            maxLength={5000}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Tell a moderator what's wrong with this review."
          />
          <button
            type="button"
            className="wb-btn wb-btn--primary rvPostSmall"
            onClick={submitReport}
            disabled={busy || !why.trim()}
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      )}

      {note && <p className={note.ok ? 'rvNoteOk' : 'rvError'}>{note.text}</p>}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

function Reviews({ profileUserId, viewer, reviews: seed, minLength = 40 }) {
  // Read once in the initializer rather than in an effect: localStorage is
  // synchronous, so an effect would render the signed-out state for one frame
  // and flash the "Sign in" gate at a signed-in user.
  const [meId] = useState(() => localStorage.getItem('userId'))
  const [data, setData] = useState(seed ?? null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [pending, setPending] = useState(null)   // optimistic card, cleared on refetch
  const [toast, setToast] = useState(null)
  const [composing, setComposing] = useState(false)

  const composerRef = useRef(null)
  const toastTimer = useRef(null)

  // Clear on unmount so a navigation mid-toast can't setState on a dead component.
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const flash = useCallback((text) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const loadReviews = useCallback(async () => {
    const res = await api.get(`/api/users/${profileUserId}/reviews?limit=50`)
    setData(res.data)
    return res.data
  }, [profileUserId])

  // The `reviews` prop is only a SEED: AnyWouldBe fetches it with `?limit=5` for
  // the card, so its `reviews[]` is the five newest, not the feed. The counts on
  // it ARE whole-table (getReviewSummary ignores limit), so the summary is
  // correct from the first paint while the full list arrives.
  useEffect(() => {
    if (!profileUserId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/api/users/${profileUserId}/reviews?limit=50`)
        if (cancelled) return
        setData(res.data)
        setLoadError(null)
      } catch (err) {
        console.error('[Reviews] load failed', err)
        if (!cancelled) setLoadError("We couldn't load reviews just now.")
      }
    })()
    return () => { cancelled = true }
  }, [profileUserId])

  const myReview = data?.my_review ?? null

  const summary = useMemo(() => ({
    counts: {
      5: data?.five_star ?? 0,
      4: data?.four_star ?? 0,
      3: data?.three_star ?? 0,
      2: data?.two_star ?? 0,
      1: data?.one_star ?? 0,
    },
    total: data?.review_count ?? 0,
    // null, not 0, when nothing has been rated — see Summary.
    avg: data?.average_rating ?? null,
  }), [data])

  const list = useMemo(() => {
    const rows = data?.reviews ?? []

    // my_review is returned SEPARATELY from the public list, and is already in
    // it when visible. Merge only when it is missing — that is the hidden case,
    // where the author should still see their own review rather than have it
    // silently disappear. getMyReviewOf is a bare SELECT *, so it carries no
    // reviewer identity columns; fill them from the viewer, who IS the author.
    let merged = rows
    if (myReview && !rows.some((r) => r.id === myReview.id)) {
      merged = [{
        ...myReview,
        reviewer_username: viewer?.username,
        reviewer_first_name: viewer?.first_name,
        reviewer_last_name: viewer?.last_name,
        reviewer_photo_url: viewer?.profile_photo_url,
      }, ...rows]
    }

    // While a submit is in flight, drop the caller's existing row: the upsert
    // will replace it, and showing both would flash a duplicate.
    if (pending) return [pending, ...merged.filter((r) => r.reviewer_user_id !== meId)]
    return merged
  }, [data, myReview, pending, meId, viewer])

  const isSelf = !!meId && meId === profileUserId

  // POST is an UPSERT — one review per (reviewer, reviewed) pair, DB-enforced —
  // so a second submit REPLACES rather than stacking. That is why the composer is
  // the edit form too, and why the button reads "Update review" once you have one.
  //
  // Throws on failure so the composer can surface the message inline.
  async function handleSubmit({ rating, body }) {
    setActionError(null)

    const optimistic = {
      id: `pending-${rating}-${body.length}`,
      reviewer_user_id: meId,
      reviewer_first_name: viewer?.first_name,
      reviewer_last_name: viewer?.last_name,
      reviewer_username: viewer?.username,
      reviewer_photo_url: viewer?.profile_photo_url,
      rating,
      body,
      created_at: new Date().toISOString(),
      isPending: true,
    }
    setPending(optimistic)

    try {
      await api.post(`/api/users/${profileUserId}/reviews`, { rating, body })
      // Refetch rather than splice in the response: the average, the count and
      // the distribution bars are all server-computed over visible rows, and
      // guessing them here would drift from what the next load shows.
      await loadReviews()
      flash(myReview ? 'Review updated.' : 'Review posted.')
      setComposing(false)
    } catch (err) {
      console.error('[Reviews] submit failed', err)
      throw err
    } finally {
      setPending(null)   // rollback on failure; on success the refetch supersedes it
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete your review? This cannot be undone.')) return
    try {
      await api.delete(`/api/reviews/${id}`)
      setActionError(null)
      // my_review goes null, which flips the composer's key back to 'new' and
      // remounts it empty — no manual field clearing needed.
      await loadReviews()
      setComposing(false)
      flash('Your review was deleted.')
    } catch (err) {
      console.error('[Reviews] delete failed', err)
      setActionError(err?.response?.data?.error || 'That did not delete. Try again.')
    }
  }

  const handleReport = useCallback(
    (id, payload) => api.post(`/api/reviews/${id}/report`, payload),
    []
  )

  // Opening the composer and scrolling to it are one action: a form that appears
  // off-screen has not been opened as far as the person who clicked is concerned.
  const openComposer = () => {
    setComposing(true)
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      composerRef.current?.querySelector('#rvReviewBody')?.focus()
    })
  }

  const viewerName =
    [viewer?.first_name, viewer?.last_name].filter(Boolean).join(' ') || viewer?.username || 'you'

  if (!profileUserId) return null

  return (
    <div className="wb-reviews">
      {/* Three states for the call to action, not two. A self-review is blocked
          by a CHECK constraint AND by the route, so offering the form on your own
          profile would only ever earn a 400. */}
      <Summary summary={summary}>
        {!meId ? (
          <>
            <Link className="wb-btn wb-btn--primary" to="/login">Sign in to review</Link>
            <p className="wb-rev-note">Reviews are public and tied to your account.</p>
          </>
        ) : isSelf ? (
          <p className="wb-rev-note">
            This is your profile — you can&apos;t review yourself.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="wb-btn wb-btn--primary"
              onClick={openComposer}
              disabled={composing}
            >
              {myReview ? 'Edit your review' : 'Write a review'}
            </button>
            <p className="wb-rev-note">Reviews are public and tied to your account.</p>
          </>
        )}
      </Summary>

      {(loadError || actionError) && <p className="rvError">{loadError || actionError}</p>}

      {toast && (
        <div role="status" className="rvToast">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 10.5 8 14.5 16 6" />
          </svg>
          {toast}
        </div>
      )}

      {composing && !isSelf && meId && (
        <ReviewComposer
          /* Remounts with fresh initial values when the caller's review identity
             changes — first post, or delete. See ReviewComposer. */
          key={myReview?.id ?? 'new'}
          composerRef={composerRef}
          viewerName={viewerName}
          editing={!!myReview}
          initialRating={myReview?.rating ?? 0}
          initialText={myReview?.body ?? ''}
          minLength={minLength}
          onSubmit={handleSubmit}
          onCancel={() => setComposing(false)}
        />
      )}

      {list.length === 0 ? (
        <div className="wb-empty">
          <span className="wb-empty__t">No reviews yet</span>
          {meId && !isSelf
            ? 'Be the first. What did you see them do?'
            : 'Backers and people who watched a debate can leave one.'}
        </div>
      ) : (
        <ul className="wb-rev-list">
          {list.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              isMine={r.reviewer_user_id === meId}
              onEdit={openComposer}
              onDelete={handleDelete}
              onReport={handleReport}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default Reviews
