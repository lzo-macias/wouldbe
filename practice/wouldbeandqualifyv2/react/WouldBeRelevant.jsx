// ============================================================================
// REACT B — WouldBeRelevant (grouped, conditional rendering)
// ----------------------------------------------------------------------------
// The relevant-mode render of WouldBeRows, isolated. It receives an `offices`
// prop where each office is already annotated { id, office_name, qualifies,
// relevance_tier, min_age }. Fill in the TODOs so it renders three groups:
//
//   1. "Offices you can run for"      — the qualified ones
//      (or, if there are none, a <p> that says you don't qualify yet)
//   2. "Not yet — in your districts"  — NOT qualified, tier 'district',
//                                        under "Eligible at age N" sub-headers
//   3. "Statewide & national"         — NOT qualified, tier !== 'district'
//
// Reuse your logic from problems 05 (partition) and 06 (groupByAge) — here they
// run in the render body, deriving from props each time (no useState needed for
// derived data).
//
// CONCEPT CHECK:
//   • Why compute qualified / districtLater / groups in the render body instead
//     of storing them in useState? (What is "derived state" and why avoid it?)
//   • Why does each mapped element (cards AND the age sub-headers) need a `key`?
//   • `React.Fragment` lets you return a header + its cards without a wrapper div
//     — why does the age loop need `<React.Fragment key={age}>` specifically?
//   • How does a `cond ? (<A/>) : (<B/>)` differ from `cond && (<A/>)` in JSX,
//     and which fits "show qualified list OR a fallback message"?
// ============================================================================

import React from "react";

function groupByAge(list) {
    const buckets = {};
    for (const o of list) { const age = o.min_age ?? 0; (buckets[age] ??= []).push(o); }
    return Object.keys(buckets).map(Number).sort((a, b) => a - b).map((age) => ({ age, list: buckets[age] }));
}

function Card({ office }) {
    return <li>{office.office_name}</li>;
}

function WouldBeRelevant({ offices = [] }) {
    // TODO 1: qualified     = offices where qualifies is true
    // TODO 2: districtLater = NOT qualified AND relevance_tier === 'district'
    // TODO 3: stateLater    = NOT qualified AND relevance_tier !== 'district'
    const { qualified, districtLater, stateLater } = offices.reduce((acc, o) => {
        if (o.qualifies == true) acc.qualified.push(o)
        else if (o.relevance_tier == "district") acc.districtLater.push(o)
        else if (o.relevance_tier != 'district') acc.stateLater.push(o)
        return acc 
    }, { qualified: [], districtLater: [], stateLater: [] })

    return (
        <div>
            {/* TODO 4: if qualified has items, render <h2>Offices you can run for</h2>
                and a <Card> per office; ELSE render a <p> fallback message. */}
            { qualified.length ? (
                <>
                    <h2>Offices you can run for</h2>
                    {/* {qualified.map((o) => (
                        <div className="card" key={o.id}>{o.office_name}</div>
                    ))} */}
                    {qualified.map((o) => <Card key = {o.id} office = {o} />)}
                </>
            ) : (
                <p>At the moment there are no offices you can run for</p>
            )}
           
            {/* TODO 5: if districtLater has items, render <h2>Not yet — in your
                districts</h2>, then for each groupByAge(districtLater) bucket render
                an <h3>Eligible at age {age}</h3> followed by its <Card>s.
                Wrap each bucket in <React.Fragment key={age}>. */}
            {/* {districtLater && (
                <>
                    <h2>Must be {districtLater.age} and over</h2>
                     {districtLater.map((o) => <Card key = {o.id} office = {o}/>)}
                </>
            )} */}

                {groupByAge(districtLater).map(({ age, list }) => ( //why do we wrap age and list in a curly brackets, is it becaue groupByAge is returning an object?
                    <React.Fragment key = {age}>
                        <h3>Must be {age} and over</h3>
                        {list.map((o) => <Card key = {o.id} office = {o}/>)}
                    </React.Fragment>
                ))}
            {/* TODO 6: same as 5 for stateLater under <h2>Statewide &amp; national</h2> */}
            {/* {stateLater && (
                <>
                    <h2>Must be {stateLater.age} and over</h2>
                     {stateLater.map((o) => <Card key = {o.id} office = {0}/>)}
                </>
            )} */}
                {groupByAge(stateLater).map(({ age, list }) => ( //why do we wrap age and list in a curly brackets, is it becaue groupByAge is returning an object?
                    <React.Fragment key = {age}>
                        <h3>Must be {age} and over</h3>
                        {list.map((o) => <Card key = {o.id} office = {o}/>)}
                    </React.Fragment>
                ))}
        </div>
    );
}

export default WouldBeRelevant;
