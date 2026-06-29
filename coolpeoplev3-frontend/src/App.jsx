import { useState } from 'react'
import { Routes, Route} from "react-router-dom";
import './App.css'

import Home from './assets/pages/Home'
import Debate from "./assets/pages/Debate"
import Admin from "./assets/pages/Admin"
import Login from "./assets/pages/Login"
import Signup from "./assets/pages/Signup"
import RequireAdmin from "./assets/component/RequireAdmin"

function App() {

  return (
    <>
      <Routes>
        <Route path = "/" element = {<Home/>}/>
        <Route path = "/debate" element = {<Debate/>} />
        <Route path = "/login" element = {<Login/>} />
        <Route path = "/signup" element = {<Signup/>} />
        <Route path = "/admin" element = {<RequireAdmin><Admin/></RequireAdmin>} />

      </Routes>
    </>
  )
}

export default App
