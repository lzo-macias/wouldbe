import React, { useState, useEffect, useMemo } from 'react'
import api from '../../lib/api'
import './Admin.css'

// Admin dashboard v1 — browse the pre-seeded electoral reference data with
// search + filter. Reads are public endpoints; the shared api instance attaches
// the Bearer token when present (harmless, future-proofs gated reads).

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const JURISDICTION_TYPES = ['federal','state','congressional_district','state_leg_upper','state_leg_lower','municipal','city_council_district'];

// Each dataset: how to fetch it + which columns to show + which filters apply.
const DATASETS = {
    offices: {
        label: 'Offices',
        needsState: true,
        url: (f) => `/api/offices?state=${f.state}`,
        columns: [['office_name','Office'],['district_identifier','District'],['office_type','Type'],['chamber','Chamber'],['min_age','Min age'],['residency_duration','Residency'],['resolution_method','Resolution']],
    },
    jurisdictions: {
        label: 'Jurisdictions',
        hasType: true,
        url: (f) => `/api/jurisdictions?limit=500${f.state ? `&state_code=${f.state}` : ''}${f.type ? `&type=${f.type}` : ''}`,
        columns: [['name','Name'],['type','Type'],['state_code','State'],['ocd_division_id','OCD-id'],['boundaries_loaded','Boundaries']],
    },
    filing: {
        label: 'Filing authorities',
        url: () => `/api/filing-authorities?limit=200`,
        columns: [['authority_name','Authority'],['authority_level','Level'],['jurisdiction_name','Jurisdiction'],['state_code','State'],['registration_portal_url','Portal']],
    },
    rules: {
        label: 'Contribution limits',
        url: (f) => `/api/rules-versions?limit=400${f.state ? `&state_code=${f.state}` : ''}`,
        columns: [['jurisdiction_name','Jurisdiction'],['state_code','State'],['version','Version'],['contribution_limit_individual_primary','Indiv. limit'],['advancement_rule','Advancement'],['matching_funds_program','Match funds']],
    },
    deadlines: {
        label: 'Deadlines',
        needsState: true,
        url: (f) => `/api/election-deadlines?limit=1500&state_code=${f.state}`,
        columns: [['jurisdiction_name','Jurisdiction'],['deadline_type','Type'],['deadline_date','Date'],['is_tbd','TBD'],['state_code','State']],
    },
    categories: {
        label: 'Categories',
        url: () => `/api/categories`,
        columns: [['display_name','Name'],['category_group','Group'],['category_key','Key']],
    },
    // The sponsor submission inbox. Unlike every other dataset here this one is
    // requireAdmin() on the server, so it 403s for a non-admin token instead of
    // returning rows. ?status=draft = submitted and not yet published.
    applications: {
        label: 'Debate applications',
        // hasStatus + actions are what turn this tab into a review queue rather
        // than another read-only table.
        hasStatus: true,
        actions: true,
        url: (f) => `/api/debate-applications?status=${f.appStatus || 'draft'}`,
        columns: [
            ['title','Debate'],
            ['format','Format'],
            ['category','Category'],
            ['sponsor_display_name','Sponsor'],
            // Hosting is free now. These three stay for debates created while
            // the host fee existed — new rows simply show "—".
            ['tier_name','Plan (legacy)'],
            ['tier_status','Fee (legacy)'],
            ['prompt_count','Prompts'],
            ['win_type','Win by'],
            ['judge_count','Judges'],
            ['sponsor_contribution_cents','Prize'],
            ['start_date','Starts'],
            ['status','Status'],
            ['created_at','Submitted'],
        ],
    },
    // WouldBe campaigns awaiting review. Same requireAdmin() shape as the debate
    // inbox. `kind` tells the action handlers which endpoints to hit.
    wouldbes: {
        label: 'WouldBe campaigns',
        hasStatus: true,
        actions: true,
        kind: 'wouldbe',
        url: (f) => `/api/wouldbe-applications?launch_status=${f.wbStatus || 'draft'}`,
        columns: [
            ['title','Campaign'],
            ['username','Candidate'],
            ['office_name','Office'],
            ['state_code','State'],
            ['goal_cents','Goal'],
            ['fee_paid','Fee'],
            ['committee_ok','Committee'],
            ['has_plan','Plan'],
            ['pledger_count','Pledges'],
            ['launch_status','Status'],
            ['created_at','Created'],
        ],
    },
};

