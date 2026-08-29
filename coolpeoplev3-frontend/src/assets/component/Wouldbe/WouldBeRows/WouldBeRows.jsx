import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDeadlineDate, formatUSD } from './deadlineFormat';
import FilingTimeline from '../FilingTimeline/FilingTimeline';
import api from '../../../lib/api';
import "./WouldBeRows.css"
import { useNavigate } from 'react-router-dom';

// ============================================================================
// The office browser — "what can I run for", answered in one screen.
//
// WHAT CHANGED AND WHY. This was a hover-driven list of ~250px black cards
// beside a fixed regulations panel. Three things were wrong with it and none
// were cosmetic:
//
//   FOUR OFFICES PER SCREEN, out of seven thousand. A row is ~72px now, so the
//   list is browsable and two offices can be compared without moving the mouse
//   between them.
//
//   HOVER WAS THE ONLY WAY IN. The office's name, its dates and its rules all
//   lived behind a hover, which is unreachable on touch, invisible to the
//   keyboard, and gone the instant you move toward what it revealed. Rows are
//   buttons now: click selects, the detail panel stays.
//
//   NOTHING SAID WHETHER YOU QUALIFY. `qualifies` was already on every row in
//   relevant mode and went unused; it is now the first thing each row and the
//   detail panel say. Where we DON'T know — a guest, or an office whose
//   requirements aren't encoded — the panel says that instead of guessing.
//
// Layout, toolbar, rows and panel are the .wb-browse block of the gold system
// in index.css.
// ============================================================================

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

// The deadline types that actually gate candidacy — the soonest of these is the
// binding, first-to-miss date and drives both the row's headline and the filter.
const ACTIONABLE_DEADLINES = new Set(["filing_close", "petition_filing_deadline"]);

// A deadline inside this window is URGENT, and urgency gets --wb-warn, not gold.
const SOON_DAYS = 30;

// Rows rendered per page. See the `limit` state for why there is a page at all.
const PAGE = 60;

const DAY_MS = 86400000;
const todayISO = () => new Date().toISOString().slice(0, 10);
const ms = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime();
const daysUntil = (iso) => Math.round((ms(iso) - ms(todayISO())) / DAY_MS);

