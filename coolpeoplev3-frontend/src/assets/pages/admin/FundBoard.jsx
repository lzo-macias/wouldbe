import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../lib/api'
import './FundBoard.css'

/* ============================================================================
 * FundBoard — the backer ledger for the launch raise. Route: /admin/fund
 *
 * Every row is a pledge to WouldBe the COMPANY. This is NOT the candidate
 * pledge ledger and must never be confused with it: nothing here is subject to
 * the $3,300 sitewide pledge cap, and nothing here is a political contribution.
 *
 * WHAT IT IS FOR, in the order the questions actually get asked:
 *   1. how much have we raised, net of refunds
 *   2. who are they and what is their email      (reward delivery at launch)
 *   3. did this specific person's payment land   (support)
 *   4. give someone their money back             (the 30-day refund promise)
 *   5. get the whole thing into a spreadsheet    (the accountant)
 *
 * It is a SEPARATE ROUTE rather than a tab inside Admin.jsx. Admin.jsx is a
 * reference-data browser — offices, deadlines, applications — and money wants
 * different columns, different actions and a different blast radius. Bolting it
 * on would have meant one component holding both.
 *
 * AUTH: mounted behind <RequireAdmin> in App.jsx, and every endpoint it calls is
 * independently requireAuth + requireAdmin server-side. The guard is for the UI;
 * the routes do not trust it.
 * ========================================================================= */

const usd = (cents) =>
    ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const when = (iso) =>
    iso ? new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit',
    }) : '—'

const STATUSES = ['', 'succeeded', 'pending', 'failed', 'refunded', 'disputed']

