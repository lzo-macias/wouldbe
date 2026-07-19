import { useState } from 'react'
import { Routes, Route} from "react-router-dom";
import './App.css'

import Home from './assets/pages/home/Home'
import Debate from "./assets/pages/debate/Debate"
import Admin from "./assets/pages/admin/Admin"
import Login from "./assets/pages/auth/Login"
import Signup from "./assets/pages/auth/Signup"
import RequireAdmin from "./assets/component/RequireAdmin"
import Wouldbe from './assets/pages/wouldbe/Wouldbe';
import StartAnOffice from './assets/pages/wouldbe/StartAnOffice';

function App() {

  return (
    <>
      <Routes>
        <Route path = "/" element = {<Home/>}/>
        <Route path = "/debate" element = {<Debate/>} />
        <Route path = "/login" element = {<Login/>} />
        <Route path = "/signup" element = {<Signup/>} />
        <Route path = "/admin" element = {<RequireAdmin><Admin/></RequireAdmin>} />
        <Route path = '/wouldbe' element = {<Wouldbe/>}/>
        <Route path = '/wouldbe/jurisdiction_id/officeId' element = {<StartAnOffice/>}/>
      </Routes>
    </>
  )
}

export default App
