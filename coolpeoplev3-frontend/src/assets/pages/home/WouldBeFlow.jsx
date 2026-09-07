import React, { lazy, Suspense, useEffect, useState } from 'react'
import api from '../../lib/api'
import WouldBeRows from '../../component/Wouldbe/WouldBeRows/WouldBeRows'
import Qualify from '../../component/Qualify/Qualify'
import './wouldbeflow.css'

const StartAnOffice = lazy(() => import('../wouldbe/StartAnOffice'))

/* ============================================================================
 * WouldBeFlow — starting a campaign, in the feed column.
 *
 * IT IS THE REAL BROWSER, MOUNTED HERE. WouldBeRows is the office screen this
 * app already has: 7,511 seeded offices, filing deadlines pulled per state,
 * per-office eligibility and recommended goal, search and filters. The first
 * pass at this rendered its own list against `/api/offices?limit=60` — which is
 * sixty rows out of seven and a half thousand, alphabetically, so the whole
 * screen was Alaska. Reimplementing a browser that exists is how you end up
 * with two of them and neither is right.
 *
 * A WOULD BE STARTS WITH A SEAT. Before there is a goal, a plan or a dollar
 * there is a specific office, and everything after it — the filing deadline,
 * the contribution rules, the minimum age — is a property of that office rather
 * than a thing the candidate chooses.
 *
 * WHAT YOU QUALIFY FOR, WHEN WE KNOW IT. /api/users/me/jurisdictions says
 * whether this person's address has been resolved; if it has, /api/offices/
 * relevant scopes the list to their own districts and tags each row. If it has
 * not, WouldBeRows falls back to the full list on its own — and Check what I
 * qualify for opens the address flow that fixes it, in place.
 * ==========================================================================*/

export default function WouldBeFlow({ onClose }) {
    // null means "not scoped" — WouldBeRows reads that as "fetch them all",
    // which is the right answer for somebody who has not told us where they
    // live. It is NOT the same as an empty array.
    const [scoped, setScoped] = useState(null)
    const [checking, setChecking] = useState(true)
    const [qualify, setQualify] = useState(false)
    const [picked, setPicked] = useState(null)

    // Address→district resolution is persisted server-side, so a reload must
    // not forget it. Same rehydrate the /wouldbe page does.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                if (!localStorage.getItem('token')) return
                const jur = await api.get('/api/users/me/jurisdictions')
                if (cancelled || !(jur.data ?? []).length) return
                const offices = await api.get('/api/offices/relevant')
                if (!cancelled) setScoped(offices.data ?? [])
            } catch {
                // A guest, or an unresolved address. Neither is an error and
                // neither should stop the browser rendering.
            } finally {
                if (!cancelled) setChecking(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    if (picked) {
        return (
            <div className="wbf">
                <div className="wbf__crumb">
                    <button type="button" className="wbf__back" onClick={() => setPicked(null)}>
                        ← Pick a different office
                    </button>
                    <span className="wbf__crumbn">{picked.office_name}</span>
                    <button type="button" className="wbf__x" onClick={onClose}>Cancel</button>
                </div>
                <Suspense fallback={<p className="wbf__wait">Loading the form…</p>}>
                    <div className="wbf__form">
                        <StartAnOffice
                            embedded
                            officeId={picked.id}
                            jurisdictionId={picked.jurisdiction_id}
                        />
                    </div>
                </Suspense>
            </div>
        )
    }

    return (
        <div className="wbf">
            <div className="wbf__head">
                <div>
                    <h2 className="wbf__h">Which seat?</h2>
                    <p className="wbf__p">
                        Everything after this — the filing deadline, the contribution rules, the
                        minimum age — belongs to the office rather than to you. Pick it first.
                    </p>
                </div>
                <span className="wbf__acts">
                    <button type="button" className="wbf__q" onClick={() => setQualify(true)}>
                        Check what I qualify for
                    </button>
                    <button type="button" className="wbf__x" onClick={onClose}>Cancel</button>
                </span>
            </div>

            {/* Gated on the check so the full list does not flash before the
                scoped one arrives — seeing seven thousand offices and then two
                reads as the page losing your data. */}
            {checking
                ? <p className="wbf__wait">Finding your offices…</p>
                : <WouldBeRows offices={scoped} onStart={setPicked} />}

            {qualify && (
                <Qualify
                    onClose={() => setQualify(false)}
                    onQualified={(offices) => { setScoped(offices); setQualify(false) }}
                />
            )}
        </div>
    )
}
