import React, { useEffect, useRef, useState } from 'react'
import { prepareImage, ACCEPTED_IMAGE_TYPES } from '../../lib/avatarUpload'
import './ImagePicker.css'

/* ============================================================================
 * ImagePicker — one optional image on a post.
 *
 * ALWAYS OPTIONAL. Every kind that uses it — a would be, a debate, a question,
 * an article — is complete without one, so it never appears in a readiness
 * count and never blocks a submit. It is the last row of a form for the same
 * reason: a picture is what you add once the thing you are posting exists.
 *
 * IT PREPARES IN THE BROWSER, using the same helper the avatar and plan-image
 * flows use: downscaled to 1600px and re-encoded to WebP, which also strips
 * EXIF. Phone photos carry GPS and a post image is public — not a detail to
 * leave to a server that may or may not end up receiving the file.
 *
 * WHAT IT DOES NOT DO is upload — still, and now on purpose rather than for want
 * of an endpoint. The caller gets a prepared Blob and a local preview and decides
 * when the bytes go. For a post that moment is submit (lib/postImageUpload.js),
 * because the words are the post: uploading on pick would mean an abandoned draft
 * leaves a file in the bucket with nothing pointing at it.
 */

const MAX_MB = 8

export default function ImagePicker({ value, onChange, label = 'Image', note }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const input = useRef(null)

    // An object URL that is never revoked is a leaked file handle for the life
    // of the tab.
    useEffect(() => () => { if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl) },
        [value?.previewUrl])

    async function pick(file) {
        if (!file) return
        setError(null)
        if (file.size > MAX_MB * 1024 * 1024) {
            return setError(`That file is over ${MAX_MB}MB — pick a smaller one.`)
        }
        setBusy(true)
        try {
            const blob = await prepareImage(file, { maxDim: 1600 })
            if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl)
            onChange({ blob, name: file.name, previewUrl: URL.createObjectURL(blob) })
        } catch {
            setError('Could not read that image.')
        } finally {
            setBusy(false)
        }
    }

    function clear() {
        if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl)
        onChange(null)
        if (input.current) input.current.value = ''
    }

    return (
        <div className="impk">
            {value ? (
                <div className="impk__has">
                    <img className="impk__img" src={value.previewUrl} alt="" />
                    <div className="impk__meta">
                        <span className="impk__n">{value.name}</span>
                        <span className="impk__s">{Math.round(value.blob.size / 1024)} KB · WebP</span>
                        <button type="button" className="impk__x" onClick={clear}>Remove</button>
                    </div>
                </div>
            ) : (
                <button
                    type="button" className="impk__drop" disabled={busy}
                    onClick={() => input.current?.click()}
                >
                    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M2.6 3.4h10.8v9.2H2.6zM2.6 10.4l3-3 2.6 2.6 2-2 3.2 3.2M6 6.2h.01"
                              stroke="currentColor" strokeWidth="1.4"
                              strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {busy ? 'Preparing…' : `Add ${label.toLowerCase()}`}
                    <em>optional</em>
                </button>
            )}

            <input
                ref={input} type="file" accept={ACCEPTED_IMAGE_TYPES} hidden
                onChange={(e) => pick(e.target.files?.[0])}
            />
            {error && <p className="impk__err" role="alert">{error}</p>}
            {note !== null && (
                <p className="impk__note">
                    {note ?? 'Resized and stripped of location data in your browser before it goes anywhere.'}
                </p>
            )}
        </div>
    )
}
