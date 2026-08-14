import React, { useState, useEffect } from 'react'
import "./HomeGrid2x.css"
import { Link } from "react-router-dom"
import api from "../../lib/api"

function Grid2x() {
    const [debates, setDebates] = useState({})
    const [wouldbe, setWouldbes] = useState({})
    const [reccomended, setReccomended] = useState({})
    const [mixed, setMixed] = useState([])
    const Today = new Date()

useEffect(() => {
    let cancelled = false
    async function loadData(){
        try{
            const {debateRes, wouldbeRes, reccomendedRes} = Promise.all([
                api.get("/api/wouldbes?sort=pledged").then(r => r.data).catch(() => []),
                api.get("/api/debates?sort=featured").then(r => r.data).catch(() => []),
                api.get("/api/wouldbes/recommended?limit=5").then(r => r.data).catch(() => []),
            ])
            const mixedRes = []
            if (!reccomendedRes.data){
                if (debateRes.data.length -1 > wouldbeRes.data.length -1) {
                    debateRes.data.forEach(( item, i) => {
                        if (wouldbeRes.data[i] == null) {
                            mixedRes.push({type: "debate", item: debateRes.data[i]})    
                        }
                            mixedRes.push({type: "wouldbe", item: wouldbeRes.data[i]})
                        if (i % 3) mixedRes.push({type: "debate", item: debateRes.data[i]})
                })
                }else if (wouldbeRes.data.length -1 > debateRes.data.length -1 ){
                    wouldbeRes.data.forEach(( item, i) => {
                        if (wouldbeRes.data[i] == null) {
                            mixedRes.push({type: "debate", item: debateRes.data[i]})    
                        }
                        mixedRes.push({type: "wouldbe", item: wouldbeRes.data[i]})
                        if (i % 3) mixedRes.push({type: "debate", item: debateRes.data[i]})
                })
            }else {
// every three a debate         
            }
            }

        }catch(err){
            console.error(err)
        }
    }
    loadData()
})

//load debates and wouldbes that arent retired, 

//prioritize wouldbes with the most pledges, in the logged in users jurisdiction or state, wouldbe poster has 

//prioritize debates with higest number of contestants, and highest prize cash amount, highest nominations

//for every three wouldbes, 1 debate 

// Percent as a capped signal, not the primary one:

// score = 0.4 × min(pct_funded, 100)/100
//       + 0.3 × velocity          (pledged in last 7 days, log-scaled)
//       + 0.2 × backer_count      (log-scaled — 50 people beats one big pledge)
//       + 0.1 × urgency           (rises as the filing deadline nears)

// Cold start. Every new campaign scores ~0 and never surfaces, so it never gets pledges. Both platforms solve this with a "newest"/"just launched" rail — which is essentially what your ?sort=newest already is. Reserve slots rather than trying to make one score handle it.

// Your local signal is stronger than theirs. Kickstarter has no equivalent of /api/wouldbes/recommended — jurisdiction match is genuinely meaningful for a political race in a way "you might like this boardgame" isn't. I'd weight that above almost everything for signed-in users; a race you can actually vote in beats a better-funded one three states away.


//debates must show cash prize, nominations total as contestants, time to start date

//wouldbes must show title, image, state, time to deadline, percent to goal

  return (
    <div>
        {mixed.map((element) => {
            const isDebate = element.type == "debate"
            let daysTillDebateDeadline =  0
            let daysTillWouldbeDeadline = 0
            {element.type == "debate" ? (
                daysTillDebateDeadline = today - element.start_date
            ): (
                daysTillWouldbeDeadline = today - element.deadline_date
            )}
         return isDebate ? (
            <div
                key = {debates.item.id}
                className = "debateMiniDiv"
            >
                <span>{debates.item.title}</span>
                <div>
                    <img 
                        src = {"./homepagegraphics/LargeColdMoney.svg"}
                        alt="" />
                        {!debates.item.cash_prize ? (
                            <>
                                <p>the prize</p>
                                <p>{debates.item.prize_description}</p>
                            </>
                        ): (
                            <>
                                <p>total cash prize</p>
                                <p>{debates.item.cash_prize}</p>
                            </>
                        )}
                    <div>
                        <div>
                            <img 
                                src = {"./homepagegraphics/Team.svg"}
                                alt = "" 
                            />
                            <p>{debates.item.nominations} competitors</p>
                        </div>
                        <div>
                            <img 
                                src = {"./homepagegraphics/Clock.svg"} 
                                alt = ""
                            />
                            <p>{daysTillDebateDeadline} days till start date</p>
                        </div>
                    </div>
                </div>
            </div>
         ):(
            <div
                key = {wouldbe.item.id}
                className = 'wouldbeMiniDiv'
            >
                {wouldbe.item.profile_photo ? (
                    <div>
                        <img 
                        src= {wouldbe.item.profile_photo}
                        alt="" 
                        />
                        <div>
                            <p>{wouldbe.item.office_name}</p>
                            <span>{wouldbe.item.state}</span>
                            <div>
                                <img 
                                    src = {"./homepagegraphics/trophy"} 
                                    alt="" 
                                />
                                <span>{wouldbe.item.percentage_to_goal}</span>
                            </div>
                            <div>
                                <img 
                                    src = {"./homepagegraphics/clock"} 
                                    alt = "" 
                                />
                                <span>{wouldbe.item.daysTillWouldbeDeadline}</span>
                            </div>
                        </div>
                    </div>
                ): (
                    <div>
                        <div>
                            {wouldbe.item.title}
                        </div>
                        <div>
                            <span>{wouldbe.item.state}</span>
                            <div>
                                <img 
                                    src = {"./homepagegraphics/trophy"} 
                                    alt="" 
                                />
                                <span>{wouldbe.item.percentage_to_goal}</span>
                            </div>
                            <div>
                                <img 
                                    src = {"./homepagegraphics/clock"} 
                                    alt = "" 
                                />
                                <span>{wouldbe.item.daysTillWouldbeDeadline}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
         )
        })}
    </div>
  )
}

export default Grid2x