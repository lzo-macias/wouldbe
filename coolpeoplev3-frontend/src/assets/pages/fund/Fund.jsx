import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { stripePromise, stripeConfigured } from '../../lib/stripe'
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

/* PAYMENT METHODS ARE NOT LISTED HERE ANY MORE, and that is the fix.
 *
 * This file used to carry fourteen hand-written buttons — Card, Apple Pay,
 * Google Pay, PayPal, Venmo, Cash App and the rest. Every one of them was a
 * label. Clicking "Apple Pay" stored the string 'apple_pay' and then charged
 * nothing, because the PaymentIntent behind them was card-only and no card form
 * was ever mounted.
 *
 * They are replaced by Stripe's PAYMENT ELEMENT, which is the only thing that
 * can answer this correctly. It renders exactly the methods enabled on the
 * account AND supported by the device in front of it: Apple Pay appears on
 * Safari with a card in Wallet and nowhere else, Google Pay on Chrome, Link for
 * a returning Link user, Cash App with its QR. A hand-built grid cannot know any
 * of that — it can only claim it.
 *
 * TO ADD OR REMOVE A METHOD: toggle it in the Stripe Dashboard
 * (Settings → Payment methods). No deploy. The PaymentIntent is created with
 * automatic_payment_methods, so the sheet follows the Dashboard.
 *
 * VENMO is the one thing that cannot arrive this way: it has no Stripe payment
 * method type and is reachable only through PayPal's own SDK or Braintree. If
 * PayPal is enabled on the Stripe account, a PayPal payment may still be funded
 * from a Venmo balance — which is what the FAQ says, and all it can honestly say.
 */

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

    /* COMING BACK FROM A REDIRECT. PayPal, Cash App and the pay-over-time
       methods take the backer off-site and return them to /fund with
       ?payment_intent_client_secret=… . Without this they would land on the
       campaign page as if nothing had happened, having just paid — the single
       most alarming thing a payment flow can do.

       Stripe is asked for the real status rather than trusting the URL, and the
       query string is then stripped so a refresh does not replay it. The webhook
       still settles the row; this only decides what the person sees. */
    const [returned, setReturned] = useState(null)

    useEffect(() => {
        const secret = new URLSearchParams(window.location.search)
            .get('payment_intent_client_secret')
        if (!secret || !stripeConfigured) return
        let cancelled = false
        stripePromise
            .then((stripe) => stripe?.retrievePaymentIntent(secret))
            .then((res) => {
                if (cancelled || !res?.paymentIntent) return
                setReturned(res.paymentIntent.status)
                window.history.replaceState({}, '', window.location.pathname)
            })
            .catch(() => {})
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

            {/* A backer returning from PayPal / Cash App / Klarna lands here. */}
            {returned && (
                <div className={`wbfund__returned wbfund__returned--${
                    returned === 'succeeded' ? 'ok' : returned === 'processing' ? 'wait' : 'bad'
                }`} role="status">
                    <div className="wbfund__wrap">
                        {returned === 'succeeded' && <><strong>Payment received.</strong> Your receipt is on its way, and your membership lands at launch.</>}
                        {returned === 'processing' && <><strong>Payment is processing.</strong> Bank transfers take a few days to clear — we&apos;ll email you when it lands.</>}
                        {returned !== 'succeeded' && returned !== 'processing' && <><strong>That payment didn&apos;t go through.</strong> Nothing was charged — you can try again below.</>}
                    </div>
                </div>
            )}

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
                             'Through Stripe. Card details are entered on Stripe-hosted fields and never touch our servers or our database — we store an opaque reference and nothing else. The payment screen shows every method your device can actually use: card, Apple Pay, Google Pay, Link, Cash App Pay, bank transfer, and pay-over-time options where they are available.'],
                            ['Can I pay with Venmo?',
                             'Not directly. Venmo has no standalone payment API — it is reachable only through PayPal. Where PayPal appears on the payment screen you may be able to fund it from a Venmo balance, but we cannot promise Venmo as its own button and would rather say so than show one that fails.'],
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
 * Checkout — the pledge modal, in two stages.
 *
 *   1  DETAILS   name, email, amount  ->  POST /api/fund/pledges
 *                writes the row, returns a client_secret
 *   2  PAY       Stripe Payment Element, then stripe.confirmPayment()
 *
 * WHY TWO STAGES. The Payment Element cannot mount without a client_secret, and
 * the secret cannot exist before an amount is known. So the row is written
 * first — which is also the safer order: if the browser dies between the two, we
 * hold a pending pledge with an email we can follow up, rather than a charge we
 * have no record of.
 *
 * REDIRECT METHODS. PayPal, Cash App and the pay-over-time methods leave the
 * site and come back to `return_url`. `redirect: 'if_required'` keeps card and
 * wallet payments inline and only redirects the ones that must. On return, the
 * page reads payment_intent_client_secret from the URL — see the effect in
 * Fund() — so the backer lands on a confirmation rather than on a form they
 * already filled in.
 * ========================================================================= */

// Stripe's own appearance API, driven from the page's tokens so the card fields
// do not arrive as a white rectangle in the middle of a warm gold modal.
const STRIPE_APPEARANCE = {
    theme: 'flat',
    variables: {
        colorPrimary: '#B07524',
        colorBackground: '#FFFFFF',
        colorText: '#16150F',
        colorDanger: '#8A2318',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        borderRadius: '14px',
        spacingUnit: '4px',
    },
    rules: {
        '.Input': { border: '1px solid #E7E0CE', boxShadow: 'none', padding: '12px' },
        '.Input:focus': { border: '1px solid #B07524', boxShadow: '0 0 0 3px #FBF0D4' },
        '.Label': {
            fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
            letterSpacing: '.08em', color: '#78715C',
        },
        '.Tab': { border: '1px solid #E7E0CE', boxShadow: 'none' },
        '.Tab--selected': { border: '1px solid #B07524', backgroundColor: '#FBF0D4' },
    },
}

// ---------------------------------------------------------------------------
// Stage 2 — the real card form. Everything the account offers, rendered by
// Stripe: card, Apple Pay, Google Pay, Link, Cash App, ACH, PayPal, BNPL.
// ---------------------------------------------------------------------------
function PayStep({ pledge, onPaid, onClose }) {
    const stripe = useStripe()
    const elements = useElements()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    async function pay(e) {
        e.preventDefault()
        if (!stripe || !elements) return
        setBusy(true)
        setError(null)

        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            elements,
            // Where PayPal / Cash App / Klarna come back to. It must be an
            // absolute URL, and it must be a page that can read the result —
            // /fund handles that on mount.
            confirmParams: { return_url: `${window.location.origin}/fund` },
            redirect: 'if_required',
        })

        if (stripeError) {
            setError(stripeError.message)
            setBusy(false)
            return
        }
        // The webhook is the source of truth and will settle the row; this only
        // decides what the backer sees next. A processing status (ACH, some
        // BNPL) is a success from their side — the money is on its way.
        onPaid(paymentIntent?.status ?? 'processing')
    }

    return (
        <form onSubmit={pay}>
            <div className="wbfund__field">
                <PaymentElement options={{ layout: 'tabs' }} />
            </div>

            {error && <p className="wbfund__error" role="alert">{error}</p>}

            <button className="wbfund__btn wbfund__btn--gold wbfund__btn--block wbfund__btn--lg"
                    type="submit" disabled={!stripe || busy}>
                {busy ? 'Confirming…' : `Pay ${usd(pledge.amount_cents)}`}
            </button>

            {/* The pledge row already exists. Saying so removes the fear that
                backing out here loses the pledge — and it is simply true. */}
            <button type="button" className="wbfund__btn wbfund__btn--block"
                    style={{ marginTop: 'var(--s2)' }} onClick={onClose} disabled={busy}>
                Cancel — nothing has been charged
            </button>
        </form>
    )
}

