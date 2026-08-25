import React, {useState} from 'react'
import api from '../../../lib/api'
import { DEADLINE_LABELS, formatDeadlineDate } from '../WouldBeRows/deadlineFormat'
import './Regulations.css'

// Wraps one displayed line (h2/h3/p). In edit mode, hovering the line reveals a
// red "edit what's wrong" prompt + input to its LEFT; submitting reports the
// issue for that specific field. Defined at module scope so its local input
// state survives Regulations' re-renders (no remount, no lost focus).
function EditableField({ editing, fieldLabel, onReport, children }) {
    const [hovered, setHovered] = useState(false)
    const [message, setMessage] = useState("")

    function handleSubmit(e) {
        e.preventDefault()
        const trimmed = message.trim()
        if (!trimmed) return
        onReport(`${fieldLabel} — ${trimmed}`)
        setMessage("")
    }

    return (
        <div
            className="editableField"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {children}
            {editing && hovered && (
                <form className="inlineEditForm" onSubmit={handleSubmit}>
                    <span className="redtext" >edit what's wrong</span>
                    <input
                        className='hoverinput'
                        placeholder="describe the issue"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                    />
                </form>
            )}
        </div>
    )
}

function Regulations({office, jurisdiction, onComplete}) {

const sourceUrl =  window.location.href;
const [status, setStatus] = useState("")

const [editBtnHovered, setEditBtnHovered] = useState(false)
const [allowHovered, setallowHovered] = useState(false)

async function submitReport(description){
    setStatus("sending")
    try{
        const res = await api.post("/api/change-reports", {
            source_url: sourceUrl,
            description,
        })
        setStatus("Sent — thanks!")
        return res.data
    }catch(err){
        const code = err.response?.status;
        if (code === 429) setStatus("Too many reports — try again in a minute.");
        else if (code === 400) setStatus(err.response.data.error);
        else setStatus("Something went wrong.");
    }
}

  // Soonest filing/petition deadline — the candidacy-gating one. deadlines are
  // sorted ascending, so find() returns the earliest match (or undefined).
  const filingDeadline = office.deadlines?.find(
    (d) => d.deadline_type === "filing_close" || d.deadline_type === "petition_filing_deadline"
  );

  return (
    <div className='RegualtionsMainContainerTwo'>
        <div className='RegualtionsMainContainer'>
            <EditableField editing={allowHovered} fieldLabel="Office name" onReport={submitReport}>
                <h2>{office.office_name} Regulations</h2>
            </EditableField>
            <div className='regulationsIdentifiers'>
                <EditableField editing={allowHovered} fieldLabel="State" onReport={submitReport}>
                    <h3>State: {jurisdiction.state_code}</h3>
                </EditableField>
                <EditableField editing={allowHovered} fieldLabel="Name" onReport={submitReport}>
                    <h3>Name: {office.office_name}</h3>
                </EditableField>
            </div>
            <div className='regulationsSubContainer'>
                <div>
                    <EditableField editing={allowHovered} fieldLabel="Min age" onReport={submitReport}>
                        <p>Min Age: {office.regulations.min_age}</p>
                    </EditableField>
                    <EditableField editing={allowHovered} fieldLabel="Citizenship required" onReport={submitReport}>
                        <p>Citizenship Required: {office.regulations.citizenship_requirement}</p>
                    </EditableField>
                    {office.regulations.citizenship_requirement == "yes" && (
                        <EditableField editing={allowHovered} fieldLabel="Citizenship years" onReport={submitReport}>
                            <p>must be a citizen for{office.regulations.citizenship_years_required} years</p>
                        </EditableField>
                    )}
                    {office.regulations.residency_requirement == "yes" && (
                        <EditableField editing={allowHovered} fieldLabel="Residency" onReport={submitReport}>
                            <p>{office.regulations.residency_duration} in {jurisdiction.name}</p>
                        </EditableField>
                    )}
                    <EditableField editing={allowHovered} fieldLabel="Jurisdiction type" onReport={submitReport}>
                        <p>Jurisdiction type: {jurisdiction.type}</p>
                    </EditableField>
                    {filingDeadline && (
                        <EditableField editing={allowHovered} fieldLabel="Filing deadline" onReport={submitReport}>
                            <p>{DEADLINE_LABELS[filingDeadline.deadline_type]}: {formatDeadlineDate(filingDeadline.deadline_date)}</p>
                        </EditableField>
                    )}
                    <EditableField editing={allowHovered} fieldLabel="Source" onReport={submitReport}>
                        <p>Source: <a href={office.regulations.eligibility_source_url}>{office.regulations.eligibility_source_url}</a></p>
                    </EditableField>
                </div>
            </div>

        <div
            className='editbutnandtext'
            onMouseEnter={() => setEditBtnHovered(true)}
            onMouseLeave={() => setEditBtnHovered(false)}
        >
            <button className='editbtn' onClick={() => setallowHovered((v) => !v)}>
                {allowHovered ? "Exit" : "Edit"}
            </button>
            {editBtnHovered && !allowHovered && <p className='redtext' >sometimes we make mistakes so if you see something wrong please let us know</p>}
            {status && <p className='reportStatus'>{status}</p>}
        </div>
        </div>
    </div>
  )
}

export default Regulations