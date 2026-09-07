import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, CardHead, CardFoot, MetaRow, Actions } from './HomeV2'
import ExpandButton from './ExpandButton'
import './PostTypes.css'

/* ============================================================================
 * PostTypes — Question, Artifact, Would be.
 *
 * All three are the SAME card as the debate. The skeleton comes from HomeV2
 * (CardHead / MetaRow / CardFoot) and only two things vary by kind:
 *
 *   kind      value slot          preview between meta and footer
 *   ────────  ──────────────────  ─────────────────────────────────────
 *   debate    prize               the duel, two opposed columns
 *   question  — (the count sits   the top answers, stacked and clamped
 *                in the meta line)
 *   artifact  — (the statement    the statement itself, at display size
 *                is the value)
 *   wouldbe   % funded            progress bar + backers + pledge
 *
 * That constraint is the whole design. Four post types that each invent their
 * own header and footer stop reading as one product very fast.
 *
 * MONEY IS CENTS, everywhere in this app — a prize crosses the wire as
 * `prize_pool_cents` and a goal as `goal_cents`. The helper below divides. Two
 * money helpers with different units in one codebase is how a $12,000 goal
 * renders as $120.
 *
 * Same invariant as everywhere else: --rule-strong is the card's OUTER edge.
 * Nothing in here uses it. Internal grouping is fill (--sunk) and --rule-2.
 * ==========================================================================*/

const nf = new Intl.NumberFormat('en-US')
const money = (cents) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(Math.round(Number(cents || 0) / 100))

const Ic = ({ d, w = 14, sw = 1.5, fill = 'none' }) => (
    <svg width={w} height={w} viewBox="0 0 16 16" fill={fill} aria-hidden="true">
        <path d={d} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)
const P = {
    comment: 'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.5L3.5 14v-2.5a1 1 0 0 1-.5-1v-6a1 1 0 0 1 0-1Z',
    reply:   'M6 3.5 2.5 7 6 10.5M2.5 7h7.2a3.3 3.3 0 0 1 3.3 3.3V13',
    link:    'M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-1 1M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l1-1',
    bolt:    'M8.8 1.8 3.4 9h3.4l-.6 5.2L12.6 7H9.2l-.4-5.2Z',
    check:   'm4.2 8.2 2.4 2.4 5-5.2',
    lock:    'M4.6 7V5.4a3.4 3.4 0 0 1 6.8 0V7M3.8 7h8.4v6H3.8V7Z',
    star:    'M8 1.9 9.9 5.8l4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.9Z',
}

/** Shared composer. Same shape for an answer and a comment — one box, one rule. */
export function Composer({ me, placeholder, cta, note, onSubmit, id, signedIn }) {
    return (
        <div className="comp">
            <Avatar name={me?.name} src={me?.avatarUrl} size={34} />
            <div className="comp__f">
                <label className="sr" htmlFor={id} hidden>{cta}</label>
                <textarea className="comp__in" id={id} placeholder={placeholder} />
                <div className="comp__b">
                    <button
                        type="button" className="btn btn--gold" onClick={onSubmit}
                        style={{ height: 34, padding: '0 15px', fontSize: 13 }}
                    >
                        {signedIn === false ? 'Sign in to post' : cta}
                    </button>
                    <span className="comp__note">{note}</span>
                </div>
            </div>
        </div>
    )
}

/* ==========================================================================
   QUESTION
   ========================================================================== */

/**
 * One answer. The SAME row the collapsed preview shows, because they are the
 * same object — a reader who opens the card should recognise what they were
 * already looking at, not meet a second design for it.
 *
 * NO BOX AND NO TINT. Answers used to sit in filled cards with the leader in a
 * gold one under a TOP ANSWER badge, which did three unhelpful things: it made
 * the list read as a stack of widgets rather than as a conversation, it put a
 * verdict at the top of a question that is explicitly not a contest, and it cost
 * every answer a border on a page whose card edge is already the only border
 * that means anything. A hairline between them is enough.
 */
