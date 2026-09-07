import React, {useState, useEffect} from 'react'
import ApplyForDebateCasual from "../../../component/StartADebate/ApplyForDebateCasual"
import "./StartADebate.css"
import StartADebateHeader from '../../../component/header/StartADebateHeader/StartADebateHeader'


// `embedded` — the same form, rendered inside another page. The only thing it
// changes is the header: inline on /homev2 the feed already has one, and two
// headers on one screen is a page that looks broken rather than nested.
function StartADebate({ embedded = false, onDone, onCancel }) {
    // ALWAYS THE FORM. Screen 1 was a shelf of your existing drafts, which
    // meant pressing "Start a debate" answered a question nobody asked —
    // "here is what you already made" — before letting you make anything. That
    // shelf is a profile view, and it lives on the profile now.
    const [screen] = useState("3")
    const screens = {
        "3": <ApplyForDebateCasual onDone={onDone} embedded={embedded} onCancel={onCancel} />,
    }

  return ( 
    /* NO data-surface="dark". It flipped --wb-gold-ink to #E8C56A for a black
       ground — and the ground is white now, where that gold is 1.3:1 and
       effectively invisible. One scheme, one surface, nothing to flip. */
    <div className='debategradientV2'>
        {!embedded && <StartADebateHeader/>}
        {screens[screen]}
    </div>
  )
}

export default StartADebate