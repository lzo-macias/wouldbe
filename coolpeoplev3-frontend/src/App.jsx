import { lazy, Suspense } from 'react'
import { Routes, Route } from "react-router-dom";
import './App.css'

// ============================================================================
// ROUTE-LEVEL CODE SPLITTING.
//
// Every page used to be a static import, so one bundle carried the admin
// dashboard, the Stripe Elements SDK, the debate bracket and the tournament CSS
// to a visitor who only opened the home page. Lighthouse counted that as unused
// JavaScript, and it was right.
//
// lazy() makes each route its own chunk, fetched when it is first visited. Home
// stays STATIC on purpose: it is the landing route, so deferring it would just
// add a network round trip before the first paint — the opposite of the goal.
// ============================================================================
import Home from './assets/pages/home/Home'

const StartADebate     = lazy(() => import('./assets/pages/debate/StartADebate/StartADebate'))
const ConnectTwitch    = lazy(() => import('./assets/pages/debate/StartADebate/ConnectTwitch'))
const SeedBracket      = lazy(() => import('./assets/pages/debate/StartADebate/SeedBracket'))
const MyPrompts        = lazy(() => import('./assets/pages/debate/Debates/MyPrompts'))
const AnyUserProfile   = lazy(() => import('./assets/pages/anyUserProfile/AnyUserProfile'))
const Debate           = lazy(() => import('./assets/pages/debate/Debate'))
const Admin            = lazy(() => import('./assets/pages/admin/Admin'))
const Login            = lazy(() => import('./assets/pages/auth/Login'))
const Signup           = lazy(() => import('./assets/pages/auth/Signup'))
const Wouldbe          = lazy(() => import('./assets/pages/wouldbe/Wouldbe'))
const StartAnOffice    = lazy(() => import('./assets/pages/wouldbe/StartAnOffice'))
const MyRunningWouldBe = lazy(() => import('./assets/pages/wouldbe/MyRunningWouldBe'))
const AnyWouldBe       = lazy(() => import('./assets/component/Wouldbe/WouldBeScreen/AnyWouldBe'))
const AnyDebate        = lazy(() => import('./assets/pages/debate/Debates/AnyDebate'))
// One match of a typed debate: the prompt, both answers, the thread. This is
// where every clickable thing in the bracket points.
const MatchThread      = lazy(() => import('./assets/pages/debate/Debates/MatchThread'))

// RequireAdmin stays static: it is a GUARD, not a page. Lazy-loading it would
// mean fetching a chunk just to decide whether the user may proceed.
import RequireAdmin from "./assets/component/RequireAdmin"

function App() {

  return (
    // <main> is the document's main landmark. Without one, a screen-reader user
    // has no "skip to content" target and Lighthouse flags the page as having no
    // landmark at all.
    <main>
      {/* Suspense is REQUIRED once routes are lazy: without a boundary React
          throws when a chunk suspends. The fallback is deliberately minimal —
          it appears only during a chunk fetch, and a heavy skeleton would itself
          shift layout, which is what CLS measures. */}
      <Suspense fallback={<div className="routeFallback">Loading…</div>}>
      <Routes>
        <Route path = "/" element = {<Home/>}/>
        <Route path = "/myWouldBe" element = {<MyRunningWouldBe/>}/>
        <Route path = "wouldbe/:id" element = {<AnyWouldBe/>} />
        <Route path = "/startadebate" element = {<StartADebate/>}/>
        {/* Post-submission setup. Its own route because the Twitch OAuth handoff
            leaves the site, and coming back has to rebuild context from the URL. */}
        <Route path = "/startadebate/:debateId/twitch" element = {<ConnectTwitch/>}/>
        {/* Seeding day. Its own route because the sponsor arrives from an email
            days after submitting — there is no in-app journey to resume, so the
            URL has to carry the whole context. */}
        <Route path = "/startadebate/:debateId/seed" element = {<SeedBracket/>}/>
        {/* A contestant's whole answering surface for a typed debate. Its own
            route because the link in their notification email is where most of
            them will arrive from, days before they open the debate page. */}
        <Route path = "/debate/:debateId/my-prompts" element = {<MyPrompts/>}/>
        {/* Anyone's public profile. Auth is optional — a token only widens it
            into the owner's own view, which shows their hidden fields back to
            them and includes campaigns they haven't launched. */}
        <Route path = "/u/:userId" element = {<AnyUserProfile/>}/>
        <Route path = "/debate" element = {<Debate/>} />
        <Route path = "/login" element = {<Login/>} />
        <Route path = "/signup" element = {<Signup/>} />
        <Route path = "/admin" element = {<RequireAdmin><Admin/></RequireAdmin>} />
        <Route path = '/wouldbe' element = {<Wouldbe/>}/>
        {/* '/wouldbe/:id' is served by AnyWouldBe above. IndividualWouldbe is an
            unfinished stub and its duplicate route was unreachable anyway —
            the first matching route wins. */}
        <Route path = '/wouldbe/:jurisdiction_id/:officeId' element = {<StartAnOffice/>}/>
        <Route path = 'debate/:debateId' element = {<AnyDebate/>}/>
        {/* `key` is the bracket slot coordinate, "left:0:1" — the same
            (side, round, position) the matches and prompts are keyed on. */}
        <Route path = 'debate/:debateId/match/:key' element = {<MatchThread/>}/>
      </Routes>
      </Suspense>
    </main>
  )
}

export default App