function Answer({ a, onReply }) {
    return (
        <div className="qi">
            <Avatar name={a.name} src={a.avatarUrl} size={24} />
            <span className="qi__t">
                <span className="qi__h">
                    <span className="qi__n">{a.name}</span>
                    <span className="qi__o">{a.office}</span>
                    {a.when && <span className="qi__when">{a.when}</span>}
                </span>
                <p className="qi__b">{a.body}</p>
                <span className="qi__f">
                    <Actions
                        likes={a.likes} liked={a.liked}
                        reposts={a.reposts} reposted={a.reposted}
                        replies={a.replies} onReply={onReply}
                    />
                </span>

                {/* One level of nesting and one only. A thread that goes deeper
                    has stopped being an answer and become an argument, which is
                    what the debate type exists for — so it should be promoted,
                    not indented. */}
                {a.thread?.length > 0 && (
                    <span className="qi__rep">
                        {a.thread.map((r) => (
                            <span className="rep" key={r.name + r.when}>
                                <span className="rep__h">
                                    <Avatar name={r.name} size={24} />
                                    <span className="rep__n">{r.name}</span>
                                    <span className="rep__when">{r.when}</span>
                                </span>
                                <p className="rep__b">{r.body}</p>
                                <span className="th__f">
                                    <Actions likes={r.likes} reposts={r.reposts} replies={r.replies} />
                                </span>
                            </span>
                        ))}
                    </span>
                )}
            </span>
        </div>
    )
}

export function QuestionExpanded({
    id, lede, stats = [], answers = [], total, me, signedIn, onLoadMore, onPost,
}) {
    const [sort, setSort] = useState('top')
    const sorts = [['top', 'Top'], ['new', 'New'], ['candidates', 'Candidates only']]

    return (
        <div className="xp" id={`xp-${id}`}>
            {lede && (
                <div className="xp__lede"><p className="xp__blurb">{lede}</p></div>
            )}

            {stats.length > 0 && (
                <div className="stats">
                    {stats.map((s) => (
                        <div className="stat" key={s.label}>
                            <span className="stat__l">{s.label}</span>
                            <span className="stat__v">{s.value}</span>
                            {s.sub && <span className="stat__s">{s.sub}</span>}
                        </div>
                    ))}
                </div>
            )}

            <div className="qa__sort" role="group" aria-label="Sort answers">
                {sorts.map(([k, label]) => (
                    <button
                        type="button" key={k} className="sortchip"
                        aria-pressed={sort === k} onClick={() => setSort(k)}
                    >
                        {label}
                    </button>
                ))}
                <span className="qa__count">Showing {answers.length} of {total}</span>
            </div>

            <div className="qa__list">
                {answers.map((a) => <Answer key={a.name + a.when} a={a} />)}
            </div>

            {total > answers.length && (
                <button type="button" className="qa__more" onClick={onLoadMore}>
                    Load {total - answers.length} more answers
                </button>
            )}

            <Composer
                id={`qa-${id}`} me={me} signedIn={signedIn}
                placeholder="Answer for your own side. What does it cost you to say it?"
                cta="Post answer" note="Answers are public and tied to your account."
                onSubmit={onPost}
            />
        </div>
    )
}

