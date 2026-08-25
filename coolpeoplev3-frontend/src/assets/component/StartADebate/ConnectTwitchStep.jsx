import React, { useEffect, useState } from "react"
import api from "../../lib/api"
import "./ConnectTwitchStep.css"

// ============================================================================
// ConnectTwitchStep — the screen right after "submit for review".
//
// The debate already exists with a date; this attaches the DESTINATION: which
// Twitch channel it streams on, and how many top-nominated competitors get a
// seat. It runs here rather than on the application form because linking a
// Twitch account is an OAuth round-trip that leaves the page — blocking a draft
// from being saved on that would lose everything the sponsor typed.
//
// SEATS ARE NOT ASKED FOR HERE. How many competitors get on the broadcast is
// the debate's max-contestants setting, chosen on the application form — asking
// twice would be two numbers that can disagree. This screen displays it.
//
// TWO WAYS TO FINISH, both valid:
//   1. Connect Twitch  — full OAuth link. Gives us EventSub (we know when the
//      stream goes live) and VOD access.
//   2. Just name the channel — enough to EMBED, which is the actual requirement.
//      A sponsor who won't grant API access still gets a working broadcast; they
//      only lose the automatic live/offline detection.
//
// Either way the channel lands on the debate's stream row via
// PATCH /api/debates/:id/stream/channel.
// ============================================================================

function ConnectTwitchStep({ debateId, onConnected, onSkipped }) {
    const [connection, setConnection] = useState(null)   // the caller's Twitch link, if any
    const [twitchReady, setTwitchReady] = useState(true) // is Twitch OAuth configured server-side
    const [channel, setChannel] = useState("")
    // Read-only here: set from the debate's max_contestants when the stream was
    // scheduled. Shown so the sponsor can see what they chose, not edited.
    const [seats, setSeats] = useState(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    // Does this user already have a Twitch account linked? 200-with-null means
    // "no link", which is a normal state, so only a real failure sets an error.
    useEffect(() => {
        let cancelled = false
        api.get("/api/twitch/connection")
            .then(({ data }) => {
                if (cancelled || !data) return
                setConnection(data)
                // Pre-fill from the linked account — the channel they just
                // authorised is almost certainly the one they'll stream on.
                setChannel((c) => c || data.login || "")
            })
            .catch(() => { /* not linked, or endpoint unavailable — the manual path still works */ })
        return () => { cancelled = true }
    }, [])

    // The seat count that was set from max_contestants at submission.
    useEffect(() => {
        let cancelled = false
        api.get(`/api/debates/${debateId}/stream`)
            .then(({ data }) => { if (!cancelled) setSeats(data?.invite_slots ?? null) })
            .catch(() => { /* the count is informational — its absence isn't an error */ })
        return () => { cancelled = true }
    }, [debateId])

    // The OAuth handoff. The server builds the authorize URL because the client
    // id and redirect URI live in its env; a 503 means Twitch isn't configured,
    // in which case the manual channel box is the only path and we say so.
    async function connectTwitch() {
        setError(null)
        try {
            const { data } = await api.get("/api/twitch/oauth/start")
            // Full page navigation, not a popup: Twitch refuses to render its
            // consent screen inside an iframe, and popups get blocked unless the
            // click handler opens them synchronously.
            window.location.href = data.url
        } catch (err) {
            if (err.response?.status === 503) {
                setTwitchReady(false)
                setError("Twitch sign-in isn't set up on this server yet — enter your channel name instead.")
            } else {
                setError(err.response?.data?.error || "Couldn't start Twitch sign-in.")
            }
        }
    }

    // Opting out is recorded server-side, not just skipped in the UI — otherwise
    // "no thanks" and "haven't finished" are the same state and this screen comes
    // back on the next reload.
    async function skip() {
        setError(null)
        setSaving(true)
        try {
            const { data } = await api.patch(`/api/debates/${debateId}/stream/skip`)
            onSkipped?.(data)
        } catch (err) {
            console.error(err)
            setError(err.response?.data?.error || "Couldn't skip this step.")
        } finally {
            setSaving(false)
        }
    }

    async function save() {
        setError(null)
        if (!channel.trim()) return setError("Enter the Twitch channel your debate streams on.")

        setSaving(true)
        try {
            const { data } = await api.patch(`/api/debates/${debateId}/stream/channel`, {
                twitch_channel: channel.trim(),
                // Present only when they completed the OAuth link. The server
                // COALESCEs it, so sending null never clears an existing link.
                twitch_connection_id: connection?.id ?? null,
                twitch_broadcaster_user_id: connection?.twitch_user_id ?? null,
            })
            onConnected?.(data)
        } catch (err) {
            console.error(err)
            setError(err.response?.data?.error || "Couldn't save the channel.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="twitchStep">
            <div className="twitchStepHead">
                <h3>Post your debate on Twitch</h3>
                <p>
                    You don't have to post on Twitch, but we highly recommend it. There's a lot of
                    BS flying around — if you're smart, why don't you strut your stuff? We'll help
                    organise it so it's seamless.
                </p>
            </div>

            {connection ? (
                <p className="twitchConnected">
                    Connected as <strong>{connection.display_name || connection.login}</strong>
                </p>
            ) : (
                twitchReady && (
                    <button type="button" className="twitchConnect" onClick={connectTwitch}>
                        Connect Twitch
                    </button>
                )
            )}

            <div className="regularLabelAndInput">
                <label htmlFor="twitchChannel">Channel</label>
                <div className="fieldStack">
                    <div className="twitchField">
                        <span className="twitchPrefix">twitch.tv/</span>
                        <input
                            id="twitchChannel"
                            type="text"
                            value={channel}
                            onChange={(e) => setChannel(e.target.value)}
                            placeholder="yourchannel"
                            autoComplete="off"
                            spellCheck="false"
                        />
                    </div>
                    <span className="hint">
                        Paste the full URL if that's easier — we'll pull the channel out of it.
                    </span>
                </div>
            </div>

            {seats != null && (
                <p className="twitchSeats">
                    <strong>{seats}</strong> seats on the broadcast — the top {seats} competitors by
                    nominations are invited on. Change this by editing max contestants.
                </p>
            )}

            {error && <p className="formError">{error}</p>}

            {/* type="button" on both: this can render inside a <form>, and a
                bare button would submit it. */}
            <div className="twitchActions">
                <button type="button" className="twitchSave" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save and continue"}
                </button>
                <button type="button" className="twitchSkip" onClick={skip} disabled={saving}>
                    Skip — no Twitch
                </button>
            </div>
        </div>
    )
}

export default ConnectTwitchStep
