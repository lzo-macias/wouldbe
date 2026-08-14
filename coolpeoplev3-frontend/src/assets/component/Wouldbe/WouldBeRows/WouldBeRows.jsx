import React, { useState, useEffect } from 'react'
import DeadlineTimeline from './DeadlineTimeline';
import { DEADLINE_LABELS, formatDeadlineDate, formatUSD } from './deadlineFormat';
import api from '../../../lib/api';
import "./WouldBeRows.css"
import { useNavigate } from 'react-router-dom';
import Regulations from '../Regulations/Regulations';

// Show the offices we hold data for, ranked by how many recommendations the
// caller has received for each office (most-recommended first). Each card shows
// the office's filing-close deadline (last day to file to run), resolved via the
// office's jurisdiction.

// Alphabetical ordering key: sort by the office's STATE (from its jurisdiction),
// not the office name — "US Representative LA-6" belongs under Louisiana, not "U".
// Offices with no state (e.g. President, which is national) sink to the bottom.
// office_name is the final tiebreak so ordering within a state stays stable.


function byStateThenName(a, b) {
    const sa = a.state_code || null;
    const sb = b.state_code || null;
    if (sa === null && sb === null) return a.office_name.localeCompare(b.office_name);
    if (sa === null) return 1;   // a has no state -> after b
    if (sb === null) return -1;  // b has no state -> after a
    return sa.localeCompare(sb) || a.office_name.localeCompare(b.office_name);
}

// DEADLINE_LABELS, formatDeadlineDate and formatUSD now live in ./deadlineFormat
// (shared with DeadlineTimeline) — imported above.

// ⚠️ ─────────────────── TEMPORARY DEV SCAFFOLD — DELETE ME ───────────────────
// Set to false (or delete this const and the two blocks marked "DEV SCAFFOLD"
// below) to restore normal behaviour.
//
// WHY IT'S HERE: as of 2026-08-10 EVERY seeded filing deadline is in the past —
// the last filing_close nationally was 2026-08-07 — and no 2027/2028 calendars
// are seeded yet. The deadline filter is working correctly and hiding all 7,400+
// offices, which leaves nothing to click through and no way to practise the
// WouldBe creation flow from the feed.
//
// Nothing on the backend blocks creation: getReadiness gates on race_open
// (general_date >= today), and general dates ARE still upcoming. So bypassing
// this filter surfaces offices that the rest of the stack will happily accept.
//
// REMOVE ONCE the 2027+ filing deadlines are seeded.
const DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES = true;
// ⚠️ ───────────────────────────────────────────────────────────────────────────

// The deadline types that actually gate candidacy — an office is shown only if one
// of these is still upcoming, and the soonest drives the card's headline date.
const ACTIONABLE_DEADLINES = new Set(["filing_close", "petition_filing_deadline"]);

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

// The hover card in the WouldBe list plots ONLY these milestones (+ Today, which
// the timeline adds itself). StartAnOffice shows every deadline instead.
const HOVER_DEADLINE_TYPES = ["filing_close", "petition_filing_deadline", "primary_date", "general_date"];



// A timeline of ALL an office's deadlines in chronological order, with a "Today"
// marker in its place. Points are spaced EVENLY (not by real date) so that with
// every name + date always shown, no two labels ever overlap — the card stays the
// fixed size of a collapsed card. Same-day deadlines collapse into one line.


// Headline date for a card: soonest upcoming filing/petition deadline (else a
// year fallback / TBD).
function formatDeadline(office, deadlineByJurisdiction) {
    const iso = deadlineByJurisdiction[office.jurisdiction_id];
    if (iso) return formatDeadlineDate(iso);
    if (office.next_election_year) return `${office.next_election_year} election`;
    return "Filing date TBD";
}

