import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from "../../../lib/api"
import UserOverView from './UserOverView'
import PledgeCardOverview from './PledgeCardOverview'
import "./AnyWouldBe.css"
import WouldBeHeader from '../../header/WouldBeHeader'
import PlanReviews from './PlanReviews'
import NeedProofOfFundraisingCommittee from './NeedProofOfFundraisingCommittee'
import './AnyWouldBe.css'

//if mine or anothers
//if committee filed or not (only if mine, shouldnt be visible if not)
//if goal has been set yet

// The thesis on the hero plate: the first sentence of the pitch, which is the
// one the candidate wrote to be read first. Falls back to the title when there
// is no description yet — a plate with nothing on it is worse than a repeat.
const firstSentence = (text) => {
    if (!text) return null
    const t = String(text).trim()
    const stop = t.search(/[.!?](\s|$)/)
    return stop === -1 ? t : t.slice(0, stop + 1)
}

const money = (cents) =>
    `$${Math.round(Number(cents || 0) / 100).toLocaleString('en-US')}`

function AnyWouldBe() {
  const { id: wouldbeId } = useParams()
  // TWO DIFFERENT PEOPLE, and conflating them is what put the viewer's face and
  // tags on someone else's campaign:
  //   user   — the campaign OWNER. This page is ABOUT them, so it is what the
  //            card, the tags and the Bio tab all render. PledgeCardOverview
  //            already says so in as many words ("`user` is the campaign OWNER")
  //            and reads the viewer out of localStorage itself.
  //   viewer — whoever is logged in, or null. Only needed to sign a review.
  const [user, setUser] = useState({})
  const [viewer, setViewer] = useState(null)
  const [plans, setPlans] = useState(null)
  const [ongoingDebates, setOngoingDebates] = useState([])
  const [wonDebates, setWonDebates] = useState([])
  // null, not [] — this holds a single object, and `wouldbe?.id` on an array is
  // silently undefined forever, which reads as "still loading" rather than a bug.
  const [wouldbe, setWouldbe] = useState(null)
  const [differentOwner, setDifferentOwner] = useState(null)
  const [checklist, setChecklist] = useState({})
  // GET /api/wouldbes/:id is a bare SELECT * with NO joins, so office_name,
  // jurisdiction_id and district_name are simply not on a wouldbe row. Fetched
  // once here and passed down, rather than in each child that needs a piece.
  const [office, setOffice] = useState(null)
  const [race, setRace] = useState(null)
  // Reviews are on the CAMPAIGN OWNER's profile (wouldbe.user_id), not the
  // viewer's — this page is about them, whether or not you're the one looking.
  const [reviews, setReviews] = useState(null)
  // unique_pledgers + active_pledged_cents, for the card's stat row.
  const [pledgeStats, setPledgeStats] = useState(null)


// {
//   wouldbe_id,
//   launch_status,     
//   fee_paid,         
//   committee_ok,      
//   race_open,       
//   has_plan,         
//   blockers: [],      
//   ready               
// }
//must set up reviews as endorsements

useEffect(() => {
  if (!wouldbeId) return
  let cancelled = false
  async function loadData(){
    try{
      const userId = localStorage.getItem("userId")
      // `{ data: me }`, not `{ datame }` — axios has no `datame` key, so the old
      // form set the viewer to undefined and every downstream guard failed.
      // Fetched in parallel: neither depends on the other.
      const [meRes, wouldbeRes] = await Promise.all([
        userId ? api.get(`/api/users/${userId}`) : Promise.resolve({ data: null }),
        api.get(`/api/wouldbes/${wouldbeId}`),
      ])
      if (cancelled) return
      console.log("[AnyWouldBe] loaded", {
        wouldbeId,
        wouldbe_user_id: wouldbeRes.data?.user_id,
        viewer_id: meRes.data?.id,
        launch_status: wouldbeRes.data?.launch_status,
      })
      // The OWNER isn't known until the wouldbe lands, so they're fetched in the
      // detail effect below; this one only resolves the viewer.
      setViewer(meRes.data)
      setWouldbe(wouldbeRes.data)
    }catch(err){
      console.error("[AnyWouldBe] load failed", err)
    }
  }
  loadData()
  return () => {cancelled = true}
}, [wouldbeId])

// Gated on the WOULDBE only — NOT on `user?.id`.
//
// Everything below is public data about the campaign's OWNER: the plan, their
// reviews, the office, the race, their debates, the pledge totals. None of it
// needs a viewer. The only owner-only call is the checklist, and that one is
// already skipped below when you aren't the owner.
//
// Gating the whole fan-out on the viewer meant a logged-out visitor got NOTHING:
// plans stayed null, so the Plan tab rendered blank, and reviews stayed null, so
// Bio crashed on `reviews.average_rating`. And you don't have to be logged out to
// hit it — clearAuth() removes `userId` whenever a token expires, so the page
// silently emptied itself the moment a session aged out.
useEffect(() => {
  if (!wouldbe?.id) return
  // Set BOTH ways. Only ever setting `true` left this null for the owner, and
  // `null === false` is false — so the owner-only block could never render.
  // No viewer (logged out, or an expired session) is definitively NOT the owner,
  // and `undefined !== id` already gives us that.
  // Straight from localStorage, NOT from the viewer fetch: it's available
  // synchronously, and it keeps `user` out of this effect's deps — the effect
  // now setUser()s the owner, and depending on what you set is an render loop.
  const viewerId = localStorage.getItem("userId")
  const isDifferentOwner = wouldbe.user_id !== viewerId
  setDifferentOwner(isDifferentOwner)

  let cancelled = false
  async function loadData(){
    try{
      const [planres, debateres, sponsoredres, checklistres, officeres, raceres, reviewsres, statsres, ownerres] = await Promise.all([
        api.get(`/api/wouldbes/${wouldbe.id}/plan`)
          // 404 = no plan yet, which is a normal state, not a failure. Re-throw
          // anything else or a 500 turns into a confusing `undefined.data`.
          .catch(e => {
            if (e.response?.status === 404) return { data: null }
            throw e
          }),
        // .catch on BOTH: these are one section of the card, but an unguarded
        // rejection here rejects the whole Promise.all, which would blank the
        // plan and the reviews over a debate query that failed.
        api.get(`/api/users/${wouldbe.user_id}/debate-history`)
          .catch(() => ({ data: [] })),
        api.get(`/api/users/${wouldbe.user_id}/sponsored-debates`)
          .catch(() => ({ data: [] })),
        // The checklist is keyed by WOULDBE id, not user id — and it's owner-only,
        // so don't even ask when viewing someone else's campaign (it would 403).
        isDifferentOwner
          ? Promise.resolve({ data: {} })
          : api.get(`/api/wouldbes/${wouldbe.id}/checklist`).catch(() => ({ data: {} })),
        // office -> office_name, jurisdiction_id, district_name
        // race   -> election_cycle (the committee form's cycle_year)
        wouldbe.office_id
          ? api.get(`/api/offices/${wouldbe.office_id}`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
        wouldbe.race_id
          ? api.get(`/api/races/${wouldbe.race_id}`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
        // Returns { average_rating, review_count, five_star…one_star, reviews[],
        // my_review }. average_rating is NULL (not 0) when nobody has reviewed —
        // 0 would render as a zero-star rating we haven't earned.
        api.get(`/api/users/${wouldbe.user_id}/reviews?limit=5`)
          .catch(() => ({ data: null })),
        api.get(`/api/wouldbes/${wouldbe.id}/pledge-stats`)
          .catch(() => ({ data: null })),
        // The campaign OWNER's public profile: first/last name, photo, bio, age,
        // state, college, link. None of that is on the wouldbe row — GET
        // /api/wouldbes/:id is a bare SELECT * with no joins — so it's a read of
        // its own, keyed to wouldbe.user_id rather than to whoever is logged in.
        api.get(`/api/users/${wouldbe.user_id}`)
          .catch(() => ({ data: null })),
      ])

      if (cancelled) return
      setPlans(planres.data)

      // No length guard: [].filter() is [], and gating on debate-history meant a
      // user with no contestant rows lost their sponsored debates too.
      // debate-history rows expose `debate_status` (`status` is the contestant's);
      // sponsored-debates rows expose `status`. Hence the two separate filters.
      setOngoingDebates([
        ...debateres.data.filter(r => r.outcome === "ongoing"),
        ...sponsoredres.data
          .filter(r => r.status === "open_entry" || r.status === "live")
          .map(d => ({ ...d, debate_id: d.id })),   // normalize the key field
      ])
      setWonDebates(debateres.data.filter(r => r.outcome === "won"))

      // The checklist is an OBJECT — `.length` is undefined, so the old guard
      // meant setChecklist never ran and the gate block never appeared.
      // `?? {}` not `?? null`: PledgeCardOverview and UserOverView both bail on a
      // falsy user, so a failed profile read would blank the whole card instead
      // of just leaving the name fields empty.
      setUser(ownerres.data ?? {})
      setOffice(officeres.data)
      setRace(raceres.data)
      setReviews(reviewsres.data)
      setPledgeStats(statsres.data)

      console.log("[AnyWouldBe] detail", {
        isDifferentOwner,
        committee_ok: checklistres.data?.committee_ok,
        launch_status: checklistres.data?.launch_status,
        blockers: checklistres.data?.blockers,
        showCommitteePanel: !isDifferentOwner && checklistres.data?.committee_ok === false,
        plan_components: planres.data?.components?.length ?? 0,
        office_name: officeres.data?.office_name,
        jurisdiction_id: officeres.data?.jurisdiction_id,
        election_cycle: raceres.data?.election_cycle,
        owner: ownerres.data?.username,
        review_count: reviewsres.data?.review_count,
        average_rating: reviewsres.data?.average_rating,
      })
      setChecklist(checklistres.data ?? {})
    }catch(err){
      console.error("[AnyWouldBe] detail load failed", err)
    }
  }
  loadData()
  return () => {cancelled = true}
  // `[wouldbe]` only. This effect calls setUser(), so keeping `user` in the deps
  // would re-run it on its own result, forever.
}, [wouldbe])


  // A new pledge moves two numbers on the card: the campaign's running total
  // (the bar and the percentage) and the backer count. They are handled
  // DIFFERENTLY on purpose.
  //
  // The money is applied optimistically — we know the exact amount, so the bar
  // moves the instant step 1 succeeds, while the user is still in the modal.
  //
  // The backer count is REFETCHED, not guessed. getWouldbePledgeStats returns
  // COUNT(DISTINCT pledger_user_id) and the payload carries nothing per-viewer,
  // so the client cannot tell a first-time backer from someone adding to an
  // existing pledge — incrementing blindly would inflate the count on every
  // repeat pledge. One cheap GET is authoritative; if it fails the money is
  // still correct and the count catches up on the next load.
  async function handlePledged(amountCents) {
    setWouldbe((prev) =>
      prev
        ? {
            ...prev,
            pledged_total_cents:
              Number(prev.pledged_total_cents ?? 0) + Number(amountCents),
          }
        : prev
    )
    try {
      const { data } = await api.get(`/api/wouldbes/${wouldbe.id}/pledge-stats`)
      setPledgeStats(data)
    } catch (err) {
      console.error('[AnyWouldBe] pledge-stats refresh failed', err)
    }
  }

  return (
  <div>
    <WouldBeHeader dontshow = {true}/>
      {/* Three owner-only states, not two:
            1. no committee                  -> ask for proof
            2. receipt on file, unconfirmed  -> reassure; nothing left to do
            3. verified_active               -> show nothing

          committee_ok alone can't tell 1 from 2, because 'provisional_on_receipt'
          already satisfies the launch gate. Without the middle state the red panel
          just vanishes on submit and the candidate gets no signal it landed. */}
      {differentOwner === false && checklist.committee_ok === false && (
          <div className='NeedProofOfFundraisingCommitteeParentDiv'>
            <NeedProofOfFundraisingCommittee wouldbe = {wouldbe} office = {office} race = {race}/>
          </div>
        )}
      {differentOwner === false && checklist.committee_status === "provisional_on_receipt" && (
          <div className='committeePendingPanel'>
            <h3>Committee received — awaiting review</h3>
            <p>
              We have your filing receipt. Nothing more is needed from you.{checklist.fee_paid === false ? ", the $5 creation fee needs to clear," : ""} and we will approve  yourr wouldbe within a day or two
            </p>
          </div>
        )}
   
    {/* THE CAMPAIGN LAYOUT: the pitch scrolls, the ask stays. A reader
        convinced on paragraph three should not have to scroll back up to act on
        it — that is the whole argument for a sticky funding rail. Everything
        inside is the component it always was: this is an arrangement, not a
        rewrite of what any of them do. */}
    <div className='wb-campaign'>
      <main className='wb-campaign__main'>
        {/* THE HERO. A campaign with no media does not get a grey box — the
            plate is built from what the page already has: the pitch set large,
            with the candidate under it. */}
        <div className='wb-hero'>
          <div className='wb-hero__plate'>
            <p className='wb-hero__thesis'>
              {firstSentence(wouldbe?.description) || wouldbe?.title}
            </p>
            <div className='wb-hero__by'>
              {user?.profile_photo_url ? (
                <img src={user.profile_photo_url} alt='' />
              ) : (
                <span className='wb-hero__byblank' aria-hidden='true'>
                  {(user?.first_name || user?.username || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span className='wb-hero__byline'>
                <span className='wb-hero__byname'>
                  {[user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
                    user?.username ||
                    'This candidate'}
                </span>
                {office?.office_name && (
                  <span className='wb-hero__bymeta'>
                    {office.office_name}
                    {office.district_identifier ? ` · ${office.district_identifier}` : ''}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className='wb-hero__head'>
            <h1 className='wb-hero__title'>{wouldbe?.title}</h1>
            <div className='wb-hero__facts'>
              {office?.office_name && <span className='wb-chip'>{office.office_name}</span>}
              {wouldbe?.goal_cents > 0 && (
                <span className='wb-chip wb-chip--gold'>
                  Goal {money(wouldbe.goal_cents)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* The case, the positions, the debate record and the reviews — all
            present and findable, navigated by anchors rather than hidden behind
            a tab. */}
        <PlanReviews
          plans = {plans ? [plans] : []}
          user = {user}
          viewer = {viewer}
          profileUserId = {wouldbe?.user_id}
          reviews = {reviews}
          wouldbe = {wouldbe}
          ongoingDebates = {ongoingDebates}
          wonDebates = {wonDebates}
        />
      </main>

      {/* THE ASK. Same component, same props — the owner check, the committee
          gate and the goal state all still live inside it. It has only moved
          into the rail so it stays on screen while the case is read. */}
      <aside className='wb-rail' aria-label='Support this campaign'>
        <PledgeCardOverview
          wouldbe = {wouldbe}
          office = {office}
          user = {user}
          differentOwner = {differentOwner}
          checklist = {checklist}
          stats = {pledgeStats}
          onPledged = {handlePledged}
        >
          {/* The debates are NOT passed any more — the "Debate record" section
              in the main column owns them now, as tiles. */}
          <UserOverView
            user = {user}
            plans = {plans}
            reviews = {reviews}
          />
        </PledgeCardOverview>
      </aside>
    </div>
  </div>

  )
}

export default AnyWouldBe