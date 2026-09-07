import React, { useState, useRef, useEffect, useId } from 'react'
import './filter.css'

/* ============================================================================
 * FilterPanel — the filter popover.
 *
 * What was wrong with the old one, in order of how much it cost:
 *
 *   1. It floated in the middle of the feed with no relationship to the button
 *      that opened it. A popover not attached to its trigger reads as a modal
 *      whose overlay failed to load. It is now anchored, right-aligned, with a
 *      caret pointing at the button.
 *
 *   2. The label sat in a left column beside the chips, spending ~140px of a
 *      ~380px panel on the word "PRIZE". That is why three chips per row was
 *      the ceiling and why "For the arrow", "$5k+" and "$100k+" each ended up
 *      alone on a line. Labels go above; the chips get the whole width.
 *
 *   3. Selected was --gold-wash on --card: a 1.04:1 fill difference. You could
 *      not tell what was on. Selected is now the solid plate the LIVE chip
 *      already uses (--gold-950 / --gold-200, 11:1).
 *
 *   4. Content ran under the Reset/Apply row with nothing to say so, and the
 *      cut landed mid-chip. There is a fade now, and the scroll has ends.
 *
 *   5. Nothing said how many filters were actually on.
 *
 * Four things this got wrong on the first pass, all found by testing it
 * rather than reading it:
 *
 *   A. The dimmed sections used pointer-events:none, which only stops the
 *      mouse. A keyboard user could Tab into a section that looks switched
 *      off and change a filter whose effect they cannot see. The chips are
 *      properly `disabled` now.
 *
 *   B. There is an Apply button, so closing any other way has to mean cancel —
 *      and it did not. You could switch two things off, press Escape, and the
 *      feed would be unchanged while the button read "2 filters" and
 *      reopening showed a state the feed was not in. The panel now edits a
 *      draft and commits it on Apply.
 *
 *   C. The panel id was hardcoded, so two of these on a page produced
 *      duplicate ids and aria-controls pointing at the wrong one. useId now.
 *
 *   D. role="dialog" promises focus moves into the panel and is trapped
 *      there. This is a non-modal popover, so it is the disclosure pattern
 *      instead: the button's aria-expanded/aria-controls carry the meaning
 *      and nothing lies to a screen reader about being a dialog.
 *
 * Two CSS notes that are load-bearing and easy to undo by accident:
 *
 *   .flt__p[hidden]{display:none} — a class that sets display beats the UA
 *   rule for [hidden]. Without it the panel is invisible but still hit-tests.
 *
 *   The toolbar is overflow-x:auto below 840 in the feed stylesheet, and an
 *   overflow container clips its descendants — which cut this panel off and
 *   offset it by the toolbar's scroll position. filter.css sets the toolbar
 *   back to overflow:visible there and lets it wrap instead.
 * ==========================================================================*/

export const KINDS = [
    { v: 'debate',   t: 'Debates' },
    { v: 'wouldbe',  t: 'Would bes' },
    { v: 'question', t: 'Questions' },
    { v: 'artifact', t: 'Articles' },
]

/** Every group except SHOW is single-select with a default. */
export const GROUPS = [
    {
        name: 'order', label: 'Order', def: 'trending',
        opts: [
            { v: 'trending', t: 'Trending' },
            { v: 'new',      t: 'New' },
            { v: 'closing',  t: 'Closing soon' },
        ],
        note: 'Trending counts likes, reposts and responses together — one number, ' +
              'because ranking on any single one rewards whoever farms that one.',
    },
]

export const SECTIONS = [
    {
        kind: 'debate', title: 'Debates',
        groups: [
            { name: 'prize', label: 'Prize', def: 'any', opts: [
                { v: 'any', t: 'Any' }, { v: 'cash', t: 'Cash prize' }, { v: 'arrow', t: 'For the arrow' }] },
            { name: 'purse', label: 'Purse at least', def: 'any', opts: [
                { v: 'any', t: 'Any' }, { v: '500', t: '$500+' }, { v: '1k', t: '$1k+' }, { v: '5k', t: '$5k+' }] },
        ],
    },
    {
        kind: 'wouldbe', title: 'Would bes',
        groups: [
            { name: 'goal', label: 'Goal at least', def: 'any', opts: [
                { v: 'any', t: 'Any' }, { v: '5k', t: '$5k+' }, { v: '25k', t: '$25k+' }, { v: '100k', t: '$100k+' }] },
            { name: 'stage', label: 'Stage', def: 'any', opts: [
                { v: 'any', t: 'Any' }, { v: 'open', t: 'Open' },
                { v: 'soon', t: 'Ending soon' }, { v: 'funded', t: 'Funded' }] },
        ],
    },
]

const ALL_GROUPS = GROUPS.concat(...SECTIONS.map((s) => s.groups))
export const DEFAULTS = ALL_GROUPS.reduce((o, g) => ((o[g.name] = g.def), o), {})

function Chip({ on, children, ...p }) {
    return (
        <button type="button" className="fc" aria-pressed={on} {...p}>
            {children}
        </button>
    )
}

/** the shape the parent owns, and the shape the panel edits before committing */
const asDraft = (v) => ({
    kinds: v?.kinds ?? KINDS.map((k) => k.v),
    picks: { ...DEFAULTS, ...(v?.picks ?? {}) },
})

