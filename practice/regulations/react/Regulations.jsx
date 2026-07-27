// ============================================================================
// REACT B — Regulations (fetch-on-mount, guarded render, map fields, edit toggle)
// ----------------------------------------------------------------------------
// The shell that ties it together: it receives a loaded `office` + `jurisdiction`
// as props, fetches the office's eligibility on mount, and renders each field
// wrapped in an <EditableField>. One button toggles edit mode (Edit ⇄ Exit).
//
// Fill in the TODOs from memory. Use your capstone view-model logic (problem 08)
// as the mental model for WHICH keys to read.
//
// CONCEPT CHECK — answer first:
//   • The effect fetches `/api/offices/${office.id}/eligibility`. Why the
//     `if (!office?.id) return` guard, and why is `[office?.id]` the dep array?
//     (What broke when the effect had NO deps? What request fired when office was
//     still empty?)
//   • You cannot `await` directly in a useEffect callback. What's the shape that
//     lets you await inside? (Hint: an async function DEFINED then CALLED.)
//   • `filingDeadline` uses `office.deadlines?.find(...)`. What does the `?.` save
//     you from when deadlines is undefined?
//   • The Edit button: `onClick={() => setEditing((v) => !v)}`. Why the functional
//     updater `(v) => !v` instead of `setEditing(!editing)`?
//   • Why does the "sometimes we make mistakes…" helper only show when
//     `!editing` (i.e. NOT in edit mode)?
// ============================================================================

import React, { useEffect, useState } from "react";
import api from "../../../lib/api";           // adjust path if you relocate this
import EditableField from "./EditableField";

// deadline machine-code -> words (raw fallback), shared in the real app.
const DEADLINE_LABELS = {
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
};

const GATING_TYPES = new Set(["filing_close", "petition_filing_deadline"]);

function formatDeadlineDate(value) {
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Regulations({ office, jurisdiction, onComplete }) {
    const [regulations, setRegulations] = useState("");
    const [editing, setEditing] = useState(false);
    const [status, setStatus] = useState("");

    const [allowedHovered, setAllowedHovered] = useState(false)

    useEffect(() => {
        // TODO: guard on office?.id; define an async LoadData() that GETs
        //   /api/offices/${office.id}/eligibility and setRegulations(res.data);
        //   then CALL LoadData(). Dep array: [office?.id].
        async function loadData() {
            const eligibility = await api.get(`/api/offices/${office.id}/eligibility`)
            setRegulations(eligibility?.data ?? null)
        }
        loadData()
    }, [office?.id]);

    async function submitReport(description) {
        // TODO: setStatus("sending"); POST /api/change-reports
        //   { source_url: window.location.href, description }; on success
        //   setStatus("Sent — thanks!"); on error read err.response?.status and
        //   set a friendly message (429 -> rate limited, 400 -> server error text).
        try {
        setStatus("sending")
        const source = window.location.href
        const reportRes = await api.put('/api/change-reports'), {
            source_url: source,
            description: editing
        }
        if (reportRes.data) setStatus("Sent — thanks")
        }catch(err){
            setStatus(err.response?.status)
        }
    }

    // Soonest filing/petition deadline (or undefined). deadlines are pre-sorted.
    const filingDeadline = office.deadlines?.find((d) => GATING_TYPES.has(d.deadline_type));

    return (
        <div className="RegualtionsMainContainer">
            {/* TODO: wrap EACH line in <EditableField editing={editing}
                       fieldLabel="..." onReport={submitReport}> ... </EditableField>.
                Read the RIGHT keys:
                  - <h2>{office.office_name} Regulations</h2>
                  - State:  {jurisdiction.state_code}
                  - Name:   {office.office_name}
                  - Min Age: {regulations.min_age}
                  - Citizenship Required: {regulations.citizenship_requirement}
                  - Jurisdiction type: {jurisdiction.type}
                  - {filingDeadline && (<>{DEADLINE_LABELS[filingDeadline.deadline_type] ?? filingDeadline.deadline_type}
                       : {formatDeadlineDate(filingDeadline.deadline_date)}</>)}
                  - Source: {regulations.eligibility_source_url}
            */}
            <EditableField editing={allowHovered} fieldLabel="Office name" onReport={submitReport}>
                <h2>{office.office_name} Regulations</h2>
            </EditableField>
            <EditableField onReport={submitReport}>
                <h2>{jurisdiction.state_code}</h2>
            </EditableField>
            <EditableField onReport={submitReport}>
                <h2>{office.office_name}</h2>
            </EditableField>
            <EditableField onReport={submitReport}>
                <h2>{office.office_name} Regulations</h2>
            </EditableField>
        
            <button className="continue" onClick={() => onComplete()}>Continue</button>

            <div
                style={{ display: "flex", alignItems: "baseline", gap: "8px" }}
            >
                {/* TODO: Edit/Exit button — onClick toggles `editing` with (v) => !v;
                          label is editing ? "Exit" : "Edit". */}
                <button onClick={setEditing((v) => !v)}>{editing ? "Exit": "Edit"}</button>
                {/* TODO: when NOT editing, a red italic helper <p> to the RIGHT. */}
                <p>{editing ? "" : "RED ITALIC HELPER EDIT!"}</p>
                {status && <p style={{ margin: 0 }}>{status}</p>}
            </div>
        </div>
    );
}

export default Regulations;
