// ============================================================================
// REACT B — HoverCard (hover state + lazy fetch + conditional render)
// ----------------------------------------------------------------------------
// This is the shell around the timeline: a card that shows a compact summary by
// default and, ON HOVER, swaps to the expanded timeline view — fetching the
// office's recommended goal the FIRST time it's hovered (not for every card up
// front). This is the exact pattern from RenderCard in WouldBeRows.
//
// Fill in the TODOs.
//
// CONCEPT CHECK — answer in your head first:
//   • Why must this be its OWN component (with its own useState) instead of a
//     function you call inside a .map? (Hint: Rules of Hooks — what breaks?)
//   • goalCents has THREE states: undefined (not fetched), null (none on record),
//     a number (cents). Why three, not two? What does each render?
//   • Why guard the fetch with `if (goalCents !== undefined) return;`?
//   • `cond ? <A/> : <B/>` vs `cond && <A/>` — which one is right for
//     "hovered ? expanded : collapsed", and why?
// ============================================================================

import React, { useState } from "react";
import DeadlineTimeline from "./DeadlineTimeline";
// import api from "../../lib/api";   // in the real app; here it's injected as a prop

function HoverCard({ office, api, buildModel }) {
    // office     = { id, state_code, office_name, deadlines: [{type,date}] }
    // api        = { get(path) -> Promise<{ data }> }   (injected so this is testable)
    // buildModel = (office, goalCents) -> the timeline view-model (your problem 07)

    const [hovered, setHovered] = useState(false);
    // TODO 1: goalCents state, initial value undefined (= "not fetched yet")
    const [goalCents, setGoalCents] = useState(undefined)

    // TODO 2: async handleEnter():
    //   - setHovered(true)
    //   - if goalCents is already fetched (!== undefined), return early
    //   - try: res = await api.get(`/api/offices/${office.id}/recommended-goal`)
    //          setGoalCents(res.data?.recommended_goal_cents ?? null)
    //     catch: setGoalCents(null)


async function handleEnter() {
    try {
        setHovered(true)
        if (goalCents !== undefined) return 
        else {
            const res = await api.get(`/api/offices/${office.id}/recommended-goal`)
            setGoalCents(res.data?.recommended_goal_cents ?? null)
        }   
    }catch(err){
        console.log(err)
    }
}


    return (
        <div
            className={hovered ? "hoveredWouldBeCard" : "wouldbeCard"}
            // TODO 3: onMouseEnter={handleEnter}  onMouseLeave={() => setHovered(false)}
            onMouseEnter = {handleEnter} onMouseLeave ={() => setHovered(false)}
        >
            {/* TODO 4: hovered ? (expanded) : (collapsed)
                  expanded:
                    <>
                      <h3 className="hoveredWouldBeName">{office.state_code}: {office.office_name}</h3>
                      <DeadlineTimeline model={buildModel(office, goalCents)} />
                    </>
                  collapsed:
                    <h3 className="officeOrWouldbeName">{office.state_code}: {office.office_name}</h3>
            */}

               {hovered ? (
                    <>
                        <h3 className="hoveredWouldBeName">{office.state_code}: {office.office_name}</h3>
                        <DeadlineTimeline model = {buildModel(office, goalCents)} />
                    </>
               ): (
                    <>
                        <h3 className="officeOrWouldbeName">{office.state_code}: {office.office_name}</h3>
                    </>
               )}
        </div>
    );
}

export default HoverCard;
