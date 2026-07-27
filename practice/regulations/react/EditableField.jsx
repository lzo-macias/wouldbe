// ============================================================================
// REACT A — EditableField (per-line local state + hover-to-report)
// ----------------------------------------------------------------------------
// This is the star of the component. It wraps ONE displayed line (an h2/h3/p).
// When edit mode is on AND this specific line is hovered, it reveals — to the
// RIGHT of the line — red "edit what's wrong" text + an input; submitting reports
// the issue for that field.
//
// Fill in the TODOs from memory, then diff against the real component at
//   coolpeoplev3-frontend/src/assets/component/Wouldbe/Regulations/Regulations.jsx
//
// CONCEPT CHECK — answer in your head first:
//   • Why is EditableField defined at MODULE scope, not inside Regulations? (Hint:
//     what happens to the <input>'s state/focus every time the parent re-renders
//     if the component is re-created each render?)
//   • Each line needs its OWN hover + message state. Where does that state live —
//     in the parent, or here? Why does putting it HERE mean you don't need an
//     array of hover booleans in Regulations?
//   • `onMouseEnter={() => setHovered(true)}` vs `onMouseEnter={setHovered(true)}`
//     — what does the second one do, and when?
//   • The input is CONTROLLED: `value={message}` + `onChange`. What must the
//     onChange arrow take as its parameter to read `e.target.value`? (The classic
//     bug is writing `onChange={() => setMessage(e.target.value)}` — no `e`.)
//   • The form renders AFTER {children} in a flex row. What flips it to the LEFT?
// ============================================================================

import React, { useState } from "react";

function EditableField({ editing, fieldLabel, onReport, children }) {
    const [hovered, setHovered] = useState(false);
    const [message, setMessage] = useState("");

    function handleSubmit(e) {
        e.preventDefault();
        // TODO: trim message; if empty, bail. Otherwise call
        //   onReport(`${fieldLabel} — ${trimmed}`) and clear the input.
        const trimmed = message.trim()
        onReport(`${fieldLabel} — ${trimmed}`)
        setMessage("")
    }

    return (
        <div
            className="editableField"
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
            // TODO: set hovered true on mouse enter, false on mouse leave
            //       (remember: pass a FUNCTION, not a call)
            onMouseEnter={setHovered(true)}
            onMouseLeave={setHovered(false)}
        >
            {children}
            {/* TODO: only when `editing` AND `hovered`, render a <form onSubmit={handleSubmit}>
                containing:
                  - <span style={{ color: "red" }}>edit what's wrong</span>
                  - a CONTROLLED <input value={message} onChange={(e) => setMessage(e.target.value)} />
                Rendering it AFTER {children} puts it to the RIGHT of the line. */}
            {editing & hovered && (
                <>
                    <form onSubmit={handleSubmit}>
                        <span className="redtext">edit what's wrong</span>
                        <input 
                            className='hoverinput'
                            placeholder="describe the issue"
                            value={message} 
                            onChange={(e) => setMessage(e.target.value)}
                        />
                    </form>
                </>
            )}
        </div>
    );
}

export default EditableField;
