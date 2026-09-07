import React from 'react'

/**
 * ExpandButton — the trigger in a card footer.
 *
 * IN ITS OWN FILE, and that is the point. It used to live in DebateExpanded,
 * which HomeV2 and PostTypes both needed it from — so a module that is supposed
 * to arrive only when a debate is opened was being pulled into the main chunk by
 * a 12-line button. Rollup said so out loud:
 *
 *   INEFFECTIVE_DYNAMIC_IMPORT … dynamically imported but also statically
 *   imported, dynamic import will not move module into another chunk
 *
 * Which meant every visitor who merely scrolled the feed was downloading the
 * bracket, the ballots and the conversation threads. One tiny leaf module with
 * no imports of its own is what keeps the big one lazy.
 *
 * `label` because what is behind it genuinely differs by kind and by phase — a
 * live debate opens onto a bracket you can vote in, a would be onto a funding
 * panel, an artifact onto its sources. "See the full debate" on all four would
 * promise the same thing about four different screens.
 */
export default function ExpandButton({ open, onClick, id, label = 'See the full debate' }) {
    return (
        <button
            type="button" className="expand" onClick={onClick}
            aria-expanded={open} aria-controls={`xp-${id}`}
        >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                <path d="M4 6.2 8 10l4-3.8" stroke="currentColor" strokeWidth="1.9"
                      strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="expand__t">{open ? 'Collapse' : label}</span>
        </button>
    )
}
