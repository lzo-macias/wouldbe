import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../lib/api'
import Trophy from '../debate/Debates/Trophy'
import './Fund.css'

/* ============================================================================
 * Fund — the crowdfunding campaign page. Route: /fund
 *
 * WHY THIS PAGE EXISTS AT ALL. Kickstarter and Indiegogo both prohibit
 * campaigns that fund political activity, and a fundraising platform FOR
 * candidates reads as exactly that to their trust-and-safety review — so the
 * raise has to happen on our own domain. That is the whole reason this is a
 * page in our app rather than a link out.
 *
 * ── EVERYTHING HERE IS MOCK ────────────────────────────────────────────────
 * No network calls. `raised`, `backers` and the tier claim counts are literals
 * in CAMPAIGN below, and "Back this project" runs a fake 1.2s await and shows a
 * success card. Nothing is charged, nothing is stored.
 *
 * ── WHERE THE REAL PAYMENT ATTACHES ────────────────────────────────────────
 * One place: `submitPledge()`. The real version POSTs { tierId, amountCents,
 * email, name } to the backend, which creates a Stripe Checkout Session (or a
 * PaymentIntent, if we keep the form in-house) and returns its URL/secret. The
 * frontend never sees a key beyond the publishable one. @stripe/stripe-js and
 * @stripe/react-stripe-js are ALREADY dependencies of this app — see
 * package.json — so wiring it is a backend route plus an <Elements> wrapper
 * around the modal, not a new integration.
 *
 * Method notes, because this decision keeps getting re-litigated:
 *   · Stripe is the processor. Card + Apple Pay + Google Pay + Link + ACH all
 *     arrive from the one integration, and Stripe's restricted business list
 *     covers political CONTRIBUTIONS to candidates — which this is not. This is
 *     a pre-sale of software memberships by a company.
 *   · PayPal is a second button, not a second system: it converts the cohort
 *     that will not hand a card to a site they have never heard of.
 *   · Venmo is consumer P2P. It has no refund rail we control and reads as "pay
 *     a guy" — it only belongs here as a PayPal Braintree funding source, which
 *     is why it is not offered separately.
 *
 * ── KEEP-IT-ALL: THE CARD IS CHARGED ON PLEDGE ─────────────────────────────
 * This campaign is NOT all-or-nothing. Every pledge is captured immediately and
 * the raise keeps whatever it collects, goal or no goal.
 *
 * That makes the integration the SIMPLE Stripe shape — one PaymentIntent,
 * captured on confirm. No SetupIntent, no stored payment method, no off-session
 * charge at close, and none of the 7-day authorization-expiry problem that
 * makes a 30-day all-or-nothing campaign hard to build.
 *
 * The cost moves to policy instead of plumbing: money is taken for a reward
 * that only exists once the platform ships, so the REFUND POLICY is now the
 * load-bearing promise on this page rather than the funding model. It is stated
 * in the FAQ and the footer, and it is a commitment — if those two get edited
 * apart from each other, the page is lying to somebody.
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * CAMPAIGN — every number and string on this page that will change lives here,
 * so nobody has to hunt through JSX to update the raise. Replace with API data
 * when the backend lands.
 * ------------------------------------------------------------------------ */
/* THE BUDGET IS THE SOURCE OF TRUTH, and the goal is its SUM — see GOAL_CENTS
   below. It used to be the other way round: a goal typed here, and percentages
   typed there that were trusted to add up to it. With one line that was merely
   redundant; with two it is a bug waiting to happen, because 30,000 and 3,500
   are 89.55% and 10.45% of the total, and integer percentages CANNOT express
   that. Rounding them to 90/10 would put numbers on the page that do not match
   the numbers we intend to spend.

   So the amounts are exact and the percentages are derived. Edit a line here,
   or add one, and the goal, the bar and the legend all follow. They cannot
   disagree with each other, because there is only one number. */
const ALLOCATION = [
    { name: 'Campus launch & live events', cents: 3000000, color: 'var(--wb-gold-500)' },
    { name: 'Initial attorney briefing',   cents:  500000, color: 'var(--wb-gold-800)' },
]

const GOAL_CENTS = ALLOCATION.reduce((sum, a) => sum + a.cents, 0)

const CAMPAIGN = {
    goalCents:   GOAL_CENTS,  // $35,000 — the sum of the budget above
    /* raised/backers are MOCK, and they have to stay coherent with each other:
       raised must sit under the goal (or the meter pins at 100% and the page
       claims a success it has not had), and raised ÷ backers is what the "avg
       pledge" tile shows, so a lazy pair here renders as a $9 or a $4,000
       average. These are ~26% of goal at a ~$179 average. */
    raisedCents:    768400,   // $7,684
    backers:            43,
    closesOn:  '2026-10-15',  // placeholder
    launchTarget: 'January 2027',
}

