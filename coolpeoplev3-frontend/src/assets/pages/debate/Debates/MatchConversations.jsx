import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../../lib/api'
import ArrowPaywall from './ArrowPaywall'
import './MatchConversations.css'

// ============================================================================
// MatchConversations — a typed debate read the way a messaging app is read.
//
// Every match is a CONVERSATION: the prompt is its subject line, the two answers
// are the two messages in it. Sidebar on the left (who is in it, what it is
// about), the thread on the right, and a vote strip above that grows as you open
// things.
//
// NOBODY LEAVES THIS SCREEN. "Read & comment" used to be a link to a separate
// comments page, which threw away the sidebar, the prompt and the reader's place
// in a seven-match debate to show them one answer they were already looking at.
// It expands in place instead: the comments, their replies, and the like count
// arrive under the message.
//
// THE FOOT IS THE COMPOSER, and it is addressed. Only the two contestants may
// write ANSWERS here — that has not changed — but everyone may comment, and a
// chat app puts the box for that at the bottom. It names whose answer it is
// about, because with two messages on screen an unlabelled box is a coin flip.
// One message is expanded at a time for the same reason: the composer has to be
// unambiguous about where the words are going.
//
// THE PANE OPENS AT THE MIDDLE. Two long answers do not fit on a screen, and
// starting at the top silently declares the first one the important one. Landing
// at the centre point puts the seam between them on screen and lets the reader
// scroll either way — which is also how you read an argument.
//
// THE BALLOTS GO UPWARDS, not on this surface. Opening a conversation makes its
// match votable (a released typed match opens its own ballot — there is no host
// in the room to press a button) and reports it to the page, which shows it in
// the vote panel between the title and the bracket. A vote button inside a
// message thread would invite a verdict from someone who has read one answer.
// ============================================================================

const fullName = (p) =>
    [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.username || 'Someone'

const initial = (p) => fullName(p).charAt(0)

const shortTime = (iso) =>
    iso
        ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso))
        : ''

const roundLabel = (c) =>
    c.side === 'final'
        ? 'Final'
        : `R${c.round + 1} · ${c.side === 'left' ? 'L' : 'R'}${c.position + 1}`

