import { useEffect, useRef, useState } from 'react'
import { DEFAULT_FILTERS, US_STATES, activeCount } from '../../lib/homeFilters'
import './HomeFilter.css'

// ============================================================================
// HomeFilter — the filter control under the search bar, and its dropdown.
//
// State lives in Home.jsx (Grid2x needs it too), so this component only edits a
// `value` it is handed. It applies on "Apply" rather than on every keystroke —
// each change is a refetch, and a live-updating lean slider would fire ten.
// ============================================================================

function HomeFilter({ value, onChange }) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(value)
    const rootRef = useRef(null)

    // Click-away and Escape. A dropdown that only closes via its own button is a
    // trap on a page whose whole body is clickable cards.
    useEffect(() => {
        if (!open) return
        const onDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
    const signedIn = !!localStorage.getItem('userId')

    // Filters that only make sense for one kind of row are disabled when the
    // other kind is selected, rather than silently doing nothing.
    const debatesOff = draft.type === 'wouldbes'
    const campaignsOff = draft.type === 'debates'

    const n = activeCount(value)

    return (
        <div className='homeFilterRoot' ref={rootRef}>
            <button
                type='button'
                className={`homeFilterBtn${n ? ' is-active' : ''}`}
                onClick={() => {
                    // Sync the draft HERE rather than in an effect: reopening must
                    // show what is actually applied, not whatever was abandoned
                    // last time without hitting Apply.
                    if (!open) setDraft(value)
                    setOpen((o) => !o)
                }}
                aria-expanded={open}
                aria-haspopup='dialog'
            >
                Filter{n ? ` · ${n}` : ''}
            </button>

            {open && (
                <div className='homeFilterPanel' role='dialog' aria-label='Filter results'>
                    <div className='hfGroup'>
                        <span className='hfLabel'>Show</span>
                        <div className='hfSeg'>
                            {[['all', 'All'], ['wouldbes', 'WouldBes'], ['debates', 'Debates']].map(
                                ([v, l]) => (
                                    <button
                                        key={v}
                                        type='button'
                                        className={draft.type === v ? 'is-on' : ''}
                                        onClick={() => set({ type: v })}
                                    >
                                        {l}
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    <div className='hfGroup'>
                        <label className='hfCheck hfCheck--disabled'>
                            <input type='checkbox' disabled checked={false} readOnly />
                            <span>
                                Contentious
                                {/* Disabled, not silently inert. There is no
                                    contentiousness algorithm yet, and a checkbox
                                    that ticks but changes nothing is worse than
                                    one that says why. */}
                                <small>Coming soon — no scoring algorithm yet</small>
                            </span>
                        </label>
                    </div>

                    <div className='hfGroup'>
                        <span className='hfLabel'>State</span>
                        <select
                            className='hfSelect'
                            value={draft.state}
                            disabled={campaignsOff}
                            onChange={(e) => set({ state: e.target.value })}
                        >
                            <option value=''>Anywhere</option>
                            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {campaignsOff && <small className='hfHint'>Campaigns only</small>}
                    </div>

                    <div className='hfGroup'>
                        <span className='hfLabel'>Prize</span>
                        <div className='hfSeg'>
                            {[['any', 'Any'], ['cash', 'Cash prize'], ['none', 'No cash']].map(
                                ([v, l]) => (
                                    <button
                                        key={v}
                                        type='button'
                                        disabled={debatesOff}
                                        className={draft.prize === v ? 'is-on' : ''}
                                        onClick={() => set({ prize: v })}
                                    >
                                        {l}
                                    </button>
                                )
                            )}
                        </div>
                        {debatesOff && <small className='hfHint'>Debates only</small>}
                    </div>

                    <div className='hfGroup'>
                        <span className='hfLabel'>
                            Political leaning <b>{draft.leanMin}–{draft.leanMax}</b>
                        </span>
                        <div className='hfRange'>
                            <input
                                type='range' min='1' max='10' value={draft.leanMin}
                                disabled={campaignsOff}
                                onChange={(e) => {
                                    const v = Number(e.target.value)
                                    // Keep the pair ordered — dragging min past max
                                    // would otherwise ask for an empty window.
                                    set({ leanMin: v, leanMax: Math.max(v, draft.leanMax) })
                                }}
                            />
                            <input
                                type='range' min='1' max='10' value={draft.leanMax}
                                disabled={campaignsOff}
                                onChange={(e) => {
                                    const v = Number(e.target.value)
                                    set({ leanMax: v, leanMin: Math.min(v, draft.leanMin) })
                                }}
                            />
                        </div>
                        <div className='hfScale'><span>Conservative</span><span>Progressive</span></div>
                        <small className='hfHint'>
                            Campaigns only. Narrowing this hides campaigns whose owner
                            hasn't set a leaning.
                        </small>
                    </div>

                    <div className='hfGroup'>
                        <label className={`hfCheck${signedIn ? '' : ' hfCheck--disabled'}`}>
                            <input
                                type='checkbox'
                                checked={draft.myJurisdiction}
                                disabled={!signedIn || campaignsOff}
                                onChange={(e) => set({ myJurisdiction: e.target.checked })}
                            />
                            <span>
                                Only in my jurisdiction
                                {!signedIn && <small>Log in to use this</small>}
                            </span>
                        </label>
                    </div>

                    <div className='hfGroup'>
                        <span className='hfLabel'>Almost reached goal</span>
                        <div className='hfSeg'>
                            {[['none', 'Off'], ['goal_desc', 'Closest ↓'], ['goal_asc', 'Furthest ↑']].map(
                                ([v, l]) => (
                                    <button
                                        key={v}
                                        type='button'
                                        disabled={campaignsOff}
                                        className={draft.goalSort === v ? 'is-on' : ''}
                                        onClick={() => set({ goalSort: v })}
                                    >
                                        {l}
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    <div className='hfActions'>
                        <button
                            type='button'
                            className='hfGhost'
                            onClick={() => { onChange(DEFAULT_FILTERS); setOpen(false) }}
                        >
                            Reset
                        </button>
                        <button
                            type='button'
                            className='hfApply'
                            onClick={() => { onChange(draft); setOpen(false) }}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default HomeFilter