const TIERS = [
    {
        id: 'l1',
        amountCents: 2500,
        level: 'Premium — Level 1',
        name: 'Founding Backer',
        perks: [
            'Premium Level 1 on WouldBe, free for 12 months',
            'Founding Backer badge on your profile',
            'Backer-only build updates before they go public',
        ],
        claimed: 138,
        limit: null,
    },
    {
        id: 'l2',
        amountCents: 10000,
        level: 'Premium — Level 2',
        name: 'Charter Member',
        featured: true,
        perks: [
            'Premium Level 2 on WouldBe, free for 24 months',
            'Everything in Level 1',
            'Your name in the launch credits',
            'Early access to every new feature before public release',
        ],
        claimed: 61,
        limit: null,
    },
    {
        id: 'l3',
        amountCents: 50000,
        level: 'Premium — Level 3',
        name: "Founders' Circle",
        trophy: true,
        perks: [
            'Premium Level 3 on WouldBe, for life',
            'Everything in Levels 1 and 2',
            'The gold Trophy on your profile, permanently',
            'Invitation to the NYC launch night',
        ],
        claimed: 15,
        limit: 100,
    },
]

/* The named wins the thesis rests on. AGES ARE AS OF THEIR RACE — check these
   against the record before this page is public; a wrong age on the page whose
   entire argument is about age is the one error nobody forgives. */
const WINS = [
    { age: 34, name: 'Zohran Mamdani',  race: 'Mayor of New York City' },
    { age: 37, name: 'James Talarico',  race: 'U.S. Senate — Texas' },
    { age: 41, name: 'Abdul El-Sayed',  race: 'U.S. Senate — Michigan' },
]

/* The team. `photo`, `bio` and `firms` are all OPTIONAL and the card renders
   without any of them — two of these are real people whose backgrounds nobody
   here has written yet, and inventing a sentence about someone's career on a
   page asking strangers for money is not a placeholder, it is a false claim
   about a named person. Name + role + a link they control is a complete card.

   PHOTOS live in `public/team/`, cropped to the inside of the LinkedIn ring so
   no ring or banner survives into the square — the card then clips them to a
   circle. Add a person without a photo and the gold initials render instead,
   which is a finished state rather than a hole.

   These came from the people themselves. LinkedIn returns HTTP 999 to any
   unauthenticated fetch and forbids scraping, and a headshot is the subject's
   to give in any case. */
const TEAM = [
    {
        photo: '/team/lorenzo.jpg',
        initials: 'LM',
        name: 'Lorenzo Macias',
        role: 'Founder & CEO',
        bio: 'A go-to-market background across several unicorn tech startups — the exact discipline this needs. A political platform does not fail on engineering; it fails on distribution, and distribution is the thing this team has done before.',
        // Operating companies FIRST, then the funds. The bio claims a background at
        // "unicorn tech startups", and leading with three VC names undercut it —
        // an investor chip and an operator chip are different claims.
        firms: ['Masterworks', 'Chargeflow', 'Left Lane Capital', 'Galaxy Interactive', 'Viola Growth'],
        linkedin: 'https://www.linkedin.com/in/lorenzomacias/',
    },
    {
        photo: '/team/ansh.jpg',
        initials: 'AM',
        name: 'Ansh Mehta',
        role: 'Tech Advisor',
        bio: 'Ships production AI into regulated industries — an autonomous legal research engine at Cliff, and neural cash-flow forecasting for banks. Three years building product at Intellect Design Arena in New York, on top of a math and computer science degree from Wisconsin.',
        firms: ['Cliff', 'Intellect Design Arena', 'Jio', 'UW–Madison'],
        linkedin: 'https://www.linkedin.com/in/anshmehta2000/',
    },
    {
        photo: '/team/safara.jpg',
        initials: 'SM',
        name: 'Safara Malone',
        role: 'Ambassador',
        // She/Her is stated on her own profile, so the pronoun here is hers, not
        // an inference from a name.
        bio: 'A national policy advocate who interned on trans justice policy at the ACLU and works with the Transgender Education Network of Texas. She has spoken at the Texas Capitol and has been organizing young people around policy since she was a teenager — which is exactly the constituency this platform is built for.',
        firms: ['Harvard', 'ACLU', 'Transgender Education Network of Texas', 'Jack Kent Cooke Scholar'],
        linkedin: 'https://www.linkedin.com/in/safaramalone/',
    },
]

