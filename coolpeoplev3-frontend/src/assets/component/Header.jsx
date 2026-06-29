import React from 'react'
import "../styling/Header.css"

function Header() {
  return (
    <div className='WouldBeHeader'>
      <div className='LogoandSearch'>
          <div className='WouldbeLogo'>
            <img 
              src="/logos/WouldBeLogo.svg" 
              alt=""
              className=''
            />
        </div>
        <div className='SearchContainer'>
            <img 
                src="/homepagegraphics/Search.svg" 
                alt="Search" 
                className='SearchIcon'
              />
              <p>Search for different campaigns and debate </p>   
        </div>
      </div>

        <div className='actionbtns'>
            <button>signup</button>
            <button className='login'>login</button>
        </div>
    </div>
  )
}

export default Header