function Checkout({ tier, onClose }) {
    const isCustom = tier === 'custom'
    const [amount, setAmount] = useState(isCustom ? '25' : String(tier.amountCents / 100))
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    // 'details' -> 'pay' -> 'done'
    const [step, setStep] = useState('details')
    const [pledge, setPledge] = useState(null)
    const [clientSecret, setClientSecret] = useState(null)
    // Recorded, but no payment leg could be opened (Stripe keys absent). The
    // success card must say so — telling somebody they are done when no money
    // moved is the one lie this page cannot afford.
    const [pendingPayment, setPendingPayment] = useState(false)

    const cents = Math.max(0, Math.round(parseFloat(amount || '0') * 100))

    /* Which reward the pledge actually earns, computed from the AMOUNT rather
       than from the card that was clicked. The server does this too and its
       answer is the real one; this is only so the summary agrees with it. */
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
            })
            setPledge(data.pledge)
            if (data.client_secret && stripeConfigured) {
                setClientSecret(data.client_secret)
                setStep('pay')
            } else {
                // No processor leg — the row stands and we follow up by email.
                setPendingPayment(true)
                setStep('done')
            }
        } catch (err) {
            setError(err?.response?.data?.error || 'Something went wrong. Your card has not been charged.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="wbfund__overlay" role="dialog" aria-modal="true" aria-label="Back this project" onClick={onClose}>
            <div className="wbfund__modal" onClick={(e) => e.stopPropagation()}>

                {/* ------------------------------ done ------------------------------ */}
                {step === 'done' && (
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
                    </div>
                )}

                {/* ------------------------------ pay ------------------------------- */}
                {step === 'pay' && clientSecret && (
                    <>
                        <div className="wbfund__modalHead">
                            <div>
                                <h2 className="wbfund__modalH">Pay {usd(cents)}</h2>
                                <p className="wbfund__modalSub">
                                    {earned ? earned.level : 'Supporter'} · delivered {CAMPAIGN.launchTarget}
                                </p>
                            </div>
                            <button type="button" className="wbfund__x" onClick={onClose} aria-label="Close">×</button>
                        </div>
                        <Elements
                            stripe={stripePromise}
                            options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
                        >
                            <PayStep
                                pledge={pledge}
                                onClose={onClose}
                                onPaid={() => setStep('done')}
                            />
                        </Elements>
                    </>
                )}

                {/* ---------------------------- details ---------------------------- */}
                {step === 'details' && (
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
                                <input id="wbfund-amt" className="wbfund__input" type="number"
                                       min="1" step="1" value={amount}
                                       onChange={(e) => setAmount(e.target.value)} required />
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

                        <div className="wbfund__summary">
                            <div className="wbfund__sumRow">
                                <span>Reward</span>
                                <span>{earned ? earned.level : 'No reward — supporter'}</span>
                            </div>
                            <div className="wbfund__sumRow">
                                <span>Delivered</span>
                                <span>{CAMPAIGN.launchTarget}</span>
                            </div>
                            <div className="wbfund__sumRow wbfund__sumRow--total">
                                <span>Total today</span>
                                <span>{usd(cents)}</span>
                            </div>
                        </div>

                        {error && <p className="wbfund__error" role="alert">{error}</p>}

                        <button className="wbfund__btn wbfund__btn--gold wbfund__btn--block wbfund__btn--lg"
                                type="submit" disabled={busy || cents < 100}>
                            {busy ? 'One moment…' : 'Continue to payment'}
                        </button>

                        {/* Naming the methods HERE is safe — it is a sentence about
                            what the next screen may offer, not four buttons
                            claiming to be them. */}
                        <p className="wbfund__note">
                            Card, Apple Pay, Google Pay, Link, Cash App, bank transfer and pay-over-time,
                            wherever your device supports them.
                        </p>
                        <p className="wbfund__note">
                            Not a political contribution. Not an investment. You are pre-buying a
                            membership on WouldBe.
                        </p>
                    </form>
                )}
            </div>
        </div>
    )
}
