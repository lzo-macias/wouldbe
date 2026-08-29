import React, {useState, useEffect} from 'react'
import api from "../../../lib/api"
import CasualOrCorporate from "../../../component/StartADebate/CasualOrCorporate"
import ApplyForDebateCasual from "../../../component/StartADebate/ApplyForDebateCasual"
import "./StartADebate.css"
import StartADebateHeader from '../../../component/header/StartADebateHeader/StartADebateHeader'
import PreExistingDebates from '../../../component/Prexistingdebate/PreExistingDebates'


function StartADebate() {
    const [screen, setScreen] = useState("1")
    // Arrays, not objects — these hold the filtered lists, and the first render
    // happens before the fetch resolves. An object here means .map() blows up
    // in PreExistingDebates before any data arrives.
    const [drafts, setDrafts] = useState([])
    const [approved, setApproved] = useState([])
    const [rejected, setRejecteds] = useState([])

useEffect(() => {
    async function loadData() {
        try {
            const { data } = await api.get("/api/debate-applications/mine")
            setDrafts(data.filter((d) => d.status === "draft"))
            setApproved(data.filter((d) => d.status === "open_entry"))
            setRejecteds(data.filter((d) => d.status === "cancelled"))
            if (data.length === 0) setScreen("2")
        } catch (err) {
            // A 401 (not signed in, or the refresh failed) lands here. THE CHOICE
            // SCREEN IS STILL THE RIGHT ANSWER: somebody who has hosted nothing —
            // whether because they have no debates or because we could not read
            // their list — came here to start one, and an empty "your debates"
            // shelf is a dead end that answers a question they did not ask.
            console.error(err)
            setScreen("2")
        }
    }
    loadData()
}, [])

    const screens = {
        "1": (
            <>
                <PreExistingDebates approved = {approved} drafts = {drafts} rejected = {rejected} travelToCasualOrCorporate = {() => setScreen('2')}/>
            </>
        ),
        "2" : (
            <>
                <CasualOrCorporate onComplete = {()=> setScreen("3")} onCompleteV2 = {() => setScreen("3")}/>
            </>
        ),
        "3": (
            <>
                <ApplyForDebateCasual/>
            </>
        )
    }

  return ( 
    /* data-surface="dark" is what flips the gold system: --wb-gold-ink resolves
       to #E8C56A here instead of #7A5211, and every primitive inside picks it up
       without knowing it is on a dark page. */
    <div className='debategradientV2' data-surface="dark">
        <StartADebateHeader/>
        {screens[screen]}
    </div>
  )
}

export default StartADebate