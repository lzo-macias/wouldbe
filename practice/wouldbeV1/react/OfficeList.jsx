// ============================================================================
// PROBLEM 07 — Put it all together in a React component (useState + useEffect)
// ----------------------------------------------------------------------------
// This is a stripped-down twin of WouldBeRows. There's no backend here — a mock
// `fakeApi` is provided. Fill in every TODO so the component:
//   1. starts in a loading state
//   2. on mount, fetches offices + recommendations IN PARALLEL
//   3. tallies recommendations per office (reuse your Problem 01 logic)
//   4. sorts offices by that count, descending (reuse Problem 03 logic)
//   5. renders "Loading…" first, then one <li> per office:
//         "<office_name> — <count> recs"
//
// You can't "run" this file directly (it's JSX). To actually see it, drop it
// into your frontend and render <OfficeList />. But the point is to WRITE it
// from memory — compare against WouldBeRows.jsx and SOLUTIONS.md when done.
//
// CONCEPT CHECK — answer these in your head before coding:
//   • Why does `useState(true)` for loading, but `useState([])` for offices?
//   • Why is the dependency array `[]` and not omitted? What changes if you omit it?
//   • Why must the async work live in a function DECLARED INSIDE useEffect,
//     instead of making the useEffect callback itself async?
//   • Why does each <li> need a `key`?
// ============================================================================

import React, { useState, useEffect } from "react";

// ---- mock api (pretend this is your real `api` instance) -------------------
const fakeApi = {
    get(path) {
        const table = {
            "/offices": [
                { id: "a", office_name: "Mayor" },
                { id: "b", office_name: "Assessor" },
                { id: "c", office_name: "Council" },
            ],
            "/recs": [
                { office_id: "a" }, { office_id: "a" }, { office_id: "c" },
            ],
        };
        return new Promise((resolve) => setTimeout(() => resolve({ data: table[path] }), 20));
    },
};

function OfficeList() {
    // TODO 1: two pieces of state — offices (start []) and loading (start true)

    useEffect(() => {
        async function load() {
            try {
                // TODO 2: fetch "/offices" and "/recs" in parallel with Promise.all,
                //         destructure, and pull .data off each (default to []).

                // TODO 3: build a counts object: office_id -> number of recs

                // TODO 4: make a sorted copy of offices by counts[o.id] desc.
                //         (attach the count so the render can show it, e.g. { ...o, count })

                // TODO 5: setOffices(...) with the sorted+counted list
            } catch (err) {
                console.error(err);
            } finally {
                // TODO 6: turn loading off (runs on success AND error)
            }
        }
        load();
    }, []); // <-- empty deps = run once on mount

    // TODO 7: if loading, return <p>Loading…</p>

    // TODO 8: return a <ul> with one <li key={...}> per office showing
    //         "<office_name> — <count> recs"
    return null;
}

export default OfficeList;