export default function FundBoard() {
    const [rows, setRows] = useState([])
    const [summary, setSummary] = useState(null)
    const [status, setStatus] = useState('')
    const [q, setQ] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [acting, setActing] = useState(null)   // pledge id mid-action

    // Manual entry, for a check or a wire that arrived off-platform.
    const [mEmail, setMEmail] = useState('')
    const [mName, setMName] = useState('')
    const [mAmount, setMAmount] = useState('')
    const [mChannel, setMChannel] = useState('check')

    /* fetchLedger sets NO React state — it just returns data. That separation is
       what lets the effect below define its own async loader inline (the pattern
       the rest of this codebase uses, e.g. HomeHeader): the lint rule forbids an
       effect from calling out to a function that sets state, because it cannot
       see that the state change happens after an await. Keeping the fetch pure
       means the state is only ever set where the linter can see it is safe. */
    const fetchLedger = useCallback(async () => {
        // Both in flight together: the summary does not depend on the rows, and
        // awaiting them in sequence doubles the time the board sits blank.
        const [list, sum] = await Promise.all([
            api.get('/api/fund/pledges', { params: { status: status || undefined, q: q || undefined } }),
            api.get('/api/fund/pledges/summary'),
        ])
        return { rows: list.data, summary: sum.data }
    }, [status, q])

    // Refetch on mount and whenever a filter changes. `loading` already starts
    // true, so the first paint is the spinner without anyone setting it here;
    // the filter handlers turn it back on, where doing so is allowed.
    useEffect(() => {
        let cancelled = false
        async function run() {
            try {
                const data = await fetchLedger()
                if (cancelled) return
                setRows(data.rows)
                setSummary(data.summary)
                setError(null)
            } catch (err) {
                if (!cancelled) setError(err?.response?.data?.error || err.message || 'Could not load the ledger')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => { cancelled = true }
    }, [fetchLedger])

    // The handler-facing reload: a click is not an effect, so flipping the
    // spinner synchronously here is fine.
    const load = useCallback(async () => {
        setLoading(true)
        try {
            const data = await fetchLedger()
            setRows(data.rows)
            setSummary(data.summary)
            setError(null)
        } catch (err) {
            setError(err?.response?.data?.error || err.message || 'Could not load the ledger')
        } finally {
            setLoading(false)
        }
    }, [fetchLedger])

    async function refund(row) {
        // A refund moves real money and cannot be undone from this screen, so it
        // asks — and it names the person and the amount, because "are you sure?"
        // with no specifics is a dialog people learn to click through.
        if (!window.confirm(`Refund ${usd(row.amount_cents)} to ${row.email}?\n\nThis issues a real Stripe refund and cannot be undone here.`)) return
        setActing(row.id)
        try {
            await api.post(`/api/fund/pledges/${row.id}/refund`)
            await load()
        } catch (err) {
            setError(err?.response?.data?.error || 'Refund failed')
        } finally {
            setActing(null)
        }
    }

    async function markReceipt(row) {
        setActing(row.id)
        try {
            await api.post(`/api/fund/pledges/${row.id}/receipt-sent`)
            await load()
        } catch (err) {
            setError(err?.response?.data?.error || 'Could not stamp the receipt')
        } finally {
            setActing(null)
        }
    }

    async function addOffline(e) {
        e.preventDefault()
        const cents = Math.round(parseFloat(mAmount || '0') * 100)
        if (!cents || cents <= 0) { setError('Enter an amount'); return }
        setActing('manual')
        try {
            await api.post('/api/fund/pledges/offline', {
                email: mEmail, backer_name: mName || null,
                amount_cents: cents, channel: mChannel,
            })
            setMEmail(''); setMName(''); setMAmount('')
            await load()
        } catch (err) {
            setError(err?.response?.data?.error || 'Could not record that pledge')
        } finally {
            setActing(null)
        }
    }

    // The CSV is behind requireAdmin like everything else, so it cannot be a
    // plain <a href> — that request carries no Authorization header. Fetch it
    // through the same api instance, then hand the browser a blob.
    async function exportCsv() {
        setActing('csv')
        try {
            const res = await api.get('/api/fund/pledges/export.csv', { responseType: 'blob' })
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
            const a = document.createElement('a')
            a.href = url
            a.download = `wouldbe-backers-${new Date().toISOString().slice(0, 10)}.csv`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
        } catch (err) {
            setError(err?.response?.data?.error || 'Export failed')
        } finally {
            setActing(null)
        }
    }

    return (
        <div className="wbfb">
            <div className="wbfb__head">
                <h1 className="wbfb__h1">Backer ledger</h1>
                <span className="wbfb__crumb">
                    the launch raise · <Link to="/fund">public page</Link> · <Link to="/admin">admin</Link>
                </span>
                <span className="wbfb__spacer" />
                <button className="wbfb__btn" onClick={load} disabled={loading}>Refresh</button>
                <button className="wbfb__btn wbfb__btn--gold" onClick={exportCsv} disabled={acting === 'csv'}>
                    {acting === 'csv' ? 'Exporting…' : 'Export CSV'}
                </button>
            </div>

            {error && <div className="wbfb__err">{error}</div>}

            {summary && (
                <div className="wbfb__tiles">
                    <div className="wbfb__tile">
                        <div className="wbfb__tileK">Raised</div>
                        <div className="wbfb__tileV wbfb__tileV--gold">{usd(summary.raised_cents)}</div>
                        <div className="wbfb__tileSub">succeeded pledges</div>
                    </div>
                    <div className="wbfb__tile">
                        <div className="wbfb__tileK">Net of refunds</div>
                        <div className="wbfb__tileV">{usd(summary.net_cents)}</div>
                        <div className="wbfb__tileSub">{usd(summary.refunded_cents)} refunded</div>
                    </div>
                    <div className="wbfb__tile">
                        <div className="wbfb__tileK">Backers</div>
                        <div className="wbfb__tileV">{summary.backers}</div>
                        {/* Unique EMAILS, not rows — one person who pledges twice
                            is one backer, and pledge_count is shown beside it so
                            the difference is visible rather than confusing. */}
                        <div className="wbfb__tileSub">{summary.pledge_count} pledges</div>
                    </div>
                    <div className="wbfb__tile">
                        <div className="wbfb__tileK">Average</div>
                        <div className="wbfb__tileV">{usd(summary.avg_pledge_cents)}</div>
                        <div className="wbfb__tileSub">per backer</div>
                    </div>
                    <div className="wbfb__tile">
                        <div className="wbfb__tileK">Needs attention</div>
                        <div className="wbfb__tileV">{summary.pending_count + summary.failed_count}</div>
                        <div className="wbfb__tileSub">
                            {summary.pending_count} pending · {summary.failed_count} failed
                        </div>
                    </div>
                </div>
            )}

            <div className="wbfb__bar">
                <input
                    className="wbfb__input"
                    placeholder="Search email or name…"
                    value={q}
                    onChange={(e) => { setLoading(true); setQ(e.target.value) }}
                />
                <select className="wbfb__select" value={status}
                        onChange={(e) => { setLoading(true); setStatus(e.target.value) }}>
                    {STATUSES.map((s) => (
                        <option key={s || 'all'} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : 'All statuses'}</option>
                    ))}
                </select>
                <span className="wbfb__spacer" />
                <span className="wbfb__dim">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
            </div>

            <div className="wbfb__tableWrap">
                {loading ? (
                    <div className="wbfb__loading">Loading the ledger…</div>
                ) : rows.length === 0 ? (
                    <div className="wbfb__empty">
                        No pledges yet.{(q || status) && ' Try clearing the filters.'}
                    </div>
                ) : (
                    <table className="wbfb__table">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Email</th>
                                <th>Name</th>
                                <th className="wbfb__amt">Amount</th>
                                <th>Reward</th>
                                <th>Channel</th>
                                <th>Status</th>
                                <th>Receipt</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id}>
                                    <td className="wbfb__dim">{when(r.created_at)}</td>
                                    <td className="wbfb__email">{r.email}</td>
                                    <td>{r.backer_name || <span className="wbfb__dim">—</span>}</td>
                                    <td className="wbfb__amt">
                                        {usd(r.amount_cents)}
                                        {r.status === 'refunded' && r.refund_amount_cents != null && (
                                            <div className="wbfb__dim">−{usd(r.refund_amount_cents)}</div>
                                        )}
                                    </td>
                                    <td>{r.reward_level ? `Level ${r.reward_level}` : <span className="wbfb__dim">none</span>}</td>
                                    <td className="wbfb__dim">{r.channel}</td>
                                    <td><span className={`wbfb__pill wbfb__pill--${r.status}`}>{r.status}</span></td>
                                    <td className="wbfb__dim">{r.receipt_sent_at ? when(r.receipt_sent_at) : '—'}</td>
                                    <td>
                                        {r.status === 'succeeded' && (
                                            <>
                                                {!r.receipt_sent_at && (
                                                    <button className="wbfb__btn" disabled={acting === r.id}
                                                            onClick={() => markReceipt(r)}>
                                                        Receipt sent
                                                    </button>
                                                )}{' '}
                                                <button className="wbfb__btn wbfb__btn--danger" disabled={acting === r.id}
                                                        onClick={() => refund(r)}>
                                                    {acting === r.id ? '…' : 'Refund'}
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <form className="wbfb__manual" onSubmit={addOffline}>
                <div className="wbfb__manualRow">
                    <div className="wbfb__field">
                        <label className="wbfb__label" htmlFor="fb-email">Email</label>
                        <input id="fb-email" className="wbfb__input" type="email" required
                               value={mEmail} onChange={(e) => setMEmail(e.target.value)} placeholder="backer@example.com" />
                    </div>
                    <div className="wbfb__field">
                        <label className="wbfb__label" htmlFor="fb-name">Name</label>
                        <input id="fb-name" className="wbfb__input" value={mName}
                               onChange={(e) => setMName(e.target.value)} placeholder="optional" />
                    </div>
                    <div className="wbfb__field">
                        <label className="wbfb__label" htmlFor="fb-amt">Amount (USD)</label>
                        <input id="fb-amt" className="wbfb__input" type="number" min="1" step="0.01" required
                               style={{ minWidth: 120 }} value={mAmount} onChange={(e) => setMAmount(e.target.value)} />
                    </div>
                    <div className="wbfb__field">
                        <label className="wbfb__label" htmlFor="fb-chan">Channel</label>
                        <select id="fb-chan" className="wbfb__select" value={mChannel}
                                onChange={(e) => setMChannel(e.target.value)}>
                            <option value="check">Check</option>
                            <option value="wire">Wire</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <button className="wbfb__btn wbfb__btn--gold" type="submit" disabled={acting === 'manual'}>
                        {acting === 'manual' ? 'Recording…' : 'Record offline pledge'}
                    </button>
                </div>
                <p className="wbfb__note">
                    For money that arrived outside Stripe — a mailed check, a wire. It lands as
                    <strong> succeeded</strong> immediately, so only enter it once the funds have actually
                    cleared: this figure is what the public meter on /fund reports.
                </p>
            </form>

            <p className="wbfb__note">
                These are pledges to WouldBe the company — a rewards pre-sale. They are not political
                contributions, they are not subject to the $3,300 sitewide pledge cap, and they are a
                different ledger from candidate pledges entirely. Emails here are how memberships get
                granted at launch, so treat the export as the PII it is.
            </p>
        </div>
    )
}
