import React from 'react'
import "./HomeHeader.css"
import { useNavigate } from 'react-router-dom'


function HomeHeader() {

    const navigate = useNavigate()
    async function travelToWouldbes() {
        // e.preventDefault()
        navigate('/Wouldbe')
    }
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
            </div>
            {/* <div>
                <h3 className='login'>Login</h3>
            </div> */}
        </div>

        <div className='HomeHeaderActionButtons'>
            <button onClick={travelToWouldbes}>
                <img 
                    src="/homepagegraphics/WouldBeButton.svg" 
                    alt="WouldBe" 
                    className=''
                />
            </button>
            <button>
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