export function QuestionCard({
    to = '#', id, author, question, meta = [], answers = [], total = 0,
    totalComments, imageUrl, expanded, onToggleExpand, onFollow, onAnswer, ...rest
}) {
    return (
        <article className="card" {...(expanded ? { 'data-open': '' } : {})}>
            <div className="card__pad">
                <CardHead author={author} onFollow={onFollow} />
                {/* The question is the door here too — same reasoning as the
                    debate card: opening in place must not cost a navigation. */}
                <button type="button" className="q q--btn" aria-expanded={expanded} onClick={onToggleExpand}>
                    {question}
                </button>
                <MetaRow kind="question" items={meta} />
            </div>

            {/* FULL-BLEED, under the head. An image on a post is not an
                illustration beside the text, it is part of what was posted —
                inset with the prose it reads as a thumbnail somebody attached. */}
            {imageUrl && <img className="post__img" src={imageUrl} alt="" />}

            {/* preview: the answers that are winning, clamped */}
            <div className="qpv">
                {answers.slice(0, 2).map((a) => (
                    <div className="qpv__i" key={a.name + a.when}>
                        <Avatar name={a.name} src={a.avatarUrl} size={24} />
                        <span className="qpv__t">
                            <span className="qpv__h">
                                <span className="qpv__n">{a.name}</span>
                                <span className="qpv__o">{a.office}</span>
                            </span>
                            <p className="qpv__b">{a.body}</p>
                            <span className="qpv__f">
                                <Actions
                                    likes={a.likes} liked={a.liked}
                                    reposts={a.reposts} reposted={a.reposted}
                                    replies={a.replies}
                                />
                            </span>
                        </span>
                    </div>
                ))}
            </div>

            {expanded && (
                <QuestionExpanded id={id} answers={answers} total={total} {...rest} />
            )}

            {/* ONE CONTROL, not two. "See the question" and "Read all 88
                comments" sat side by side and did the same thing — open the
                card — so the second one read as a different destination that
                did not exist. The count is the better label of the two: it says
                what is behind the chevron rather than naming the card you are
                already looking at. */}
            <CardFoot to={to}>
                <button type="button" className="respond" onClick={onAnswer}>
                    <Ic d={P.reply} sw={1.7} />Answer
                </button>
                <ExpandButton id={id} open={expanded} onClick={onToggleExpand} label={totalComments} />
            </CardFoot>
        </article>
    )
}

/* ==========================================================================
   ARTIFACT — a statement someone is putting their name to.
   The statement is not a summary of the post, it IS the post, so it takes the
   serif at display size and nothing on the card competes with it.
   ========================================================================== */

