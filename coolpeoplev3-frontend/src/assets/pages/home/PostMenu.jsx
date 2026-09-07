import React, { useEffect, useRef, useState } from 'react'
import './postmenu.css'

/* ============================================================================
 * PostMenu — the four things you can put up, as a popover on the button.
 *
 * IT REPLACED A PANEL IN THE FEED. Choosing a kind is not a step of writing a
 * post, it is the question of which post you are writing — so it belongs on the
 * button that asked, not in a card the size of the thing you have not made yet.
 * The old chooser opened a full-width panel above the column, which pushed the
 * feed down to ask a question with four one-word answers.
 *
 * THEY ARRIVE IN ORDER, one breath apart. The stagger is not decoration: four
 * options appearing at once is a menu you scan, four arriving in sequence is a
 * list you read — and the order is the answer to "what is the smallest thing I
 * can do here", which is the order somebody deciding actually wants.
 *
 * THE COLOURS ARE THE LADDER. White, then a wash of gold, then the plate, then
 * ink: paper → asking for attention → asking for money → the whole apparatus.
 * A question costs nothing and a debate has a purse behind it, and the surface
 * says which before the words do.
 * ==========================================================================*/

const KINDS = [
    { k: 'question', t: 'Question', d: 'Open to anyone',
      icon: 'M8 11.5v.01M8 9.2c0-1.6 1.9-1.7 1.9-3.1A1.9 1.9 0 0 0 6.2 5.6' },
    { k: 'artifact', t: 'Article', d: 'Your name on a claim',
      icon: 'M4 2.6h8v10.8H4zM6 5.4h4M6 8h4M6 10.6h2.5' },
    { k: 'debate', t: 'Debate', d: 'Two seats, a purse',
      icon: 'M2.6 5.4h4.2v5.2H2.6zM9.2 5.4h4.2v5.2H9.2zM8 3.4v9.2' },
    { k: 'wouldbe', t: 'Would be', d: 'Run for something',
      icon: 'M8 2.6v10.8M5 5.2h4.4a1.7 1.7 0 0 1 0 3.4H6.6a1.7 1.7 0 0 0 0 3.4H11' },
]

export default function PostMenu({ onPick, className = '', align = 'left', children }) {
    const [open, setOpen] = useState(false)
    const root = useRef(null)
    const btn = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
        const esc = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
        document.addEventListener('mousedown', away)
        document.addEventListener('keydown', esc)
        return () => {
            document.removeEventListener('mousedown', away)
            document.removeEventListener('keydown', esc)
        }
    }, [open])

    return (
        <span className="pm" ref={root} data-align={align}>
            <button
                ref={btn} type="button" className={className}
                aria-expanded={open} aria-haspopup="menu"
                onClick={() => setOpen((o) => !o)}
            >
                {children}
            </button>

            {open && (
                <div className="pm__m" role="menu">
                    {KINDS.map((k, i) => (
                        <button
                            type="button" role="menuitem" key={k.k}
                            className={`pm__i pm__i--${k.k}`}
                            /* the stagger is a custom property so one keyframe
                               serves all four and the interval is one number */
                            style={{ '--i': i }}
                            onClick={() => { setOpen(false); onPick?.(k.k) }}
                        >
                            <span className="pm__ic">
                                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path d={k.icon} stroke="currentColor" strokeWidth="1.5"
                                          strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </span>
                            <span className="pm__t">{k.t}</span>
                            <span className="pm__d">{k.d}</span>
                        </button>
                    ))}
                </div>
            )}
        </span>
    )
}
