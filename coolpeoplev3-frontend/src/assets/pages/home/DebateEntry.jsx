import React from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from './HomeV2'
import './DebateEntry.css'

/* ============================================================================
 * DebateEntry — the nomination stage.
 *
 * WHY THIS IS A SEPARATE OBJECT, not a variant of the duel:
 * an open-entry debate has no arguments yet. Previewing a duel with one filled
 * seat shows a thing that does not exist at that point in the lifecycle. What
 * a reader needs before the first round is who has been put forward, when it
 * starts, what it pays, and whether they can get in — so that is what the card
 * shows while `status === "entry"`.
 *
 * Two states, both shipped:
 *   nominations.length === 0  →  empty preview + "No nominations yet"
 *   nominations.length  >  0  →  leading-three strip + the ranked list
 *
 * MONEY IS CENTS, as everywhere else in this app.
 *
 * Invariant unchanged: --rule-strong is the card's OUTER edge. Nothing here
 * uses it; grouping is fill (--sunk) and --rule-2.
 * ==========================================================================*/

const money = (cents) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    }).format(Number(cents || 0) / 100)

const Ic = ({ d, w = 14, sw = 1.5 }) => (
    <svg width={w} height={w} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d={d} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)
const StarFilled = () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.9 9.9 5.8l4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.9Z" />
    </svg>
)
const D = {
    plus:  'M8 3v10M3 8h10',
    arrow: 'M6.4 3.6 10.8 8l-4.4 4.4',
    link:  'M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-1 1M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l1-1',
    x:     'M3 3h2.4l3 4 3.3-4h1.5l-4 4.9L13.2 13h-2.4l-3.1-4.2L4.3 13H2.8l4.3-5.2L3 3Z',
    mail:  'M2.6 4.2h10.8v7.6H2.6V4.2Zm0 .4L8 8.6l5.4-4',
}

/** The collapsed preview. Replaces the duel while the debate is at entry. */
export function EntryPreview({ nominations = [], totalNominations, onNominate }) {
    if (nominations.length === 0) {
        return (
            <div className="epv epv--empty">
                <span className="epv__t">
                    <b>Nobody has been put forward yet</b>
                    <p>Nominate someone and they&rsquo;ll be invited to take a side. First one in sets the tone.</p>
                </span>
                <button type="button" className="btn btn--gold" onClick={onNominate}
                        style={{ height: 34, padding: '0 16px', fontSize: 13 }}>
                    <StarFilled />Nominate
                </button>
            </div>
        )
    }
    const lead = nominations.slice(0, 3)
    const rest = nominations.length - lead.length
    return (
        <div className="epv">
            <div className="epv__top">
                <span className="epv__l">Leading nominations</span>
                {/* TWO NUMBERS, because they are not the same number. Three people
                    can carry forty nominations between them, and a single count
                    hides which of those a reader is looking at. */}
                <span className="epv__c">
                    {nominations.length} people put forward · {totalNominations} nominations cast
                </span>
            </div>
            <div className="epv__row">
                {lead.map((n) => (
                    <Link className="nomchip" to={n.to ?? '#'} key={n.name}>
                        <Avatar name={n.name} src={n.avatarUrl} size={24} />
                        {n.name}<b>{n.count}</b>
                    </Link>
                ))}
                {rest > 0 && <span className="epv__more">+{rest} more</span>}
                <button type="button" className="btn btn--gold epv__cta" onClick={onNominate}
                        style={{ height: 34, padding: '0 16px', fontSize: 13 }}>
                    <StarFilled />Nominate
                </button>
            </div>
        </div>
    )
}

