// ============================================================================
// REACT A — QualifyForm (controlled inputs + submit + branch)
// ----------------------------------------------------------------------------
// A stripped-down twin of Qualify.jsx. A mock `fakeApi` is provided. Fill in the
// TODOs so the component:
//   1. has four CONTROLLED text inputs: street, city, state, zip
//   2. on submit (preventing the page reload), builds
//        `${street}, ${city}, ${state} ${zip}`
//      and POSTs it to '/api/users/me/jurisdictions/resolve'
//   3. if the response status is 'needs_manual_pin', shows a <p>Drop a pin…</p>
//   4. otherwise GETs '/api/offices/relevant' and calls onQualified(data)
//
// You can't `node` a .jsx file — WRITE it from memory, then compare with the real
// Qualify.jsx and SOLUTIONS.md. The point is the patterns, not running it.
//
// CONCEPT CHECK — answer in your head first:
//   • What makes an input "controlled", and why is `value` + `onChange` a pair?
//   • Why call `e.preventDefault()` in the submit handler?
//   • Why must the awaited work live in a normal async function you CALL, not by
//     making the onSubmit handler itself the effect's async callback?
//   • Why does the office fetch belong in the `else` branch (not before the if)?
// ============================================================================

import React, { useState } from "react";

// ---- mock api -------------------------------------------------------------
const fakeApi = {
    async post(path, body) {
        // pretend the address resolved fine
        return { data: { status: "resolved" }, sentAddress: body.address };
    },
    async get(path) {
        return { data: [{ id: "a", office_name: "Mayor" }] };
    },
};

function QualifyForm({ onQualified }) {
    // TODO 1: one piece of state per field (street, city, state, zip), start ""
    const [street, setStreet] = useState('')
    const [city, setCity] = useState('')
    const [state, setState] = useState('')
    const [zip, setZip] = useState('')

    // TODO 2: a boolean `needsPin` state, start false
    const [needsPin, setNeedsPin] = useState(false)

    //do 

    async function handleSubmit(e) {
        // TODO 3: stop the browser from reloading the page
        e.preventDefault()
        // TODO 4: build the address string from the four fields
        const address = `${street}, ${city}, ${state} ${zip}`
        // TODO 5: await fakeApi.post('/api/users/me/jurisdictions/resolve', { address })
        const result = await fakeApi.post(`/api/users/me/jurisdictions/resolve`, { address })
        // TODO 6: if res.data.status === 'needs_manual_pin' -> setNeedsPin(true) and return
        if (result.data.status === "needs_manual_pin") setNeedsPin(true)
        // TODO 7: else await fakeApi.get('/api/offices/relevant') and
        //         onQualified?.(officesRes.data ?? [])
        else {
            const relevantOffices = await fakeApi.get('/api/offices/relevant')
            onQualified?.(relevantOffices.data ?? []) //how does this line work?
        }
    }

    if (/* TODO 8: needsPin */ needsPin) return <p>Drop a pin on your home to finish.</p>;

    return (
        <form onSubmit={handleSubmit}>
            {/* TODO 9: four controlled <input>s. Each needs value={field} and
                onChange={(e) => setField(e.target.value)} */}
            <label>Street</label>
            <input id = "street" type = "text" value={street} onChange={(e) => setStreet(e.target.value)}/>
            <label>City</label>
            <input id = "city" type = "text" value={city} onChange={(e) => setCity(e.target.value)}/>
            <label>State</label>
            <input id = "state" type = "text" value={state} onChange={(e) => setState(e.target.value)}/>
            <label>Zip</label>
            <input id = "zip" type = "number" value={zip} onChange={(e) => setZip(e.target.value)}/>
            <button type="submit">Find my offices</button>
        </form>
    );
}

export default QualifyForm;