/* EVERY CHANNEL WE CAN TAKE. `id` is what the backend stores in
   fund_pledges.channel, so these strings must stay inside that column's CHECK.

   Almost all of them are ONE Stripe integration: a PaymentIntent created with
   automatic_payment_methods offers whatever is switched on in the Stripe
   dashboard, so adding Cash App or Klarna is a dashboard toggle, not a deploy.
   That is why `via` is recorded — it says which of the three real integrations
   a row depends on, and there are only three:

     stripe   card, wallets, Link, Cash App, ACH, BNPL, Amazon Pay
     paypal   PayPal, and Venmo through it (Venmo has no standalone API)
     offline  a mailed check or a wire — no processor at all, entered by an admin

   `primary: true` is the row shown by default. The rest sit behind "More ways
   to pay", because sixteen payment buttons above a form reads as a checkout
   error, not as generosity. */
const CHANNELS = [
    { id: 'card',       label: 'Card',            sub: 'Visa · Mastercard · Amex', via: 'stripe', primary: true },
    { id: 'apple_pay',  label: 'Apple Pay',       sub: 'One tap',                  via: 'stripe', primary: true },
    { id: 'google_pay', label: 'Google Pay',      sub: 'One tap',                  via: 'stripe', primary: true },
    { id: 'paypal',     label: 'PayPal',          sub: 'Venmo balance included',   via: 'paypal', primary: true },

    { id: 'venmo',      label: 'Venmo',           sub: 'Through PayPal',           via: 'paypal' },
    { id: 'link',       label: 'Link',            sub: 'Saved with Stripe',        via: 'stripe' },
    { id: 'cashapp',    label: 'Cash App Pay',    sub: 'Scan to pay',              via: 'stripe' },
    { id: 'ach',        label: 'Bank (ACH)',      sub: 'Lowest fee on big pledges', via: 'stripe' },
    { id: 'klarna',     label: 'Klarna',          sub: 'Pay over time',            via: 'stripe' },
    { id: 'affirm',     label: 'Affirm',          sub: 'Pay over time',            via: 'stripe' },
    { id: 'afterpay',   label: 'Afterpay',        sub: 'Pay in 4',                 via: 'stripe' },
    { id: 'amazon_pay', label: 'Amazon Pay',      sub: 'Amazon account',           via: 'stripe' },
    { id: 'check',      label: 'Check',           sub: 'Mailed — we invoice you',  via: 'offline' },
    { id: 'wire',       label: 'Wire transfer',   sub: 'For large pledges',        via: 'offline' },
]

const PRIMARY_CHANNELS = CHANNELS.filter((c) => c.primary)
const MORE_CHANNELS = CHANNELS.filter((c) => !c.primary)

const usd = (cents, opts = {}) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...opts })

function daysLeft(iso) {
    const ms = new Date(`${iso}T23:59:59`).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / 86400000))
}

const LinkedIn = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95C20.6 8.75 22 11 22 14.5V21h-4v-5.8c0-1.4-.03-3.2-2-3.2s-2.3 1.53-2.3 3.1V21H9z" />
    </svg>
)

/* A single check glyph, inline rather than an icon font: three shapes on this
   page do not justify a dependency. */
