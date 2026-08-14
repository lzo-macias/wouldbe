import React, {useEffect, useState} from 'react'
import api from '../../../lib/api'
import { useNavigate } from 'react-router-dom'
import "./MyRunningWouldbes.css"

// created_at / reviewed_at are real timestamps (not DATE columns), so the
// viewer's local zone is correct here — no timeZone:"UTC", unlike wouldbe.deadline.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric",
})

const fmtDate = (v) => (v ? dateFmt.format(new Date(v)) : "—")

function MyRunningWouldbes({ myWouldBeDrafts, myWouldBeLive, registeredCommittees, changeScreen }) {
  const navigate = useNavigate()

  return (
      <div className='bigContainer'>
        <button onClick = {() => navigate("/wouldbe")}className='seeLiveOffice'>see live offices <img src = "/wouldbegraphics/arrowright.svg"/></button>
          {myWouldBeLive.length > 0 && (
            <div>
            <h2>Live WouldBe's</h2>
              {myWouldBeLive.map((element) => (
                  <ul onClick = {() => changeScreen(element, false)} key = {element.id}>
                    <li>{element.title}</li>
                    <li><span>Office Name: </span>{element.office_name}</li>
                    <li><span>Applied at: </span>{fmtDate(element.created_at)}</li>
                    <li><span>Approved at: </span>{fmtDate(element.reviewed_at)}</li>
                  </ul>
              ))}
            </div>
          )}
              {myWouldBeDrafts.length > 0 && (
                <div className = 'DraftsBigContainer'>
                  <h2 className='DraftsHeader'>Drafts</h2>
                    <p className='DraftsHeaderDescription'>awaiting approval</p>
                    {myWouldBeDrafts.map((element) => (
                        <ul onClick = {() => changeScreen(element, true)}className='DraftsCard' key={element.id}>
                          <li className='draftTitle'>{element.title}</li>
                          <li><span>Office Name: </span>{element.office_name}</li>
                          <li><span>Applied at: </span>{fmtDate(element.created_at)}</li>
                          {registeredCommittees.get(element.id) && (
                            <li className='draftMissing'>
                              <span>Missing: </span>{registeredCommittees.get(element.id)}
                            </li>
                          )}
                        </ul>
                    ))}
                </div>
              )}
      </div>
  )
}

export default MyRunningWouldbes