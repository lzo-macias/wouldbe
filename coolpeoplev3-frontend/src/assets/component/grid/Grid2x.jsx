import React, { useState, useEffect } from "react"
import "./HomeGrid2x.css"
import { Link } from "react-router-dom"
import api from "../../lib/api"
import { DEFAULT_FILTERS, activeCount } from "../../lib/homeFilters"

// ============================================================================
// Grid2x — the LIVE version of the hero grid (Grid.jsx is the static mockup).
//
// It reads three feeds and interleaves them into one list:
//   /api/wouldbes?sort=pledged      — most-backed campaigns first
//   /api/wouldbes/recommended       — campaigns in the signed-in user's own
//                                     jurisdictions. A race you can actually
//                                     vote in beats a better-funded one three
//                                     states away, so these go FIRST. 401s for
//                                     logged-out visitors, which is fine — the
//                                     catch below turns that into [].
//   /api/debates?sort=featured      — one debate after every three campaigns.
//
// Every field rendered below exists on the rows those endpoints actually
// return (wouldbe: title/goal_cents/pledged_total_cents/deadline/office_name/
// state_code; debates: title/prize_pool_cents/prize_is_cash/prize_description/
// total_contestants/nomination_count/start_date). Percentages and day counts
// are DERIVED here — the API sends raw cents and dates, not display strings.
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Postgres DATE/timestamptz arrives as a string. Returns null (not NaN) when the
// column is null, so the caller can hide the row instead of printing "NaN days".
const daysUntil = (value) => {
    if (!value) return null
    const when = new Date(value)
    if (Number.isNaN(when.getTime())) return null
    return Math.max(0, Math.ceil((when.getTime() - Date.now()) / MS_PER_DAY))
}

// Cents -> "$1,234" — money never crosses the wire as a float.
const money = (cents) =>
    `$${Math.round(Number(cents || 0) / 100).toLocaleString("en-US")}`

// The handle shown under a card. Username first — it's what the rest of the app
// shows — then the real name, then a neutral stand-in.
//
// The @-strip is deliberate: signup allows an email address as a username, and
// several accounts have one, so this rendered a full email on a public card.
// Printing someone's address to every visitor is worse than showing the local
// part, and the local part is what reads as a handle anyway.
const posterName = (item) => {
    const raw =
        item.username ||
        [item.first_name, item.last_name].filter(Boolean).join(" ") ||
        "Someone"
    return raw.includes("@") ? raw.split("@")[0] : raw
}

// Capped at 100: a 400%-funded campaign shouldn't render a 400% bar.
const percentOfGoal = ({ pledged_total_cents, goal_cents }) => {
    const goal = Number(goal_cents || 0)
    if (goal <= 0) return 0
    return Math.min(100, Math.round((Number(pledged_total_cents || 0) / goal) * 100))
}

// Recommended campaigns lead, then the pledged feed with those ids removed, and
// a debate slotted in after every third campaign. Leftover debates tail the list
// so a short campaign feed doesn't swallow them.
//
// CADENCE IS A CONSTANT, not a random divisor. The previous
// `(i + 1) % Math.floor(Math.random() * 3)` was two bugs at once: the floor is 0
// a third of the time, and `n % 0` is NaN — never === 0 — so on those iterations
// no debate was placed at all and they all fell through to the tail. It also
// re-rolled per campaign, so the layout was different on every load.
const DEBATE_EVERY = 3

const interleave = (wouldbes, debates) => {
    const mixed = []
    let d = 0
    wouldbes.forEach((item, i) => {
        mixed.push({ type: "wouldbe", item })
        if ((i + 1) % DEBATE_EVERY === 0 && d < debates.length) {
            mixed.push({ type: "debate", item: debates[d++] })
        }
    })
    while (d < debates.length) mixed.push({ type: "debate", item: debates[d++] })
    return mixed
}

// A failed request has to be distinguishable from one that legitimately returned
// nothing. Both used to collapse to [], so an unreachable API rendered an empty
// grid with no error and no explanation — a blank page that looks like "there is
// nothing here" when it actually means "we never got an answer".
const FAILED = Symbol("failed")
const orEmpty = (v) => (v === FAILED || !Array.isArray(v) ? [] : v)

