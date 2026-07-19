import React, {useEffect} from 'react'
import { useParams } from 'react-router-dom'
import Regulations from '../../component/Wouldbe/Regulations/Regulations'

function StartAnOffice() {
  const [screen, setScreen] = useState("1")
  const [office, setOffice] = useState("")
  const [individualJurisdiction, setIndividualJurisdiction] = useState("")
  const officeId = useParams()
  const [individualOffice, setindividualOffice] = useState("")


useEffect(() => {
  try{
    const officeresult = await api.get(`/api/offices/${officeId}`)
    if (officeresult.data) setOffice(officeresult.data)
    const jurisdictionresult = await api.get(`/api/jurisdictions/${office.jurisdiction_id}` )
    if (jurisdictionresult.data) setJurisdiction(jurisdictionresult.data)
  }catch(err){
    console.error(err)
  }
})

  const screens = {
    "1": (
      <Regulations office = {individualOffice} jurisdiction = {individualJurisdiction} onComplete = {() => {setScreen("2")}}/>
    ),
    "2": (
      <>
      
      </>
    ),
    "3": (
      <>

      </>
    )
  }

  return (
    <div>
      {screens[screen]}
    </div>
  )
}

export default StartAnOffice