// columns rendered as a pill badge
const BADGE_KEYS = new Set(['office_type', 'chamber', 'type', 'authority_level', 'advancement_rule', 'category_group', 'deadline_type', 'win_type', 'status', 'tier_status', 'launch_status', 'format']);

// The lifecycle states an application can be filtered by in the review queue.
// 'draft' is the actual inbox: submitted and not yet acted on.
// launch_status values a campaign can sit in while it waits.
const WB_STATUSES = [
    ['draft', 'New'],
    ['pending_committee', 'Waiting on committee'],
    ['pending_review', 'Ready for review'],
    ['suspended', 'Suspended'],
    ['all', 'All open'],
];

const APP_STATUSES = [
    ['draft', 'Awaiting review'],
    ['open_entry', 'Approved'],
    ['cancelled', 'Rejected'],
    ['all', 'All'],
];

// cents columns rendered as dollars
const MONEY_KEYS = new Set(['sponsor_contribution_cents', 'sponsor_entry_fee_cents', 'entry_price_cents', 'prize_pool_cents', 'tier_price_cents', 'goal_cents']);

function cell(key, value) {
    if (value === null || value === undefined || value === '') return <span className="admin__muted">—</span>;
    if (typeof value === 'boolean') return value ? '✅' : <span className="admin__muted">—</span>;
    if (key === 'contribution_limit_individual_primary') return `$${(Number(value) / 100).toLocaleString()}`;
    if (MONEY_KEYS.has(key)) return `$${(Number(value) / 100).toLocaleString()}`;
    if (key === 'created_at') return new Date(value).toLocaleString();
    if (key === 'start_date') return String(value).slice(0, 10);
    if (key === 'deadline_date') return String(value).slice(0, 10);
    if (key === 'ocd_division_id') return <span className="admin__ocd">{value}</span>;
    if (typeof value === 'string' && value.startsWith('http')) return <a href={value} target="_blank" rel="noreferrer">link</a>;
    if (BADGE_KEYS.has(key)) return <span className="admin__badge">{String(value).replace(/_/g, ' ')}</span>;
    if (typeof value === 'string' && value.length > 52) return <span title={value}>{value.slice(0, 50)}…</span>;
    return String(value);
}

