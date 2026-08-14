import { useState } from 'react'
import { Routes, Route} from "react-router-dom";
import './App.css'

import Home from './assets/pages/home/Home'
import StartADebate from './assets/pages/debate/StartADebate/StartADebate';
import ConnectTwitch from './assets/pages/debate/StartADebate/ConnectTwitch';
import Debate from "./assets/pages/debate/Debate"
import Admin from "./assets/pages/admin/Admin"
import Login from "./assets/pages/auth/Login"
import Signup from "./assets/pages/auth/Signup"
import RequireAdmin from "./assets/component/RequireAdmin"
import Wouldbe from './assets/pages/wouldbe/Wouldbe';
import StartAnOffice from './assets/pages/wouldbe/StartAnOffice';
import MyRunningWouldBe from './assets/pages/wouldbe/MyRunningWouldBe';
import AnyWouldBe from './assets/component/Wouldbe/WouldBeScreen/AnyWouldBe';

function App() {

  return (
    <>
      <Routes>
        <Route path = "/" element = {<Home/>}/>
        <Route path = "/myWouldBe" element = {<MyRunningWouldBe/>}/>
        <Route path = "wouldbe/:id" element = {<AnyWouldBe/>} />
        <Route path = "/startadebate" element = {<StartADebate/>}/>
        {/* Post-submission setup. Its own route because the Twitch OAuth handoff
            leaves the site, and coming back has to rebuild context from the URL. */}
        <Route path = "/startadebate/:debateId/twitch" element = {<ConnectTwitch/>}/>
        <Route path = "/debate" element = {<Debate/>} />
        <Route path = "/login" element = {<Login/>} />
        <Route path = "/signup" element = {<Signup/>} />
        <Route path = "/admin" element = {<RequireAdmin><Admin/></RequireAdmin>} />
        <Route path = '/wouldbe' element = {<Wouldbe/>}/>
        {/* '/wouldbe/:id' is served by AnyWouldBe above. IndividualWouldbe is an
            unfinished stub and its duplicate route was unreachable anyway —
            the first matching route wins. */}
        <Route path = '/wouldbe/:jurisdiction_id/:officeId' element = {<StartAnOffice/>}/>
      </Routes>
    </>
  )
}

export default App
