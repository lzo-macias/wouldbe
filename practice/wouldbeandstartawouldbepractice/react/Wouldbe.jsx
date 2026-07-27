// ============================================================================
// REACT B — Wouldbe (modal + blur composition + rehydrate-with-cancel)
// ----------------------------------------------------------------------------
// The feed page: header + rows, with a Qualify modal that blurs everything behind
// it. On load it re-checks whether the user already resolved their districts and,
// if so, pulls their scoped office list back. Fill the TODOs from memory, diff vs
//   coolpeoplev3-frontend/src/assets/pages/wouldbe/Wouldbe.jsx
// Cancel-flag logic drilled in ../03-cancelled-effect.js.
//
// CONCEPT CHECK — answer first:
//   • The blur is done by toggling a className on the CONTENT wrapper, not by a
//     prop on each child. Why is `className={\`wouldbeContent${open ? ' blurred' : ''}\`}`
//     the whole trick? (What does `.blurred` do in Wouldbe.css — filter + pointer-events?)
//   • Why does the effect declare `let cancelled = false` and return
//     `() => { cancelled = true }`? What bug appears if you setState after the
//     component unmounted mid-fetch?
//   • `!checkingJurisdictions && <WouldBeRows/>` — why wait for that flag instead
//     of rendering WouldBeRows immediately? (What flashes otherwise?)
//   • The modal is a SIBLING of the blurred content, not a child. Why does that
//     matter for the blur not applying to the modal itself?
// ============================================================================

import React, { useState, useEffect } from "react";
import WouldBeHeader from "../../component/header/WouldBeHeader";
import WouldBeRows from "../../component/Wouldbe/WouldBeRows/WouldBeRows";
import Qualify from "../../component/Qualify/Qualify";
import api from "../../lib/api";
import "./Wouldbe.css";

function Wouldbe() {
    const [showQualifyScreen, setShowQualifyScreen] = useState(false);
    const [qualifiedOffices, setQualifiedOffices] = useState(null);
    const [checkingJurisdictions, setCheckingJurisdictions] = useState(true);

    useEffect(() => {
        // TODO 1: declare the cancel flag
        async function rehydrate() {
            try {
                // TODO 2: if logged in, GET /api/users/me/jurisdictions; if the user has any,
                //         GET /api/offices/relevant and setQualifiedOffices(...) — BUT only if
                //         not cancelled.
            } catch (err) {
                console.error(err);
            } finally {
                // TODO 3: if not cancelled, setCheckingJurisdictions(false)
            }
        }
        rehydrate();
        // TODO 4: return a cleanup that flips the cancel flag
    }, []);

    return (
        <div className="wouldbePage">
            {/* TODO 5: wrapper className is "wouldbeContent" plus " blurred" while the modal is open */}
            <div className="wouldbeContent">
                <WouldBeHeader onQualifyClick={() => setShowQualifyScreen(true)} />
                {/* TODO 6: render WouldBeRows only once checkingJurisdictions is false */}
            </div>

            {/* TODO 7: render <Qualify/> (a SIBLING, so it isn't blurred) only while open */}
        </div>
    );
}

export default Wouldbe;
