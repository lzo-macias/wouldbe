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

  const screens = {
    "1": (
      <>
      <StartAWouldBe 
        office = {individualOffice} 
        jurisdiction = {individualJurisdiction} 
        onComplete = {(() => {setScreen("2")})}/>
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
          onComplete = {(() => {setScreen("3")})}
        />
      </>
    ),
    "3": (
      <>
        <PayWall/>
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