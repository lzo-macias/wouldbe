import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../lib/api'
import { FeedPage } from './HomeV2'
import DebatePage from './DebatePage'

/**
 * The route. It supplies the shell — header, nav, the account button's face —
 * and hands FeedPage the debate as its `page`, so the chrome is the same object
 * the feed uses rather than a second copy that drifts.
 *
 * `debateId` is read and passed through even though DebatePage renders a
 * fixture: the id is what the eventual read will key on, and threading it now
 * means wiring is one hook rather than a re-plumb.
 */
export default function DebateRoute() {
    const { debateId } = useParams()
    const [me, setMe] = useState(null)
    const navigate = useNavigate()
    const userId = localStorage.getItem('userId')

    useEffect(() => {
        let cancelled = false
        if (!localStorage.getItem('token')) return undefined
        api.get('/api/auth/me')
            .then(({ data }) => { if (!cancelled) setMe(data) })
            .catch(() => { if (!cancelled) setMe(null) })
        return () => { cancelled = true }
    }, [])

    return (
        <FeedPage
            me={me}
            userId={userId}
            signedIn={Boolean(localStorage.getItem('token'))}
            tagline="a fundraising platform for candidates under 45 years old"
            profileTo={userId ? `/u/${userId}` : '/login'}
            navCounts={{ chat: 3 }}
            current="home"
            page={<DebatePage debateId={debateId} />}
            onStart={() => navigate(userId ? '/homev2' : '/signup')}
            onNewPrompt={() => navigate('/homev2')}
            onAccount={() => navigate(userId ? `/u/${userId}` : '/login')}
        />
    )
}
