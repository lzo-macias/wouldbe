// ============================================================================
// REACT D — WouldBeNavHeader (a presentational component + CSS scoping)
// ----------------------------------------------------------------------------
// The simplest of the four: no state, just structure + navigation. The lesson is
// mostly CSS discipline — every selector scoped under `.wbNav` so its button/svg
// resets never leak. Fill the TODOs, diff vs
//   coolpeoplev3-frontend/src/assets/component/header/WouldBeNavHeader.jsx  (+ .css)
// Layout drilled in ../css/07-sticky-clamp-capstone.
//
// CONCEPT CHECK — answer first:
//   • This component holds no state. What makes it "presentational," and why is
//     `onQualifyClick` a prop instead of logic living here?
//   • In JSX, SVG attributes are camelCase: `strokeWidth`, not `stroke-width`.
//     Why? (JSX attributes map to DOM props.) Which attrs stay as-is (viewBox)?
//   • The CSS file scopes everything under `.wbNav`. What breaks elsewhere if you
//     ship a bare `button { … }` reset from a component stylesheet?
//   • `margin-left: auto` on `.wbNav-auth` — what does it do in the flex row?
// ============================================================================

import React from "react";
import { useNavigate } from "react-router-dom";
import "./WouldBeNavHeader.css";

function WouldBeNavHeader({ onQualifyClick }) {
    const navigate = useNavigate();

    return (
        <header className="wbNav">
            <div className="wbNav-inner">
                <div className="wbNav-logo">would be</div>

                <div className="wbNav-search">
                    {/* TODO 1: an inline search SVG — remember camelCase strokeWidth */}
                    Search campaigns &amp; debates
                </div>

                {/* TODO 2: the gold "See what you qualify for" button, onClick={onQualifyClick} */}

                <div className="wbNav-auth">
                    {/* TODO 3: Sign up -> navigate('/signup'); Log in -> navigate('/login') */}
                </div>
            </div>
        </header>
    );
}

export default WouldBeNavHeader;
