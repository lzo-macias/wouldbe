// ============================================================================
// REACT A — StartAnOffice (screen state + ordered load + the gate)
// ----------------------------------------------------------------------------
// The page shell: read :officeId from the URL, load the office + everything that
// hangs off it IN ORDER, stash it in state, and only render the flow once it's
// there. Fill the TODOs from memory, then diff against
//   coolpeoplev3-frontend/src/assets/pages/wouldbe/StartAnOffice.jsx
// Logic drilled in ../01-screen-switch.js and ../02-load-in-order.js.
//
// CONCEPT CHECK — answer first:
//   • Inside loadData, why use the local `office` you just awaited to fetch the
//     jurisdiction, instead of the `individualOffice` state you're about to set?
//     (When does that state actually update?)
//   • The effect depends on [officeId]. What re-runs it, and why is that correct?
//   • `screens` is an object keyed by the screen string. What's the one-line win
//     over a switch statement when you add step 4?
//   • Why gate on `individualOffice ? … : <p>Loading…</p>` instead of rendering
//     the screen immediately? What blows up on the first render without the gate?
// ============================================================================

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../../lib/api";
import StartAWouldBe from "../../component/Wouldbe/StartAWouldBe/StartAWouldBe";
import WouldBeHeader from "../../component/header/WouldBeHeader";

function StartAnOffice() {
    const [screen, setScreen] = useState("1");
    const [individualJurisdiction, setIndividualJurisdiction] = useState(null);
    const [individualOffice, setIndividualOffice] = useState(null);

    const { officeId } = useParams();

    useEffect(() => {
        async function loadData() {
            try {
                // TODO 1: const office = await api.get(`/api/offices/${officeId}`) -> .data
                //         bail if there's no office.
                // TODO 2: using office.jurisdiction_id (NOT state), load the jurisdiction,
                //         then its deadlines (sort ascending by deadline_date),
                //         then the recommended goal, then the eligibility.
                // TODO 3: setIndividualJurisdiction(jurisdiction); and
                //         setIndividualOffice({ ...office, deadlines, goalCents, regulations })
                const officeResult = await api.get(`/api/offices/${officeId}`)
                const office = officeResult.data
                if (!office) return

                // use the LOCAL office (state isn't updated yet within this pass)
                const jurisResult = await api.get(`/api/jurisdictions/${office.jurisdiction_id}`)
                const jurisdiction = jurisResult.data
                if (!jurisdiction) return

                const deadResult = await api.get(`/api/jurisdictions/${office.jurisdiction_id}/deadlines`)
                const sortedDeadlines = [...(deadResult.data ?? [])].sort(
                    (a, b) => a.deadline_date.localeCompare(b.deadline_date)
                )

                const goalResult = await api.get(`/api/offices/${office.id}/recommended-goal`)
                const goalCents = goalResult.data?.recommended_goal_cents ?? null

                const eligResult = await api.get(`/api/offices/${office.id}/eligibility`)
                const eligibility = eligResult.data ?? null

                setIndividualJurisdiction(jurisdiction)
                setIndividualOffice({ ...office, deadlines: sortedDeadlines, goalCents, regulations: eligibility })
            } catch (err) {
                console.error(err);
            }
        }
        loadData();
    }, [officeId]);

    // TODO 4: an object keyed by screen string -> the element to render.

    const screens = {
        "1": <StartAWouldBe office={individualOffice} jurisdiction={individualJurisdiction} />,
        // "2": …, "3": …
    };

    return (
        <div>
            <WouldBeHeader />
            {individualOffice ? screens[screen] : <p>Loading…</p>}
        </div>
    );
}

export default StartAnOffice;
