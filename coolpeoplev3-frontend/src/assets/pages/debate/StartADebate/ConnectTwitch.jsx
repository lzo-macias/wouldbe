import React, { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import api from "../../../lib/api"
import ConnectTwitchStep from "../../../component/StartADebate/ConnectTwitchStep"
import StartADebateHeader from "../../../component/header/StartADebateHeader/StartADebateHeader"
import "../../../component/StartADebate/ApplyForDebateCasual.css"
import "./StartADebate.css"

// ============================================================================
// /startadebate/:debateId/twitch — the page a sponsor lands on after submitting.
//
// WHY ITS OWN ROUTE rather than another step inside the application form:
// connecting Twitch is an OAuth handoff that LEAVES the site. Coming back has to
// land somewhere that can rebuild the context from the URL alone, and a step
// buried in a form's local state cannot — the form would remount empty and the
// sponsor would be staring at a blank application with their draft already saved.
// A route with the debate id in it survives that round trip, a refresh, and a
// bookmarked link.
//
// Hosting is FREE, so there is no payment step: connecting (or declining) the
// channel is the last thing a sponsor does, and the debate goes straight to
// review. The tier/host-fee machinery still exists in the backend but nothing
// sends anyone to it.
// ============================================================================

function ConnectTwitch() {
    const { debateId } = useParams()
    const navigate = useNavigate()

    const [stream, setStream] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // Rebuild where the sponsor is from the server, not from state passed in —
    // this page is reachable by a fresh page load after the OAuth redirect.
    useEffect(() => {
        let cancelled = false
        api.get(`/api/debates/${debateId}/stream`)
            .then(({ data }) => { if (!cancelled) setStream(data) })
            .catch((err) => {
                if (!cancelled) setError(err.response?.data?.error || "Couldn't load this debate.")
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [debateId])

    // "Done with this step" is EITHER a channel or a recorded opt-out. Without
    // the opt-out half, skipping would send the sponsor straight back here on the
    // next page load.
    const connected = !!stream?.twitch_channel || !!stream?.channel_opt_out_at
    const optedOut = !stream?.twitch_channel && !!stream?.channel_opt_out_at

    return (
        <div className="debategradientV2">
            <StartADebateHeader />
            <div className="applyPage">
                <p className="eyebrow">Step 2 of 2</p>
                <h1 className="pageTitle">Set up your broadcast</h1>

                {loading && <p className="cardStepLoading">Loading…</p>}
                {error && <p className="formError">{error}</p>}

                {!loading && !connected && (
                    <ConnectTwitchStep
                        debateId={debateId}
                        onConnected={setStream}
                        onSkipped={setStream}
                    />
                )}

                {!loading && connected && (
                    <>
                        <p className="formSuccess">
                            {optedOut
                                ? "No Twitch broadcast — you can add one later. That's everything: your debate is with an admin for review, usually within a day."
                                : `Streaming on twitch.tv/${stream.twitch_channel}${
                                      stream.invite_slots ? ` — ${stream.invite_slots} seats` : ""
                                  }. That's everything: your debate is with an admin for review, usually within a day.`}
                        </p>
                        <div className="formActions">
                            <button type="button" onClick={() => navigate("/debate")}>
                                Back to debates
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default ConnectTwitch
