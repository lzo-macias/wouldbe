import React, { useState, useEffect, useNavigate } from 'react'
import api from '../../../lib/api';
import "./WouldBeRows.css"

// Show the offices we hold data for, ranked by how many recommendations the
// caller has received for each office (most-recommended first). Each card shows
// the office's filing-close deadline (last day to file to run), resolved via the
// office's jurisdiction.

// Alphabetical ordering key: sort by the office's STATE (from its jurisdiction),
// not the office name — "US Representative LA-6" belongs under Louisiana, not "U".
// Offices with no state (e.g. President, which is national) sink to the bottom.
// office_name is the final tiebreak so ordering within a state stays stable.

const navigate = useNavigate()

function byStateThenName(a, b) {
    const sa = a.state_code || null;
    const sb = b.state_code || null;
    if (sa === null && sb === null) return a.office_name.localeCompare(b.office_name);
    if (sa === null) return 1;   // a has no state -> after b
    if (sb === null) return -1;  // b has no state -> after a
    return sa.localeCompare(sb) || a.office_name.localeCompare(b.office_name);
}

// Human-readable label for each deadline_type, for the hover breakdown.
const DEADLINE_LABELS = {
    petition_circulation_start: "Petitioning opens",
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
    fec_quarterly_q1: "FEC Q1 report",
    fec_quarterly_q2: "FEC Q2 report",
    fec_quarterly_q3: "FEC Q3 report",
    fec_pre_primary_report: "FEC pre-primary report",
    fec_pre_general_report: "FEC pre-general report",
    fec_post_general_report: "FEC post-general report",
    fec_year_end: "FEC year-end report",
};

// The deadline types that actually gate candidacy — an office is shown only if one
// of these is still upcoming, and the soonest drives the card's headline date.
const ACTIONABLE_DEADLINES = new Set(["filing_close", "petition_filing_deadline"]);

