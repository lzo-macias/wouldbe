import React from "react"
import "./PreExistingDebates.css"

// Formatters built ONCE at module scope. Intl objects are expensive to
// construct, and building them inside the component makes a new pair per card
// per render.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

// timeZone: "UTC" on purpose. start_date is a DATE column that pg parses into a
// Date at the SERVER's local midnight, which serialises to UTC — "2026-08-11"
// arrives as "2026-08-11T04:00:00.000Z". Formatting in the viewer's zone would
// show the 10th to anyone west of the server.
const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
})

// Status → card class. A lookup, not state: the colour is a pure function of the
// debate, so deriving it during render is correct and setState would be a loop.
const COLORS = {
    open_entry: "approvedDebate",
    cancelled: "rejectedDebate",
    draft: "draftDebate",
}

// MODULE SCOPE, not nested inside PreExistingDebates. A component declared
// inside another is a brand-new function reference on every parent render, so
// React unmounts and remounts it instead of updating it.
function RenderCards({ type, heading }) {
    // The parent renders before the fetch resolves, and again if it fails, so
    // `type` is not guaranteed to be an array yet.
    if (!Array.isArray(type) || type.length === 0) return null

    return (
        <section className="debateGroup">
            <h2 className="debateGroupHead">
                {heading} <span className="debateCount">{type.length}</span>
            </h2>
            <div className="debateCards">
                {type.map((debate) => {
                    const color = COLORS[debate.status] ?? ""
                    return (
            // key goes on the element .map() returns. A bare <> can't take one,
            // which is why the fragment that used to wrap this is gone.
            <article className={`debateCard ${color}`} key={debate.id}>
                <h3 className="debateCardTitle">{debate.title}</h3>

                <div className="cardRow">
                    <p className="cardLabel">Category</p>
                    <p className="cardValue">{debate.category ?? "—"}</p>
                </div>

                <div className="cardRow">
                    <p className="cardLabel">Win type</p>
                    <p className="cardValue">
                        {debate.win_type === "general_vote" ? "General vote" : "Hybrid"}
                    </p>
                </div>

                <div className="cardRow">
                    <p className="cardLabel">Prize</p>
                    <div className="cardValue cardPrize">
                        {/* cents arrive as a STRING from pg, so "0" is truthy —
                            compare the number, or a non-cash prize renders $0.00 */}
                        {Number(debate.sponsor_contribution_cents) > 0 && (
                            <p>{usd.format(Number(debate.sponsor_contribution_cents) / 100)}</p>
                        )}
                        {/* both halves can be present: prize_type 'both' */}
                        {debate.prize_description && <p>{debate.prize_description}</p>}
                    </div>
                </div>

                <div className="cardRow">
                    <p className="cardLabel">Max contestants</p>
                    <p className="cardValue">{debate.max_contestants ?? "—"}</p>
                </div>

                <div className="cardRow">
                    <p className="cardLabel">Who can enter</p>
                    <p className="cardValue">
                        {debate.participation_type === "invitation_only" ? "Invite only" : "Open to all"}
                    </p>
                </div>

                <div className="cardRow">
                    <p className="cardLabel">Start date</p>
                    <p className="cardValue">
                        {debate.start_date ? dateFmt.format(new Date(debate.start_date)) : "—"}
                    </p>
                </div>

                <div className="cardFoot">
                    {debate.status === "open_entry" && (
                        <button type="button" className="cardButton">View</button>
                    )}
                    {debate.status === "cancelled" && (
                        <>
                            <button type="button" className="cardButton">Appeal</button>
                            {debate.rejection_reason && (
                                <p className="cardReason">{debate.rejection_reason}</p>
                            )}
                        </>
                    )}
                    {debate.status === "draft" && (
                        <p className="cardPending">Awaiting approval</p>
                    )}
                </div>
            </article>
                    )
                })}
            </div>
        </section>
    )
}

function PreExistingDebates({ approved, drafts, rejected, travelToCasualOrCorporate }) {
    const empty =
        !approved?.length && !rejected?.length && !drafts?.length

    return (
        <div className="preExisting">
            <div className="preExistingHead">
                <h1>Your debates</h1>
                <button type="button" className="addDebate" onClick={travelToCasualOrCorporate}>
                    + Start a debate
                </button>
            </div>

            <RenderCards type={approved} heading="Approved" />
            <RenderCards type={drafts} heading="Awaiting approval" />
            <RenderCards type={rejected} heading="Rejected" />

            {empty && (
                <p className="preExistingEmpty">
                    You haven't started a debate yet.
                </p>
            )}
        </div>
    )
}

export default PreExistingDebates