function Admin() {
    const [active, setActive] = useState('offices');
    const [state, setStateFilter] = useState('NY');
    const [type, setType] = useState('');
    const [appStatus, setAppStatus] = useState('draft');
    const [wbStatus, setWbStatus] = useState('draft');
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // debate id currently being approved/rejected — disables both buttons on
    // that row so a double-click can't fire two reviews.
    const [acting, setActing] = useState(null);
    const [notice, setNotice] = useState(null);
    // Bumped after a review to re-run the fetch effect.
    const [refresh, setRefresh] = useState(0);
    // Which application's prompts are open, and what came back. A typed debate
    // is REVIEWED ON ITS PROMPTS — they are the questions two strangers will be
    // told to argue, published under the platform's name — so the queue cannot
    // just say "15" and call that visible.
    const [openPrompts, setOpenPrompts] = useState(null);   // debate id
    const [promptData, setPromptData] = useState(null);
    const [promptError, setPromptError] = useState(null);

    const ds = DATASETS[active];

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get(ds.url({ state, type, appStatus, wbStatus }))
            .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
            .catch((err) => { if (!cancelled) { setError(err.response?.data?.error || 'Failed to load'); setRows([]); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [active, state, type, appStatus, wbStatus, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

    // approve — no money is involved anywhere; hosting is free. The server still
    // refuses if a hybrid debate has no panel or the prize wasn't signed for, so
    // the error it returns is worth showing verbatim.
    async function approve(row) {
        const isWouldbe = ds.kind === 'wouldbe';
        setActing(row.id);
        setNotice(null);
        setError(null);
        try {
            // The server re-checks every gate — fee paid, committee on file,
            // race still open — so a 409 here is informative, not a bug. Show
            // its message verbatim: it names the exact blocker.
            const path = isWouldbe
                ? `/api/wouldbes/${row.id}/approve`
                : `/api/debate-applications/${row.id}/approve`;
            await api.post(path);
            setNotice(
                isWouldbe
                    ? `Approved "${row.title}" — it is live and can take pledges.`
                    : `Approved "${row.title}" — it is now open for entry.`
            );
            setRefresh((n) => n + 1);
        } catch (err) {
            setError(err.response?.data?.error || 'Approve failed');
        } finally {
            setActing(null);
        }
    }

    // Not a rejection — the campaign is fine, the candidate just hasn't filed a
    // committee yet. Moves it out of the "needs a human" queue.
    async function askForCommittee(row) {
        setActing(row.id);
        setNotice(null);
        setError(null);
        try {
            await api.post(`/api/wouldbes/${row.id}/request-committee`, {
                note: 'A registered committee is required before this campaign can go live.',
            });
            setNotice(`"${row.title}" moved to Waiting on committee.`);
            setRefresh((n) => n + 1);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed');
        } finally {
            setActing(null);
        }
    }

    // reject — cancels the debate. Hosting is free, so there is normally nothing
    // to refund; the refund path still runs for debates created while the host
    // fee existed, which is why the confirm still names an amount when there is one.
    async function reject(row) {
        if (ds.kind === 'wouldbe') {
            const ok = window.confirm(`Reject "${row.title}"? The candidate is told why.`);
            if (!ok) return;
            // The server REQUIRES a reason — a campaign that fails with no
            // explanation is a support ticket the candidate can't act on.
            const reason = window.prompt('Reason (shown to the candidate):', '');
            if (!reason || !reason.trim()) return;

            setActing(row.id);
            setNotice(null);
            setError(null);
            try {
                await api.post(`/api/wouldbes/${row.id}/reject`, { reason: reason.trim() });
                setNotice(`Rejected "${row.title}".`);
                setRefresh((n) => n + 1);
            } catch (err) {
                setError(err.response?.data?.error || 'Reject failed');
            } finally {
                setActing(null);
            }
            return;
        }

        const paid = row.tier_status === 'paid';
        const ok = window.confirm(
            `Reject "${row.title}"?` +
            (paid ? `\n\nThis refunds their ${((row.tier_price_cents || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })} host fee.` : '')
        );
        if (!ok) return;
        const reason = window.prompt('Reason (shown to the sponsor):', '') ?? '';

        setActing(row.id);
        setNotice(null);
        setError(null);
        try {
            const { data } = await api.post(`/api/debate-applications/${row.id}/reject`, { reason });
            setNotice(
                data.refund_due
                    ? `Rejected "${row.title}" — but the refund FAILED (${data.refund_error}). Refund it in Stripe.`
                    : `Rejected "${row.title}"${data.refunded ? ' and refunded the host fee.' : '.'}`
            );
            setRefresh((n) => n + 1);
        } catch (err) {
            setError(err.response?.data?.error || 'Reject failed');
        } finally {
            setActing(null);
        }
    }

    // Open (or close) one application's prompts. Reads the PUBLIC match-prompts
    // endpoint rather than the admin application detail: it returns every
    // bracket slot whether or not it has been written, which is exactly the
    // question an admin has — "is this thing finished?" — and the unslotted
    // list alongside it for a live debate's ordered prompts.
    async function togglePrompts(row) {
        if (openPrompts === row.id) {
            setOpenPrompts(null);
            setPromptData(null);
            return;
        }
        setOpenPrompts(row.id);
        setPromptData(null);
        setPromptError(null);
        try {
            const { data } = await api.get(`/api/debates/${row.id}/match-prompts`);
            setPromptData(data);
        } catch (err) {
            setPromptError(err.response?.data?.error || 'Could not load the prompts');
        }
    }

    // client-side free-text search across the visible columns
    const filtered = useMemo(() => {
        if (!search.trim()) return rows;
        const q = search.toLowerCase();
        const keys = ds.columns.map((c) => c[0]);
        return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
    }, [rows, search, ds]);

    const showState = ds.needsState || active === 'jurisdictions' || active === 'rules';

    return (
        <div className="admin">
            <header className="admin__header">
                <h1>Admin · Reference Data</h1>
                <p>Browse the pre-seeded offices, jurisdictions, authorities, limits & deadlines.</p>
            </header>

            <nav className="admin__tabs">
                {Object.entries(DATASETS).map(([key, d]) => (
                    <button
                        key={key}
                        className={`admin__tab${active === key ? ' admin__tab--active' : ''}`}
                        onClick={() => { setActive(key); setSearch(''); }}
                    >
                        {d.label}
                    </button>
                ))}
            </nav>

            <div className="admin__filters">
                {showState && (
                    <label>State
                        <select value={state} onChange={(e) => setStateFilter(e.target.value)}>
                            {!ds.needsState && <option value="">All</option>}
                            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                )}
                {ds.hasStatus && (
                    <label>Queue
                        {ds.kind === 'wouldbe' ? (
                            <select value={wbStatus} onChange={(e) => setWbStatus(e.target.value)}>
                                {WB_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        ) : (
                            <select value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
                                {APP_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        )}
                    </label>
                )}
                {ds.hasType && (
                    <label>Type
                        <select value={type} onChange={(e) => setType(e.target.value)}>
                            <option value="">All</option>
                            {JURISDICTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                    </label>
                )}
                <input
                    className="admin__search"
                    type="text"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <span className="admin__count">{loading ? 'Loading…' : `${filtered.length} row${filtered.length === 1 ? '' : 's'}`}</span>
            </div>

            {error && <p className="admin__error">{error}</p>}
            {notice && <p className="admin__notice">{notice}</p>}

            <div className="admin__table-wrap">
                <table className="admin__table">
                    <thead>
                        <tr>
                            {ds.columns.map(([k, label]) => <th key={k}>{label}</th>)}
                            {ds.actions && <th>Review</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((r, i) => (
                            <React.Fragment key={r.id || i}>
                            <tr
                                className={ds.kind !== 'wouldbe' && ds.actions ? 'admin__row--expandable' : undefined}
                                onClick={ds.kind !== 'wouldbe' && ds.actions ? () => togglePrompts(r) : undefined}
                            >
                                {ds.columns.map(([k]) => <td key={k}>{cell(k, r[k])}</td>)}
                                {ds.actions && ds.kind === 'wouldbe' && (
                                    <td className="admin__actions">
                                        {r.launch_status === 'active' || r.launch_status === 'failed' ? (
                                            <span className="admin__muted">
                                                {r.launch_status === 'failed' ? 'rejected' : 'live'}
                                            </span>
                                        ) : (
                                            <>
                                                {/* Disabled until BOTH gates pass. The server
                                                    enforces it too, but a dead button with a
                                                    reason beats a 409 the admin has to read. */}
                                                <button
                                                    className="admin__btn admin__btn--approve"
                                                    onClick={() => approve(r)}
                                                    disabled={acting === r.id || !r.fee_paid || !r.committee_ok}
                                                    title={
                                                        !r.fee_paid ? 'The $5 creation fee is unpaid'
                                                        : !r.committee_ok ? 'No registered committee on file'
                                                        : ''
                                                    }
                                                >
                                                    Approve
                                                </button>
                                                {!r.committee_ok && (
                                                    <button
                                                        className="admin__btn"
                                                        onClick={() => askForCommittee(r)}
                                                        disabled={acting === r.id}
                                                        title="Ask the candidate to file a committee"
                                                    >
                                                        Need committee
                                                    </button>
                                                )}
                                                <button
                                                    className="admin__btn admin__btn--reject"
                                                    onClick={() => reject(r)}
                                                    disabled={acting === r.id}
                                                >
                                                    Reject
                                                </button>
                                            </>
                                        )}
                                    </td>
                                )}
                                {ds.actions && ds.kind !== 'wouldbe' && (
                                    /* stopPropagation: the row opens the prompt
                                       panel, and approving must not also toggle
                                       it open behind the confirm dialog. */
                                    <td className="admin__actions" onClick={(e) => e.stopPropagation()}>
                                        {r.status === 'draft' ? (
                                            <>
                                                {/* No payment gate — hosting is free. The
                                                    server still refuses if a hybrid debate has
                                                    no panel or the prize wasn't signed for, and
                                                    that error is shown verbatim. */}
                                                <button
                                                    className="admin__btn admin__btn--approve"
                                                    onClick={() => approve(r)}
                                                    disabled={acting === r.id}
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    className="admin__btn admin__btn--reject"
                                                    onClick={() => reject(r)}
                                                    disabled={acting === r.id}
                                                >
                                                    Reject
                                                </button>
                                            </>
                                        ) : (
                                            <span className="admin__muted">
                                                {r.status === 'cancelled' ? 'rejected' : 'reviewed'}
                                            </span>
                                        )}
                                    </td>
                                )}
                            </tr>

                            {/* The prompts themselves, under the row they belong
                                to. For a TYPED debate this is the whole review:
                                one question per bracket match, and any slot left
                                empty is a match two people would be asked to
                                argue with nothing in front of them. */}
                            {openPrompts === r.id && (
                                <tr className="admin__promptrow">
                                    <td colSpan={ds.columns.length + (ds.actions ? 1 : 0)}>
                                        {promptError && <p className="admin__error">{promptError}</p>}
                                        {!promptData && !promptError && <p className="admin__muted">Loading prompts…</p>}
                                        {promptData && (
                                            <div className="admin__prompts">
                                                <p className="admin__prompts-head">
                                                    <span className="admin__badge">{promptData.format}</span>
                                                    {promptData.format === 'typed' ? (
                                                        <>
                                                            {promptData.filled} of {promptData.required} match prompts written
                                                            {promptData.filled < promptData.required && (
                                                                <strong className="admin__prompts-warn">
                                                                    {' '}— incomplete
                                                                </strong>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <>{promptData.unslotted.length} prompt{promptData.unslotted.length === 1 ? '' : 's'}, no bracket slots (live debate)</>
                                                    )}
                                                </p>

                                                {promptData.format === 'typed' ? (
                                                    <ol className="admin__prompt-list">
                                                        {promptData.slots.map((slot) => (
                                                            <li key={slot.key} className={slot.body ? '' : 'is-empty'}>
                                                                <span className="admin__prompt-slot">{slot.label}</span>
                                                                <span className="admin__prompt-body">
                                                                    {slot.body || <em>not written</em>}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                ) : (
                                                    <ol className="admin__prompt-list">
                                                        {promptData.unslotted.map((p) => (
                                                            <li key={p.id}>
                                                                <span className="admin__prompt-slot">
                                                                    Prompt {p.prompt_order} · {p.prompt_type}
                                                                </span>
                                                                <span className="admin__prompt-body">{p.body}</span>
                                                            </li>
                                                        ))}
                                                        {!promptData.unslotted.length && (
                                                            <li className="is-empty"><em>No prompts on this debate.</em></li>
                                                        )}
                                                    </ol>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            )}
                            </React.Fragment>
                        ))}
                        {!loading && filtered.length === 0 && (
                            <tr><td className="admin__empty" colSpan={ds.columns.length + (ds.actions ? 1 : 0)}>No rows.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default Admin
