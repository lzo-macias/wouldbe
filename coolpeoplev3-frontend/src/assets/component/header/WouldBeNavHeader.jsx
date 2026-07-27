import React from 'react'
import { useNavigate } from 'react-router-dom'
import './WouldBeNavHeader.css'

// Updated "would be" nav bar — sticky, blurred, with a gold "qualify" CTA.
// Presentational for now (wired to routes); drop in `onQualifyClick` to hook up
// the qualify flow when ready.
function WouldBeNavHeader({ onQualifyClick }) {
  const navigate = useNavigate()

  return (
    <header className="wbNav">
      <div className="wbNav-inner">
        <div className="wbNav-logo">would be</div>

        <div className="wbNav-search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Search campaigns &amp; debates
        </div>

        <button className="wbNav-qualify" onClick={onQualifyClick}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          See what you qualify for
        </button>

        <div className="wbNav-auth">
          <button className="wbNav-ghost" onClick={() => navigate('/signup')}>Sign up</button>
          <button className="wbNav-outline" onClick={() => navigate('/login')}>Log in</button>
        </div>
      </div>
    </header>
  )
}

export default WouldBeNavHeader
