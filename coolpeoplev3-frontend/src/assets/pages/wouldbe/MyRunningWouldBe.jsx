import React, {useState, useEffect} from 'react'
import MyRunningWouldbes from '../../component/Wouldbe/MyRunningWouldbes/MyRunningWouldbes'
import WouldBeNavHeader from "../../component/header/WouldBeNavHeader"
import api from '../../lib/api'
import { useNavigate } from 'react-router-dom'

function MyRunningWouldBe() {
  const [myWouldBeDrafts, setMyWouldBeDrafts] = useState([])
  const [myWouldBeLive, setMyWouldbeLives] = useState([])
  const [registeredCommittees, setRegisteredCommittees] = useState(new Map())

  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      try {
        const { data } = await api.get("/api/wouldbes/mine")
        if (cancelled) return
        if (data.length > 0) {
          setMyWouldBeDrafts(data.filter(r => r.launch_status !== "active"))
          setMyWouldbeLives(data.filter(r => r.launch_status == "active"))
        }
      }catch(err){
        console.error(err)
      }
    }
    loadData()
    return () => {cancelled = true}
  }, [])

  //new map with wouldbe.id and the message to show
  useEffect(() => {
    let cancelled = false
    async function loadData(){
      try{
        for (let i = 0; i < myWouldBeDrafts.length; i++){
          const wouldbeId = myWouldBeDrafts[i].id
          const { data } = await api.get(`/api/wouldbes/${wouldbeId}/checklist`)
          if (cancelled) return
          if (!data.committee_ok) {
            setRegisteredCommittees(prev =>
              new Map(prev).set(wouldbeId, "still need proof of filed committee to approve")
            )
          }
        }
      }catch(err){
        console.error(err)
      }
    }
    loadData()
    return () => {cancelled = true}
  }, [myWouldBeDrafts])

async function changeScreen (wouldbe, live){
  navigate(`/wouldbe/${wouldbe.id}`)
  // await setIndividualWouldbe(wouldbe)
  // await setLive(live)
  // await setScreen("2")
}
  // Screen "2" is gone: changeScreen navigates to /wouldbe/:id, and AnyWouldBe now
  // reads that id from useParams instead of props. Rendering it inline passed
  // `wouldbe`/`live` props it no longer accepts, and on /myWouldBe there is no
  // :id in the URL for it to fall back to.
  return (
    <div>
        <WouldBeNavHeader/>
        <MyRunningWouldbes
          myWouldBeDrafts = {myWouldBeDrafts}
          myWouldBeLive = {myWouldBeLive}
          registeredCommittees = {registeredCommittees}
          changeScreen = {changeScreen}
        />
    </div>
  )
}

export default MyRunningWouldBe