import React, { useState, useEffect } from 'react'
import Header from '../../component/header/Header'
import WouldBeHeader from '../../component/header/WouldBeHeader'
import WouldBeRows from '../../component/Wouldbe/WouldBeRows/WouldBeRows'
import Qualify from '../../component/Qualify/Qualify'
import api from '../../lib/api'
import './Wouldbe.css'

function Wouldbe() {
  const [showQualifyScreen, setShowQualifyScreen] = useState(false)
  const [qualifiedOffices, setQualifiedOffices] = useState(null)
  const [showQualify, setShowQualifyBtn] = useState(true)
  const [offices, setOffices] = useState(true)

  // Address→district resolution is persisted server-side (user_jurisdictions), so
  // a refresh must NOT forget it. On load, if the user has already resolved their
  // jurisdictions, pull their qualifying offices back; otherwise leave null and
  // WouldBeRows falls back to the full office list. Gating the render on this
  // check also avoids a flash of the full list before the scoped one loads.

  const [checkingJurisdictions, setCheckingJurisdictions] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function rehydrate() {
      try {
      let jur = {}
      if (localStorage.getItem('token') && localStorage.getItem('refreshToken')) {
        jur = await api.get('/api/users/me/jurisdictions')
      }
        if (cancelled) return
        if ((jur.data ?? []).length > 0) {
          // relevant = offices in the user's districts + state + national, each
          // tagged qualifies / relevance_tier so the feed can show what they
          // qualify for AND what they don't (yet), grouped by required age.
          const offices = await api.get('/api/offices/relevant')
          if (!cancelled) setQualifiedOffices(offices.data ?? [])
          setQualifiedOffices(offices.data ?? [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setCheckingJurisdictions(false)
      }
    }
    rehydrate()
    return () => { cancelled = true }
  }, []) ///wouldbePage

  return (
    <div className='wouldbePage'>
        {/* <Header></Header> */}
        <div className={`wouldbeContent${showQualifyScreen ? ' blurred' : ''}`}>
          <WouldBeHeader onQualifyClick ={() => setShowQualifyScreen(true)} />
          {!checkingJurisdictions && <WouldBeRows offices = {qualifiedOffices}/>}
        </div>
        {showQualifyScreen && (
          <Qualify 
          onClose ={() => setShowQualifyScreen(false)}
          onQualified ={(offices) => setQualifiedOffices(offices)}
          />
        )}
    </div>
  )
}

export default Wouldbe