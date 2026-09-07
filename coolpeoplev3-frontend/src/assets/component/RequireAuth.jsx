import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import api from '../lib/api'

// ============================================================================
// RequireAuth — the closed-beta guard on every page except the raise.
//
// WHY: /fund sends strangers to this domain. Without this, one click on the
// logo dropped a funder into the working app — every campaign, every debate,
// every candidate profile — before any of it is ready to be read by them.
//
// IT VERIFIES, IT DOES NOT TRUST. A token in localStorage is not a session: it
// expires, it can be revoked, and it can be typed in by hand. So this asks the
// server (GET /api/auth/me) rather than checking that the key exists. The
// presence check is only a fast path to skip a request that would obviously
// 401.
//
// THIS IS NOT THE SECURITY BOUNDARY — it cannot be. Anything enforced in a
// browser is advisory, because the person holding the browser can edit it. The
// real gate is preLaunchGate on the server, which refuses the DATA. This exists
// so that a locked-out visitor sees a sign-in page instead of an app frame full
// of failed requests.
// ============================================================================
function RequireAuth({ children }) {
    // The no-token case is decided at INITIALISATION, not in the effect. Doing it
    // in the effect would be a synchronous setState there, which cascades a
    // render — and the answer is already known before the first paint, so there
    // is nothing to wait for. A missing token means denied, full stop.
    const [status, setStatus] = useState(() => {
        // Reading localStorage throws outright in some embedded contexts
        // (private mode, blocked site data). No token we can read is the same
        // outcome as no token at all.
        try { return localStorage.getItem('token') ? 'checking' : 'denied' }
        catch { return 'denied' }
    })
    const location = useLocation()

    useEffect(() => {
        if (status !== 'checking') return
        let cancelled = false
        api.get('/api/auth/me')
            .then(() => { if (!cancelled) setStatus('ok') })
            .catch(() => { if (!cancelled) setStatus('denied') })
        return () => { cancelled = true }
    }, [status])

    // Deliberately blank rather than a spinner: this resolves in one request,
    // and a flash of "Checking access…" on every navigation is worse than a
    // beat of nothing.
    if (status === 'checking') return null

    if (status === 'denied') {
        // `state.from` — NOT a ?next= query param — because Login already reads
        // exactly this key (`location.state?.from`) and redirects to it after a
        // successful sign-in. Inventing a second convention would have meant
        // teaching Login about it for no gain.
        //
        // `replace` keeps the guarded URL out of history; without it, Back lands
        // on the guarded page again and bounces straight back out.
        return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
    }
    return children
}

export default RequireAuth
