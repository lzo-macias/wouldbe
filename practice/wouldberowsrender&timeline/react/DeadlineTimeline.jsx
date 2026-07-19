// ============================================================================
// REACT A — DeadlineTimeline (positioning points with absolute + percent left)
// ----------------------------------------------------------------------------
// You get a ready-made view-model (from problem 07). Your job is only the RENDER:
// turn each point into an absolutely-positioned tick on a horizontal line, always
// showing its name(s) + date, with the Today point styled as the "you" marker.
//
// The layout trick: the track is `position: relative`; every tick is
// `position: absolute; left: {point.left}%` and shifted back by its own half-width
// (`transform: translateX(-50%)`) so the LINE — not the left edge — lands on the %.
//
// Fill in the TODOs.
//
// CONCEPT CHECK — answer in your head first:
//   • Why does each tick need BOTH `left: x%` AND `translateX(-50%)`? What lands on
//     the date if you drop the transform?
//   • Why is the "you" badge `position: absolute; bottom: 100%` instead of just
//     sitting in the flex column above the line?
//   • A Today point has `labels: []`. How does the render use that to decide
//     between the "Today" text and the name+date block?
//   • Why is `key={p.date}` a good key here (and why not the array index)?
// ============================================================================

import React from "react";

function DeadlineTimeline({ model }) {
    // model = { goalLabel: "$250,000" | null, points: [{ date, labels, isToday, left }] }
    return (
        <div className="wouldbeTimelineWrap">
            {/* TODO 1: if model.goalLabel is truthy, render
                <div className="wouldbeGoal">Recommended financing goal: {model.goalLabel}</div> */}
            {model.goalLabel && (
                <>
                    <div className="wouldbeGoal">{model.goalLabel}</div>
                </>
            )}

            <div className="wouldbeTimeline">
                <div className="wouldbeTimelineLine" />

                {/* TODO 2: map model.points -> a tick per point.
                    Each tick is:
                      <div className={"wouldbeTick" + (p.isToday ? " wouldbeTickToday" : "")}
                           style={{ left: `${p.left}%` }} key={p.date}>
                    Inside each tick:
                      - if p.isToday: a <span className="wouldbeYouBadge">you</span>
                      - always: a <span className="wouldbeTickMark" />
                      - then the label:
                          * if p.isToday -> <span className="wouldbeTodayText">Today</span>
                          * else -> p.labels.map(...) as <span>s, then
                                    <span className="wouldbeTickDate">{formatDate(p.date)}</span>
                */}
    
                {model.points.map((p) => (
                    <div className={"wouldbeTick" + (p.isToday ? " wouldbeTickToday": "")}
                        style= {{left: `${p.left}%`}} key = {p.date}
                    >
                       {p.isToday && <span className="wouldbeYouBadge">you</span>}
                       <span className = "wouldbeTickMark"/>
                       {p.isToday ? (
                            <span className="wouldBeTodayText">Today</span>
                       ): (
                            <span className="woulbeTickLabel">
                                {p.labels.map((l, j) => <span key={j}>{l}</span>)}
                                <span className="wouldbeTickDate">{formatDate(p.date)}</span>
                            </span>
                       )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// Format "2026-08-07" -> "Aug 7, 2026" (T00:00:00 = local, dodges the TZ off-by-one)
function formatDate(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
    });
}

export default DeadlineTimeline;
