import React from 'react'
import "../styling/HomeHeader.css"

function HomeHeader() {
  return (
    <div className='main_container'>
        <div className= "Logoandsearchbar">
            <div>
                <img 
                src="/logos/HomeLogo.svg" 
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
        </div>

        <div className='HomeHeaderActionButtons'>
            <button>
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