// Format a bare YYYY-MM-DD as "Mar 15, 2026". Appending T00:00:00 forces LOCAL
// time so a date-only value doesn't slip a day backward in a negative-offset TZ.
function formatDeadlineDate(iso) {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Recommended-goal cents -> "$30,000". No fractional dollars — goals are round.
function formatUSD(cents) {
    return (cents / 100).toLocaleString("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
}

// The candidacy milestones we plot on the hover timeline (in chronological order).
// The FEC financial-report dates are intentionally excluded — they'd crowd the
// line and aren't candidacy gates.
const TIMELINE_TYPES = [
    "petition_circulation_start",
    "petition_filing_deadline",
    "filing_close",
    "primary_date",
    "general_date",
];



// A timeline of ALL an office's deadlines in chronological order, with a "Today"
// marker in its place. Points are spaced EVENLY (not by real date) so that with
// every name + date always shown, no two labels ever overlap — the card stays the
// fixed size of a collapsed card. Same-day deadlines collapse into one line.
function DeadlineTimeline({ deadlines, goalCents }) {
    const today = new Date().toISOString().slice(0, 10);
    const ms = (iso) => new Date(`${iso}T00:00:00`).getTime();

    // group every deadline by date so same-day deadlines share one line
    const byDate = new Map();
    for (const d of deadlines ?? []) {
        const label = DEADLINE_LABELS[d.type] ?? d.type;
        if (byDate.has(d.date)) byDate.get(d.date).labels.push(label);
        else byDate.set(d.date, { date: d.date, labels: [label], isToday: false });
    }
    // fold Today in — reuse the line if a deadline already lands on today's date
    if (byDate.has(today)) byDate.get(today).isToday = true;
    else byDate.set(today, { date: today, labels: [], isToday: true });

    const points = [...byDate.values()].sort((a, b) => ms(a.date) - ms(b.date));
    const n = points.length;
    // even spacing across the track, in chronological order
    const leftPct = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);

    return (
        <div className="wouldbeTimelineWrap">
            {goalCents != null && (
                <div className="wouldbeGoal">Recommended financing goal: {formatUSD(goalCents)}</div>
            )}
            <div className="wouldbeTimeline">
                <div className="wouldbeTimelineLine" />
                {points.map((p, i) => (
                    <div
                        key={p.date}
                        className={`wouldbeTick${p.isToday ? " wouldbeTickToday" : ""}`}
                        style={{ left: `${leftPct(i)}%` }}
                    >
                        {p.isToday && <span className="wouldbeYouBadge">you</span>}
                        <span className="wouldbeTickMark" />
                        <span className="wouldbeTickLabel">
                            {p.isToday ? (
                                <span className="wouldbeTodayText">Today</span>
                            ) : (
                                <>
                                    {p.labels.map((l, j) => <span key={j}>{l}</span>)}
                                    <span className="wouldbeTickDate">{formatDeadlineDate(p.date)}</span>
                                </>
                            )}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}


function WouldBeRows({ offices: officesProp }) {
    const [recommendations, setRecommendations] = useState([]);
    const [offices, setOffices] = useState([]);
    // office id -> how many recommendations the caller received for that office
    const [counts, setCounts] = useState({});
    // jurisdiction id -> soonest upcoming filing-close date (ISO string)
    const [deadlineByJurisdiction, setDeadlineByJurisdiction] = useState({});
    const [loading, setLoading] = useState(true);
    const [visibleCount, setVisibleCount] = useState(4000);
    // Does the user qualify (by age) for ANY relevant office, regardless of whether
    // its filing window is still open? Tracked separately from the deadline-filtered
    // list so we can tell "too young" apart from "qualified, but windows have closed."
    const [anyQualified, setAnyQualified] = useState(false);
    const [loggedin, setLoggedIn] = useState(false);

    useEffect(() => {
        async function loadData() {
            try {
                let [recRes, offRes] = [{}, {}]
                if (localStorage.getItem('token') && localStorage.getItem('refreshToken')){
                    setLoggedIn(true);
                    [recRes, offRes] = await Promise.all([
                    api.get("/api/recommendations/received"),
                    officesProp ? Promise.resolve({ data: officesProp }) : api.get("/api/offices"),
                ]);
                } else {
                    offRes = await api.get("/api/offices")
                }
                // recommendations + the base offices list, in parallel.
                // (skip the /api/offices call when the parent handed us qualified offices)

                const recs = recRes.data ?? [];
                const offs = officesProp ?? offRes.data ?? [];

                // Fetch ALL deadline types SCOPED TO THE STATES present in these
                // offices — one request per state, never a global page. The
                // /api/election-deadlines list orders by state alphabetically and
                // caps at 2000 rows, so a blanket fetch silently drops every state
                // past the cutoff. Scoping by state keeps each request whole (even
                // NY, the largest, is ~1.6k rows across all 12 types). We fetch every
                // type — not just filing_close — so we can gate on petition deadlines
                // too and show the full labeled breakdown on hover.
                const stateCodes = [...new Set(offs.map((o) => o.state_code).filter(Boolean))];
                const dlResponses = await Promise.all(
                    stateCodes.map((sc) =>
                        api.get(`/api/election-deadlines?state_code=${sc}&limit=2000`)
                    )
                );
                const deadlines = dlResponses.flatMap((r) => r.data ?? []);

                // tally recommendations per office
                const officeCounts = {};
                for (const rec of recs) {
                    officeCounts[rec.office_id] = (officeCounts[rec.office_id] ?? 0) + 1;
                }

                // Today as an ISO date (YYYY-MM-DD). deadline_date may arrive as a
                // bare date or a full timestamp; slicing to 10 chars makes the
                // string comparison sound either way.
                const today = new Date().toISOString().slice(0, 10);
                const dateOf = (d) => String(d.deadline_date).slice(0, 10);

                // Two maps, keyed by jurisdiction:
                //   fullDlMap — EVERY deadline as { type, date }, soonest-first. Powers
                //               the hover breakdown (all ~12 dates, each labeled).
                //   dlMap     — the EARLIEST filing/petition deadline (past OR future).
                //               This is the binding, first-to-miss deadline: if it has
                //               passed, the ballot window is gone even if filing_close is
                //               later. Drives the card's headline date AND the gate below.
                const fullDlMap = {};
                const dlMap = {};
                for (const d of deadlines) {
                    if (!d.deadline_date) continue;
                    const date = dateOf(d);
                    (fullDlMap[d.jurisdiction_id] ??= []).push({ type: d.deadline_type, date });
                    if (ACTIONABLE_DEADLINES.has(d.deadline_type)) {
                        const existing = dlMap[d.jurisdiction_id];
                        if (!existing || date < existing) dlMap[d.jurisdiction_id] = date;
                    }
                }
                for (const jur of Object.keys(fullDlMap)) {
                    fullDlMap[jur].sort((a, b) => a.date.localeCompare(b.date));
                }

                // Show an office ONLY if its EARLIEST filing/petition deadline is still
                // upcoming. If the earlier of the two (usually the petition deadline) has
                // already passed, the ballot window is missed even when filing_close is
                // later — so hide it. Offices with no filing/petition data seeded yet
                // (off-cycle seats) have no binding deadline, so they're hidden too.
                const runnable = offs.filter((o) => {
                    const binding = dlMap[o.jurisdiction_id];
                    return binding && binding >= today;
                });

                // rank by recommendation count (desc), then by state (nulls last)
                let ranked = []
                if (loggedin){
                    ranked = runnable.sort((a, b) => {
                    const diff = (officeCounts[b.id] ?? 0) - (officeCounts[a.id] ?? 0);
                    return diff !== 0 ? diff : byStateThenName(a, b);
                });
                } else {
                    ranked = runnable.sort((a, b) => byStateThenName(a, b))
                }

                // attach each office's full, sorted, labeled deadline list for the hover
                ranked = ranked.map((o) => ({
                    ...o,
                    deadlines: fullDlMap[o.jurisdiction_id] ?? [],
                }))

                setCounts(officeCounts);
                setRecommendations(recs);
                setDeadlineByJurisdiction(dlMap);
                setOffices(ranked);
                // computed on the FULL set (pre deadline-filter) so "you don't qualify"
                // reflects age, not a closed filing window.
                setAnyQualified(offs.some((o) => o.qualifies === true));
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
// and add officesProp to the effect's dependency array so it re-runs when it arrives:
    }, [officesProp]);

    // Headline date for a card: the soonest upcoming filing/petition deadline (a
    // specific date like "Mar 15, 2026"). Displayed offices always have one — the
    // runnable filter guarantees it — so the year/TBD fallbacks are last resorts.
    function formatDeadline(office) {
        const iso = deadlineByJurisdiction[office.jurisdiction_id];
        if (iso) return formatDeadlineDate(iso);
        if (office.next_election_year) return `${office.next_election_year} election`;
        return "Filing date TBD";
    }

    // One office card: deadline/next-election label, optional "recommended you"
    // tally, and the office name.
    function RenderCard({ office, count }) {
        const [hovered, setHovered] = useState(false);
        // undefined = not fetched yet, null = none on record, number = cents
        const [goalCents, setGoalCents] = useState(undefined);
        const recd = count > 0;

        // Lazily pull the recommended financing goal the first time the card is
        // hovered — no need to fetch a goal for every card up front.
        async function handleEnter() {
            setHovered(true);
            if (goalCents !== undefined) return;
            try {
                const res = await api.get(`/api/offices/${office.id}/recommended-goal`);
                setGoalCents(res.data?.recommended_goal_cents ?? null);
            } catch (err) {
                console.error(err);
                setGoalCents(null);
            }
        }

        return (
            <div
                key = {office.id}
                className = {hovered ? 'hoveredWouldBeCard' : "wouldbeCard"}
                onMouseEnter = {handleEnter}
                onMouseLeave = {() => setHovered(false)}
            >
                {hovered ? (
                    <>
                        <div onClick={navigate(`/wouldbe/${office.id}`)}>
                            <h3 className='hoveredWouldBeName'>{office.state_code}:     {office.office_name}</h3>
                            <DeadlineTimeline deadlines={office.deadlines} goalCents=   {goalCents} />
                        </div>
                    </>
                ): (
                    <>
                        <div className='deadlineAmtIncumbent'>
                            <div className='deadlineAndAmount'>
                                <h3 className='deadline'>{formatDeadline(office)}   </h3>
                                {recd && (
                                    <>
                                    <span className='redCircle'></span>
                                        <h3 className='amount'>{count} ppl  recommended you</h3>
                                    </>
                                )}
                            </div>
                            <div className='Incumbent'></div>
                        </div>
                        <h3 className='officeOrWouldbeName'>{office.state_code}:    {office.office_name}</h3>                  
                    </>
                )}
            </div>
        )
    }

    // Bucket offices by required age, ascending -> [{ age, list }], so the UI can
    // show "Eligible at age 18 / 25 / 30 …" sub-sections.
    function groupByAge(list) {
        const buckets = {};
        for (const o of list) {
            const age = o.min_age ?? 0;
            (buckets[age] ||= []).push(o);
        }
        return Object.keys(buckets)
            .map(Number)
            .sort((a, b) => a - b)
            .map((age) => ({ age, list: buckets[age] }));
    }

    if (loading) return <div>Loading…</div>;

    // "Relevant" mode: the parent handed us offices annotated with qualifies /
    // relevance_tier (a logged-in, address-resolved user). Show what they qualify
    // for, then what they don't yet (by required age) in their own districts, then
    // statewide/national. Otherwise fall back to the flat ranked list (guest / the
    // full office browse).
    const isRelevant = offices.length > 0 && typeof offices[0].qualifies === 'boolean';

    if (!isRelevant) {
        if (!offices.length && loggedin == true) return <div>no qualified offices at this moment</div>;
        const visibleOffices = offices.slice(0, visibleCount);
        return (
            <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
                {visibleOffices.map((o) => (
                    <RenderCard key ={o.id} office = {o} count = {counts[o.id]} />
                ))}
                {(offices.length > visibleOffices.length ) && ( // why doesnt this button work
                    <>
                        <button className='loadmorebutton' onClick={() => setVisibleCount((c) => c + 10)}>
                        load more
                        </button>                       
                    </>
                )}
                {/* {(loggedin = true) && (
                    <>
                        <button className='loadmorebutton' onClick={() => setVisibleCount((c) => c + 10)}>
                        load more
                        </button>                       
                    </>
                )} */}
            </div>
        );
    }

    const byRecs = (a, b) =>
        (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || byStateThenName(a, b);
    const qualified = offices.filter((o) => o.qualifies).sort(byRecs);
    const districtLater = offices.filter((o) => !o.qualifies && o.relevance_tier === 'district');
    const stateLater = offices.filter((o) => !o.qualifies && o.relevance_tier !== 'district');
    const stateLabel = stateLater[0]?.state_code || 'your state';

    if (!qualified.length && !districtLater.length && !stateLater.length) {
        return (
            <div className='wouldbeEmptyNote'>
                No offices with open filing windows in your area right now — check back for the next
                election cycle.
            </div>
        );
    }

    return loggedin ? (
            <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
            {qualified.length > 0 ? (
                <>
                    <h2 className='wouldbeSectionHeader'>Offices you can run for</h2>
                    {qualified.map(renderCard)}
                </>
            ) : anyQualified ? (
                <p className='wouldbeEmptyNote'>
                    You qualify to run for offices in your area, but their filing windows have closed for
                    this cycle. Here’s what still has an open or upcoming window:
                </p>
            ) : (
                <p className='wouldbeEmptyNote'>
                    You don’t currently qualify to run for offices in your area — but here’s what you could
                    run for as you meet each age requirement:
                </p>
            )}

            {districtLater.length > 0 && (
                <>
                    <h2 className='wouldbeSectionHeader'>Not yet — offices in your districts</h2>
                    {groupByAge(districtLater).map(({ age, list }) => (
                        <React.Fragment key={`d-${age}`}>
                            <h3 className='wouldbeAgeHeader'>Eligible at age {age}</h3>
                            {list.map((o) => (
                                <RenderCard key ={o.id} office = {o} count = {counts[o.id]}/>
                            ))}
                        </React.Fragment>
                    ))}
                </>
            )}

            {stateLater.length > 0 && (
                <>
                    <h2 className='wouldbeSectionHeader'>Statewide &amp; national — {stateLabel}</h2>
                    {groupByAge(stateLater).map(({ age, list }) => (
                        <React.Fragment key={`s-${age}`}>
                            <h3 className='wouldbeAgeHeader'>Eligible at age {age}</h3>
                            {list.map((o) => (
                                <RenderCard key ={o.id} office = {o} count = {counts[o.id]}/>
                            ))}                        
                        </React.Fragment>
                    ))}
                </>
            )}
        </div>
        ):(
            <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
            {offices.length > 0 && (
                <>
                    <h2 className='wouldbeSectionHeader'>Offices you can run for</h2>
                    {offices.map(renderCard)}
                </>
            )}
            </div>
    )
}

export default WouldBeRows
