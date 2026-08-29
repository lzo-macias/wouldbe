import React, {useState, useEffect} from 'react'
import "./StartADebateHeader.css"
import { useNavigate } from "react-router-dom"
import api from "../../../lib/api"
import { clearAuth } from "../../../lib/authStorage"
import Qualify from "../../Qualify/Qualify"

// `onQualifyClick` was REFERENCED BY THE BUTTON BUT NEVER DECLARED — not a prop,
// not a local — so rendering the signed-out header threw a ReferenceError and
// took the whole Start a debate page down with it.
//
// The other headers (WouldBeHeader, WouldBeNavHeader) take it as a prop and let
// the page own the modal. This one is used on pages that do not, so it owns the
// modal ITSELF and still accepts the prop for a caller that wants to override —
// which fixes every existing call site without touching any of them.
function StartADebateHeader({ onQualifyClick = null }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showQualify, setShowQualify] = useState(true)
    // Only used when no handler is passed in.
    const [qualifyOpen, setQualifyOpen] = useState(false)

    const openQualify = onQualifyClick || (() => setQualifyOpen(true))
    
    const navigate = useNavigate()

    useEffect(() => {
    async function checkAuth() {
      // Nothing to check if we have no credentials at all.
      if (!localStorage.getItem('token') && !localStorage.getItem('refreshToken')) {
        setLoading(false);
        setShowQualify(true)
        return;
      }
      try {
        // The api instance attaches the token and refreshes-on-401 for us.
        const { data } = await api.get('/api/auth/me');
        if (data.has_jurisdictions) {
          setShowQualify(false)
        }
        setUser(data);
      } catch (err) {
        clearAuth();
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    checkAuth()
  }, []);

  return (
<div  className='StartADebateHeader'>
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

      {!loading && (
        user ? (
          <div className='actionbtns'>
            {showQualify && (
              <>
                {/* <div className='qualify' onClick={onQualifyClick}>
                  <h3>See What Would Be's you Qualify For?</h3>
                </div> */}
                {/* <button className="qualify" onClick={onQualifyClick}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M20 6 9 17l-5-5" />
                   </svg>
                    See what you qualify for
                </button> */}
              </>
            )}
            <button
              className='signout'// need to do omething instead of refresh
              onClick={() => { clearAuth(); setUser(null);}} >
              signout
            </button>
          </div>
        ): (
        <div className='actionbtns'>
          {showQualify && (
            <>
                  <button className="qualify" onClick={openQualify}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M20 6 9 17l-5-5" />
                   </svg>
                    See what you qualify for
                </button>
            </>
          )}
          {/* <div className='actionbtns'> */}
            <button onClick={() => navigate('/signup')}>signup</button>
            <button onClick={() => navigate('/login')} className='login'>login</button>
          </div>
        )
      )}

      {/* Rendered only when this header is the owner. Passing onQualifyClick in
          means the page is showing its own, and two would stack. */}
      {qualifyOpen && !onQualifyClick && (
        <Qualify
          onClose={() => setQualifyOpen(false)}
          onQualified={() => {
            // They now have jurisdictions on file, so the prompt has served its
            // purpose and should stop asking.
            setShowQualify(false)
            setQualifyOpen(false)
          }}
        />
      )}
    </div>
  )
}

export default StartADebateHeader