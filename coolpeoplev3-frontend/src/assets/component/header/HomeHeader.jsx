import React, {useEffect, useState} from 'react'
import api from '../../lib/api'
import "./HomeHeader.css"
import { useNavigate } from 'react-router-dom'
import HomeFilter from './HomeFilter'


function HomeHeader({ filters, onFiltersChange }) {
    const [travelToMyWouldBes, setTravelToMyWouldBes] = useState(false)

    const navigate = useNavigate()
    async function travelToWouldbes(travelToMyWouldBes) {
        // e.preventDefault()
        if (travelToMyWouldBes) {navigate('/myWouldBe')}
        else {navigate('/Wouldbe')}
    }

    async function travelToStartADebate() {
        navigate("/startadebate")
    }

    useEffect(() => {
    let cancelled = false
    async function loadData() {
        try{
            const { data } = await api.get("/api/wouldbes/mine")
            if (cancelled) return
            if (data.length > 0) setTravelToMyWouldBes(true)
        }catch(err){
            console.error(err)
            if (!cancelled) setTravelToMyWouldBes(false)
        }
    }
    loadData()
    return () => { cancelled = true}
  }, [])
  return (
    <div className='main_container'>
        <div className= "Logoandsearchbar">
            <div>
                <img 
                src="/logos/WouldBeLogo.svg" 
                alt="WouldBe_By_CoolPeople" 
                className='HomeLogo'
                />
            </div>
            
            <div className='HomeSearchContainer'>
                <img 
                src="/homepagegraphics/Search.svg" 
                alt="Search" 
                className='SearchIcon'
                />
                <p>Search for different campaigns and debate </p>
                {/* Inside the search container on purpose: that element is
                    position:fixed, so it is the positioned ancestor the filter
                    button anchors to (top:100%, left:75%). Anchoring to the page
                    instead would mean duplicating the bar's hard-coded left and
                    width, and drifting apart the moment either changed. */}
                {filters && (
                    <HomeFilter value={filters} onChange={onFiltersChange} />
                )}
            </div>
            {/* <div>
                <h3 className='login'>Login</h3>
            </div> */}
        </div>

        <div className='HomeHeaderActionButtons'>
            <button onClick={()=> {travelToWouldbes(travelToMyWouldBes)}}>
                <img 
                    src="/homepagegraphics/WouldBeButton.svg" 
                    alt="WouldBe" 
                    className=''
                />
            </button>
            <button
                onClick ={travelToStartADebate}
            >
                <img 
                    src="/homepagegraphics/DebateButton.svg" 
                    alt="Debate" 
                    className=''
                />
            </button>
        </div>
    </div>

  )
}

export default HomeHeader