/**
 * `grid` forces a 2-up. The four post kinds wrapped 3 + 1 and orphaned
 * "Articles" on its own line — the one wrapping shape that always looks like a
 * mistake. A fixed grid also reads as a set of four rather than a queue that
 * ran out of room.
 */
function Group({ label, note, grid, children }) {
    return (
        <div className={`fg${grid ? ' fg--grid' : ''}`}>
            <span className="fg__l">{label}</span>
            <div className="fg__c" role="group" aria-label={label}>{children}</div>
            {note && <p className="fg__n">{note}</p>}
        </div>
    )
}

export default function FilterPanel({ value, onApply }) {
    const id = useId()
    const [open, setOpen] = useState(false)
    /* draft is what the panel edits; `value` is what the feed is actually
       showing. They only meet on Apply. */
    const [draft, setDraft] = useState(() => asDraft(value))
    const { kinds, picks } = draft
    const box = useRef(null)
    const btn = useRef(null)

    const setKinds = (fn) => setDraft((d) => ({ ...d, kinds: fn(d.kinds) }))
    const setPicks = (fn) => setDraft((d) => ({ ...d, picks: fn(d.picks) }))

    const active =
        (kinds.length !== KINDS.length ? 1 : 0) +
        ALL_GROUPS.filter((g) => picks[g.name] !== g.def).length

    /* closing without applying is a cancel: throw the draft away and go back to
       whatever the feed is showing */
    function close(commit) {
        if (!commit) setDraft(asDraft(value))
        setOpen(false)
    }
    /* reseed while closed so a parent-side change (a cleared filter elsewhere,
       a restored URL) does not leave a stale draft waiting behind the button */
    useEffect(() => { if (!open) setDraft(asDraft(value)) }, [value, open])

    useEffect(() => {
        if (!open) return undefined
        const away = (e) => { if (!box.current?.contains(e.target)) close(false) }
        const esc = (e) => {
            if (e.key === 'Escape') { close(false); btn.current?.focus() }
        }
        document.addEventListener('mousedown', away)
        document.addEventListener('keydown', esc)
        return () => {
            document.removeEventListener('mousedown', away)
            document.removeEventListener('keydown', esc)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, value])

    /* never let the reader switch off every kind and stare at an empty feed */
    function toggleKind(v) {
        setKinds((ks) =>
            ks.includes(v) ? (ks.length === 1 ? ks : ks.filter((k) => k !== v)) : ks.concat(v))
    }
    function reset() {
        setDraft({ kinds: KINDS.map((k) => k.v), picks: { ...DEFAULTS } })
    }
    function apply() {
        onApply?.(draft)
        close(true)
        btn.current?.focus()
    }

    return (
        <span className="flt" ref={box}>
            <button
                ref={btn} type="button" className="chip"
                aria-expanded={open} aria-controls={id}
                onClick={() => (open ? close(false) : setOpen(true))}
            >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                Filter
            </button>

            {/* a disclosure, not a dialog — role="dialog" promises focus
                management this popover deliberately does not do */}
            <div className="flt__p" id={id} aria-label="Filter the feed" hidden={!open}>
                <div className="flt__h">
                    <span className="flt__t">Filter</span>
                    {active > 0 && (
                        <span className="flt__n">{active} {active === 1 ? 'filter' : 'filters'}</span>
                    )}
                    <button type="button" className="flt__x" aria-label="Close"
                            onClick={() => { close(false); btn.current?.focus() }}>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="flt__b">
                    <Group label="Show" grid
                           note="All four are on. Turn one off to take it out of the feed.">
                        {KINDS.map((k) => (
                            <Chip key={k.v} on={kinds.includes(k.v)} onClick={() => toggleKind(k.v)}>
                                {k.t}
                            </Chip>
                        ))}
                    </Group>

                    {GROUPS.map((g) => (
                        <Group key={g.name} label={g.label} note={g.note}>
                            {g.opts.map((o) => (
                                <Chip key={o.v} on={picks[g.name] === o.v}
                                      onClick={() => setPicks((p) => ({ ...p, [g.name]: o.v }))}>
                                    {o.t}
                                </Chip>
                            ))}
                        </Group>
                    ))}

                    {/* A section is dimmed, not hidden, when its kind is switched
                        off. Removing it re-flows the panel under the cursor every
                        time you toggle a kind, which is how you mis-click. */}
                    {SECTIONS.map((sec) => {
                        const off = !kinds.includes(sec.kind)
                        return (
                            <div className="fs" key={sec.kind} data-off={off ? '' : undefined}>
                                <div className="fs__h">{sec.title}</div>
                                {sec.groups.map((g) => (
                                    <Group key={g.name} label={g.label}>
                                        {g.opts.map((o) => (
                                            /* disabled, not just dimmed — see (A) at the top */
                                            <Chip key={o.v} on={picks[g.name] === o.v} disabled={off}
                                                  onClick={() => setPicks((p) => ({ ...p, [g.name]: o.v }))}>
                                                {o.t}
                                            </Chip>
                                        ))}
                                    </Group>
                                ))}
                            </div>
                        )
                    })}
                </div>

                <div className="flt__f">
                    <button type="button" className="flt__r" disabled={active === 0} onClick={reset}>
                        Reset
                    </button>
                    <button type="button" className="btn btn--gold flt__a" onClick={apply}
                            style={{ height: 34, padding: '0 18px', fontSize: 13 }}>
                        Apply
                    </button>
                </div>
            </div>
        </span>
    )
}
