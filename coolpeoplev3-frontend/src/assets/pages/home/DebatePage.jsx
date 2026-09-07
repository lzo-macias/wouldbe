import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from './HomeV2'
import ExpandButton from './ExpandButton'
import { CRITERIA, BONUS, MAXPTS, PEOPLE, DEBATE, BRACKETS } from './debateFixture'
import './DebatePage.css'

/* ============================================================================
 * DebatePage — where the feed's "Debate" button lands.
 *
 * THE CORRECTION THIS PAGE EXISTS FOR: a bracket is ONE QUESTION with MANY
 * RESPONSES. It is not a pair of people. The old screen drew a tennis draw,
 * which implied a turn order and a head-to-head the format never had.
 *
 * Everything below follows from that:
 *   · the timeline is the navigation, and it is on screen in every state
 *   · exactly one bracket renders at a time, because that is how many a reader
 *     can hold, and exactly one is open at a time, because that is how many the
 *     format runs
 *   · the criteria are never behind a tab; they are the rule of the game
 *   · the result is stated first, wherever a bracket has settled
 * ==========================================================================*/

const nf = new Intl.NumberFormat('en-US')
const money = (cents, dp = 0) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: dp, maximumFractionDigits: dp,
    }).format(Number(cents || 0) / 100)

const HEART = (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 13.6 2.7 8.5a3.1 3.1 0 1 1 4.4-4.4L8 5l.9-.9a3.1 3.1 0 1 1 4.4 4.4L8 13.6Z"
              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
)
const REPOST = (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 6.2V5a1.6 1.6 0 0 1 1.6-1.6h6.2M11.6 1.8l1.7 1.6-1.7 1.7M13 9.8V11a1.6 1.6 0 0 1-1.6 1.6H5.2M4.4 14.2 2.7 12.6l1.7-1.7"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)
const REPLY = (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6.4 3.4 2.6 7.2l3.8 3.8M2.6 7.2h7.1a3.5 3.5 0 0 1 3.5 3.5v2.1"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)
const Chev = (p) => (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...p}>
        <path d="M4 6.2 8 10l4-3.8" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

/* ---- derived ------------------------------------------------------------- */
const all = (bk) => (bk.seats || []).concat(bk.field || [])
const ini = (name) => (PEOPLE[name] || {}).i || '??'
const isSeat = (bk, r) => (bk.seats || []).indexOf(r) > -1

// The bracket goes to whoever took the most votes — a seat, or somebody from
// the field who outscored both of them.
const winnerOf = (bk) =>
    bk.seats ? [...all(bk)].sort((a, b) => b.votes - a.votes)[0] : null

// The field, in the order it should be read. If a challenger took the bracket
// they lead it — burying the person who won underneath four people who did not
// is not a ranking, it is a filing error.
const fieldOrder = (bk, win) => {
    const f = [...(bk.field || [])].sort((a, b) => b.votes - a.votes)
    if (!win || isSeat(bk, win)) return f
    return [win, ...f.filter((r) => r !== win)]
}

/* ---- pieces -------------------------------------------------------------- */

// A contestant who is also raising money gets a way through to it.
function WouldBeChip({ name }) {
    const w = (PEOPLE[name] || {}).wouldbe
    if (!w) return null
    return (
        <Link className="wb" to={w.to ?? '#'}>
            <span className="wb__k">would be</span>
            <span className="wb__t">{w.t}</span>
            <span className="wb__p">{w.pct}%</span>
        </Link>
    )
}

function Eng({ r, liked }) {
    return (
        <div className="eng">
            <button type="button" className={`engb${liked ? ' engb--on' : ''}`}>
                {HEART}{nf.format(r.votes)}
            </button>
            <button type="button" className="engb">{REPOST}{nf.format(r.reposts)}</button>
            <button type="button" className="engb">{REPLY}{nf.format(r.replies)}</button>
            <WouldBeChip name={r.name} />
        </div>
    )
}

// The one emphasised sentence. Held as three fields rather than as HTML so the
// body never has to be dangerouslySetInnerHTML — a debate response is the one
// string on this platform most likely to be user-authored.
const Body = ({ r }) => (
    <>{r.b}{r.pull && <b>{r.pull}</b>}{r.b2}</>
)

/* The rule of the game does not belong behind a tab. If a reader has to go
   looking for what a good answer is, they write the wrong answer; if a voter
   has to go looking, they score on vibe. */
function Criteria() {
    return (
        <div className="cx">
            <div className="cx__h">
                What a response is scored on
                <em>Four criteria, 1–5 each · {nf.format(MAXPTS)} points maximum</em>
            </div>
            <div className="cx__g">
                {CRITERIA.map((c, i) => (
                    <div className="cxi" key={c.k}>
                        <span className="cxi__n"><i className="cxi__i">{i + 1}</i>{c.n}</span>
                        <span className="cxi__s">{c.s}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Following a debate and following the person who runs debates are different
// subscriptions, and a single button silently picks one for you. The main
// button does the common thing (both); the caret is there for when it isn't.
function Follow({ host }) {
    const [open, setOpen] = useState(false)
    const [on, setOn] = useState({ thing: false, host: false })
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', away)
        document.addEventListener('keydown', esc)
        return () => {
            document.removeEventListener('mousedown', away)
            document.removeEventListener('keydown', esc)
        }
    }, [open])

    const count = Number(on.thing) + Number(on.host)
    const label = count === 0 ? 'Follow' : count === 2 ? 'Following' : 'Following · 1'

    return (
        <span className="fol" ref={ref}>
            <button
                type="button" className="follow" data-on={count ? '1' : '0'}
                onClick={() => setOn({ thing: !count, host: !count })}
            >
                {label}
            </button>
            <button
                type="button" className="fol__c" aria-expanded={open}
                aria-label="Choose what to follow" onClick={() => setOpen((o) => !o)}
            >
                <Chev width="11" height="11" />
            </button>
            <div className="fol__m" hidden={!open}>
                <p className="fol__h">Follow</p>
                <button
                    type="button" className="fol__o" aria-pressed={on.thing}
                    onClick={() => setOn((s) => ({ ...s, thing: !s.thing }))}
                >
                    <span className="fol__ot">This debate</span>
                    <span className="fol__os">Every bracket, result and reply</span>
                    <span className="fol__k" aria-hidden="true" />
                </button>
                <button
                    type="button" className="fol__o" aria-pressed={on.host}
                    onClick={() => setOn((s) => ({ ...s, host: !s.host }))}
                >
                    <span className="fol__ot">{host.name}</span>
                    <span className="fol__os">Everything they put up</span>
                    <span className="fol__k" aria-hidden="true" />
                </button>
            </div>
        </span>
    )
}

/* ---- 1. the timeline ------------------------------------------------------
   Every bracket the debate has, in order, always on screen. Past brackets are
   grey but live — the whole point of a written debate is that the record stays
   readable — and brackets that have not been released are dashed and inert. */
function Timeline({ brackets, current, stateOf, query, onQuery, onPick, view, onView }) {
    const shown = brackets.filter((bk) => {
        if (!query) return true
        const hay = bk.q + ' ' + all(bk).map((r) => r.name + ' ' + r.b).join(' ')
        return hay.toLowerCase().includes(query.toLowerCase())
    })

    return (
        <section className="panel">
            <div className="psec" style={{ borderTop: 0 }}>
                <h2 className="ph">
                    Timeline <em>Every bracket, in order</em>
                    <span className="ph__sp" />
                    <span className="vw" role="group" aria-label="Preview state">
                        <button type="button" aria-pressed={view === 'live'} onClick={() => onView('live')}>Live</button>
                        <button type="button" aria-pressed={view === 'done'} onClick={() => onView('done')}>Concluded</button>
                    </span>
                </h2>

                <div className="tl__bar">
                    <label className="tlsearch">
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M13.6 13.6 17.5 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        <input
                            type="search" value={query} onChange={(e) => onQuery(e.target.value)}
                            placeholder="Search this debate — a question, a name, a phrase"
                            aria-label="Search this debate"
                        />
                    </label>
                </div>

                {shown.length === 0 ? (
                    <div className="tl__none">Nothing in this debate matches “{query}”.</div>
                ) : (
                    <div className="tl__rail">
                        {shown.map((bk) => {
                            const st = stateOf(bk)
                            const win = st === 'done' && bk.seats ? winnerOf(bk) : null
                            return (
                                <button
                                    type="button" key={bk.id}
                                    className={`tlb tlb--${st}`}
                                    disabled={st === 'lock'}
                                    aria-current={bk.id === current}
                                    onClick={() => onPick(bk.id)}
                                >
                                    <span className="tlb__n">
                                        <i className="tlb__d" />
                                        {bk.final ? 'Final' : `Bracket ${bk.n}`}
                                        {st === 'open' ? ' · open' : ''}
                                    </span>
                                    <span className="tlb__q">{bk.q}</span>
                                    <span className="tlb__f">
                                        {st === 'lock' ? (
                                            <span>{bk.when}</span>
                                        ) : win ? (
                                            <>
                                                <span className="av av--24" style={{ width: 18, height: 18, fontSize: 8.5 }}>
                                                    {ini(win.name)}
                                                </span>
                                                <b>{win.name}</b>
                                            </>
                                        ) : (
                                            <span style={{ color: 'var(--live)', fontWeight: 700 }}>{bk.when}</span>
                                        )}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>
        </section>
    )
}

/* ---- the duel ----
   Two contestants, the same width, the same length. Two people in opposition
   at equal weight is the whole claim of the format; a flat ranked list quietly
   replaces it with a leaderboard. */
function Side({ r, i, lead, bkId }) {
    const [clipped, setClipped] = useState(true)
    const ref = useRef(null)
    const [long, setLong] = useState(false)

    // Only offer "Read more" where there is actually more to read.
    useEffect(() => {
        const el = ref.current
        if (el) setLong(el.scrollHeight > el.clientHeight + 2)
    }, [bkId])

    return (
        <div className={`side${i ? ' side--b' : ''}${lead ? ' side--lead' : ''}`}>
            <div className="side__head">
                <span className="av av--24">{ini(r.name)}</span>
                <span className="side__n">{r.name}</span>
                <span className="stance">{r.stance}</span>
            </div>
            <p ref={ref} className={`arg${clipped ? ' arg--clip' : ''}`}><Body r={r} /></p>
            {long && (
                <button type="button" className="more" onClick={() => setClipped((c) => !c)}>
                    {clipped ? 'Read more' : 'Read less'}
                </button>
            )}
            <Eng r={r} liked={lead} />
        </div>
    )
}

/**
 * THE FIELD, as a list. Exported because the feed card shows exactly this when
 * somebody presses "Read all N responses" — a card is one prompt out of a
 * debate, and the rest of the answers to that prompt are what "the responses"
 * means in both places. Two implementations of it would drift the first time
 * one of them was touched.
 */
export function FieldList({ bk, win }) {
    return (
        <div className="rest__l">
            {fieldOrder(bk, win).map((r) => {
                const isWin = win === r
                return (
                    <article className={`rest__i${isWin ? ' rest__i--win' : ''}`} key={r.name}>
                        <div className="rest__h">
                            <span className="av av--24">{ini(r.name)}</span>
                            <span className="rest__n">{r.name}</span>
                            {isWin ? (
                                <span className="rsp__tag rsp__tag--chal">took the bracket</span>
                            ) : r.chal ? (
                                <span className="rsp__tag rsp__tag--chal">challenger</span>
                            ) : null}
                            <span className="rsp__tag">{r.stance}</span>
                        </div>
                        <p className="rest__b"><Body r={r} /></p>
                        <Eng r={r} liked={isWin} />
                    </article>
                )
            })}
        </div>
    )
}

/**
 * WHO TOOK IT. Exported for the same reason FieldList is: a settled bracket
 * says the same thing in the feed as it does on the debate screen, and the
 * result is the first thing a reader wants either place.
 */
export function WinnerBanner({ bk, win }) {
    if (!win) return null
    return (
        <div className="wnr">
            <span className="wnr__c">Took the bracket</span>
            <span className="wnr__t">
                <b>{win.name}</b> — {isSeat(bk, win) ? 'held the seat' : 'came from the field and took the seat'}
            </span>
            <span className="wnr__m">
                <b>{nf.format(win.votes)} votes</b> &nbsp;·&nbsp; {nf.format(PEOPLE[win.name].noms)} nominations
            </span>
        </div>
    )
}

/** ONE bracket is open at a time, so there is exactly one ballot. */
export function OpenVote({ bk, signedIn, onSignIn }) {
    const [a, b] = bk.seats || []
    if (!a || !b) return null
    return (
        <section className="xp__sec">
            <h3 className="xp__h">Open vote {!signedIn && <em>Sign in to vote</em>}</h3>
            <div className="votes votes--one">
                <div className="vm">
                    <span className="vm__r">{bk.final ? 'The Final' : `Bracket ${bk.n}`}</span>
                    <span className="vm__who">
                        <span className="vm__faces">
                            <Avatar name={a.name} size={24} />
                            <Avatar name={b.name} size={24} />
                        </span>
                        <span className="vm__n">{a.name} <s>vs</s> {b.name}</span>
                    </span>
                    <div className="vm__foot">
                        <p className="vm__p">Read them both, then say who won.</p>
                        <button
                            type="button" className="btn btn--ghost" onClick={onSignIn}
                            style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
                        >
                            {signedIn ? 'Vote' : 'Sign in'}
                        </button>
                    </div>
                    <span className="vm__t">{bk.when.replace('Closes in', 'closes in')}</span>
                </div>
            </div>
        </section>
    )
}

function Bracket({ bk, st, onWrite, signedIn }) {
    const [openField, setOpenField] = useState(false)
    // Closed by default: the criteria are the rule of the game, but a reader who
    // has read them once does not need four cards of them above every bracket
    // they open afterwards.
    const [showCx, setShowCx] = useState(false)
    useEffect(() => { setOpenField(false); setShowCx(false) }, [bk.id])

    const head = (
        <div className="bk__h">
            <span className="bk__n">{bk.final ? 'Final bracket' : `Bracket ${bk.n}`}</span>
            {st === 'open' ? (
                <span className="kind kind--live"><span className="pip" />Open now</span>
            ) : st === 'lock' ? (
                <span className="kind kind--entry">Not released</span>
            ) : (
                <span className="kind kind--done">Settled</span>
            )}
            <span className="bk__t">{bk.when}</span>
        </div>
    )

    if (st === 'lock') {
        return (
            <section className="panel">
                <div className="psec bk" style={{ borderTop: 0 }}>
                    {head}
                    <p className="bk__q">{bk.q}</p>
                    <div className="bk__none">
                        One question goes out per bracket, in order. This one is released{' '}
                        {bk.when.replace('Opens ', 'on ')}, when the bracket before it closes.
                        <br /><br />
                        Nothing is written here yet — that is what makes it a fair question.
                    </div>
                </div>
            </section>
        )
    }

    const win = st === 'done' ? winnerOf(bk) : null
    const field = fieldOrder(bk, win)

    return (
        <section className="panel">
            <div className="psec bk" style={{ borderTop: 0 }}>
                {head}
                <p className="bk__q">{bk.q}</p>

                {/* the result, first, before anybody has to hunt for it */}
                <WinnerBanner bk={bk} win={win} />

                {/* THE ONE SENTENCE. The paragraph under it explained the
                    rules of the format inside the invitation, which is the
                    wrong place for them twice over: it buried the offer under
                    its own terms, and the terms are what the criteria panel is
                    for. The button beside it is now the way to those terms —
                    they are one press away instead of permanently open. */}
                {st === 'open' && (
                    <div className="inv">
                        <span className="inv__t">
                            <p className="inv__h">You can respond to this prompt for a chance to win.</p>
                        </span>
                        <button
                            type="button" className="critbtn" aria-expanded={showCx}
                            onClick={() => setShowCx((c) => !c)}
                        >
                            Criteria
                            <Chev width="12" height="12" />
                        </button>
                    </div>
                )}

                {/* THE BALLOT. It was missing from this screen altogether —
                    the page told you that you could respond and what you would
                    be scored on, and then gave you no way to score anybody. A
                    live bracket without its ballot is a scoreboard you can read
                    and not play. */}
                {st === 'open' && (
                    <OpenVote bk={bk} signedIn={signedIn} onSignIn={onWrite} />
                )}

                {/* A SETTLED bracket keeps the criteria one press away too — it
                    is how the result was arrived at, and a reader checking a
                    score should not have to remember the rules. */}
                {st !== 'open' && (
                    <div className="bk__cx">
                        <button
                            type="button" className="critbtn" aria-expanded={showCx}
                            onClick={() => setShowCx((c) => !c)}
                        >
                            Criteria
                            <Chev width="12" height="12" />
                        </button>
                    </div>
                )}

                {showCx && <Criteria />}

                <div className="duel">
                    {bk.seats.map((r, i) => (
                        <React.Fragment key={r.name}>
                            {i === 1 && <div className="duel__rule" aria-hidden="true" />}
                            <Side r={r} i={i} lead={win === r} bkId={bk.id} />
                        </React.Fragment>
                    ))}
                </div>

                {/* THE FIELD — folded, and led by the challenger when one won.
                    Its own bar is gone: the footer below opens it, the same way
                    a feed card's footer opens the card. Two controls for one
                    list is how a reader ends up pressing the wrong one. */}
                {/* RENDERED, not hidden. The `hidden` attribute is a UA rule
                    (`[hidden]{display:none}`) and any author `display` beats it
                    — .rest__l sets display:flex, so the field was on screen at
                    all times no matter what the toggle said, and the footer was
                    pushed to the bottom of a list nobody had opened. */}
                {field.length > 0 && openField && (
                    <div className="rest"><FieldList bk={bk} win={win} /></div>
                )}
            </div>

            {/* THE SAME FOOTER THE FEED CARD HAS — --foot ground, Respond on
                the left, the expander beside it. It says RESPONSES, not
                comments: what opens is the rest of the field answering this
                question, and calling those comments would file an entry in the
                bracket as a remark about it. */}
            <footer className="card__foot bk__foot">
                {st === 'open' && (
                    <button type="button" className="respond" onClick={onWrite}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M6 3.5 2.5 7 6 10.5M2.5 7h7.2a3.3 3.3 0 0 1 3.3 3.3V13"
                                  stroke="currentColor" strokeWidth="1.7"
                                  strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Respond
                    </button>
                )}
                {field.length > 0 && (
                    <ExpandButton
                        id={bk.id} open={openField}
                        onClick={() => setOpenField((o) => !o)}
                        label={`Read all ${field.length + bk.seats.length} responses`}
                    />
                )}
                <span className="sp" />
                <button type="button" className="act" aria-label="Save">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M4 2.8h8v10.4L8 10.4l-4 2.8V2.8Z" stroke="currentColor"
                              strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                </button>
                <button type="button" className="act" aria-label="Share">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M8 10.6V2.6M5.2 5.2 8 2.4l2.8 2.8M3.4 9.6v3a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1v-3"
                              stroke="currentColor" strokeWidth="1.5"
                              strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </footer>
        </section>
    )
}

/**
 * standingsRows — the dashboard, computed once and the same everywhere.
 *
 * IT DOES NOT MOVE. It used to be derived from the page's `view`, so flipping
 * the preview switch — or, once this is real, the debate simply ending —
 * silently changed everybody's total. A dashboard whose numbers depend on which
 * bracket you happen to be reading is not a dashboard. Every bracket that has
 * responses counts, in every state, and nothing here reads the current view.
 *
 * Exported because the bracket card in the feed ends with the same table: a
 * reader who has just read one bracket's responses is exactly the reader who
 * wants to know where that leaves everybody.
 */
export function standingsRows() {
    const acc = {}
    // WHO WAS BUMPED, AND WHO DID THE BUMPING. When a bracket settles and its
    // winner came from the field, that person took a seat — and the seat they
    // took is the lower-scoring of the two, because that is the one that lost
    // its place. Both facts belong on the person, not on the bracket.
    const role = {}
    BRACKETS.forEach((b) => {
        if (!b.seats) return
        all(b).forEach((r) => {
            const row = acc[r.name] || (acc[r.name] = { name: r.name, votes: 0 })
            row.votes += r.votes
            if (r.chal) role[r.name] = { ...role[r.name], challenger: true }
        })
        const win = winnerOf(b)
        if (b.state === 'done' && win && !isSeat(b, win)) {
            const out = [...b.seats].sort((x, y) => x.votes - y.votes)[0]
            role[out.name] = { ...role[out.name], bumped: true }
        }
    })
    return Object.values(acc)
        .map((r) => ({
            ...r,
            ...(PEOPLE[r.name] || {}),
            noms: PEOPLE[r.name]?.noms ?? 0,
            // BUMPED WINS over challenger when somebody is both. Losing a seat
            // is what happened TO them and it is the fact a reader scans the
            // column for; taking one is what they did, and the bracket itself
            // already says so.
            role: role[r.name]?.bumped ? 'bumped'
                : role[r.name]?.challenger ? 'challenger'
                : null,
        }))
        .sort((a, b) => b.votes - a.votes)
}

/* ---- 4. standings ----
   The two numbers a reader actually asks for: how many votes somebody finished
   with, and how many times they were nominated. */
export function Standings({ rows, bare = false }) {
    const table = (
        <>
                <p className="st__k">
                    Where somebody finished, and how many people put them forward.{' '}
                    <b>Final votes</b> are every vote they took across every settled bracket;{' '}
                    <b>nominations</b> are how many people asked for them to be in this debate at
                    all. The four criteria live on each response, where you are looking at the
                    thing being scored.
                </p>
                <div className="st">
                    <div className="st__hd">
                        <span /><span>Contestant</span><span>Nominations</span><span>Final votes</span>
                    </div>
                    {rows.map((r, i) => (
                        <div className={`st__r${i === 0 ? ' st__r--lead' : ''}`} key={r.name}>
                            <span className="st__rk">{i + 1}</span>
                            <span className="st__who">
                                <span className="av av--24">{r.i}</span>
                                <span className="st__n">{r.name}</span>
                                {r.wouldbe && (
                                    <span className="st__wbwrap"><WouldBeChip name={r.name} /></span>
                                )}
                            </span>
                            {/* The role REPLACES the count. Somebody who was
                                bumped or who came up from the field is not
                                described by how many people asked for them —
                                what happened in the brackets is. */}
                            <span className="st__v">
                                <span className="st__lbl">Nominations</span>
                                {r.role
                                    ? <span className={`st__role st__role--${r.role}`}>{r.role}</span>
                                    : nf.format(r.noms)}
                            </span>
                            <span className="st__t"><span className="st__lbl">Final votes</span>{nf.format(r.votes)}</span>
                        </div>
                    ))}
                </div>
        </>
    )
    // `bare` drops the panel and the heading: inside the bracket card the panel
    // IS the card and the heading is supplied by the section around it, and a
    // panel nested in a panel is two edges saying the same thing.
    if (bare) return table
    return (
        <section className="panel">
            <div className="psec" style={{ borderTop: 0 }}>
                <h2 className="ph">Votes dashboard <em>Final votes and nominations</em></h2>
                {table}
            </div>
        </section>
    )
}

/* ---- the page ------------------------------------------------------------ */

export default function DebatePage() {
    const navigate = useNavigate()
    const [view, setView] = useState('live')      // 'live' | 'done' — the preview switch
    const [current, setCurrent] = useState('b3')
    const [query, setQuery] = useState('')
    const bkRef = useRef(null)

    /* A concluded debate has no open bracket and nothing still to come — the
       whole record is readable, which is the point of writing it down. But a
       bracket with no responses was never released, and no amount of the debate
       being over conjures answers into it: it stays locked. */
    const stateOf = (bk) => {
        if (!bk.seats) return 'lock'
        if (view === 'done') return 'done'
        return bk.state
    }

    // Landing on a bracket with nothing in it is landing on an empty screen.
    const pickView = (v) => {
        setView(v)
        const here = BRACKETS.find((b) => b.id === current)
        if (!here?.seats) setCurrent([...BRACKETS].reverse().find((b) => b.seats).id)
    }

    const pick = (id) => {
        setCurrent(id)
        bkRef.current?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            block: 'start',
        })
    }

    const bk = BRACKETS.find((b) => b.id === current)
    const st = bk ? stateOf(bk) : 'lock'

    const chrome = useMemo(() => {
        const open = BRACKETS.find((b) => stateOf(b) === 'open')
        const settled = BRACKETS.filter((b) => stateOf(b) === 'done' && b.seats).length
        const lock = BRACKETS.filter((b) => stateOf(b) === 'lock').length
        const names = new Set()
        BRACKETS.forEach((b) => all(b).forEach((r) => names.add(r.name)))
        return {
            open, settled, lock, answered: names.size,
            brackets: open
                ? `Bracket ${open.n} of ${BRACKETS.length}`
                : `${settled} of ${BRACKETS.length} brackets settled`,
            split: `${settled} settled · ${open ? '1 open · ' : ''}${lock ? `${lock} to come` : 'none left'}`,
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view])

    const rows = useMemo(() => standingsRows(), [])

    return (
        <div className="dpage">
            {/* Back to the feed, not to whatever page happened to precede it —
                the debate is a destination people arrive at from links. */}
            <Link className="back" to="/homev2" aria-label="Back to your feed">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.9"
                          strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Back</span>
            </Link>

            {/* ---------- hero ---------- */}
            <section className="panel">
                <div className="dh">
                    <div className="dh__main">
                        <h1 className="dh__q">{DEBATE.title}</h1>

                        <div className="meta dh__meta">
                            <span className={`kind ${chrome.open ? 'kind--live' : 'kind--done'}`}>
                                {chrome.open && <span className="pip" />}
                                {chrome.open ? 'Live' : 'Concluded'}
                            </span>
                            <span className="meta__dot" />
                            <span>{chrome.brackets}</span>
                            <span className="meta__dot" />
                            <span>{chrome.answered} people have answered</span>
                            {chrome.open && (
                                <>
                                    <span className="meta__dot" />
                                    <span className="meta__urgent">{chrome.open.when}</span>
                                </>
                            )}
                        </div>

                    </div>

                    <div className="dh__side">
                        <span className="dh__prize">
                            <span className="dh__pn">{money(DEBATE.prizeCents)}</span>
                            <span className="dh__pl">prize</span>
                        </span>

                        <div className="dh__hg">
                            <div className="dh__who">
                                <span className="dh__wt">
                                    <span className="dh__wl">Hosted by</span>
                                    <span className="dh__wn">{DEBATE.host.name}</span>
                                </span>
                                <span className="av av--34">{DEBATE.host.i}</span>
                            </div>
                            <Follow host={DEBATE.host} />
                        </div>
                    </div>
                </div>

            </section>

            <Timeline
                brackets={BRACKETS} current={current} stateOf={stateOf}
                query={query} onQuery={setQuery} onPick={pick}
                view={view} onView={pickView}
            />

            <div ref={bkRef}>
                {bk && (
                    <Bracket
                        bk={bk} st={st}
                        signedIn={Boolean(localStorage.getItem('token'))}
                        onWrite={() => navigate('/login')}
                    />
                )}
            </div>

            <Standings rows={rows} />
        </div>
    )
}
