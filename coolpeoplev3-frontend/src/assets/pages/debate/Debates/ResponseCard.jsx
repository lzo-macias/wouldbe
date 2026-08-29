import { useCallback, useEffect, useState } from 'react'
import api from '../../../lib/api'
import './ResponseThread.css'

// ============================================================================
// ResponseCard — one contestant's written answer, and the conversation under it.
//
// Used in two places on purpose: the match screen (both answers side by side)
// and the most-engaged feed (one answer, out of context). That is why it takes a
// whole response object and asks for nothing about its surroundings.
//
// THREADING IS ONE LEVEL. The API stores a reply-to-a-reply against the same
// parent, so a thread can never grow a third indent nobody can read on a phone.
// The first two replies come down with the comment and the rest arrive on
// "see more replies" — a conversation that isn't being read shouldn't cost a
// query, and one that is should not cost a query per comment.
//
// ENGAGEMENT IS RECORDED, NOT COUNTED HERE. Clicking the author's face or name
// POSTs one profile_click, which the server dedupes to one per person per day —
// so this can fire on every click without inflating anything, and a failed
// metric never blocks the navigation it was measuring.
// ============================================================================

const fullName = (u) =>
    [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || 'Someone'

const initial = (u) => fullName(u).charAt(0)

const when = (iso) => {
    if (!iso) return ''
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

// Avatar + name, together, because they are one target: both open the same
// person and both count as the same signal.
function Person({ user, size = 34, onOpen, sub }) {
    return (
        <button type="button" className="rt-person" onClick={onOpen} title={`Open ${fullName(user)}`}>
            {user?.profile_photo_url ? (
                <img className="rt-face" style={{ width: size, height: size }} src={user.profile_photo_url} alt="" />
            ) : (
                <span className="rt-face rt-face--blank" style={{ width: size, height: size }} aria-hidden="true">
                    {initial(user)}
                </span>
            )}
            <span className="rt-person-id">
                <strong>{fullName(user)}</strong>
                {sub && <span className="rt-sub">{sub}</span>}
            </span>
        </button>
    )
}

function Comment({ comment, onReply, onOpenPerson }) {
    const [replies, setReplies] = useState(comment.replies || [])
    const [more, setMore] = useState(comment.more_replies || 0)
    const [loading, setLoading] = useState(false)

    const seeMore = async () => {
        setLoading(true)
        try {
            // offset by what is already on screen, so pressing it twice on a long
            // thread doesn't re-fetch the two we started with.
            const { data } = await api.get(
                `/api/comments/${comment.id}/replies?offset=${replies.length}`
            )
            setReplies((prev) => [...prev, ...data])
            setMore(0)
        } catch {
            setMore(0)
        } finally {
            setLoading(false)
        }
    }

    return (
        <li className="rt-comment">
            <Person user={comment} size={28} onOpen={() => onOpenPerson(comment.author_user_id)} />
            <p className="rt-comment-body">{comment.body}</p>
            <div className="rt-comment-foot">
                <span>{when(comment.created_at)}</span>
                <button type="button" onClick={() => onReply(comment)}>Reply</button>
            </div>

            {!!replies.length && (
                <ul className="rt-replies">
                    {replies.map((r) => (
                        <li key={r.id}>
                            <Person user={r} size={24} onOpen={() => onOpenPerson(r.author_user_id)} />
                            <p className="rt-comment-body">{r.body}</p>
                            <span className="rt-comment-foot">{when(r.created_at)}</span>
                        </li>
                    ))}
                </ul>
            )}

            {more > 0 && (
                <button type="button" className="rt-more" onClick={seeMore} disabled={loading}>
                    {loading ? 'Loading…' : `See ${more} more repl${more === 1 ? 'y' : 'ies'}`}
                </button>
            )}
        </li>
    )
}

/**
 * @param {object} response  a row from the match thread or the top feed
 * @param {string} context   optional line above the answer (the prompt, the debate)
 * @param {boolean} openComments  start with the thread expanded
 */
function ResponseCard({ response, context = null, openComments = false }) {
    const [comments, setComments] = useState([])
    const [total, setTotal] = useState(response.comment_count ?? 0)
    const [shown, setShown] = useState(openComments)
    const [draft, setDraft] = useState('')
    const [replyTo, setReplyTo] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [liked, setLiked] = useState(!!response.liked_by_me)
    const [likes, setLikes] = useState(Number(response.like_count) || 0)

    const signedIn = !!localStorage.getItem('token')

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(`/api/responses/${response.id}/comments`)
            setComments(data.comments || [])
            setTotal(data.total_top_level || 0)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load the comments')
        }
    }, [response.id])

    useEffect(() => {
        if (!shown) return
        let cancelled = false
        ;(async () => { if (!cancelled) await load() })()
        return () => { cancelled = true }
    }, [shown, load])

    // One click = one recorded signal, deduped server-side to one per person per
    // day. Deliberately not awaited: the metric must never be in the way of the
    // thing it is measuring.
    const openPerson = (userId) => {
        api.post(`/api/responses/${response.id}/engage`, { kind: 'profile_click' }).catch(() => {})
        if (userId) window.location.assign(`/wouldbe/${userId}`)
    }

    const like = async () => {
        if (!signedIn) return setError('Sign in to like this.')
        // Optimistic: the count is the one thing that must feel instant.
        setLiked((v) => !v)
        setLikes((n) => n + (liked ? -1 : 1))
        try {
            const { data } = await api.post(`/api/responses/${response.id}/like`)
            setLiked(data.liked)
            setLikes(data.like_count)
        } catch (err) {
            setLiked((v) => !v)
            setLikes((n) => n + (liked ? 1 : -1))
            setError(err.response?.data?.error || 'Could not register that')
        }
    }

    const submit = async () => {
        if (!draft.trim()) return
        setBusy(true)
        setError(null)
        try {
            await api.post(`/api/responses/${response.id}/comments`, {
                body: draft.trim(),
                parent_comment_id: replyTo?.id ?? null,
            })
            setDraft('')
            setReplyTo(null)
            await load()
        } catch (err) {
            setError(err.response?.data?.error || 'Could not post that')
        } finally {
            setBusy(false)
        }
    }

    return (
        <article className="rt-card">
            {context && <p className="rt-context">{context}</p>}

            <header className="rt-card-head">
                <Person
                    user={response}
                    onOpen={() => openPerson(response.user_id)}
                    sub={when(response.submitted_at)}
                />
                {response.only_you && <span className="rt-sealed">Only you can see this yet</span>}
            </header>

            <p className="rt-body">{response.body}</p>

            <footer className="rt-card-foot">
                <button type="button" className={`rt-like${liked ? ' is-on' : ''}`} onClick={like}>
                    ♥ {likes}
                </button>
                <button type="button" className="rt-toggle" onClick={() => setShown((v) => !v)}>
                    {shown ? 'Hide' : `${total} comment${total === 1 ? '' : 's'}`}
                </button>
            </footer>

            {shown && (
                <div className="rt-thread">
                    {signedIn ? (
                        <div className="rt-composer">
                            {replyTo && (
                                <p className="rt-replying">
                                    Replying to <strong>{fullName(replyTo)}</strong>
                                    <button type="button" onClick={() => setReplyTo(null)}>cancel</button>
                                </p>
                            )}
                            <textarea
                                value={draft}
                                maxLength={4000}
                                placeholder="Say what you think of this answer."
                                onChange={(e) => setDraft(e.target.value)}
                            />
                            <button type="button" onClick={submit} disabled={busy || !draft.trim()}>
                                {busy ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
                            </button>
                        </div>
                    ) : (
                        <p className="rt-signin">
                            <a href="/login">Log in</a> to join the conversation.
                        </p>
                    )}

                    {error && <p className="rt-error" role="alert">{error}</p>}

                    <ul className="rt-comments">
                        {comments.map((c) => (
                            <Comment
                                key={c.id}
                                comment={c}
                                onReply={setReplyTo}
                                onOpenPerson={openPerson}
                            />
                        ))}
                        {!comments.length && <li className="rt-empty">No comments yet.</li>}
                    </ul>
                </div>
            )}
        </article>
    )
}

// Only the component is exported. Exporting the helpers alongside it breaks
// React Fast Refresh (a module has to export components and nothing else), and
// the one consumer that wanted them was better off asking for a card.
export default ResponseCard
