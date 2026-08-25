import { useCallback, useEffect, useState } from "react"
import api from "./api"

// ============================================================================
// useFollow(followedId, followType) — a follow button's persisted state.
//
// The state lives in the `follows` table, NOT in component state. Before this
// hook the buttons flipped a local boolean, so a follow vanished on reload and
// the same user could "follow" the same debate every visit. Reading the truth on
// mount is the whole point.
//
// followType is one of 'User' | 'Debate' | 'Wouldbe' — the values the
// follows_follow_type_check constraint allows. Anything else is a 400.
//
// Returns { following, loading, busy, error, toggle }.
// ============================================================================
export function useFollow(followedId, followType) {
    const [following, setFollowing] = useState(false)
    // Starts false when there is nothing to read (logged out, or no target), so
    // the effect never has to setState synchronously just to clear a spinner
    // that was never warranted.
    const [loading, setLoading] = useState(() =>
        Boolean(followedId && followType && localStorage.getItem("userId"))
    )
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    // Logged-out visitors have no edges to read; skip the request rather than
    // fire one that can only 401.
    const signedIn = !!localStorage.getItem("userId")

    useEffect(() => {
        let cancelled = false
        if (!followedId || !followType || !signedIn) return
        async function read() {
            try {
                const { data } = await api.get("/api/follows/state", {
                    params: { followed_id: followedId, follow_type: followType },
                })
                if (!cancelled) setFollowing(!!data.following)
            } catch {
                // A failed read is not a failed follow — leave the button in its
                // default state rather than showing an error for something the
                // user never asked for.
                if (!cancelled) setFollowing(false)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        read()
        return () => { cancelled = true }
    }, [followedId, followType, signedIn])

    const toggle = useCallback(async () => {
        if (!signedIn) {
            setError("Log in to follow.")
            return
        }
        if (busy || !followedId) return
        const next = !following
        setBusy(true)
        setError(null)
        // Optimistic: the button responds immediately and reverts if the write
        // fails, so a slow network never looks like a dead button.
        setFollowing(next)
        try {
            if (next) {
                // createFollow is idempotent (ON CONFLICT DO NOTHING, returns the
                // existing edge), so a double-click cannot create a duplicate.
                await api.post("/api/follows", {
                    followed_id: followedId,
                    follow_type: followType,
                })
            } else {
                await api.delete("/api/follows", {
                    params: { followed_id: followedId, follow_type: followType },
                })
            }
        } catch (err) {
            setFollowing(!next)
            setError(
                err.response?.status === 401
                    ? "Log in to follow."
                    : err.response?.data?.error || "Could not update follow."
            )
        } finally {
            setBusy(false)
        }
    }, [busy, followedId, followType, following, signedIn])

    return { following, loading, busy, error, toggle }
}

export default useFollow