const when = (iso) => {
    if (!iso) return ''
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

function Face({ person, size = 30, stacked = false }) {
    return person?.profile_photo_url ? (
        <img
            className={`mc-face${stacked ? ' is-stacked' : ''}`}
            style={{ width: size, height: size }}
            src={person.profile_photo_url}
            alt=""
        />
    ) : (
        <span
            className={`mc-face mc-face--blank${stacked ? ' is-stacked' : ''}`}
            style={{ width: size, height: size }}
            aria-hidden="true"
        >
            {initial(person)}
        </span>
    )
}

// One comment and the first two replies to it. THREADING IS ONE LEVEL — the API
// files a reply-to-a-reply against the same parent, so this cannot grow a third
// indent. The rest of a thread is fetched on demand: a conversation nobody is
// reading should not cost a query, and one that is should not cost a query per
// comment.
function Comment({ comment, onReply }) {
    const [replies, setReplies] = useState(comment.replies || [])
    const [more, setMore] = useState(comment.more_replies || 0)
    const [loading, setLoading] = useState(false)

    const seeMore = async () => {
        setLoading(true)
        try {
            // Offset by what is already on screen, so pressing it twice does not
            // re-fetch the two we started with.
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
        <li className="mc-comment">
            <Face person={comment} size={24} />
            <div className="mc-comment-main">
                <span className="mc-comment-who">
                    {fullName(comment)}
                    <em>{when(comment.created_at)}</em>
                </span>
                <p className="mc-comment-body">{comment.body}</p>
                <button type="button" className="mc-comment-reply" onClick={() => onReply(comment)}>
                    Reply
                </button>

                {!!replies.length && (
                    <ul className="mc-replies">
                        {replies.map((r) => (
                            <li key={r.id}>
                                <Face person={r} size={20} />
                                <div className="mc-comment-main">
                                    <span className="mc-comment-who">
                                        {fullName(r)}
                                        <em>{when(r.created_at)}</em>
                                    </span>
                                    <p className="mc-comment-body">{r.body}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                {more > 0 && (
                    <button type="button" className="mc-more" onClick={seeMore} disabled={loading}>
                        {loading ? 'Loading…' : `See ${more} more repl${more === 1 ? 'y' : 'ies'}`}
                    </button>
                )}
            </div>
        </li>
    )
}

// The sidebar row: both contestants, then whoever the match answers to — the
// host, or a judge on a panel-decided debate.
function ConversationRow({ convo, authority, active, onOpen }) {
    const [a, b] = convo.people
    const last = convo.people[convo.people.length - 1]

    return (
        <li>
            <button
                type="button"
                className={`mc-row${active ? ' is-active' : ''}`}
                onClick={() => onOpen(convo)}
            >
                <div className="mc-row-faces">
                    <Face person={a} />
                    <Face person={b} stacked />
                    {/* The authority sits apart from the pair, smaller: they are
                        not in the argument, they are over it. */}
                    {authority?.people?.[0] && (
                        <Face person={{ profile_photo_url: authority.people[0].photo_url, first_name: authority.people[0].name }} size={20} stacked />
                    )}
                </div>

                <div className="mc-row-text">
                    <div className="mc-row-top">
                        <span className="mc-row-title">
                            {convo.title || 'Sealed until the round opens'}
                        </span>
                        <span className="mc-row-when">{shortTime(convo.response_deadline)}</span>
                    </div>
                    <div className="mc-row-bottom">
                        <span className="mc-row-preview">
                            {convo.state === 'pending'
                                ? 'Not open yet'
                                : convo.state === 'open'
                                  ? `${convo.message_count} of 2 in — sealed`
                                  : last?.preview
                                    ? `${(last.first_name || '').trim()}: ${last.preview}`
                                    : 'No answers'}
                        </span>
                        <span className={`mc-row-tag is-${convo.state}`}>{roundLabel(convo)}</span>
                    </div>
                </div>
            </button>
        </li>
    )
}

function MatchConversations({ debate, onActive }) {
    const navigate = useNavigate()
    const debateId = debate?.id
    const [data, setData] = useState(null)
    const [active, setActive] = useState(null)      // the open conversation key
    const [thread, setThread] = useState(null)
    // The response whose comments are expanded. ONE AT A TIME: the composer in
    // the foot is addressed to it, and two open threads would leave "Commenting
    // on…" pointing at whichever was clicked least recently.
    const [openId, setOpenId] = useState(null)
    const [comments, setComments] = useState([])
    // The footer's count, seeded from the response and kept here for the same
    // reason as the likes. It counts EVERY comment including replies, which is
    // what the server's stored counter counts — `total_top_level` from the
    // comments endpoint is a different number, and showing that one while
    // expanded made the footer drop from "2 comments" to "1 comment" just for
    // opening it.
    const [counts, setCounts] = useState({})     // id -> number
    // Likes live here, not on the response row, because the row is replaced
    // wholesale every time the thread reloads and a like must not blink back.
    const [likes, setLikes] = useState({})          // id -> { liked, count }
    const [draft, setDraft] = useState('')
    const [replyTo, setReplyTo] = useState(null)
    const [posting, setPosting] = useState(false)
    const [error, setError] = useState(null)
    // The refusal from the server, held so the paywall can render the exact
    // numbers that refused rather than fetching a second opinion.
    const [paywall, setPaywall] = useState(null)
    const [myAnswer, setMyAnswer] = useState('')
    const [composing, setComposing] = useState(false)
    const paneRef = useRef(null)

    // Read once: localStorage is synchronous, so the first paint already knows
    // whether to offer the box or the sign-in line.
    const [signedIn] = useState(() => !!localStorage.getItem('token'))

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (cancelled || !debateId) return
            try {
                const { data } = await api.get(`/api/debates/${debateId}/conversations`)
                if (cancelled) return
                setData(data)
                // Open the newest thing worth reading: the latest RELEASED match,
                // because an app that opens on a sealed conversation shows a
                // reader nothing on arrival.
                const readable = [...data.conversations].reverse().find((c) => c.state === 'released')
                if (readable) {
                    setActive(readable.key)
                    onActive?.(readable.key)
                }
            } catch (err) {
                console.error('[MatchConversations] list failed', err)
            }
        })()
        return () => { cancelled = true }
    }, [debateId])

    const openConversation = useCallback(
        async (convo) => {
            setActive(convo.key)
            onActive?.(convo.key)
        },
        [onActive]
    )

    // The thread, plus the ballot that opening it creates.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            if (cancelled || !debateId || !active) return
            setThread(null)
            try {
                const { data: t } = await api.get(
                    `/api/debates/${debateId}/matches/${active}/thread`
                )
                if (cancelled) return
                setThread(t)
                // A new match is a new conversation: nothing stays expanded, and
                // a half-typed comment must not follow the reader to somebody
                // else's answer.
                setOpenId(null)
                setComments([])
                setReplyTo(null)
                setDraft('')
                setError(null)
                setLikes(
                    Object.fromEntries(
                        (t.responses || []).map((r) => [
                            r.id,
                            { liked: !!r.liked_by_me, count: Number(r.like_count) || 0 },
                        ])
                    )
                )
                setCounts(
                    Object.fromEntries(
                        (t.responses || []).map((r) => [r.id, Number(r.comment_count) || 0])
                    )
                )

                // Reading a released match is what OPENS its vote — the GET
                // creates the row when there isn't one. Fire and forget: the
                // panel above reads the full list for itself, so nothing here
                // has to hand it anything, and a ballot that fails to load must
                // not stop the reading.
                if (t.state === 'released') {
                    api.get(`/api/debates/${debateId}/matches/${active}/ballot`).catch(() => {})
                }
            } catch (err) {
                console.error('[MatchConversations] thread failed', err)
            }
        })()
        return () => { cancelled = true }
    }, [debateId, active])

    const loadComments = useCallback(async (responseId) => {
        try {
            const { data: c } = await api.get(`/api/responses/${responseId}/comments`)
            setComments(c.comments || [])
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load the comments')
        }
    }, [])

    // Expand in place. The `expand` signal is fire-and-forget and deduped
    // server-side to one per person per day, so it can fire on every click
    // without inflating anything — and a failed metric must never be in the way
    // of the thing it is measuring.
    const toggleComments = (r) => {
        setError(null)
        setReplyTo(null)
        if (openId === r.id) return setOpenId(null)
        setOpenId(r.id)
        setComments([])
        loadComments(r.id)
        api.post(`/api/responses/${r.id}/engage`, { kind: 'expand' }).catch(() => {})
    }

    const toggleLike = async (r) => {
        if (!signedIn) return setError('Sign in to like this answer.')
        const now = likes[r.id] || { liked: false, count: 0 }
        // Optimistic: the count is the one thing that has to feel instant.
        setLikes((m) => ({
            ...m,
            [r.id]: { liked: !now.liked, count: now.count + (now.liked ? -1 : 1) },
        }))
        try {
            const { data: res } = await api.post(`/api/responses/${r.id}/like`)
            setLikes((m) => ({ ...m, [r.id]: { liked: res.liked, count: res.like_count } }))
        } catch (err) {
            setLikes((m) => ({ ...m, [r.id]: now }))   // put it back
            setError(err.response?.data?.error || 'Could not register that')
        }
    }

    const postComment = async () => {
        if (!draft.trim() || !openId) return
        setPosting(true)
        setError(null)
        try {
            await api.post(`/api/responses/${openId}/comments`, {
                body: draft.trim(),
                parent_comment_id: replyTo?.id ?? null,
            })
            setDraft('')
            setReplyTo(null)
            // Refetch rather than splicing the new row in: replies, counts and
            // ordering are all the server's to decide, and a guess here would
            // disagree with the next load.
            await loadComments(openId)
            // A reply counts too — the server's counter increments for both.
            setCounts((m) => ({ ...m, [openId]: (m[openId] ?? 0) + 1 }))
        } catch (err) {
            setError(err.response?.data?.error || 'Could not post that')
        } finally {
            setPosting(false)
        }
    }

    // Land on the seam between the two answers, not the top. Runs after the
    // thread paints, so there is a height to measure.
    useEffect(() => {
        if (!thread || !paneRef.current) return
        const el = paneRef.current
        const id = requestAnimationFrame(() => {
            el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
        })
        return () => cancelAnimationFrame(id)
    }, [thread])

    if (!data?.conversations?.length) return null

    const activeConvo = data.conversations.find((c) => c.key === active)

    // ONE CARD, TWO LISTS. The two contestants and the outsiders below them
    // render through the same function — a second copy of a card carrying a like
    // button, a comment count and an expanding thread drifts out of step with
    // the first one inside a week.
    //
    // `outsider` changes only what the card says about itself. The controls are
    // identical because the affordances are: an outsider's answer is liked and
    // commented on exactly like a contestant's, and those likes are what can
    // promote it into the bracket.
    // The lowest like count among the two seats — the number an outsider has to
    // pass to take one. Derived here so the rail's caption and the card's
    // "backdoor" tag are reading the same figure.
    const lowestSeated = thread?.responses?.length
        ? Math.min(...thread.responses.map((r) => Number(r.like_count) || 0))
        : null

    // THE DOOR IS CHECKED BEFORE THE BOX OPENS, not after the answer is written.
    // The server refuses either way, but being told the price after composing is
    // the worst possible moment to learn it.
    // THE BUTTON IS NEVER DISABLED. A greyed-out control is a dead end that
    // explains nothing — it cannot say why, it cannot be tabbed to in some
    // browsers, and the reasons it would be grey (not signed in, not enough
    // standing, nobody has answered yet) are all things worth SAYING. So every
    // path from here ends in an explanation or a destination.
    const openCompose = async () => {
        setError(null)

        // SIGNED OUT GOES TO SIGN-IN. Adding a response needs an account before
        // it needs anything else, so the door is the account — showing somebody
        // a price for standing they cannot hold yet is a step out of order.
        // Sign-in rather than sign-up because most people pressing this already
        // have an account; the login page carries a link to sign up, so the
        // person who does not is one click away, while the person who does is
        // not sent to create a second one.
        // `from` is what sends them back to this match after signing in rather
        // than to the home page — a login they were pushed into should return
        // them to the thing they pressed.
        if (!signedIn) {
            return navigate('/login', { state: { from: `${window.location.pathname}${window.location.search}` } })
        }

        try {
            const { data } = await api.get('/api/me/may-respond', {
                params: { debate_id: debate?.id, prompt_id: thread?.prompt_id ?? thread?.id },
            })
            if (!data.allowed) return setPaywall(data)

            // The one refusal the server would give AFTER a composer is open, so
            // it is checked before one is: an outside answer cannot be the first
            // thing in a match.
            if (!thread?.responses?.length) {
                return setError(
                    'Nobody in this match has answered yet — you can add yours once they have.'
                )
            }
            setComposing(true)
        } catch (err) {
            setError(err.response?.data?.error || 'Could not check your standing.')
        }
    }

    const submitOpenResponse = async () => {
        const promptId = thread?.prompt_id ?? thread?.id
        if (!promptId) return setError('This match has no prompt to answer.')
        try {
            await api.post(`/api/debates/${debate?.id}/prompts/${promptId}/response`, {
                body: myAnswer,
            })
            setMyAnswer('')
            setComposing(false)
            // Re-read rather than splicing the new answer in locally: whether it
            // is even VISIBLE depends on the round's state and on whether the
            // author is in the match, and both of those are the server's call.
            const { data: t } = await api.get(
                `/api/debates/${debateId}/matches/${active}/thread`
            )
            setThread(t)
        } catch (err) {
            // A 403 here carries the gate, so the paywall renders the exact
            // numbers that refused rather than a second, possibly different read.
            if (err.response?.status === 403 && err.response?.data?.gate) {
                setPaywall(err.response.data.gate)
                setComposing(false)
            } else {
                setError(err.response?.data?.error || 'Could not post that.')
            }
        }
    }

    const renderResponse = (r, i, { outsider = false, backdoor = false } = {}) => {
        const open = openId === r.id
        const like = likes[r.id] || { liked: false, count: Number(r.like_count) || 0 }
        const count = counts[r.id] ?? (Number(r.comment_count) || 0)
        return (
                /* An <article>, not a <button>. The
                   foot now holds two controls and the
                   expansion holds more — a button
                   inside a button is invalid markup
                   and the browser resolves it by
                   dropping one of them. */
                <article
                    key={r.id}
                    className={`mc-msg${i % 2 ? ' is-them' : ''}${open ? ' is-open' : ''}` + `${outsider ? ' mc-msg--outsider' : ''}` + `${backdoor ? ' mc-msg--backdoor' : ''}`}
                >
                    <span className="mc-msg-who">
                        <Face person={r} size={22} />
                        {fullName(r)}
                    {outsider && (
                        <span className="mc-arrows" title={`${r.trophy_count ?? 0} standing arrows`}>
                            &#8593; {r.trophy_count ?? ''}
                        </span>
                    )}
                    {backdoor && <span className="mc-backdoor-tag">backdoor</span>}
                    </span>
                    <span className="mc-msg-body">{r.body}</span>

                    <span className="mc-msg-foot">
                        {/* The heart leads the row —
                            it is the one control here
                            that is a single click with
                            no consequence, so it sits
                            where the thumb already is
                            and reads its own count. */}
                        <button
                            type="button"
                            className={`mc-like${like.liked ? ' is-on' : ''}`}
                            onClick={() => toggleLike(r)}
                            aria-pressed={like.liked}
                            aria-label={like.liked ? 'Unlike this answer' : 'Like this answer'}
                        >
                            <span aria-hidden="true">♥</span> {like.count}
                        </button>
                        <span className="mc-msg-count">
                            {count} comment{count === 1 ? '' : 's'}
                        </span>
                        <button
                            type="button"
                            className="mc-msg-toggle"
                            onClick={() => toggleComments(r)}
                            aria-expanded={open}
                        >
                            {open ? 'hide comments' : 'read & comment →'}
                        </button>
                    </span>

                    {open && (
                        <div className="mc-thread">
                            {comments.length ? (
                                <ul className="mc-comments">
                                    {comments.map((c) => (
                                        <Comment
                                            key={c.id}
                                            comment={c}
                                            onReply={setReplyTo}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p className="mc-thread-empty">
                                    No comments yet. The box below is yours.
                                </p>
                            )}
                        </div>
                    )}
                </article>
        )
    }

    // A FOR-FUN DEBATE HAS ONE MATCH. The sidebar exists to choose between
    // several, so on a single-question debate it is a list of one — a column of
    // chrome taking a third of the width to offer no choice at all. The pane
    // fills the space instead.
    const isForFun = !!debate?.is_for_fun

    return (
        <div className={`mc${isForFun ? ' mc--solo' : ''}`}>
            <div className="mc-body">
                {/* ---- sidebar ---- */}
                {!isForFun && (
                <aside className="mc-side">
                    <div className="mc-side-head">
                        <h3>{data.debate_title}</h3>
                        <span>{data.conversations.length} matches</span>
                    </div>
                    <ul className="mc-list">
                        {data.conversations.map((c) => (
                            <ConversationRow
                                key={c.key}
                                convo={c}
                                authority={data.authority}
                                active={c.key === active}
                                onOpen={openConversation}
                            />
                        ))}
                    </ul>
                </aside>
                )}

                {/* ---- the thread ---- */}
                <section className="mc-pane">
                    {!activeConvo ? (
                        <p className="mc-empty">Pick a match to read it.</p>
                    ) : (
                        <>
                            <header className="mc-pane-head">
                                <div className="mc-pane-faces">
                                    {activeConvo.people.map((p) => (
                                        <Face key={p.user_id} person={p} size={28} stacked />
                                    ))}
                                </div>
                                <div>
                                    <span className="mc-pane-round">{roundLabel(activeConvo)}</span>
                                    {/* THE PROMPT IS THE HEADER. It is what both
                                        messages below are answering, so it stays
                                        on screen while they scroll. */}
                                    <p className="mc-pane-prompt">
                                        {activeConvo.title || 'This round has not opened yet.'}
                                    </p>
                                </div>
                            </header>

                            <div className="mc-messages" ref={paneRef}>
                                {thread?.responses?.length ? (
                                    <>
                                        {/* THE TWO CONTESTANTS FIRST, always.
                                            They are the match; everyone below is
                                            commentary on it, and the order is
                                            what says so. */}
                                        {thread.responses.map((r, i) => renderResponse(r, i))}

                                        {/* — MORE RESPONSES — the outsiders.
                                            Answers from people who are not in
                                            this match, written on a hundred
                                            standing arrows. Ordered by likes,
                                            because likes are what promote one of
                                            them INTO the bracket: the top one,
                                            once it passes a contestant's count,
                                            takes that seat. The rail is the
                                            standings for that, so it is captioned
                                            with the count it has to beat. */}
                                        {thread.open_responses?.length > 0 && (
                                            <>
                                                <div className="mc-more">
                                                    <span>more responses</span>
                                                    {lowestSeated != null && (
                                                        <small>
                                                            {lowestSeated} like{lowestSeated === 1 ? '' : 's'} takes a seat
                                                        </small>
                                                    )}
                                                </div>
                                                {thread.open_responses.map((r, i) =>
                                                    renderResponse(r, i, {
                                                        outsider: true,
                                                        backdoor: thread.backdoor_leader?.id === r.id,
                                                    })
                                                )}
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <p className="mc-empty">
                                        {activeConvo.state === 'open'
                                            ? 'Both answers stay sealed until the round closes.'
                                            : activeConvo.state === 'pending'
                                              ? 'This round has not opened yet.'
                                              : 'Nobody answered this one.'}
                                    </p>
                                )}
                            </div>

                            {/* Where a chat app puts its composer — and now it
                                is one. It writes COMMENTS, never answers: only
                                the two contestants may answer, which is why the
                                box only exists once a reader has opened somebody's
                                answer to comment on. */}
                            <footer className="mc-pane-foot">
                                {error && <p className="mc-foot-error" role="alert">{error}</p>}

                                {composing ? (
                                    <>
                                        {/* The compose box only appears once the
                                            door has been opened — the button
                                            below is what checks it, so nobody
                                            types six paragraphs and is refused
                                            at the end of them. */}
                                        <textarea
                                            className="mc-compose"
                                            value={myAnswer}
                                            onChange={(e) => setMyAnswer(e.target.value)}
                                            placeholder="Your answer to this prompt…"
                                            aria-label="Your response to this prompt"
                                        />
                                        <button
                                            type="button"
                                            disabled={!myAnswer.trim()}
                                            onClick={() => submitOpenResponse()}
                                        >
                                            Post it
                                        </button>
                                    </>
                                ) : !openId ? (
                                    /* ADDING YOURS — and nothing else.
                                       "Open comments" used to live here, which
                                       only ever opened the FIRST answer's thread:
                                       every card already carries its own
                                       "read & comment →", so the footer copy was
                                       a second, worse way to do the same thing
                                       with no way to say which answer you meant.

                                       NEVER DISABLED, and identical whether or
                                       not you are signed in. It was two branches
                                       rendering the same markup, which is a
                                       condition that can only ever drift; the
                                       difference belongs in what pressing it
                                       DOES, and that lives in openCompose. */
                                    <button
                                        type="button"
                                        className="mc-add-response"
                                        onClick={openCompose}
                                    >
                                        + Add your response
                                    </button>
                                ) : (
                                    <div className="mc-composer">
                                        {/* NAMED. With two answers on screen an
                                            unlabelled box is a coin flip. */}
                                        <span className="mc-composer-to">
                                            {replyTo ? (
                                                <>
                                                    Replying to <strong>{fullName(replyTo)}</strong>
                                                    <button type="button" onClick={() => setReplyTo(null)}>
                                                        cancel
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    Commenting on{' '}
                                                    <strong>
                                                        {fullName(
                                                            thread?.responses?.find((r) => r.id === openId)
                                                        )}
                                                    </strong>
                                                    ’s answer
                                                </>
                                            )}
                                        </span>
                                        <div className="mc-composer-row">
                                            <textarea
                                                value={draft}
                                                maxLength={4000}
                                                rows={1}
                                                placeholder={
                                                    replyTo
                                                        ? 'Write a reply…'
                                                        : 'Say what you think of this answer…'
                                                }
                                                onChange={(e) => setDraft(e.target.value)}
                                                onKeyDown={(e) => {
                                                    // Enter sends, Shift+Enter breaks the line —
                                                    // the contract every chat composer has.
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault()
                                                        postComment()
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={postComment}
                                                disabled={posting || !draft.trim()}
                                            >
                                                {posting ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </footer>
                        </>
                    )}
                </section>
            </div>


            {/* THE DOOR'S PRICE, when somebody hits it. Rendered from the gate
                the refusal carried, so the numbers on the paywall are literally
                the ones that refused. */}
            {paywall && (
                <ArrowPaywall
                    debateId={debate?.id}
                    promptId={thread?.prompt_id ?? thread?.id}
                    gate={paywall}
                    onClose={() => setPaywall(null)}
                />
            )}
        </div>
    )
}

export default MatchConversations
