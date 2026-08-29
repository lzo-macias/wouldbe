import React, {useState, useEffect} from 'react'
import "./Header.css"
import { useNavigate } from "react-router-dom"
import api from "../../lib/api"
import { clearAuth } from "../../lib/authStorage"


function WouldBeHeader({ onQualifyClick, dontshow }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showQualify, setShowQualify] = useState(true)

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
          setShowQualify(true)
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

  useEffect(() => {
      if(dontshow) setShowQualify(false)
      return
  }, dontshow)

  return (
    <div id = "WouldBeHeader" className='WouldBeHeader'>
      <div className='LogoandSearch'>
          <div className='WouldbeLogo'>
            <img 
              src="/logos/WouldBeLogo.svg" 
              alt=""
              className=''
            />
        </div>
        {/* No placeholder copy: the box sits beside the office search below
            it, and two search fields captioned with different sentences read
            as two different searches. The icon says what it is. */}
        <div className='SearchContainer'>
            <img 
                src="/homepagegraphics/Search.svg" 
                alt="Search" 
                className='SearchIcon'
              />
        </div>
      </div>

      {!loading && (
        user ? (
          <div className='actionbtns'>
            {showQualify && (
              <>
                <button className="qualify" onClick={onQualifyClick}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M20 6 9 17l-5-5" />
                   </svg>
                    See what you qualify for
                </button>
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
                  <button className="qualify" onClick={onQualifyClick}>
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
    </div>
  )
}

export default WouldBeHeader