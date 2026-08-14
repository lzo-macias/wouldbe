import React, {useEffect, useState} from 'react'
import { useParams } from 'react-router-dom'
import api from '../../lib/api'
import Regulations from '../../component/Wouldbe/Regulations/Regulations'
import StartAWouldBe from '../../component/Wouldbe/StartAWouldBe/StartAWouldBe'
import Header from '../../component/header/Header'
import HomeHeader from '../../component/header/HomeHeader'
import WouldBeHeader from '../../component/header/WouldBeHeader'
import WouldBeNavHeader from '../../component/header/WouldBeNavHeader'
import ChooseYourIssues from '../../component/Wouldbe/ChooseYourIssues/ChooseYourIssues'
import PayWall from '../../component/Wouldbe/PayWall/PayWall'

function StartAnOffice() {
  const [screen, setScreen] = useState("1")
  const [individualJurisdiction, setIndividualJurisdiction] = useState(null)
  const [individualOffice, setindividualOffice] = useState(null)
  const [deadlines, setDeadlines] = useState([])
  const [goalCents, setGoalCents] = useState(null)
  const [regulations, setRegulations] = useState([])
  // The draft campaign, created between screen 2 and 3. It cannot be created
  // earlier: POST /api/wouldbes is gated on the age_18 + us_citizen attestations,
  // and those are recorded by ChooseYourIssues. So the order is fixed —
  // goal (screen 1) → attestations (screen 2) → create → pay (screen 3).
  const [wouldbe, setWouldbe] = useState(null)
  const [createError, setCreateError] = useState(null)

  const  { jurisdiction_id, officeId } = useParams()

  // Load the office (with its jurisdiction, deadlines, and recommended goal)
  // once per :officeId. Each call uses the PREVIOUS response's data directly —
  // never freshly-set state, which wouldn't be updated yet within this pass.
  useEffect(() => {
    async function loadDataV2(){
      try{
        const officeResult = await api.get(`/api/offices/${officeId}`)
        const office = officeResult.data
        if (!office) return

        const jurisdictionResult = await api.get(`/api/jurisdictions/${office.jurisdiction_id}`)
        const jurisdiction = jurisdictionResult.data

        const deadlineResult = await api.get(`/api/jurisdictions/${office.jurisdiction_id}/deadlines`)
        const loadedDeadlines = [...(deadlineResult.data ?? [])].sort(
          (a, b) => new Date(a.deadline_date) - new Date(b.deadline_date)
        )

        const goalResult = await api.get(`/api/offices/${office.id}/recommended-goal`)
        const goal = goalResult.data?.recommended_goal_cents ?? null

        const eligibilityResult = await api.get(`/api/offices/${office.id}/eligibility`)
        const eligibility = eligibilityResult.data ?? null   // local — NOT the stale `regulations` state

        setRegulations(eligibility)
        setIndividualJurisdiction(jurisdiction)
        setDeadlines(loadedDeadlines)
        setGoalCents(goal)
        setindividualOffice({ ...office, deadlines: loadedDeadlines, goalCents: goal, regulations: eligibility })
      }catch(err){
        console.error(err)
      }
    }
    loadDataV2()
  }, [officeId])

  // The campaign's title. Set by us, never by the sponsor: every WouldBe for an
  // office should read identically, so they can be compared at a glance.
  // Guarded against "IL IL State Representative…" — some seeded office names
  // already carry their state code.
  const campaignTitle = () => {
    const state = individualJurisdiction?.state_code ?? ""
    const name = individualOffice?.office_name ?? ""
    const dedup = state && name.startsWith(`${state} `) ? name.slice(state.length + 1) : name
    return `a great ${state} ${dedup} representative`.replace(/\s+/g, " ").trim()
  }

  // wouldbe.deadline is the date the campaign runs against. The filing close is
  // the real one — the day it becomes too late to get on the ballot — with the
  // general election as the fallback for jurisdictions that only recorded that.
  const campaignDeadline = () => {
    const of = (type) =>
      deadlines.find((d) => (d.type ?? d.deadline_type) === type)
    const pick = of("filing_close") ?? of("petition_filing_deadline") ?? of("general_date")
    const raw = pick?.date ?? pick?.deadline_date
    return raw ? String(raw).slice(0, 10) : null
  }

  // Create the draft, then move to the paywall. race_id is deliberately NOT
  // sent: the server resolves (or derives) the race from the office's seeded
  // election dates, so a citizen can be the first to run for an office nobody
  // has built a race for yet.
  const createDraftAndPay = async (planComponents = []) => {
    setCreateError(null)
    try {
      const title = campaignTitle()
      const { data } = await api.post("/api/wouldbes", {
        title,
        // Pre-seeded to match the title. Editable later from the campaign
        // page — just not during this flow.
        description: title,
        office_id: individualOffice.id,
        goal_cents: goalCents ?? 500000,
        deadline: campaignDeadline(),
      })
      setWouldbe(data)

      // The plan hangs off the campaign, and each component hangs off the plan,
      // so all three have to happen in order and only after the campaign exists.
      // ChooseYourIssues collects the positions but can't save them for exactly
      // that reason — it runs before the campaign is created.
      if (planComponents.length) {
        try {
          const { data: plan } = await api.post(`/api/wouldbes/${data.id}/plan`)
          // Sequential, not Promise.all: these all write to the same plan, and a
          // burst of parallel inserts makes a partial failure much harder to
          // reason about than a stop at the first bad one.
          for (const c of planComponents) {
            await api.post(`/api/plans/${plan.id}/components`, c)
          }
        } catch (planErr) {
          // The campaign IS created at this point. Losing the plan is worth a
          // warning, not throwing the user back to a form whose submission
          // already succeeded — they can add positions later from the campaign.
          console.error(planErr)
          setCreateError("Your campaign was created, but we couldn't save your plan. You can add it later.")
        }
      }

      setScreen("3")
    } catch (err) {
      console.error(err)
      setCreateError(err.response?.data?.error || "Could not create your campaign.")
    }
  }

  const screens = {
    "1": (
      <>
      <StartAWouldBe 
        office = {individualOffice} 
        jurisdiction = {individualJurisdiction} 
        onComplete = {((goal) => { if (goal != null) setGoalCents(goal); setScreen("2") })}/>
      </>
    ),
    "2": (
  
  //choose your issues, set political line, plan of action + skip button 
  //pay wall
  //need to file with link
      <>
        <ChooseYourIssues 
          office = {individualOffice} 
          jurisdiction = {individualJurisdiction}
          onComplete = {createDraftAndPay}
        />
        {createError && <p className="formError">{createError}</p>}
      </>
    ),
    "3": (
      <>
        {wouldbe
          ? <PayWall wouldbeId={wouldbe.id} onPaid={() => setScreen("4")} />
          : <p className="formError">{createError || "No campaign to pay for."}</p>}
      </>
    ),
    "4": (
      <>
        <p>Paid — your campaign is created. It stays a draft until you launch it.</p>
      </>
    )
  }

  return (
    <div>

      {/* <WouldBeNavHeader/> */}
      <WouldBeHeader/>
      {individualOffice ? screens[screen] : <p>Loading…</p>}
    </div>
  )
}

export default StartAnOffice