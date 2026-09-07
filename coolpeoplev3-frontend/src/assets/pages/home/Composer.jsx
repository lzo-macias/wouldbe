import React, { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import ImagePicker from '../../component/ImagePicker/ImagePicker'
import api from '../../lib/api'
import { uploadPostImage } from '../../lib/postImageUpload'
import './composer.css'

const StartADebate = lazy(() => import('../debate/StartADebate/StartADebate'))

/* ============================================================================
 * Composer — starting a post, without leaving the feed.
 *
 * FOUR KINDS, ONE DOOR. The button used to open the debate application form
 * directly, which quietly told people this is a debates product with three
 * other things bolted on. It asks WHAT first, because that answer changes
 * everything after it — what you fill in, what it costs, and where it goes.
 *
 * WHERE EACH ONE GOES:
 *   debate    the actual application flow, embedded.
 *   would be  a campaign is attached to an OFFICE, and picking one is a
 *             jurisdiction search — a real screen that already exists. This
 *             step hands off to it rather than pretending to be it.
 *   question  POST /api/posts, post_type 'question'.
 *   artifact  the same endpoint, post_type 'artifact'.
 *
 * THE LAST TWO USED TO BE A LIE, and the note under the button said so out loud:
 * they were written into React state, led the feed for the session, and were
 * gone on reload. They have a table now (migration 1784300000000 — questions and
 * artifacts are `posts` rows with a title and a body and no parent), so the
 * composer writes and the note is gone with the caveat it described.
 *
 * WHAT THE SUBMIT ACTUALLY DOES, in this order: upload the image if there is one,
 * then create the post carrying its object key. The image is second because the
 * post is the words — a failed upload must not cost somebody their draft, so it
 * surfaces as an error on a form that still holds everything they typed.
 * ==========================================================================*/

/* ---- the two forms this app can actually render today -------------------- */

/**
 * The two written kinds. One component, because they are the same card with a
 * different pair of fields:
 *
 *   question   the question, then optional context under it
 *   article    the title, then the body — which is the post
 *
 * BOTH SAY WHO CAN ANSWER, up in the bar. A debate is gated (approved judges,
 * or enough standing-bow icons) and these two are not, which is the whole
 * difference between them and the third kind — so it is stated where the debate
 * states its gate, in the same place, rather than being something you find out
 * by nobody stopping you.
 */
function WrittenForm({ kind, me, onPost, onClose }) {
    const isQ = kind === 'question'
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [image, setImage] = useState(null)
    // What the submit is doing right now, and what went wrong if it did. Two
    // pieces of state rather than one status enum, because they are not
    // exclusive: a failed attempt leaves an error AND an idle form.
    const [busy, setBusy] = useState(null)
    const [error, setError] = useState(null)

    // An article is its body; a question is answerable without one. So the
    // second field is required for one and not the other, and the checklist
    // below counts what the kind actually needs.
    const titleOk = title.trim().length > 8
    const bodyOk = isQ ? true : body.trim().length > 40
    const ready = titleOk && bodyOk && !busy
    const left = (titleOk ? 0 : 1) + (bodyOk ? 0 : 1)

    // THE FORM KEEPS ITS CONTENTS ON FAILURE. Everything that can throw is
    // awaited here and nothing is cleared until the row exists — a network error
    // that empties a nine-paragraph article is the one bug in a composer nobody
    // forgives.
    async function submit(e) {
        e.preventDefault()
        if (!ready) return
        setError(null)
        try {
            setBusy(image ? 'Uploading the image…' : 'Posting…')
            // The image first, so the post can be created with its key attached
            // in one write. Returns {} when there is no image.
            const imageFields = await uploadPostImage(image)

            setBusy('Posting…')
            const { data } = await api.post('/api/posts', {
                post_type: kind,
                title: title.trim(),
                // Sent as null rather than '' — an empty string is a body the
                // server would have to decide about, and there isn't one.
                body: body.trim() || null,
                ...imageFields,
            })
            onPost(data, image)
        } catch (err) {
            // The server's own message when it sent one: it says which field and
            // why, which is more use than anything this component could guess.
            setError(
                err?.response?.data?.error
                || err?.message
                || 'Could not post that. Try again.'
            )
        } finally {
            setBusy(null)
        }
    }

    return (
        <form className="cmp__card" onSubmit={submit}>
            <div className="cmp__hd">
                <span className="cmp__t">{isQ ? 'Start a question' : 'Start an article'}</span>
                <span className="cmp__k">{isQ ? 'Question' : 'Article'}</span>
                <span className="cmp__gate">Anyone can respond</span>
                <button type="button" className="cmp__x" onClick={onClose}>Cancel</button>
            </div>

            <div className="cmp__rows">
                <div className="cmp__r">
                    <span className="cmp__l">{isQ ? 'Question' : 'Title'} <i>*</i></span>
                    <span className="cmp__c">
                        <input
                            className="cmp__in cmp__in--big" value={title} maxLength={160}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={isQ
                                ? 'Name one thing your own party gets wrong about…'
                                : 'The petition requirement ends more campaigns than the deadline does.'}
                        />
                        {/* Only once it is close to mattering. A counter at 0/160
                            is a warning about nothing. */}
                        {title.length > 110 && (
                            <span className="cmp__h">{160 - title.length} characters left</span>
                        )}
                    </span>
                </div>

                <div className="cmp__r">
                    <span className="cmp__l">
                        {isQ ? 'Description' : 'Body'} {!isQ && <i>*</i>}
                    </span>
                    <span className="cmp__c">
                        <textarea
                            className="cmp__ta" value={body} rows={isQ ? 3 : 9}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder={isQ
                                ? 'Anything that stops the obvious answer from being the whole answer.'
                                : 'The reasoning, the sources, the part that is uncomfortable, and what would change your mind.'}
                        />
                        <span className="cmp__h">
                            {isQ
                                ? 'Optional. Context around the question, not a second question.'
                                : 'This is the article. It opens when somebody presses See more.'}
                        </span>
                    </span>
                </div>

                <div className="cmp__r">
                    <span className="cmp__l">Image</span>
                    <span className="cmp__c">
                        <ImagePicker value={image} onChange={setImage} />
                    </span>
                </div>
            </div>

            {/* THE ERROR SITS ABOVE THE BUTTON that caused it, not in a toast:
                the thing to read and the thing to press again are one glance
                apart, and it stays until the next attempt. */}
            {error && <p className="cmp__err" role="alert">{error}</p>}

            <div className="cmp__ft">
                <span className="cmp__note">
                    {busy
                        ? busy
                        : ready
                            ? (image
                                ? 'The image is reviewed before it appears; the post goes up now.'
                                : 'Goes up now, and stays.')
                            : `${left} left`}
                </span>
                <button
                    type="submit" className="btn btn--gold" disabled={!ready}
                    style={{ height: 36, padding: '0 18px', fontSize: 13 }}
                >
                    {busy ? 'Posting…' : `Post ${isQ ? 'question' : 'article'}`}
                </button>
            </div>
        </form>
    )
}

function WouldBeHandoff({ onBack }) {
    return (
        <div className="cmp__hand">
            <p className="cmp__handh">A would be is attached to an office.</p>
            <p className="cmp__handp">
                Before there is a goal or a plan there is a seat — a specific office in a
                specific jurisdiction, with its own filing deadline and its own contribution
                rules. Picking it is a search, not a field, so it has its own screen.
            </p>
            <div className="cmp__act">
                <button type="button" className="cmp__back" onClick={onBack}>Back</button>
                <Link
                    className="btn btn--gold" to="/wouldbe"
                    style={{ height: 36, padding: '0 18px', fontSize: 13 }}
                >
                    Find your office
                </Link>
            </div>
        </div>
    )
}

/* ---- the shell ----------------------------------------------------------- */

const TITLES = { question: 'question', artifact: 'article', debate: 'debate', wouldbe: 'would be' }

/* The shell renders one of three things. Only the two written kinds are handled
   in this file; the other two are whole screens that happen to open here. */

export default function Composer({ me, kind, onPost, onClose }) {

    return (
        <div className="cmp">
            <div className="cmp__bar">
                <span className="cmp__h">New {TITLES[kind] ?? 'post'}</span>
                <button type="button" className="cmp__x" aria-label="Close" onClick={onClose}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                    </svg>
                </button>
            </div>

            {kind === 'debate' ? (
                <Suspense fallback={<p className="cmp__wait">Loading the form…</p>}>
                    <div className="cmp__embed"><StartADebate embedded /></div>
                </Suspense>
            ) : kind === 'wouldbe' ? (
                <WouldBeHandoff onBack={onClose} />
            ) : (
                <WrittenForm kind={kind} me={me} onClose={onClose} onPost={onPost} />
            )}
        </div>
    )
}