// One office card. HOVER shows this office's regulations (onHover) and lazily
// loads its recommended goal; CLICK opens the full StartAWouldBe flow (onOpen).
// Defined at MODULE scope (not inside WouldBeRows) so that selecting an office —
// a parent re-render — doesn't change this component's identity and remount every
// card, which would wipe each card's local `hovered` state mid-hover.
function RenderCard({ office, count, deadlineByJurisdiction, onHover, onOpen }) {
    const [hovered, setHovered] = useState(false);
    // undefined = not fetched yet, null = none on record, number = cents
    const [goalCents, setGoalCents] = useState(undefined);
    const recd = count > 0;

    async function handleEnter() {
        setHovered(true);
        onHover(office);                 // load THIS office's regulations into the panel
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
            className={hovered ? 'hoveredWouldBeCard' : "wouldbeCard"}
            onMouseEnter={handleEnter}
            onMouseLeave={() => setHovered(false)}
        >
            {hovered ? (
                <div onClick={() => onOpen(office)}>
                    {goalCents != null && (
                        <div className='hoveredGoalChip'>Recommended financing goal <b>{formatUSD(goalCents)}</b></div>
                    )}
                    <h3 className='hoveredWouldBeName'>{office.state_code}:     {office.office_name}</h3>
                    <DeadlineTimeline deadlines={office.deadlines} allowedTypes={HOVER_DEADLINE_TYPES} />
                </div>
            ) : (
                <>
                    <div className='deadlineAmtIncumbent'>
                        <div className='deadlineAndAmount'>
                            <h3 className='deadline'>{formatDeadline(office, deadlineByJurisdiction)}   </h3>
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
    const navigate = useNavigate()
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
                const lackingDeadlines = {}
                for (const d of deadlines) {
                    if (!d.deadline_date) {
                        (lackingDeadlines[d.jurisdiction_id]??= []).push({message: "no deadline"});continue
                    }
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
                // ⚠️ DEV SCAFFOLD — the `DEV_...` branch is temporary; delete it and
                // keep the .filter() to restore normal behaviour. See the flag's
                // comment at the top of this file.
                const runnable = DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES
                    ? offs
                    : offs.filter((o) => {
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

    // The office whose Regulations panel is shown beside the list (null = none yet).
    const [selectedOffice, setSelectedOffice] = useState(null)

    // Hovering a card selects its office and loads THAT office's eligibility, then
    // shapes the object into what <Regulations> expects:
    //   - regulations: the eligibility row (Regulations reads office.regulations.*)
    //   - deadlines:   WouldBeRows carries { type, date }; Regulations wants
    //                  { deadline_type, deadline_date } — normalize so its filing
    //                  line renders. Defaults keep Regulations from crashing on a
    //                  missing eligibility row (fields just render blank).
    async function selectOffice(office) {
        const deadlines = (office.deadlines ?? []).map((d) => ({
            deadline_type: d.type,
            deadline_date: d.date,
        }))
        try {
            const eligRes = await api.get(`/api/offices/${office.id}/eligibility`)
            setSelectedOffice({ ...office, regulations: eligRes.data ?? {}, deadlines })
        } catch (err) {
            console.error(err)
            setSelectedOffice({ ...office, regulations: {}, deadlines })
        }
    }


    // Click a card -> full StartAWouldBe flow for that office.
    function openOffice(office) {
        navigate(`/wouldbe/${office.jurisdiction_id}/${office.id}`);
    }

    // One mapped card, wired to hover->show-regulations and click->open. Pass this
    // straight to .map so every list renders identical, correctly-wired cards.
    const renderOfficeCard = (o) => (
        <RenderCard
            key={o.id}
            office={o}
            count={counts[o.id]}
            deadlineByJurisdiction={deadlineByJurisdiction}
            onHover={selectOffice}
            onOpen={openOffice}
        />
    );

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

    // The Regulations panel shown to the LEFT of the list. Its jurisdiction fields
    // come straight off the office row (listOffices joins the jurisdiction in), so
    // no extra jurisdiction fetch is needed. Continue proceeds to the full flow.
    const selectedJurisdiction = selectedOffice
        ? { state_code: selectedOffice.state_code, name: selectedOffice.jurisdiction_name, type: selectedOffice.jurisdiction_type }
        : null;

    // ⚠️ DEV SCAFFOLD — delete this const and its use below. It exists so the
    // bypass is impossible to miss on screen (and impossible to ship by accident).
    const devBanner = DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES ? (
        <div className="devDeadlineBypassBanner">
            ⚠️ DEV: showing offices whose filing deadlines have already passed.
            Set <code>DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES = false</code> in WouldBeRows.jsx to disable.
        </div>
    ) : null;

    const regulationsPanel = (
        <div className="regulationContainer">
            {devBanner}
            {selectedOffice ? (
                <Regulations
                    office={selectedOffice}
                    jurisdiction={selectedJurisdiction}
                    onComplete={() => navigate(`/wouldbe/${selectedOffice.jurisdiction_id}/${selectedOffice.id}`)}
                />
            ) : (
                <p className="regulationsPlaceholder">Hover an office to see its rules.</p>
            )}
        </div>
    );

    // "Relevant" mode: the parent handed us offices annotated with qualifies /
    // relevance_tier (a logged-in, address-resolved user). Show what they qualify
    // for, then what they don't yet (by required age) in their own districts, then
    // statewide/national. Otherwise fall back to the flat ranked list (guest / the
    // full office browse).
    const isRelevant = offices.length > 0 && typeof offices[0].qualifies === 'boolean';
    const noDeadlines = offices.filter(o => !o.deadline_date)

    if (!isRelevant) {
        if (!offices.length && loggedin == true) {
            return <div>
               <p>no qualified offices at this moment</p>
               <p>{noDeadlines.map(renderOfficeCard)}</p>
            </div>;
        }
        const visibleOffices = offices.slice(0, visibleCount);
        return (
            <div className='mainContainer'>
                {regulationsPanel}
                <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
                    {visibleOffices.map(renderOfficeCard)}
                    {(offices.length > visibleOffices.length ) && (
                        <button className='loadmorebutton' onClick={() => setVisibleCount((c) => c + 10)}>
                        load more
                        </button>
                    )}
                </div>
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
        <div className='mainContainer'>
            {regulationsPanel}
            <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
            {qualified.length > 0 ? (
                <>
                    <h2 className='wouldbeSectionHeader'>Offices you can run for</h2>
                    {qualified.map(renderOfficeCard)}
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
                            {list.map(renderOfficeCard)}
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
                            {list.map(renderOfficeCard)}                        
                        </React.Fragment>
                    ))}
                </>
            )}
        </div>
    </div>
        ):(
        <div className='mainContainer'>
            {regulationsPanel}
            <div id="wouldBeRowsMainContainer" className='wouldBeRowsMainContainer'>
            {offices.length > 0 && (
                <>
                    <h2 className='wouldbeSectionHeader'>Offices you can run for</h2>
                    {offices.map(renderOfficeCard)}
                </>
            )}
            </div>
        </div>
    )
}

export default WouldBeRows