function Grid2x({ filters = DEFAULT_FILTERS }) {
    const [mixed, setMixed] = useState([])
    const [error, setError] = useState(null)

    // The filter object is rebuilt on every Home render, so depending on it
    // directly would refetch forever. Depend on its VALUE instead.
    const filterKey = JSON.stringify(filters)

    useEffect(() => {
        let cancelled = false

        async function loadData() {
            try {
                const f = filters
                const wantCampaigns = f.type !== "debates"
                const wantDebates = f.type !== "wouldbes"

                // "Only in my jurisdiction" is served by /wouldbes/recommended,
                // which already scopes to the caller's user_jurisdictions rows.
                // It REPLACES the pledged feed rather than being merged into it:
                // merging would reintroduce the campaigns the filter exists to
                // exclude.
                const jurisdictionOnly = f.myJurisdiction && wantCampaigns

                const campaignReq = !wantCampaigns
                    ? Promise.resolve([])
                    : jurisdictionOnly
                        ? api.get("/api/wouldbes/recommended", { params: { limit: 24 } })
                            .then((r) => r.data)
                            .catch(() => FAILED)
                        : api.get("/api/wouldbes", {
                            params: {
                                // The goal-progress sort is a SORT, so it takes the
                                // place of 'pledged' rather than stacking with it.
                                sort: f.goalSort !== "none" ? f.goalSort : "pledged",
                                limit: 24,
                                state: f.state || undefined,
                                // Only send the lean window when it is actually
                                // narrowed — a full 1-10 range would still exclude
                                // every campaign whose owner never set one.
                                lean_min: f.leanMin !== 1 || f.leanMax !== 10 ? f.leanMin : undefined,
                                lean_max: f.leanMin !== 1 || f.leanMax !== 10 ? f.leanMax : undefined,
                            },
                        }).then((r) => r.data).catch(() => FAILED)

                const debateReq = !wantDebates
                    ? Promise.resolve([])
                    : api.get("/api/debates", {
                        params: {
                            sort: "featured",
                            limit: 8,
                            prize: f.prize !== "any" ? f.prize : undefined,
                        },
                    }).then((r) => r.data).catch(() => FAILED)

                // The recommended feed is only fetched for the DEFAULT view. Under
                // any campaign filter it would smuggle back rows the filter just
                // excluded — it has no state/lean/goal parameters of its own.
                const unfiltered =
                    !f.state && f.goalSort === "none" && f.leanMin === 1 && f.leanMax === 10
                const recommendedReq =
                    wantCampaigns && !jurisdictionOnly && unfiltered
                        ? api.get("/api/wouldbes/recommended", { params: { limit: 5 } })
                            .then((r) => r.data)
                            // 401 when logged out — the NORMAL logged-out response,
                            // not an outage, so it stays a plain empty list.
                            .catch(() => [])
                        : Promise.resolve([])

                const [campaigns, debates, recommended] = await Promise.all([
                    campaignReq, debateReq, recommendedReq,
                ])

                // Every feed we ASKED for failed => the API is unreachable (dev
                // server down, wrong VITE_API_BASE_URL, CORS). Say so instead of
                // painting an empty page. Feeds we deliberately skipped resolve to
                // [] and must not count as failures.
                const asked = [
                    wantCampaigns ? campaigns : null,
                    wantDebates ? debates : null,
                ].filter((v) => v !== null)
                if (asked.length && asked.every((v) => v === FAILED)) {
                    if (!cancelled) setError("Couldn't reach the server. Is the API running?")
                    return
                }

                const recommendedList = orEmpty(recommended)
                const campaignList = orEmpty(campaigns)
                const debateList = orEmpty(debates)

                // A recommended campaign is usually ALSO in the main feed —
                // without this it renders twice.
                const seen = new Set(recommendedList.map((w) => w.id))
                const wouldbes = [
                    ...recommendedList,
                    ...campaignList.filter((w) => !seen.has(w.id)),
                ]

                if (!cancelled) setMixed(interleave(wouldbes, debateList))
            } catch (err) {
                console.error(err)
                if (!cancelled) setError("Couldn't load the feed right now.")
            }
        }

        loadData()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterKey])

    if (error) return <p className="gridcontainer1">{error}</p>
    // Reached the API, it just has nothing to show. Distinct from the error above.
    // An empty grid under a filter is a different message from an empty grid
    // full stop — otherwise a too-narrow filter reads as a broken feed.
    if (!mixed.length) {
        return (
            <p className="gridcontainer1">
                {activeCount(filters)
                    ? "Nothing matches those filters."
                    : "Nothing here yet."}
            </p>
        )
    }

    return (
        <div className="gridcontainer1">
            {mixed.map(({ type, item }) => {
                if (type === "debate") {
                    const days = daysUntil(item.start_date)
                    // prize_is_cash false => the prize is described in prose
                    // (prize_description), and prize_pool_cents is meaningless.
                    const isCash = item.prize_is_cash !== false
                    return (
                        <Link
                            // The specific debate, not the generic /debate page —
                            // every card used to land on the same screen. This is
                            // the `debate/:debateId` route that renders AnyDebate.
                            to={`/debate/${item.id}`}
                            key={`debate-${item.id}`}
                            className="overarchingdebatecomponent"
                        >
                            <div className="smallgridcomponentDebate">
                                <h3 className="DebateTitle">{item.title}</h3>
                                {/* The prize plaque: icon on the left, label +
                                    amount stacked on the right. Non-cash prizes
                                    reuse the same plaque with prose in place of
                                    the dollar figure. */}
                                <div className="totalcashprizecontainer">
                                    <img
                                        src="/homepagegraphics/LargeColdMoney.svg"
                                        alt=""
                                        className="moneyicon"
                                    />
                                    <div className="totalcashprizetext">
                                        <p className="smalltexttotalcashprize">
                                            {isCash ? "total cash prize" : "the prize"}
                                        </p>
                                        <p className="amt">
                                            {isCash
                                                ? money(item.prize_pool_cents)
                                                : item.prize_description || "Announced soon"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="DebateLowerLevel">
                                {item.sponsor_photo_url && (
                                    <img
                                        src={item.sponsor_photo_url}
                                        alt=""
                                        title={item.sponsor_name || ""}
                                        className="debatesponsorpic"
                                    />
                                )}
                                <div className="team">
                                    <img
                                        src="/homepagegraphics/Team.svg"
                                        alt=""
                                        className="teamimg"
                                    />
                                    <p>{item.total_contestants ?? 0} competitors</p>
                                </div>
                                {days !== null && (
                                    <div className="debatetimeline">
                                        <img
                                            src="/homepagegraphics/Clock.svg"
                                            alt=""
                                            className="debatetimelineimg"
                                        />
                                        <p>{days} days</p>
                                    </div>
                                )}
                            </div>
                        </Link>
                    )
                }

                const days = daysUntil(item.deadline)
                // A card needs a face. There is still no image column on
                // `wouldbe`, so the first two are placeholders for the day the
                // API sends one; until then every card falls through to the
                // POSTER'S OWN avatar, which the list endpoint already returns.
                // That makes the image path the live one and the blank-card path
                // the exception — the reverse of before.
                const photo =
                    item.profile_photo || item.image_url || item.poster_photo_url || null

                return (
                    <Link
                        to={`/wouldbe/${item.id}`}
                        key={`wouldbe-${item.id}`}
                        className="smallgridcomponent"
                        // The image card no longer shows the title, which would
                        // otherwise leave this link with nothing to announce —
                        // its only text would be the poster's handle and two
                        // stats. aria-label names it for assistive tech and
                        // title gives sighted users the same on hover, so
                        // dropping the visible text loses nothing but the space.
                        aria-label={item.title}
                        title={item.title}
                    >
                        {/* With a photo the card is the image alone; without one
                            the title IS the card face, on black, so a card is
                            never blank. */}
                        {photo ? (
                            <div className="smallimagecontainer">
                                <img src={photo} alt="" className="smallimageimage" />
                                {/* The title, revealed over the photo on hover.
                                    Same black face and type as the no-image card,
                                    so a hovered image card and a photoless one
                                    read as the same object. It is always in the
                                    DOM (opacity, not conditional rendering) so
                                    it can fade rather than pop, and so the text
                                    is present for find-in-page. */}
                                <div className="smallimageoverlay" aria-hidden="true">
                                    <h3 className="smallnoimagetitle">{item.title}</h3>
                                </div>
                            </div>
                        ) : (
                            <div className="smallnoimagecontainer">
                                <h3 className="smallnoimagetitle">
                                    {item.title}
                                </h3>
                            </div>
                        )}
                        <div className="WouldBeLowerLevel">
                            {/* Who posted it: small round avatar + handle. On an
                                image card this is now the ONLY text, since the
                                title is hidden there and the office line was
                                removed — which is why the link carries an
                                aria-label above. The handle is the only
                                variable-length string here, so it is the one
                                that gets clipped rather than pushing the stats
                                off the card. */}
                            <div className="wouldbeidentity">
                                {item.poster_photo_url ? (
                                    <img
                                        src={item.poster_photo_url}
                                        alt=""
                                        title={posterName(item)}
                                        className="wouldbeposterpic"
                                    />
                                ) : (
                                    // No avatar on file still gets a circle, with
                                    // their initial — so the row never collapses.
                                    <span
                                        className="wouldbeposterpic wouldbeposterinitial"
                                        title={posterName(item)}
                                    >
                                        {posterName(item).charAt(0).toUpperCase()}
                                    </span>
                                )}
                                <p className="wouldbehandle" title={posterName(item)}>
                                    {posterName(item)}
                                </p>
                            </div>
                            <div className="wouldbestat">
                                <img
                                    src="/homepagegraphics/Money.svg"
                                    alt=""
                                    className="wouldbestaticon"
                                />
                                <p>{percentOfGoal(item)}% of goal</p>
                            </div>
                            {days !== null && (
                                <div className="wouldbestat">
                                    <img
                                        src="/homepagegraphics/Clock.svg"
                                        alt=""
                                        className="wouldbestaticon"
                                    />
                                    <p>{days} days</p>
                                </div>
                            )}
                        </div>
                    </Link>
                )
            })}
        </div>
    )
}

export default Grid2x
