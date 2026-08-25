import React, { useEffect, useState, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from "../../../lib/api"
import MyWouldBeShare from '../../Socialshare/MyWouldBeShare'
import UserOverView from './UserOverView'
import PledgeCardOverview from './PledgeCardOverview'
import "./AnyWouldBe.css"
import WouldBeHeader from '../../header/WouldBeHeader'
import PlanReviews from './PlanReviews'
import NeedProofOfFundraisingCommittee from './NeedProofOfFundraisingCommittee'

//if mine or anothers
//if committee filed or not (only if mine, shouldnt be visible if not)
//if goal has been set yet

function AnyWouldBe() {
  const { id: wouldbeId } = useParams()
  const [user, setUser] = useState({})
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
      setUser(meRes.data ?? {})
      setWouldbe(wouldbeRes.data)
    }catch(err){
      console.error("[AnyWouldBe] load failed", err)
    }
  }
  loadData()
  return () => {cancelled = true}
}, [wouldbeId])

useEffect(() => {
  if (!wouldbe?.id || !user?.id) return
  // Set BOTH ways. Only ever setting `true` left this null for the owner, and
  // `null === false` is false — so the owner-only block could never render.
  const isDifferentOwner = wouldbe.user_id !== user.id
  setDifferentOwner(isDifferentOwner)

  let cancelled = false
  async function loadData(){
    try{
      const [planres, debateres, sponsoredres, checklistres, officeres, raceres, reviewsres, statsres] = await Promise.all([
        api.get(`/api/wouldbes/${wouldbe.id}/plan`)
          // 404 = no plan yet, which is a normal state, not a failure. Re-throw
          // anything else or a 500 turns into a confusing `undefined.data`.
          .catch(e => {
            if (e.response?.status === 404) return { data: null }
            throw e
          }),
        api.get(`/api/users/${wouldbe.user_id}/debate-history`),
        api.get(`/api/users/${wouldbe.user_id}/sponsored-debates`),
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
}, [wouldbe, user])


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
    <WouldBeHeader/>
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
   
    <div className='anyWouldbeOverallContainer'>
      {/* One card. The old .sidebyside grid held UserOverView beside the pledge
          card; the card now carries the header, stats, share, all-or-nothing and
          debates itself, so there is no second column left to place. */}
      <PledgeCardOverview
        wouldbe = {wouldbe}
        office = {office}
        user = {user}
        differentOwner = {differentOwner}
        checklist = {checklist}
        stats = {pledgeStats}
        onPledged = {handlePledged}
      >
        <UserOverView
          user = {user}
          plans = {plans}
          ongoingDebates = {ongoingDebates}
          wonDebates = {wonDebates}
          checklist = {checklist}
          reviews = {reviews}
          profileUserId = {wouldbe?.user_id}
        />
      </PledgeCardOverview>
    </div>
    <PlanReviews plans = {plans ? [plans] : []} user = {user} differentOwner = {differentOwner} reviews = {reviews} wouldbe = {status}/>
  </div>

  )
}

export default AnyWouldBe