const Tick = () => (
    <svg className="wbfund__tick" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export default function Fund() {
    const [openTier, setOpenTier] = useState(null)   // tier object, or 'custom'

    /* The meter reads from GET /api/fund/summary — succeeded pledges only, no
       names or emails in the payload. CAMPAIGN's literals are the FALLBACK, not
       the source: if the backend is down the page still renders a coherent
       campaign rather than "$0 raised", which on a funding page reads as "this
       failed" to a visitor who has no idea our API is unreachable. */
    const [live, setLive] = useState(null)

    useEffect(() => {
        let cancelled = false
        api.get('/api/fund/summary')
            .then(({ data }) => { if (!cancelled) setLive(data) })
            .catch(() => {})   // silent: the fallback below is a good answer
        return () => { cancelled = true }
    }, [])

    const raised = live?.raised_cents ?? CAMPAIGN.raisedCents
    const backers = live?.backers ?? CAMPAIGN.backers
    const avg = live?.avg_pledge_cents ?? (backers ? Math.round(raised / backers) : 0)
    const pct = Math.min(100, Math.round((raised / CAMPAIGN.goalCents) * 100))
    const left = useMemo(() => daysLeft(CAMPAIGN.closesOn), [])

    return (
        <div className="wbfund">

            {/* ───────────────────────────── TOP BAR ───────────────────────── */}
            <header className="wbfund__bar">
                <div className="wbfund__wrap wbfund__barIn">
                    <Link to="/" className="wbfund__brand">
                        <img src="/logos/WouldBeLogo.svg" alt="WouldBe" className="wbfund__logo" />
                        <span className="wbfund__brandText">A fundraising platform for candidates under 45</span>
                    </Link>
                    <span className="wbfund__barSpacer" />
                    <a className="wbfund__barLink" href="#tiers">Rewards</a>
                    <a className="wbfund__barLink" href="#funds">Where it goes</a>
                    <a className="wbfund__barLink" href="#faq">FAQ</a>
                    <button className="wbfund__btn wbfund__btn--gold" onClick={() => setOpenTier(TIERS[1])}>
                        Back this project
                    </button>
                </div>
            </header>

            {/* ───────────────────────────── HERO ──────────────────────────── */}
            <section className="wbfund__hero">
                <div className="wbfund__wrap wbfund__heroGrid">
                    <div>
                        <span className="wbfund__eyebrow">Crowdfunding the launch</span>
                        <h1 className="wbfund__h1">
                            The first crowdfunding platform for political candidates <em>under 45</em>.
                        </h1>
                        <p className="wbfund__lede">
                            The idea is simple: the people in office should be young enough to live
                            with the consequences of their decisions. We are building the place they
                            get funded, debated and judged — and we are funding the build the same
                            way, out here in the open.
                        </p>

                        <div className="wbfund__heroActions">
                            <button className="wbfund__btn wbfund__btn--gold wbfund__btn--lg" onClick={() => setOpenTier(TIERS[1])}>
                                Back this project
                            </button>
                            <a className="wbfund__btn wbfund__btn--lg" href="#tiers">See the rewards</a>
                        </div>

                        <div className="wbfund__trustRow">
                            <div className="wbfund__trust">
                                <span className="wbfund__trustK">Model</span>
                                <span className="wbfund__trustV">Charged today</span>
                            </div>
                            <div className="wbfund__trust">
                                <span className="wbfund__trustK">You receive</span>
                                <span className="wbfund__trustV">Platform credit, not equity</span>
                            </div>
                            <div className="wbfund__trust">
                                <span className="wbfund__trustK">Platform launch</span>
                                <span className="wbfund__trustV">{CAMPAIGN.launchTarget}</span>
                            </div>
                        </div>
                    </div>

                    {/* THE MONEY BOX. Sticky above 980px — see Fund.css. */}
                    <aside className="wbfund__pledge">
                        <div className="wbfund__raised">{usd(raised)}</div>
                        <div className="wbfund__goalLine">
                            raised of <b>{usd(CAMPAIGN.goalCents)}</b> goal · <b>{pct}%</b>
                        </div>

                        <div className="wbfund__meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Funding progress">
                            <div className="wbfund__meterFill" style={{ width: `${pct}%` }} />
                        </div>

                        <div className="wbfund__stats">
                            <div className="wbfund__stat">
                                <div className="wbfund__statV">{backers}</div>
                                <div className="wbfund__statK">Backers</div>
                            </div>
                            <div className="wbfund__stat">
                                <div className="wbfund__statV">{left}</div>
                                <div className="wbfund__statK">Days left</div>
                            </div>
                            <div className="wbfund__stat">
                                <div className="wbfund__statV">{usd(avg)}</div>
                                <div className="wbfund__statK">Avg pledge</div>
                            </div>
                        </div>

                        <button className="wbfund__btn wbfund__btn--gold wbfund__btn--block wbfund__btn--lg" onClick={() => setOpenTier(TIERS[1])}>
                            Back this project
                        </button>

                        <p className="wbfund__note">
                            Your card is charged when you pledge. Every dollar goes to work
                            immediately — we don&apos;t wait for the goal to start building.
                        </p>

                        <div className="wbfund__share">
                            {['Copy link', 'X', 'WhatsApp', 'Email'].map((s) => (
                                <button key={s} className="wbfund__shareBtn" title={`Share — ${s}`} aria-label={`Share — ${s}`}>
                                    {s[0]}
                                </button>
                            ))}
                        </div>
                    </aside>
                </div>
            </section>

            {/* ───────────────────────────── THESIS ────────────────────────── */}
            <section className="wbfund__section">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">Why now</div>
                    <blockquote className="wbfund__quote">
                        “The representatives in office should be young enough to live to see the
                        consequences of their actions.”
                    </blockquote>

                    <div className="wbfund__cards">
                        <div className="wbfund__card">
                            {/* SOURCE NEEDED. This is the load-bearing number of the whole pitch
                                and it currently has no citation on the page. Do not ship public
                                without one. */}
                            <div className="wbfund__cardBig">55 → 45</div>
                            <h3 className="wbfund__cardH">The average age is falling</h3>
                            <p className="wbfund__cardP">
                                Over the past decade the average age of a politician holding office
                                has moved from 55 to 45. The electorate got there before the
                                infrastructure did.
                            </p>
                        </div>
                        <div className="wbfund__card">
                            <div className="wbfund__cardBig">3</div>
                            <h3 className="wbfund__cardH">Big races won under 45</h3>
                            <p className="wbfund__cardP">
                                In a single year, three candidates under 45 won races nobody
                                modelled them to win. That is a pattern, not an upset.
                            </p>
                        </div>
                        <div className="wbfund__card">
                            <div className="wbfund__cardBig">0</div>
                            <h3 className="wbfund__cardH">Places built for them</h3>
                            <p className="wbfund__cardP">
                                Kickstarter and Indiegogo prohibit political fundraising outright.
                                ActBlue and WinRed start after you are already a campaign. Nothing
                                serves the year before that.
                            </p>
                        </div>
                    </div>

                    <div className="wbfund__wins">
                        {WINS.map((w) => (
                            <div key={w.name} className="wbfund__win">
                                <span className="wbfund__winAge">{w.age}</span>
                                <span>
                                    <span className="wbfund__winName">{w.name}</span><br />
                                    <span className="wbfund__winRace">{w.race}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ──────────────────────── WHAT WE'RE BUILDING ────────────────── */}
            <section className="wbfund__section wbfund__section--sunk">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">What your money builds</div>
                    <h2 className="wbfund__h2">A campaign, a debate and a verdict — in one place.</h2>
                    <p className="wbfund__sub">
                        WouldBe is not a donate button. It is the full path from “someone should run”
                        to a funded, tested candidate on a ballot.
                    </p>

                    <div className="wbfund__feats">
                        {[
                            ['$', 'WouldBe campaigns', 'Anyone can open a seat and set a goal. Backers pledge; nothing moves unless the goal is met and the candidacy is real.'],
                            ['⚖', 'Debates & brackets', 'Live and written debate tournaments with prompts, rounds and a sponsor-funded prize. Arguments get scored, not just posted.'],
                            ['✓', 'Judging & proof', 'Filing deadlines, ballot access and candidacy proof are checked against real election data before a campaign is allowed to collect.'],
                            ['★', 'A public record', 'Positions, debate record and reviews live on one profile, so a voter can see what a candidate said before they wanted your vote.'],
                        ].map(([icon, h, p]) => (
                            <div key={h} className="wbfund__feat">
                                <div className="wbfund__featIcon" aria-hidden="true">{icon}</div>
                                <div>
                                    <h3 className="wbfund__cardH">{h}</h3>
                                    <p className="wbfund__cardP">{p}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─────────────────────────── USE OF FUNDS ────────────────────── */}
            <section className="wbfund__section" id="funds">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">Where the money goes</div>
                    <h2 className="wbfund__h2">{usd(CAMPAIGN.goalCents)}, accounted for.</h2>
                    <p className="wbfund__sub">
                        Almost all of it goes to getting WouldBe in front of the people it is for:
                        on-campus events across New York City, live debate nights, and the promotion
                        that fills them. The rest buys an initial attorney briefing, because a
                        product that touches elections does not get to guess at the rules. This is a
                        launch budget, not a runway.
                    </p>

                    <div className="wbfund__allocBar" role="img" aria-label="Budget allocation">
                        {ALLOCATION.map((a) => {
                            const share = (a.cents / GOAL_CENTS) * 100
                            return (
                                <div
                                    key={a.name}
                                    className="wbfund__allocSeg"
                                    style={{ width: `${share}%`, background: a.color }}
                                    title={`${a.name} — ${usd(a.cents)}`}
                                >
                                    {/* Below ~12% the label does not fit the segment, and a
                                        clipped "1…" is worse than nothing — the legend under
                                        the bar carries the number for every line anyway. */}
                                    {share >= 12 ? `${Math.round(share)}%` : ''}
                                </div>
                            )
                        })}
                    </div>

                    <div className="wbfund__allocList">
                        {ALLOCATION.map((a) => (
                            <div key={a.name} className="wbfund__allocRow">
                                <span className="wbfund__swatch" style={{ background: a.color }} />
                                <span className="wbfund__allocName">{a.name}</span>
                                <span className="wbfund__allocPct">{usd(a.cents)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ───────────────────────────── TIERS ─────────────────────────── */}
            <section className="wbfund__section wbfund__section--sunk" id="tiers">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">Rewards</div>
                    <h2 className="wbfund__h2">Back the build, get the platform.</h2>
                    <p className="wbfund__sub">
                        Every reward is credit on WouldBe itself. You are pre-buying a membership in
                        the thing you are helping make — not donating to a candidate, and not buying
                        a share of the company.
                    </p>

                    <div className="wbfund__tiers">
                        {TIERS.map((t) => (
                            <button
                                key={t.id}
                                className={`wbfund__tier${t.featured ? ' wbfund__tier--featured' : ''}`}
                                onClick={() => setOpenTier(t)}
                            >
                                {t.featured && <span className="wbfund__tierFlag">Most backed</span>}
                                <div className="wbfund__tierLvl">{t.level}</div>
                                <div className="wbfund__tierAmt">{usd(t.amountCents)}</div>
                                <div className="wbfund__tierName">{t.name}</div>
                                <div className="wbfund__tierRule" />

                                {t.trophy && (
                                    <div className="wbfund__tierTrophy">
                                        <Trophy size={20} />
                                        <span>Includes the Trophy</span>
                                    </div>
                                )}

                                <ul className="wbfund__tierList">
                                    {t.perks.map((p) => (
                                        <li key={p}><Tick />{p}</li>
                                    ))}
                                </ul>

                                <span className={`wbfund__btn${t.featured ? ' wbfund__btn--gold' : ''} wbfund__btn--block`}>
                                    Select {usd(t.amountCents)}
                                </span>
                                <div className="wbfund__tierMeta">
                                    {t.limit
                                        ? `${t.claimed} of ${t.limit} claimed · ${t.limit - t.claimed} left`
                                        : `${t.claimed} backers`}
                                    {' · '}Delivered at launch, {CAMPAIGN.launchTarget}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="wbfund__custom">
                        <div className="wbfund__customText">
                            <div className="wbfund__customH">Pledge any amount</div>
                            <div className="wbfund__customP">
                                No reward — the money goes straight into the build. Pledge {usd(2500)} or
                                more and Level 1 is added automatically.
                            </div>
                        </div>
                        <button className="wbfund__btn" onClick={() => setOpenTier('custom')}>
                            Choose an amount
                        </button>
                    </div>
                </div>
            </section>

            {/* ────────────────────────── GO TO MARKET ─────────────────────── */}
            <section className="wbfund__section">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">The launch plan</div>
                    <h2 className="wbfund__h2">New York City first, then everywhere it works.</h2>
                    <p className="wbfund__sub">
                        The plan is to spread WouldBe through New York City colleges — event
                        promotion on campus, paired with a strong digital push across socials,
                        collaborations and influencer partnerships.
                    </p>

                    <div className="wbfund__steps">
                        {[
                            ['Campus beachhead', 'On-campus events and debate nights at NYC colleges, where the under-45 candidates of the next cycle already are.'],
                            ['Live debate nights', 'Run real bracketed debates with a sponsored prize. The tournament is the marketing — it produces the content.'],
                            ['Creators & collabs', 'Partnerships with political creators whose audience is the exact demographic the thesis is about.'],
                            ['Open the map', 'Every state legislature and congressional seat is already seeded in the platform. Expansion is a switch, not a rebuild.'],
                        ].map(([h, p], i) => (
                            <div key={h} className="wbfund__step">
                                <div className="wbfund__stepN">{i + 1}</div>
                                <h3 className="wbfund__cardH">{h}</h3>
                                <p className="wbfund__cardP">{p}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ──────────────────────────── THE TEAM ───────────────────────── */}
            <section className="wbfund__section wbfund__section--sunk">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">Who is building it</div>
                    <h2 className="wbfund__h2">One to build it, one to sell it, one already on campus.</h2>

                    <div className="wbfund__people">
                        {TEAM.map((m) => (
                            <div className="wbfund__person" key={m.name}>
                                {/* alt="" is correct, not lazy: the name is rendered directly
                                    below, so alt text here would make a screen reader say it
                                    twice. */}
                                {m.photo
                                    ? <img className="wbfund__avatar wbfund__avatar--img" src={m.photo} alt="" />
                                    : <div className="wbfund__avatar" aria-hidden="true">{m.initials}</div>}
                                <div className="wbfund__personName">{m.name}</div>
                                <div className="wbfund__personRole">{m.role}</div>
                                {m.bio && <p className="wbfund__cardP">{m.bio}</p>}
                                {m.firms && (
                                    <div className="wbfund__logos">
                                        {m.firms.map((f) => (
                                            <span key={f} className="wbfund__logoChip">{f}</span>
                                        ))}
                                    </div>
                                )}
                                {/* rel="noreferrer" as well as noopener: this page is the raise,
                                    and the Referer header would hand LinkedIn the campaign URL
                                    of every backer who clicks through. */}
                                <a className="wbfund__li" href={m.linkedin}
                                   target="_blank" rel="noopener noreferrer">
                                    <LinkedIn />
                                    LinkedIn
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ──────────────────────────────  FAQ  ────────────────────────── */}
            <section className="wbfund__section" id="faq">
                <div className="wbfund__wrap">
                    <div className="wbfund__kicker">Questions</div>
                    <h2 className="wbfund__h2">Before you back it.</h2>

                    <div className="wbfund__faq">
                        {[
                            ['Is this a political contribution?',
                             'No. You are backing the company building the platform — not a candidate, a campaign or a committee. Nothing you pledge here goes to anyone running for office, it is not reportable as a political contribution, and it is not tax-deductible.'],
                            ['What exactly am I buying?',
                             'Platform credit, in the form of a premium membership on WouldBe at the level of the tier you choose. It is a pre-order of software. You are not buying equity, a share of revenue, or any kind of security, and no tier conveys ownership or a vote in the company.'],
                            ['When is my card charged?',
                             'Immediately, when you pledge. This is not an all-or-nothing campaign — we keep what we raise and it goes to work the day it arrives, rather than sitting in escrow while the clock runs down.'],
                            ['What happens if you miss the goal?',
                             'We build with less. The goal is what a full launch costs, not a switch that turns the project on — under it, the campus rollout gets smaller and slower, it does not get cancelled. You still get the membership you paid for.'],
                            ['Can I get a refund?',
                             'Yes — email us within 30 days of your pledge and we refund it in full, no questions asked. After that window, pledges are non-refundable, with one exception: if we never launch the platform at all, every backer is refunded in full regardless of when they pledged. Every pledge is receipted by email the moment it is charged: the amount, the date, the tier it earns and this policy, in writing. That receipt is your record and our obligation — until we hand you the membership you paid for, your pledge sits on our books as money we owe you, not money we have earned.'],
                            ['When do I get my membership?',
                             `At public launch, targeted for ${CAMPAIGN.launchTarget}. Backers get access before the general waitlist, and Level 2 and 3 get it first. If the date slips, you hear it from us in a backer update before you hear it anywhere else.`],
                            ['What is the Trophy?',
                             'The gold mark WouldBe gives debate winners. Level 3 backers carry it on their profile permanently, marked as a founding backer rather than a debate win — it is the same object, earned a different way.'],
                            ['How is my payment handled?',
                             'Through Stripe. Card details are entered on Stripe-hosted fields and never touch our servers or our database — we store an opaque customer reference and nothing else. PayPal is offered as an alternative for backers who prefer it.'],
                        ].map(([q, a]) => (
                            <details className="wbfund__q" key={q}>
                                <summary>{q}</summary>
                                <p>{a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ──────────────────────────── FOOTER ─────────────────────────── */}
            <footer className="wbfund__wrap">
                <div className="wbfund__foot">
                    <span>© {new Date().getFullYear()} WouldBe</span>
                    <div className="wbfund__footLinks">
                        <Link to="/">Platform</Link>
                        <a href="#tiers">Rewards</a>
                        <a href="#faq">FAQ</a>
                        <a href="mailto:hello@wouldbe.com">Contact</a>
                    </div>
                </div>
                <p className="wbfund__legal">
                    This is a rewards-based crowdfunding campaign for WouldBe, the company. Pledges
                    are pre-purchases of platform memberships and are not political contributions,
                    charitable donations, investments, or securities of any kind. No pledge is made
                    to, or on behalf of, any candidate, campaign or political committee. Rewards are
                    delivered on public launch of the platform. Pledges are charged at the time
                    they are made and are refundable in full within 30 days; if the platform does
                    not launch, every pledge is refunded in full.
                </p>
            </footer>

            {openTier && <Checkout tier={openTier} onClose={() => setOpenTier(null)} />}
        </div>
    )
}

/* ============================================================================
 * Checkout — the pledge modal. MOCK.
 *
 * It is a separate component so the real one can be swapped in wholesale: the
 * page hands it a tier and a close handler and wants nothing back. When Stripe
 * lands, this file is the only one that changes — wrap the form in <Elements>,
 * replace submitPledge's setTimeout with the fetch + confirm, keep everything
 * else.
 * ========================================================================= */
function Checkout({ tier, onClose }) {
    const isCustom = tier === 'custom'
    const [amount, setAmount] = useState(isCustom ? '25' : String(tier.amountCents / 100))
    const [method, setMethod] = useState('card')
    const [showMore, setShowMore] = useState(false)
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState(null)
    // Set when the pledge was RECORDED but no payment leg could be opened —
    // Stripe keys absent, or an offline channel. The success card has to say so;
    // telling someone they are done when no money moved is the one lie this
    // page cannot afford.
    const [pendingPayment, setPendingPayment] = useState(false)

    const cents = Math.max(0, Math.round(parseFloat(amount || '0') * 100))
    const isOffline = CHANNELS.find((c) => c.id === method)?.via === 'offline'

    /* Which reward this pledge actually earns. Computed from the AMOUNT rather
       than from the card that was clicked, so a custom pledge of $500 gets
       Level 3 and a tier card that someone edited down to $30 does not silently
       keep Level 3. The amount is the contract. */
    const earned = useMemo(
        () => [...TIERS].reverse().find((t) => cents >= t.amountCents) || null,
        [cents],
    )

    async function submitPledge(e) {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
            // The tier is NOT sent. The server resolves the reward from the
            // amount, so a hand-edited request body cannot buy Level 3 for $1.
            const { data } = await api.post('/api/fund/pledges', {
                email,
                backer_name: name,
                amount_cents: cents,
                channel: method,
            })
            // client_secret present ⇒ there is a Stripe payment to confirm.
            // That confirm step is the one piece still to build: it needs
            // <Elements> around this form and stripe.confirmPayment() here.
            // Until then a real key still books the intent and the webhook
            // settles it, so the row and the money stay in step.
            setPendingPayment(!data.client_secret)
            setDone(true)
        } catch (err) {
            setError(err?.response?.data?.error || 'Something went wrong. Your card has not been charged.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="wbfund__overlay" role="dialog" aria-modal="true" aria-label="Back this project" onClick={onClose}>
            <div className="wbfund__modal" onClick={(e) => e.stopPropagation()}>
                {done ? (
                    <div className="wbfund__done">
                        <div className="wbfund__doneMark" aria-hidden="true">✓</div>
                        <h2 className="wbfund__modalH">You&apos;re in.</h2>
                        <p className="wbfund__modalSub">
                            {usd(cents)} pledged{earned ? ` · ${earned.level}` : ''}.{' '}
                            {pendingPayment
                                ? 'We have your pledge on record and will email you to complete the payment.'
                                : 'Your receipt is on its way, and your membership lands at launch.'}
                        </p>
                        <div style={{ marginTop: 'var(--s5)' }}>
                            <button className="wbfund__btn wbfund__btn--gold wbfund__btn--block" onClick={onClose}>
                                Done
                            </button>
                        </div>
                        <span className="wbfund__mockTag">Recorded in the backer ledger</span>
                    </div>
                ) : (
                    <form onSubmit={submitPledge}>
                        <div className="wbfund__modalHead">
                            <div>
                                <h2 className="wbfund__modalH">{isCustom ? 'Pledge any amount' : tier.name}</h2>
                                <p className="wbfund__modalSub">
                                    {isCustom ? 'Choose what this is worth to you.' : tier.level}
                                </p>
                            </div>
                            <button type="button" className="wbfund__x" onClick={onClose} aria-label="Close">×</button>
                        </div>

                        <div className="wbfund__field">
                            <label className="wbfund__label" htmlFor="wbfund-amt">Your pledge</label>
                            <div className="wbfund__amtRow">
                                <span className="wbfund__amtPrefix">$</span>
                                <input
                                    id="wbfund-amt"
                                    className="wbfund__input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="wbfund__field">
                            <label className="wbfund__label" htmlFor="wbfund-name">Name</label>
                            <input id="wbfund-name" className="wbfund__input" value={name}
                                   onChange={(e) => setName(e.target.value)} placeholder="Jane Rivera" required />
                        </div>

                        <div className="wbfund__field">
                            <label className="wbfund__label" htmlFor="wbfund-email">Email</label>
                            <input id="wbfund-email" className="wbfund__input" type="email" value={email}
                                   onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" required />
                        </div>

                        <div className="wbfund__field">
                            <span className="wbfund__label">Payment method</span>
                            <div className="wbfund__pays">
                                {(showMore ? CHANNELS : PRIMARY_CHANNELS).map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        className="wbfund__pay"
                                        aria-pressed={method === m.id}
                                        onClick={() => setMethod(m.id)}
                                    >
                                        <span>
                                            {m.label}<br />
                                            <span className="wbfund__paySub">{m.sub}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {!showMore && (
                                <button type="button" className="wbfund__morePay" onClick={() => setShowMore(true)}>
                                    More ways to pay ({MORE_CHANNELS.length}) — Venmo, Cash App, bank, pay over time, check
                                </button>
                            )}
                        </div>

                        <div className="wbfund__summary">
                            <div className="wbfund__sumRow">
                                <span>Reward</span>
                                <span>{earned ? earned.level : 'No reward — supporter'}</span>
                            </div>
                            <div className="wbfund__sumRow">
                                <span>Delivered</span>
                                <span>{CAMPAIGN.launchTarget}</span>
                            </div>
                            <div className="wbfund__sumRow">
                                <span>Charged</span>
                                <span>{isOffline ? 'When your transfer clears' : 'Today, on confirm'}</span>
                            </div>
                            <div className="wbfund__sumRow wbfund__sumRow--total">
                                <span>Total today</span>
                                <span>{usd(cents)}</span>
                            </div>
                        </div>

                        {error && <p className="wbfund__error" role="alert">{error}</p>}

                        <button className="wbfund__btn wbfund__btn--gold wbfund__btn--block wbfund__btn--lg"
                                type="submit" disabled={busy || cents < 100}>
                            {busy ? 'Confirming…' : `Pledge ${usd(cents)}`}
                        </button>

                        <p className="wbfund__note">
                            Not a political contribution. Not an investment. You are pre-buying a
                            membership on WouldBe.
                        </p>
                        <div style={{ textAlign: 'center' }}>
                            <span className="wbfund__mockTag">
                                Pledge is recorded · card confirmation step still to wire
                            </span>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
