import React, {useEffect} from 'react'
import api from '../../../lib/api'

function Regulations({office}) {

const [regulations, setRegulations] = useState("")

useEffect(() => {
    async function LoadData() {
        try{
            const eligibilityresult = await api.get(`/api/offices/${office.id}/eligibility`)
            if (eligibilityresult.data) setRegulations(eligibilityresult.data)
            
        }catch(err){
            console.log(err)
        }
    }
})

  return (
    <div className='RegualtionsMainContainer'>
        <h2>{office.name}Regulations</h2>
        <div className='regulationsIdentifiers'>
            {office.state}
            {office.name}
        </div>
        <div className='regulationsSubContainer'>
            <div>
                <p>Min Age: {regulations.min_age}</p>
                <p>citizenship_require</p>
            </div>
        </div>
    </div>
  )
}

export default Regulations