function Prompts({ prompts, published, onCriteria }) {
    return (
        <div className="pr">
            <h3 className="xp__h">Prompts</h3>
            <p className="pr__lede">
                These prompts will be asked during the debate. Some may be omitted, and
                some not listed here may be added.
            </p>

            {published && prompts?.length ? (
                <div className="pr__list">
                    {prompts.map((q, i) => (
                        <div className="pr__i" key={q}>
                            <span className="pr__n">{i + 1}</span>
                            <span className="pr__q">{q}</span>
                        </div>
                    ))}
                </div>
            ) : (
                /* NOT AN EMPTY LIST — a reason. "No prompts" reads as a debate
                   nobody has thought about; the real state is that they are
                   written and withheld until the seats are filled. */
                <div className="pr__empty">
                    The prompts for this debate haven&rsquo;t been published yet. They go up
                    when the seats are filled.
                </div>
            )}

            <div className="pr__crit">
                <button type="button" className="critbtn" onClick={onCriteria}>
                    Criteria<Ic d={D.arrow} w={12} sw={2} />
                </button>
            </div>
        </div>
    )
}

function EntryPanel({ startDate, prizeCents, seatsTaken, seats, onNominate, onJoin }) {
    const SHARE = [['Copy link', D.link], ['Share on X', D.x], ['Share by email', D.mail]]
    return (
        <aside className="ent">
            <span className="ent__l">Start date</span>
            <span className="ent__v">{startDate}</span>

            <div className="purse">
                <span className="ent__l">Total cash prize</span>
                <span className="purse__n">{money(prizeCents)}</span>
                <span className="purse__s">Paid to the winner when the final closes.</span>
            </div>

            {/* NOMINATE LEADS, and Join is the quieter one. Most people reading a
                debate that has not started know somebody who should be in it
                before they decide they should be in it themselves — and a
                nomination is the action that costs the reader nothing. */}
            <div className="ent__btns">
                <button type="button" className="btn btn--gold btn--full" onClick={onNominate}>
                    <StarFilled />Nominate
                </button>
                <button type="button" className="btn btn--ghost btn--full" onClick={onJoin}>
                    <Ic d={D.plus} w={15} sw={2} />Join the debate
                </button>
            </div>

            <div className="socials">
                <span className="socials__l">Share</span>
                <span className="socials__r">
                    {SHARE.map(([label, d]) => (
                        <button type="button" key={label} aria-label={label}><Ic d={d} w={15} /></button>
                    ))}
                </span>
            </div>

            <p className="ent__note">
                {seatsTaken} of {seats} seats taken. Nominating someone puts their name
                forward — they still have to accept before the first round opens.
            </p>
        </aside>
    )
}

export default function DebateEntry({
    id, prompts, promptsPublished = false,
    startDate, prizeCents, seats, seatsTaken = 0,
    nominations = [],
    onNominate, onJoin, onCriteria,
}) {
    return (
        <div className="xp" id={`xp-${id}`}>
            <div className="ent__cols">
                <Prompts prompts={prompts} published={promptsPublished} onCriteria={onCriteria} />
                <EntryPanel
                    startDate={startDate} prizeCents={prizeCents}
                    seats={seats} seatsTaken={seatsTaken}
                    onNominate={onNominate} onJoin={onJoin}
                />
            </div>

            <div className="nom">
                <div className="nom__h">
                    <span className="nom__t">Nominations</span>
                    <span className="nom__s">Who&rsquo;s been put forward</span>
                </div>

                {nominations.length === 0 ? (
                    <div className="nom__none">
                        <b>No nominations yet</b>
                        <span>
                            Anyone can put a name forward, including their own. Nominations close
                            when the seats fill or when the debate opens, whichever comes first.
                        </span>
                    </div>
                ) : (
                    <div className="nom__l">
                        {nominations.map((n, i) => (
                            <Link
                                className={`nom__i${i === 0 ? ' nom__i--lead' : ''}`}
                                to={n.to ?? '#'} key={n.name}
                            >
                                <span className="nom__r">{i + 1}</span>
                                <Avatar name={n.name} src={n.avatarUrl} size={24} />
                                <span className="nom__n">{n.name}</span>
                                <span className="nom__c"><b>{n.count}</b><span>nominations</span></span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