export function ArtifactExpanded({
    id, body, sources = [], comments = [], me, signedIn, onChallenge, onComment,
}) {
    // A string is one paragraph; an array is several. Accepting both means a
    // short artifact does not have to be wrapped in a list to be written.
    const paras = Array.isArray(body) ? body : body ? [body] : []
    return (
        <div className="xp" id={`xp-${id}`}>
            {/* THE BODY IS WHAT "SEE MORE" PROMISED, so it comes first and
                nothing precedes it. The title in the header said what this is;
                everything under here is the actual claim, in the serif that
                marks the record throughout this feed. */}
            {paras.length > 0 && (
                <div className="art__b">
                    {paras.map((t, i) => <p key={i}>{t}</p>)}
                </div>
            )}

            {sources.length > 0 && (
                <div className="src">
                    <h3 className="xp__h">Sources <em>What this claim rests on</em></h3>
                    <div className="src__l">
                        {sources.map((s, i) => (
                            <a className="src__i" href={s.href ?? '#'} key={s.title}
                               target={s.href ? '_blank' : undefined} rel="noreferrer">
                                <span className="src__n">{i + 1}</span>
                                <span className="src__t">{s.title}</span>
                                <span className="src__d"><Ic d={P.link} w={12} /></span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* The one thing a statement can do here that it cannot do on any
                other feed: become a judged argument. */}
            <div className="chal">
                <span className="chal__t">
                    <span className="chal__h">Disagree with this?</span>
                    <p className="chal__p">
                        Turn it into a debate. They get a round to defend it, you get a round
                        to take it apart, and the record stays public either way.
                    </p>
                </span>
                <button
                    type="button" className="btn btn--gold" onClick={onChallenge}
                    style={{ height: 34, padding: '0 15px', fontSize: 13 }}
                >
                    Challenge this
                </button>
            </div>

            <div className="th">
                {comments.map((c) => (
                    <div className="th__i" key={c.name + c.when}>
                        <div className="th__h">
                            <Avatar name={c.name} src={c.avatarUrl} size={24} />
                            <span className="th__n">{c.name}</span>
                            <span className="th__when">{c.when}</span>
                        </div>
                        <p className="th__b">{c.body}</p>
                        <div className="th__f">
                            <Actions likes={c.likes} reposts={c.reposts} replies={c.replies} />
                        </div>
                    </div>
                ))}
            </div>

            <Composer
                id={`ar-${id}`} me={me} signedIn={signedIn}
                placeholder="Say something you would be willing to have quoted back to you."
                cta="Comment" note="Comments are public and tied to your account."
                onSubmit={onComment}
            />
        </div>
    )
}

export function ArtifactCard({
    id, to = '#', author, title, meta = [], totalComments, imageUrl,
    expanded, onToggleExpand, onFollow, ...rest
}) {
    return (
        <article className="card" {...(expanded ? { 'data-open': '' } : {})}>
            <div className="card__pad">
                <CardHead author={author} onFollow={onFollow} />
                {/* THE TITLE CARRIES THE CARD. An artifact used to lead with its
                    whole statement, clamped — which meant the feed was three
                    posts and one wall of prose, and the clamp cut mid-sentence
                    wherever the line happened to fall. A title is a claim a
                    reader can accept or reject in one pass, and "See more" is
                    where they go to check the reasoning.

                    Same .q treatment as every other kind, so four post types
                    keep one skyline. */}
                <button type="button" className="q q--btn" aria-expanded={expanded} onClick={onToggleExpand}>
                    {title}
                </button>
                <MetaRow kind="artifact" items={meta} className="meta meta--last" />
            </div>

            {imageUrl && <img className="post__img" src={imageUrl} alt="" />}

            {expanded && <ArtifactExpanded id={id} {...rest} />}

            <CardFoot to={to}>
                <ExpandButton id={id} open={expanded} onClick={onToggleExpand} label={totalComments} />
            </CardFoot>
        </article>
    )
}

/* ==========================================================================
   WOULD BE — the campaign
   ========================================================================== */

function Ring({ pct }) {
    const r = 24, c = 2 * Math.PI * r
    return (
        <span className="ring">
            <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r={r} fill="none" stroke="var(--rule)" strokeWidth="5" />
                <circle
                    cx="28" cy="28" r={r} fill="none" stroke="var(--gold-400)" strokeWidth="5"
                    strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`}
                />
            </svg>
            <span className="ring__t">{pct}%</span>
        </span>
    )
}

// Capped for the RING and the BAR only — the figure beside them still tells the
// truth, so an over-funded campaign reads as over-funded rather than as a
// broken meter.
const funded = (raised, goal) => {
    const g = Number(goal || 0)
    return g > 0 ? Math.round((Number(raised || 0) / g) * 100) : 0
}

export function FundingPanel({ raised, goal, backers, days, avg, who, onPledge, onFollow }) {
    const pct = funded(raised, goal)
    // Five, and every one of them is a way a campaign link actually travels.
    // Copy link leads because it is the one that works everywhere.
    const SHARE = [
        ['Copy link', P.link],
        ['Share on X', 'M3 3h2.4l3 4 3.3-4h1.5l-4 4.9L13.2 13h-2.4l-3.1-4.2L4.3 13H2.8l4.3-5.2L3 3Z'],
        ['Share on WhatsApp', 'M13.4 8a5.4 5.4 0 0 1-8 4.7L2.6 13.4l.8-2.7A5.4 5.4 0 1 1 13.4 8Zm-7.7-2c-.3 0-.6.3-.6.8 0 1.6 1.9 3.5 3.5 3.5.5 0 .8-.3.8-.6l-.1-.6-1-.4-.5.5c-.6-.3-1.1-.8-1.4-1.4l.5-.5-.4-1-.8-.3Z'],
        ['Share on Instagram', 'M4.6 2.6h6.8a2 2 0 0 1 2 2v6.8a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2Zm3.4 3a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm3.3-.7h.01'],
        ['Share by email', 'M2.6 4.2h10.8v7.6H2.6V4.2Zm0 .4L8 8.6l5.4-4'],
    ]
    return (
        <aside className="wb__side">
            <div className="fund__top">
                <Ring pct={pct} />
                <span className="fund__n">
                    <span className="fund__r">{money(raised)}</span>
                    <span className="fund__g">raised of {money(goal)} goal</span>
                </span>
            </div>

            <div className="tiles">
                <div className="tile"><b>{nf.format(backers)}</b><span>backers</span></div>
                <div className="tile"><b>{days}</b><span>days left</span></div>
                <div className="tile"><b>{money(avg)}</b><span>avg pledge</span></div>
            </div>

            <div className="fund__btns">
                <button type="button" className="btn btn--gold btn--full" onClick={onPledge}>Pledge</button>
                <button type="button" className="btn btn--ghost btn--full" onClick={onFollow}>Follow</button>
            </div>

            <div className="socials">
                <span className="socials__l">Share</span>
                <span className="socials__r">
                    {SHARE.map(([label, d]) => (
                        <button type="button" key={label} aria-label={label}><Ic d={d} w={15} /></button>
                    ))}
                </span>
            </div>

            <div className="aon">
                <span className="aon__l"><Ic d={P.lock} w={11} sw={1.4} />All-or-nothing</span>
                <p>
                    {/* Named, not "the goal": these are the terms of a promise a
                        specific person is making, and the name is what turns a
                        policy sentence into one. */}
                    Nothing is collected unless {who ?? 'this candidate'} reaches {money(goal)} by
                    the deadline. If the goal is missed, every pledge is released and no card is
                    charged.
                </p>
            </div>
        </aside>
    )
}

export function WouldbeExpanded({
    id, eyebrow, pitch, author, positions = [], record = [], reviews = {}, funding,
    onPledge, onFollow,
}) {
    const [tab, setTab] = useState('positions')
    const tabs = [
        ['positions', 'Positions', positions.length],
        ['record', 'Debate record', record.length],
        ['reviews', 'Reviews', null],
    ]

    return (
        <div className="xp" id={`xp-${id}`}>
            {/* The plate does NOT repeat the title — the card head and the
                headline already say it twice. It carries the pitch, which
                nothing else does. */}
            <div className="wb__hero">
                <span className="wb__eyebrow">{eyebrow}</span>
                <h3>{pitch}</h3>
                <div className="wb__hw">
                    <Avatar name={author.name} src={author.avatarUrl} size={34} />
                    <span className="wb__hn">
                        <b>{author.name}</b><span>{author.office}</span>
                    </span>
                </div>
            </div>

            <div className="wb__cols">
                <div className="wb__main">
                    <div className="tabs" role="tablist">
                        {tabs.map(([k, label, n]) => (
                            <button
                                type="button" key={k} className="tab" role="tab"
                                aria-selected={tab === k} onClick={() => setTab(k)}
                            >
                                {label}{n != null && <span style={{ opacity: 0.6 }}> {n}</span>}
                            </button>
                        ))}
                    </div>

                    {tab === 'positions' && (
                        <div className="pos">
                            {positions.map((pn) => (
                                <div className="pos__i" key={pn.title}>
                                    {/* The node and the rail between nodes are what
                                        make this a RECORD rather than a list: a
                                        position has a date it was taken, and the
                                        thread down the left is the only thing that
                                        says these were added over time rather than
                                        drafted in one sitting. */}
                                    <span className="pos__node"><Ic d={P.check} w={11} sw={2} /></span>
                                    <span className="pos__t">
                                        <span className="pos__n">{pn.title}</span>
                                        <span className="pos__d">{pn.added}</span>
                                    </span>
                                    <p className="pos__b">{pn.body}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'record' && (
                        <div className="rec">
                            {record.map((d) => (
                                <Link className="rect" to={d.to ?? '#'} key={d.question}>
                                    <span className="rect__b">{d.badge}</span>
                                    <p className="rect__q">{d.question}</p>
                                    <span className="rect__p">Total prize <b>{money(d.prizeCents)}</b></span>
                                    <span className="rect__m">{d.meta}</span>
                                </Link>
                            ))}
                        </div>
                    )}

                    {tab === 'reviews' && (
                        <div className="rev">
                            <div className="rev__box">
                                <div className="rev__score">
                                    <span className="rev__avg">{reviews.count ? reviews.avg : '—'}</span>
                                    <span className="rev__stars">
                                        {[0, 1, 2, 3, 4].map((i) => <Ic key={i} d={P.star} w={12} sw={1.3} />)}
                                    </span>
                                    <span className="rev__n">{nf.format(reviews.count ?? 0)} reviews</span>
                                </div>
                                <div className="rev__bars">
                                    {[5, 4, 3, 2, 1].map((n) => {
                                        const c = reviews.buckets?.[n] ?? 0
                                        const w = reviews.count ? Math.round((c / reviews.count) * 100) : 0
                                        return (
                                            <div className="rev__row" key={n}>
                                                <span className="rev__k">{n}</span>
                                                <span className="rev__bar"><i style={{ width: `${w}%` }} /></span>
                                                <span className="rev__c">{c}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                                <div className="rev__cta">
                                    <button type="button" className="btn btn--gold"
                                            style={{ height: 36, padding: '0 16px', fontSize: 13 }}>
                                        Sign in to review
                                    </button>
                                    <p>Reviews are public and tied to your account.</p>
                                </div>
                            </div>
                            {!reviews.count && (
                                <div className="rev__none">
                                    <b>No reviews yet</b>
                                    <span>{reviews.emptyNote}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <FundingPanel
                    {...funding}
                    who={author.name?.split(' ')[0]}
                    onPledge={onPledge} onFollow={onFollow}
                />
            </div>
        </div>
    )
}

export function WouldbeCard({
    id, to = '#', author, title, meta = [], urgent, funding,
    totalComments, expanded, onToggleExpand, onFollow, onPledge, ...rest
}) {
    const { raised, goal, backers, days, avg } = funding
    const pct = funded(raised, goal)

    return (
        <article className="card" {...(expanded ? { 'data-open': '' } : {})}>
            <div className="card__pad">
                <CardHead author={author} onFollow={onFollow} value={{ n: `${pct}%`, label: 'funded' }} />
                <button type="button" className="q q--btn" aria-expanded={expanded} onClick={onToggleExpand}>
                    {title}
                </button>
                <MetaRow kind="wouldbe" items={meta} urgent={urgent} />
            </div>

            <div className="wbpv">
                <div className="wbpv__n">
                    <span className="wbpv__raised">{money(raised)}</span>
                    <span className="wbpv__goal">raised of {money(goal)} goal</span>
                </div>
                <div className="bar2"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                <div className="wbpv__f">
                    <span className="wbpv__s"><b>{nf.format(backers)}</b> backers</span>
                    <span className="wbpv__s"><b>{money(avg)}</b> average pledge</span>
                    <span className="wbpv__s"><b>{days}</b> days left</span>
                    <span className="wbpv__cta">
                        <button type="button" className="btn btn--gold" onClick={onPledge}
                                style={{ height: 34, padding: '0 18px', fontSize: 13 }}>
                            Pledge
                        </button>
                    </span>
                </div>
            </div>

            {expanded && (
                <WouldbeExpanded
                    id={id} author={author} funding={funding}
                    onPledge={onPledge} onFollow={onFollow} {...rest}
                />
            )}

            <CardFoot to={to}>
                <ExpandButton id={id} open={expanded} onClick={onToggleExpand} label={totalComments} />
            </CardFoot>
        </article>
    )
}

/* ==========================================================================
   dispatcher — the feed holds a mixed list, so it renders by kind
   ========================================================================== */
export const BY_KIND = {
    question: QuestionCard,
    artifact: ArtifactCard,
    wouldbe: WouldbeCard,
}
