import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import '../styling/Admin.css'

// Admin dashboard v1 — browse the pre-seeded electoral reference data with
// search + filter. Reads are public endpoints; the Bearer token is sent when
// present (harmless, future-proofs gated reads).
const API = import.meta.env.VITE_API_BASE_URL;

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
};

// columns rendered as a pill badge
const BADGE_KEYS = new Set(['office_type', 'chamber', 'type', 'authority_level', 'advancement_rule', 'category_group', 'deadline_type']);

function cell(key, value) {
    if (value === null || value === undefined || value === '') return <span className="admin__muted">—</span>;
    if (typeof value === 'boolean') return value ? '✅' : <span className="admin__muted">—</span>;
    if (key === 'contribution_limit_individual_primary') return `$${(Number(value) / 100).toLocaleString()}`;
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
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const ds = DATASETS[active];

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const token = localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        axios.get(`${API}${ds.url({ state, type })}`, { headers })
            .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
            .catch((err) => { if (!cancelled) { setError(err.response?.data?.error || 'Failed to load'); setRows([]); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [active, state, type]); // eslint-disable-line react-hooks/exhaustive-deps

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

            <div className="admin__table-wrap">
                <table className="admin__table">
                    <thead>
                        <tr>
                            {ds.columns.map(([k, label]) => <th key={k}>{label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((r, i) => (
                            <tr key={r.id || i}>
                                {ds.columns.map(([k]) => <td key={k}>{cell(k, r[k])}</td>)}
                            </tr>
                        ))}
                        {!loading && filtered.length === 0 && (
                            <tr><td className="admin__empty" colSpan={ds.columns.length}>No rows.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default Admin