const CheckIcon = () => (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// Human words for a jurisdiction/office type. The raw enum ('state_leg_upper')
// is a database fact, not a sentence, and putting it on screen made the list
// read like a table dump.
const OFFICE_TYPE_WORDS = {
    federal: 'Federal',
    state: 'Statewide',
    county: 'County',
    municipal: 'Municipal',
    school_district: 'School district',
    congressional_district: 'U.S. House',
    state_leg_upper: 'State senate',
    state_leg_lower: 'State house',
};
const officeTypeWord = (o) =>
    OFFICE_TYPE_WORDS[o.jurisdiction_type] ??
    (o.jurisdiction_type ? String(o.jurisdiction_type).replace(/_/g, ' ') : null);

// ---------------------------------------------------------------------------
// One row. A <button>, not a div: it is the page's primary control and has to
// be reachable by keyboard, which the hover card never was.
// ---------------------------------------------------------------------------
function OfficeRow({ office, selected, deadlineISO, deadlinesReady, onSelect }) {
    const days = deadlineISO ? daysUntil(deadlineISO) : null;
    // `qualifies` is only present in "relevant" mode (signed in, address
    // resolved). undefined means UNKNOWN, which must not render as "no".
    const qualifies = typeof office.qualifies === 'boolean' ? office.qualifies : null;

    let daysClass = '';
    // Before the calendar lands the date is UNKNOWN, not missing — "Date TBD"
    // there would state a fact about the office that we simply hadn't loaded.
    let daysText = deadlinesReady ? 'Date TBD' : '·';
    if (days != null) {
        if (days < 0) { daysClass = ' wb-office__days--past'; daysText = 'Closed'; }
        else if (days <= SOON_DAYS) { daysClass = ' wb-office__days--soon'; daysText = `${days} days`; }
        else daysText = `${days} days`;
    } else if (office.next_election_year) {
        daysText = `${office.next_election_year}`;
    }

    return (
        <li>
            <button
                type="button"
                className="wb-office"
                aria-selected={selected}
                onClick={() => onSelect(office)}
            >
                <span
                    className={`wb-office__mark wb-office__mark--${qualifies ? 'ok' : 'no'}`}
                    aria-hidden="true"
                >
                    {qualifies ? <CheckIcon /> : null}
                </span>
                <span className="wb-office__name">
                    {office.state_code ? `${office.state_code} ` : ''}{office.office_name}
                </span>
                <span className="wb-office__meta">
                    {office.state_code && <span>{office.state_code}</span>}
                    {officeTypeWord(office) && <><i>·</i><span>{officeTypeWord(office)}</span></>}
                    {office.min_age ? <><i>·</i><span>{office.min_age}+</span></> : null}
                    {/* relevance_tier is why an office is in YOUR list at all —
                        a seat in your own district is a different proposition
                        from a statewide one. The old screen carried it as a
                        section heading; a row carries it as a word. */}
                    {office.relevance_tier === 'district'
                        ? <><i>·</i><span>Your district</span></>
                        : null}
                </span>
                <span className="wb-office__when">
                    <span className={`wb-office__days${daysClass}`}>{daysText}</span>
                    {deadlineISO && (
                        <span className="wb-office__date">{formatDeadlineDate(deadlineISO)}</span>
                    )}
                </span>
            </button>
        </li>
    );
}

// ---------------------------------------------------------------------------
// The detail panel. Replaces the old Regulations panel's job — same facts, as a
// definition list rather than a column of "Min Age: 25" sentences.
// ---------------------------------------------------------------------------
function OfficeDetail({ office, calendar = [], goalCents, onOpen }) {
    if (!office) {
        return (
            <div className="wb-detail__card">
                <div className="wb-empty wb-empty--center">
                    <span className="wb-empty__t">Pick an office</span>
                    Choose one from the list to see its age, residency and citizenship
                    requirements, its filing calendar, and whether you can run for it.
                </div>
            </div>
        );
    }

    const reg = office.regulations ?? {};
    const qualifies = typeof office.qualifies === 'boolean' ? office.qualifies : null;
    // eligibility_is_encoded === false means the requirement columns are NOT
    // authoritative for this office. Showing hard numbers there would be
    // inventing them, so the panel says so and points at the filing authority.
    const encoded = reg.eligibility_is_encoded !== false;

    const verdict = qualifies === true
        ? { cls: 'ok', title: 'You can run for this', body: 'You meet the requirements we hold for this office.' }
        : qualifies === false
        ? { cls: 'no', title: "You don't qualify yet", body: reg.min_age ? `This seat requires you to be ${reg.min_age}.` : 'You do not yet meet this office’s requirements.' }
        : { cls: 'unknown', title: 'We don’t know yet', body: 'Sign in and add your address to see whether you qualify for this seat.' };

    return (
        <>
            <div className="wb-detail__card">
                <div>
                    <div className="wb-detail__eyebrow">Requirements</div>
                    <h2 className="wb-detail__title">
                        {office.state_code ? `${office.state_code} ` : ''}{office.office_name}
                    </h2>
                </div>

                <div className={`wb-verdict wb-verdict--${verdict.cls}`}>
                    <svg className="wb-verdict__ic" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="7.2" stroke="currentColor" strokeWidth="1.8" />
                        {verdict.cls === 'ok' ? (
                            <path d="M5.6 9.2l2.3 2.3 4.5-5" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                            <path d="M9 5.4v4.4M9 12.4v.1" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" />
                        )}
                    </svg>
                    <span><b>{verdict.title}</b>{verdict.body}</span>
                </div>

                {encoded ? (
                    <dl className="wb-reqs">
                        {reg.min_age != null && (
                            <div className={`wb-req wb-req--${qualifies === false ? 'fail' : 'pass'}`}>
                                <dt className="wb-req__k">Minimum age</dt>
                                <dd className="wb-req__v">{reg.min_age}</dd>
                            </div>
                        )}
                        {reg.citizenship_requirement && (
                            <div className="wb-req wb-req--pass">
                                <dt className="wb-req__k">Citizenship</dt>
                                <dd className="wb-req__v">
                                    {reg.citizenship_requirement === 'yes' ? 'U.S. citizen' : 'Not required'}
                                    {reg.citizenship_requirement === 'yes' && reg.citizenship_years_required
                                        ? <small>for {reg.citizenship_years_required} years</small>
                                        : null}
                                </dd>
                            </div>
                        )}
                        {reg.residency_requirement === 'yes' && (
                            <div className="wb-req wb-req--pass">
                                <dt className="wb-req__k">Residency</dt>
                                <dd className="wb-req__v">
                                    {office.state_code || 'Required'}
                                    {reg.residency_duration ? <small>{reg.residency_duration}</small> : null}
                                </dd>
                            </div>
                        )}
                        <div className="wb-req wb-req--pass">
                            <dt className="wb-req__k">Office type</dt>
                            <dd className="wb-req__v">{officeTypeWord(office) ?? '—'}</dd>
                        </div>
                    </dl>
                ) : (
                    <div className="wb-callout">
                        <span aria-hidden="true">◆</span>
                        <span>
                            We haven&apos;t encoded this office&apos;s requirements yet, so the
                            numbers above would be a guess. Confirm the age, residency and
                            filing rules with your state or local filing authority before you
                            rely on them.
                        </span>
                    </div>
                )}

                <button type="button" className="wb-btn wb-btn--primary" onClick={() => onOpen(office)}>
                    Start a campaign here →
                </button>

                {reg.eligibility_source_url && (
                    <p className="wb-src">
                        Source:{' '}
                        <a href={reg.eligibility_source_url} target="_blank" rel="noreferrer">
                            {reg.eligibility_source_url}
                        </a>
                    </p>
                )}
                {reg.eligibility_notes && <p className="wb-src">{reg.eligibility_notes}</p>}
            </div>

            <div className="wb-timeline-card">
                <div className="wb-tlh">
                    <span className="wb-tlh__t">
                        {office.state_code ? `${office.state_code} ` : ''}{office.office_name}
                    </span>
                    {goalCents != null && (
                        <span className="wb-tlh__g">Recommended goal <b>{formatUSD(goalCents)}</b></span>
                    )}
                </div>
                <FilingTimeline deadlines={calendar} goalCents={goalCents} />
            </div>
        </>
    );
}

function WouldBeRows({ offices: officesProp }) {
    const [offices, setOffices] = useState([]);
    // jurisdiction id -> soonest filing/petition date (ISO string)
    const [deadlineByJurisdiction, setDeadlineByJurisdiction] = useState({});
    // jurisdiction id -> the full labeled calendar, for the selected office's
    // timeline. Kept OFF the office rows: attaching it meant rebuilding 7,000
    // objects the moment the deadline reads landed, to serve the one office
    // actually on screen.
    const [calendarByJurisdiction, setCalendarByJurisdiction] = useState({});
    const [deadlinesReady, setDeadlinesReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loggedin, setLoggedIn] = useState(false);

    // toolbar state
    const [query, setQuery] = useState('');
    const [onlyQualified, setOnlyQualified] = useState(false);
    const [onlyOpen, setOnlyOpen] = useState(false);
    // How many rows are in the DOM. Seven thousand <button>s is seconds of
    // layout on their own, and nobody scrolls past the first screenful before
    // typing in the search box. Reset by the controls that change the result
    // set, not by an effect watching them — carrying a 600-row page into a new
    // search would render six hundred matches for two characters.
    const [limit, setLimit] = useState(PAGE);

    // selection: the office whose panel is showing, plus the two things loaded
    // on demand for it (its eligibility row and its recommended goal).
    const [selected, setSelected] = useState(null);
    const [goalCents, setGoalCents] = useState(null);

    const navigate = useNavigate();

    // ── PHASE 1: the rows. ───────────────────────────────────────────────
    // This used to await one /election-deadlines request PER STATE — up to
    // fifty of them, 2,000 rows each — before a single office appeared. The
    // offices were already in hand the whole time; the screen was blocked on
    // the date column. So the list renders as soon as the offices land, and the
    // dates fill in behind it.
    useEffect(() => {
        let cancelled = false;
        async function loadOffices() {
            try {
                let [recRes, offRes] = [{}, {}];
                const signedIn = !!(localStorage.getItem('token') && localStorage.getItem('refreshToken'));
                if (signedIn) {
                    setLoggedIn(true);
                    [recRes, offRes] = await Promise.all([
                        api.get("/api/recommendations/received"),
                        officesProp ? Promise.resolve({ data: officesProp }) : api.get("/api/offices"),
                    ]);
                } else {
                    offRes = await api.get("/api/offices");
                }
                if (cancelled) return;

                const offs = officesProp ?? offRes.data ?? [];

                // tally recommendations per office
                const officeCounts = {};
                for (const rec of recRes.data ?? []) {
                    officeCounts[rec.office_id] = (officeCounts[rec.office_id] ?? 0) + 1;
                }

                // Rank: what you qualify for first, then most-recommended, then
                // by state. Eligibility leads because it is the question the
                // screen exists to answer — sorting a list of 7,000 seats you
                // can't run for by anything else buries the handful you can.
                // Note it does NOT depend on deadlines, which is what lets the
                // list render before they arrive.
                const ranked = [...offs].sort((a, b) => {
                    const qa = a.qualifies === true ? 0 : 1;
                    const qb = b.qualifies === true ? 0 : 1;
                    if (qa !== qb) return qa - qb;
                    const diff = (officeCounts[b.id] ?? 0) - (officeCounts[a.id] ?? 0);
                    return diff !== 0 ? diff : byStateThenName(a, b);
                });

                setOffices(ranked);
            } catch (err) {
                console.error(err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        loadOffices();
        return () => { cancelled = true };
    }, [officesProp]);

    // ── PHASE 2: the filing calendar, behind the list. ───────────────────
    // Deadlines are fetched SCOPED TO THE STATES on screen — one request per
    // state, never a global page. The /api/election-deadlines list orders by
    // state alphabetically and caps at 2,000 rows, so a blanket fetch silently
    // drops every state past the cutoff. Scoping keeps each request whole (even
    // NY, the largest, is ~1.6k rows across all 12 types). Every type is
    // fetched, not just filing_close, so we can gate on petition deadlines too
    // and plot the full labeled calendar in the panel.
    useEffect(() => {
        if (!offices.length) return;
        let cancelled = false;
        async function loadDeadlines() {
            const stateCodes = [...new Set(offices.map((o) => o.state_code).filter(Boolean))];
            if (!stateCodes.length) { setDeadlinesReady(true); return; }
            try {
                const responses = await Promise.all(
                    stateCodes.map((sc) =>
                        api.get(`/api/election-deadlines?state_code=${sc}&limit=2000`)
                            .catch(() => ({ data: [] }))
                    )
                );
                if (cancelled) return;

                // Two maps, keyed by jurisdiction:
                //   calendar — EVERY deadline as { type, date }, soonest-first.
                //              Powers the selected office's timeline.
                //   binding  — the EARLIEST filing/petition deadline (past OR
                //              future). This is the first-to-miss date: if it
                //              has passed, the ballot window is gone even when
                //              filing_close is later. Drives the row's headline
                //              date and the "Filing open" filter.
                const calendar = {};
                const binding = {};
                for (const r of responses) {
                    for (const d of r.data ?? []) {
                        if (!d.deadline_date) continue;
                        const date = String(d.deadline_date).slice(0, 10);
                        (calendar[d.jurisdiction_id] ??= []).push({ type: d.deadline_type, date });
                        if (ACTIONABLE_DEADLINES.has(d.deadline_type)) {
                            const existing = binding[d.jurisdiction_id];
                            if (!existing || date < existing) binding[d.jurisdiction_id] = date;
                        }
                    }
                }
                for (const jur of Object.keys(calendar)) {
                    calendar[jur].sort((a, b) => a.date.localeCompare(b.date));
                }

                // One state update at the end, not one per response: each of
                // these maps has thousands of keys and fifty rebuilds of them
                // would cost more than the requests did.
                setCalendarByJurisdiction(calendar);
                setDeadlineByJurisdiction(binding);
            } catch (err) {
                console.error(err);
            } finally {
                if (!cancelled) setDeadlinesReady(true);
            }
        }
        loadDeadlines();
        return () => { cancelled = true };
    }, [offices]);

    // Selecting an office loads the two things a row doesn't carry: its
    // eligibility row and its recommended goal. Both are per-office reads, so
    // they only happen for the one office actually being looked at.
    const selectOffice = useCallback(async (office) => {
        setSelected({ ...office, regulations: null });
        setGoalCents(null);
        const [elig, goal] = await Promise.all([
            api.get(`/api/offices/${office.id}/eligibility`).catch(() => ({ data: {} })),
            api.get(`/api/offices/${office.id}/recommended-goal`).catch(() => ({ data: null })),
        ]);
        // Guard against a slower response for a previously-clicked office
        // landing after a newer one and overwriting the panel.
        setSelected((cur) => (cur?.id === office.id ? { ...office, regulations: elig.data ?? {} } : cur));
        setGoalCents((cur) => (goal.data?.recommended_goal_cents ?? cur ?? null));
    }, []);

    // Click through to the full StartAWouldBe flow for an office.
    const openOffice = useCallback((office) => {
        navigate(`/wouldbe/${office.jurisdiction_id}/${office.id}`);
    }, [navigate]);

    // The toolbar's filters, applied together. Derived, never stored — a stored
    // "filtered list" is a second copy that goes stale on every keystroke.
    //
    // The open-window rule lives HERE now rather than at load time, because the
    // deadlines it needs arrive after the rows do. Until they land it passes
    // everything through: hiding rows on data we don't have yet would empty the
    // list for a second and then refill it.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const today = todayISO();
        // ⚠️ DEV SCAFFOLD — drop `DEV_... ? false :` to restore normal behaviour.
        const requireOpen = DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES ? onlyOpen : true;
        return offices.filter((o) => {
            if (onlyQualified && o.qualifies !== true) return false;
            if (requireOpen && deadlinesReady) {
                const binding = deadlineByJurisdiction[o.jurisdiction_id];
                if (!binding || binding < today) return false;
            }
            if (!q) return true;
            return (
                o.office_name?.toLowerCase().includes(q) ||
                o.state_code?.toLowerCase().includes(q) ||
                o.jurisdiction_name?.toLowerCase().includes(q)
            );
        });
    }, [offices, query, onlyQualified, onlyOpen, deadlineByJurisdiction, deadlinesReady]);

    const shown = visible.slice(0, limit);

    const qualifiedCount = useMemo(
        () => offices.filter((o) => o.qualifies === true).length,
        [offices]
    );
    // Only meaningful when the server actually annotated eligibility.
    const hasEligibility = offices.some((o) => typeof o.qualifies === 'boolean');

    if (loading) return <p className="wb-browse">Loading…</p>;

    // ⚠️ DEV SCAFFOLD — delete this and its use below. It exists so the bypass
    // is impossible to miss on screen (and impossible to ship by accident).
    const devBanner = DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES ? (
        <div className="wb-dev">
            <span aria-hidden="true">▲</span>
            <span>
                <b>DEV</b> — showing offices whose filing deadlines have already passed ·{' '}
                <code>DEV_SHOW_OFFICES_WITH_PASSED_DEADLINES</code> in <code>WouldBeRows.jsx</code>
            </span>
        </div>
    ) : null;

    return (
        <div className="wb-browse">
            <div className="wbr-list">
                {devBanner}

                <div className="wb-toolbar">
                    <div className="wb-toolbar__row">
                        <label className="wb-field">
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.7" opacity=".5" />
                                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.7"
                                      strokeLinecap="round" opacity=".5" />
                            </svg>
                            <input
                                placeholder="Search offices or states"
                                aria-label="Search offices"
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }}
                            />
                        </label>
                        {hasEligibility && (
                            <button
                                type="button"
                                className="wb-filter"
                                aria-pressed={onlyQualified}
                                onClick={() => { setOnlyQualified((v) => !v); setLimit(PAGE) }}
                            >
                                I qualify
                            </button>
                        )}
                        <button
                            type="button"
                            className="wb-filter"
                            aria-pressed={onlyOpen}
                            onClick={() => { setOnlyOpen((v) => !v); setLimit(PAGE) }}
                        >
                            Filing open
                        </button>
                    </div>
                    <div className="wb-count">
                        <b>{visible.length}</b> office{visible.length === 1 ? '' : 's'}
                        {hasEligibility && <> · <b>{qualifiedCount}</b> you qualify for</>}
                        {!loggedin && <> · sign in to see what you qualify for</>}
                    </div>
                </div>

                {visible.length ? (
                    <>
                    <ul className="wb-offices" role="listbox" aria-label="Offices">
                        {shown.map((o) => (
                            <OfficeRow
                                key={o.id}
                                office={o}
                                selected={selected?.id === o.id}
                                deadlineISO={deadlineByJurisdiction[o.jurisdiction_id]}
                                deadlinesReady={deadlinesReady}
                                onSelect={selectOffice}
                            />
                        ))}
                    </ul>
                    {visible.length > shown.length && (
                        <button
                            type="button"
                            className="wb-btn wb-btn--secondary wbr-more"
                            onClick={() => setLimit((n) => n + PAGE)}
                        >
                            Show {Math.min(PAGE, visible.length - shown.length)} more
                            <span> · {visible.length - shown.length} left</span>
                        </button>
                    )}
                    </>
                ) : (
                    <div className="wb-empty">
                        <span className="wb-empty__t">Nothing matches those filters</span>
                        {offices.length
                            ? 'Try clearing the search, or turning off “I qualify” / “Filing open”.'
                            : 'No offices with open filing windows in your area right now — check back for the next election cycle.'}
                    </div>
                )}
            </div>

            <aside className="wb-detail">
                <OfficeDetail
                    office={selected}
                    calendar={selected ? calendarByJurisdiction[selected.jurisdiction_id] ?? [] : []}
                    goalCents={goalCents}
                    onOpen={openOffice}
                />
            </aside>
        </div>
    );
}

export default WouldBeRows
