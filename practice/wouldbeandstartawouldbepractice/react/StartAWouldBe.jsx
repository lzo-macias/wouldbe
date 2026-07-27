// ============================================================================
// REACT C — StartAWouldBe (recommended vs adjusted, + a CSS var from JS)
// ----------------------------------------------------------------------------
// The star page. Two goal numbers (fixed recommended vs slider-adjusted), a
// timeline whose rail fill is computed in JS and handed to CSS as an inline
// custom property, and the layout you styled. Fill the TODOs from memory, diff vs
//   coolpeoplev3-frontend/src/assets/component/Wouldbe/StartAWouldBe/StartAWouldBe.jsx
// Logic drilled in ../04, ../05, ../07.
//
// CONCEPT CHECK — answer first:
//   • `goalCents` is state; `recommendedGoalCents` is derived every render. Why
//     must the slider write ONLY `goalCents` and never touch the recommended one?
//     Which UI reads which? (chip + big number vs per-deadline amounts + "your goal")
//   • You pass layout math to CSS with `style={{ '--progress': \`${progress}%\` }}`.
//     Why is a custom property the clean boundary here instead of, say, setting
//     `width` directly? (What does the CSS gradient then do with it?)
//   • The gray subtitle is `font-size: 0.55em`. 0.55em of WHAT? What happens to it
//     if you change the headline size?
//   • `grid-template-columns: repeat(${n}, 1fr)` is inline because `n` is dynamic.
//     Why can't that live in the .css file?
// ============================================================================

import React, { useState } from "react";
import { formatUSD, formatDeadlineDate, DEADLINE_LABELS } from "../../component/Wouldbe/WouldBeRows/deadlineFormat";
import "./StartAWouldBe.css";

function StartAWouldBe({ office, jurisdiction }) {
    const originalGoalCents = office.goalCents;
    const [goalCents, setGoalCents] = useState(originalGoalCents ?? 500000);

    // TODO 1: recommendedGoalCents = the FIXED value (originalGoalCents ?? 500000)
    // TODO 2: build the timeline `points` from office.deadlines (group by date, fold
    //         Today in, sort). Compute `progress` for the rail (see ../05) and the
    //         cumulative per-deadline amount from goalCents (the ADJUSTED value, ../04).

    


    return (
        <div className="StartAWouldBeMainContainer">
            <section className="hero">
                <h1 className="headline">
                    <img src="/logos/WouldBeLogo.svg" alt="would be" className="headlineLogo" />
                    {/* TODO 3: gray, normal-weight subtitle at 0.55em */}
                    <span className="headlineText">a great {jurisdiction.state_code} {office.office_name} representative</span>
                </h1>

                <div className="panel">
                    <div className="panel-head">
                        <div className="panel-title">Campaign timeline<b>{office.office_name}</b></div>
                        {/* TODO 4: chip shows the RECOMMENDED goal (fixed) */}
                        <div className="goal-chip">Recommended financing goal <b>{/* … */}</b></div>
                    </div>
                    {/* TODO 5: <div className="track" style={{ gridTemplateColumns: `repeat(${n},1fr)` }}>
                          <div className="rail" style={{ '--progress': `${progress}%` }} />
                          … map points -> nodes (pin/label/date/amount, today = YOU flag) … */}
                </div>

                {/* … the 3-card grid … the goal card below … */}
                <div className="card goal-card">
                    <div className="goal-eyebrow">Recommended goal</div>
                    {/* TODO 6: big number = recommended (fixed) */}
                    <div className="goal-amount">{/* … */}</div>
                    <input
                        type="range" min={500000} max={100000000} step={100000}
                        value={goalCents}
                        onChange={(e) => setGoalCents(Number(e.target.value))}
                    />
                    {/* TODO 7: "your goal" line = goalCents (adjusted), updates as you drag */}
                    <div className="goal-your"><span>Your goal</span> <b>{/* … */}</b></div>
                    <button className="start-btn">Start a campaign →</button>
                </div>
            </section>
        </div>
    );
}

export default StartAWouldBe;
