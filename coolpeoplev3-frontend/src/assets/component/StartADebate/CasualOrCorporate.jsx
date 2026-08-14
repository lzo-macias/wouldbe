import React from 'react'
import "./casualorcorporate.css"

//need custom graphics
function CasualOrCorporate({onComplete, onCompleteV2}) {
  return (
    <main className = "casualOrCorporateContainer">
      <div className ="parentToTheMini"> 
        <div 
        onClick = {() => onComplete()} className='casualOrCorporateMiniContainer'>
            <h3 className='casualOrCorporateTitleCard'>Casual</h3>
            <p  className='casualOrCorporatedescription'>for caual debates and competitions among friends or for the world wide web</p>
        </div>
        <div 
        onClick = {() => onCompleteV2()}
        className='casualOrCorporateMiniContainer'>
            <h3 className='casualOrCorporateTitleCard'>Corporate</h3>
            <p className='casualOrCorporatedescription'>for businesses that want to throw there own debate or competition with the help of the wouldbe marketing team</p>
        </div>
      </div>
    </main>
  )
}

export default CasualOrCorporate