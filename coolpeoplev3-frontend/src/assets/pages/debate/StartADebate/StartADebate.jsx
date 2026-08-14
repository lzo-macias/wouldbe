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
            if( data.length == 0) setScreen("2")
        } catch (err) {
            // A 401 (not signed in, or the refresh failed) lands here. The lists
            // stay empty, which renders as "no debates yet" rather than an error.
            console.error(err)
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
    <div className='debategradientV2'>
        <StartADebateHeader/>
        {screens[screen]}
    </div>
  )
}

export default StartADebate