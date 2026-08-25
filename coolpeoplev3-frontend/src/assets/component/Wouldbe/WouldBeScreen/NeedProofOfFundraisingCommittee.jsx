import React, { useEffect, useState } from 'react'
import api from '../../../lib/api'
import "./NeedProofOfFundraisingCommittee.css"

const COMMITTEE_TYPES = ["principal", "authorized", "joint_fundraising", "leadership_pac"]

// Module scope so its identity is stable across parent renders.
// `key` on the mapped element, and `checked={value === option}` — a single `=`
// is an ASSIGNMENT that returns the option, so every radio read as checked.
const RadioGroup = ({ name, options, onChange, label, value }) => (
    <div className='radiogroup'>
        <legend>{label}</legend>
        <div className='radiogrouplabelandoptions'>
            {options.map((option) => (
                <label key={option} htmlFor={`${name}-${option}`}>
                    <input
                        id={`${name}-${option}`}
                        name={name}            // same name = one group, so they deselect each other
                        type="radio"
                        value={option}
                        onChange={() => onChange(option)}
                        checked={value === option}
                    />
                    {option.replaceAll("_", " ")}
                </label>
            ))}
        </div>
    </div>
)

// office and race come from AnyWouldBe — a wouldbe row has office_id and race_id
// but NOT office_name, jurisdiction_id or election_cycle (that route does no
// joins). Passed in rather than refetched so the page makes one request, not two.
function NeedProofOfFundraisingCommittee({ wouldbe, office, race }) {
    // null while loading — `{}` would let the render read undefined fields and
    // look like real "no authority found" data.
    const [authority, setAuthority] = useState(null)
    const [loadError, setLoadError] = useState(null)

    const [committeeType, setCommitteeType] = useState("principal")   // the right default for a candidate's own committee
    const [committeeName, setCommitteeName] = useState("")
    const [treasurerName, setTreasurerName] = useState("")
    const [isSelfTreasurer, setIsSelfTreasurer] = useState(false)
    const [file, setFile] = useState(null)

    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState(null)
    const [submitted, setSubmitted] = useState(false)

    // jurisdiction_id comes off the OFFICE, which is why this waits for it —
    // reading it off `wouldbe` produced `jurisdictionId=undefined` in the URL.
    useEffect(() => {
        const jurisdictionId = office?.jurisdiction_id
        if (!jurisdictionId) return
        let cancelled = false

        async function loadData() {
            // Clear the previous attempt's error. Without this a failure is
            // STICKY: the effect re-runs when office resolves, succeeds, sets
            // authority — but the old message is still on screen underneath,
            // so a working lookup still reads "we don't have instructions".
            setLoadError(null)
            try {
                // await — without it `data` is undefined off a Promise and the
                // next render throws on authority.authority_level.
                const { data } = await api.get(
                    `/api/filing-authorities/for?jurisdictionId=${jurisdictionId}&officeId=${wouldbe.office_id}`
                )
                if (cancelled) return
                console.log("[NeedProof] filing authority", data)
                setAuthority(data)
            } catch (err) {
                if (cancelled) return
                console.error("[NeedProof] load failed", err)
                setLoadError(
                    err.response?.status === 404
                        ? "We don't have filing instructions for this office yet."
                        : "Couldn't load filing instructions."
                )
            }
        }

        loadData()
        return () => { cancelled = true }
    }, [office?.jurisdiction_id, wouldbe?.office_id])

    async function handleSubmit(e) {
        e.preventDefault()                    // `e` has to be a PARAMETER — it was referenced but never declared
        setSubmitError(null)

        if (!committeeName.trim()) return setSubmitError("Enter the committee name exactly as you registered it")
        if (!file) return setSubmitError("Attach your filing receipt")
        // office is a prop and may still be loading — the POST reads
        // office.jurisdiction_id and office.office_name, both of which are
        // required by createCandidateCommittee.
        if (!office?.jurisdiction_id) return setSubmitError("Still loading office details — try again in a moment")

        setSubmitting(true)
        try {
            // 1. presigned PUT. PDFs go up as-is; re-encoding one through a canvas
            //    would destroy it.
            const { data: presigned } = await api.post("/api/committees/receipt-upload-url", {
                contentType: file.type,
            })
            if (file.size > presigned.maxBytes) throw new Error("That file is too large")

            // 2. bare fetch, not `api` — the presigned URL is R2's origin and our
            //    Authorization header must not be sent to a third party.
            const put = await fetch(presigned.uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
            })
            if (!put.ok) throw new Error(`Upload failed (${put.status})`)

            // 3. office_id + race_id are what make this committee count for THIS
            //    WouldBe — hasActiveVerifiedCommittee matches on them, and
            //    office_sought is a free-text label that cannot be matched on.
            const { data } = await api.post("/api/committees", {
                jurisdiction_id: office.jurisdiction_id,
                office_id: wouldbe.office_id,
                race_id: wouldbe.race_id,
                cycle_year: race?.election_cycle ?? new Date().getFullYear(),
                filing_authority_id: authority?.id ?? null,
                committee_name: committeeName.trim(),
                committee_type: committeeType,
                office_sought: office.office_name,
                treasurer_name: treasurerName.trim() || null,
                is_self_treasurer: isSelfTreasurer,
                treasurer_relationship: isSelfTreasurer ? "self" : null,
                filed_at: new Date().toISOString().slice(0, 10),   // DATE column — send YYYY-MM-DD, never a Date
                filing_receipt_object_key: presigned.objectKey,
            })
            console.log("[NeedProof] committee created", data.id, data.registration_status)
            setSubmitted(true)
        } catch (err) {
            console.error("[NeedProof] submit failed", err)
            setSubmitError(err.response?.data?.error || err.message || "Could not submit that")
        } finally {
            setSubmitting(false)
        }
    }

    if (submitted) {
        return (
            <div className="needProofPanel">
                <h3>Committee received</h3>
                <p>We've got your filing receipt. Your campaign can go live once it's reviewed.</p>
            </div>
        )
    }

    return (
        <div className="needProofPanel">
            <div>
                <h3 className='MissingFundraisingCommittee'>Registered Fundraising Committee Still Missing!</h3>
                <p className = 'missingFundraisingDescriptor'>
                    Before you can publicly display a WouldBe we need to see proof of a registered
                    fundraising committee — they're usually free and quick to file.
                </p>
            </div>

            {loadError && <p className="needProofError">{loadError}</p>}

            {/* `authority &&` — without it the first render reads fields off null */}
            {authority && (
                <div>
                    <div>
                        <span>Authority: </span>
                        <span>{authority.authority_name} ({authority.authority_level})</span>
                    </div>
                    <div>
                        <div className = 'WheretoFileContainer'>
                            <div>
                                <span>Where to file: </span>
                                <p><small>Sometimes we get this wrong — please double-check before filing.</small></p>
                            </div>
                            <a href={authority.registration_portal_url} target="_blank" rel="noreferrer">
                                {authority.registration_portal_url}
                            </a>
                        </div>
                    </div>
                    {/* {authority.how_to_file_url && (
                        <a href={authority.how_to_file_url} target="_blank" rel="noreferrer">How to file</a>
                    )}
                    {authority.treasurer_guide && <p><small>{authority.treasurer_guide}</small></p>} */}
                </div>
            )}

            <h3>When you're done, fill this out</h3>

            {/* onSubmit belongs on the FORM — buttons don't fire onSubmit */}
            <form className = "formLargeContainer" onSubmit={handleSubmit}>
                <RadioGroup
                    name="committee_type"
                    options={COMMITTEE_TYPES}
                    onChange={setCommitteeType}
                    label="Committee Type"
                    value={committeeType}
                />

                <div className='labelAndinput'>
                    <label htmlFor="committee_name">Committee Name</label>
                    <input
                        id="committee_name"
                        type="text"
                        value={committeeName}
                        onChange={(e) => setCommitteeName(e.target.value)}   // was e.value.target
                        placeholder="Exactly as you registered it"
                    />
                </div>

                {/* <div>
                    <label htmlFor="treasurer_name">Treasurer Name</label>
                    <input
                        id="treasurer_name"
                        type="text"
                        value={treasurerName}
                        onChange={(e) => setTreasurerName(e.target.value)}
                    />
                    <label htmlFor="self_treasurer">
                        <input
                            id="self_treasurer"
                            type="checkbox"
                            checked={isSelfTreasurer}
                            onChange={(e) => setIsSelfTreasurer(e.target.checked)}
                        />
                        I'm serving as my own treasurer
                        {authority?.candidate_may_self_treasure === false &&
                            <small> — {authority.authority_name} may not allow this</small>}
                        {authority?.candidate_may_self_treasure == null &&
                            <small> — confirm with your filing authority</small>}
                    </label>
                </div> */}

                <div>
                    <label htmlFor="receipt">Fundraising Committee Receipt</label>
                    <p><small>When you file, take a screenshot or download the PDF receipt.</small></p>
                    <input
                        id="receipt"
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    {file && <p><small>{file.name}</small></p>}
                </div>

                {submitError && <p className="needProofError">{submitError}</p>}

                <div className='buttoncontainer'>
                    <button className = "SubmitButton" type="submit" disabled={submitting}>
                        {submitting ? "Submitting…" : "Submit Committee"}
                    </button>
                </div>
            </form>
        </div>
    )
}

export default NeedProofOfFundraisingCommittee
