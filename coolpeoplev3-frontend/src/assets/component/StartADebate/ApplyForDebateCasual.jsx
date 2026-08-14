import React, { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import api from "../../lib/api"
import PrizeAgreementStep from "./PrizeAgreementStep"
import "./ApplyForDebateCasual.css"
import { createPortal } from "react-dom"

// DAY_MS and fmtDate lived here to derive each prompt's open/close window.
// Prompts have no dates any more — the livestream is the only scheduled thing —
// so both are gone. PROMPT_KINDS went with them: the type selector was never
// exposed and every prompt goes in as "response".

const FREE_ENTRY_TIP =
    "Nominated competitors can enter without paying. Turning this off makes the debate paid-entry only, which excludes entrants in AZ, AR, CO, CT, IA, MD, ND, NE, TN, and VT."

const VOTE_TYPE_TIP =
    "Hybrid: the platform votes a top ten, then you pick the winner. General vote: the platform picks the top ten and the winner."

const CATEGORIES = ["Politics"]

//politics, fashion, other

// The judging rubrics used to live here as three hardcoded arrays. They now come
// from GET /api/category-criteria, because the backend copies those same rows onto
// the debate at creation time — a bundled copy could silently disagree with what
// the debate actually publishes to its entrants. See the `rubrics` state below.

// Pull the item out of `from`, splice it back in at `to`. Everything between
// shifts by one on its own — this IS the renumbering. No order is ever stored.
const move = (arr, from, to) => {
    const next = [...arr]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
}

// `key` is a client-only identity so React (and the drag handler) can tell rows
// apart while they move around. It gets stripped before POSTing — the server
// assigns the real id.
const newPrompt = () => ({
    key: crypto.randomUUID(),
    prompt_type: "response",
    body: "",
})

// A judge nomination row. Same client-only `key` trick as prompts, and `links`
// starts with ONE empty string so the form always shows one link box to type in.
// Links are plain strings in an array — position is their only identity, which is
// why the link inputs are keyed by index (they never reorder; see the note there).
const newJudge = () => ({
    key: crypto.randomUUID(),
    email: "",
    qualification: "",
    links: [""],
})

// Strips "$" and "," so "$5,000" still does arithmetic. Returns 0 on junk.
const toNumber = (v) => {
    const n = Number(String(v).replace(/[^0-9.]/g, ""))
    return Number.isFinite(n) ? n : 0
}

const usd = (n) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })

// Criterion weights arrive as numeric(4,3) fractions, and pg returns numerics as
// STRINGS ("0.250") to avoid float precision loss — hence the Number() before the
// arithmetic. 0.250 -> "25%".
const pct = (fraction) => `${Math.round(Number(fraction) * 100)}%`

// Hover tooltip — a dumb bubble, no state of its own.
// The CALLER owns the hover state and decides whether to mount this at all
// (`{winByHover && <HoverTip .../>}`). One gate, one owner: a second gate in here
// would be false on mount, so the bubble would never appear.
//
// Declared at module scope, not inside ApplyForDebateCasual: a component defined
// inside another is a new type every render, so React remounts it and any input
// under it loses focus mid-keystroke.
const HoverTip = ({ message }) => (
    <div className="hoverTipWrapper" role="tooltip">
        <p>{message}</p>
    </div>
)

// A "?" affordance that owns its own hover state, so each tip is independent.
const TipMark = ({ message }) => {
    const [open, setOpen] = useState(false)
    return (
        <span
            className="hoverTipAnchor"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
        >
            <button type="button" className="tipMark" aria-label="What's this?">?</button>
            {open && <HoverTip message={message} />}
        </span>
    )
}

// A radio group. Wrapping the options in role="radiogroup" + aria-labelledby
// gives screen readers the group name — a bare <label> next to the pills
// labels nothing.
const RadioGroup = ({ id, label, options, value, onChange, tip, children }) => (
    <div className="radioOtionInputAndLabel">
        <span className="rowLabel" id={`${id}-label`}>{label}</span>
        <div className="radioRow">
            <div className="radios" role="radiogroup" aria-labelledby={`${id}-label`}>
                {options.map((opt) => (
                    <label className="radiolable" key={opt.value} htmlFor={`${id}-${opt.value}`}>
                        <input
                            type="radio"
                            id={`${id}-${opt.value}`}
                            name={id}
                            value={opt.value}
                            checked={value === opt.value}
                            onChange={() => onChange(opt.value)}
                        />
                        {opt.label}
                    </label>
                ))}
                {children}
            </div>
            {tip && <TipMark message={tip} />}
        </div>
    </div>
)

//we are practcing useref and portal to manipulate the JSX with these pop ups
const PracticePop = ({message, children}) => {
    const [hovered, setHovered] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0})
    const wrapRef = useRef(null);
    const closeTimer = useRef(null);


    function openPopUp () {
        clearTimeout(closeTimer.current); //removes the timeout with teh closeTimer ID
        const rect = wrapRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2})
        setHovered(true)
    }

    function scheduleClose() {
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setHovered(false), 120)
    }

    useEffect(() => () => clearTimeout(closeTimer.current), [])

    useEffect(() => {
    if (!hovered) return
    const close = () => setHovered(false)
    // capture:true — scroll events from nested scroll containers don't bubble,
    // but a capturing listener on window still sees them.
    window.addEventListener("scroll", close, { passive: true, capture: true })
    window.addEventListener("resize", close)
    return () => {
        window.removeEventListener("scroll", close, { capture: true })
        window.removeEventListener("resize", close)
    }
}, [hovered])

    return (
        <>
            <div
                ref = {wrapRef}
                className="hoverTipAnchor"
                onMouseEnter = {openPopUp}
                onMouseLeave = {scheduleClose}
                onFocus = {openPopUp}
                onBlur = {scheduleClose}
            >
                {children}

                {hovered && createPortal (
                    <div
                        className="practicePop"
                        role = "tooltip"
                        style = {{ top: pos.top, left: pos.left }}
                    >
                        <p>{message}</p>
                    </div>,
                document.body 
                )}
            </div>
        </>
    )
}



// Prompts are TEXT and ORDER, nothing else. They used to carry a title, an
// example video and a derived open/close window; the debate's only scheduled
// event is now the livestream, so a prompt is just the question and where it
// sits in the sequence. Position is still the only thing that stores order.
const RenderPrompts = ({ prompts, setPrompts }) => {
    // A ref, not state: a state update mid-drag re-renders and cancels the gesture.
    const dragFrom = useRef(null)

    const patch = (i, field, value) =>
        setPrompts(prompts.map((p, j) => (j === i ? { ...p, [field]: value } : p)))

    const remove = (i) => setPrompts(prompts.filter((_, j) => j !== i))

    const handleDrop = (to) => {
        const from = dragFrom.current
        dragFrom.current = null
        if (from === null || from === to) return
        setPrompts(move(prompts, from, to))
    }

    return (
        <div className="promptRail">
            {prompts.map((p, i) => {
                // Derived from position, never stored.
                const promptOrder = i + 1

                return (
                    <div
                        key={p.key}
                        className="promptContainer"
                        data-n={promptOrder}
                        // Required: the default is to REJECT the drop, so without
                        // preventDefault onDrop silently never fires.
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(i)}
                    >
                        <div className="promptHead">
                            {/* draggable goes on the handle, not the row — a draggable
                                row means you can't click into its own inputs. */}
                            <span
                                className="dragHandle"
                                draggable
                                title="Drag to reorder"
                                onDragStart={() => { dragFrom.current = i }}
                                onDragEnd={() => { dragFrom.current = null }}
                            >⠿</span>

                            <span className="promptWindow">Prompt {promptOrder}</span>

                            <button
                                type="button"
                                className="deletepromptbutton"
                                aria-label={`Remove prompt ${promptOrder}`}
                                onClick={() => remove(i)}
                            >×</button>
                        </div>

                        <div className="promptContainerList">
                            <label htmlFor={`body-${p.key}`}>Prompt</label>
                            <textarea
                                id={`body-${p.key}`}
                                value={p.body}
                                onChange={(e) => patch(i, "body", e.target.value)}
                                placeholder="What are competitors responding to?"
                            />
                        </div>
                    </div>
                )
            })}

            <button
                type="button"
                className="addPromptButton"
                onClick={() => setPrompts([...prompts, newPrompt()])}
            >
                + Add prompt
            </button>
        </div>
    )
}

function ApplyForDebateCasual() {
    const [title, setTitle] = useState("")
    // `category` holds the checked radio ("Business" | … | "other"); the free
    // text lives separately so typing in it can't uncheck the "other" radio.
    const [category, setCategory] = useState("")
    const [customCategory, setCustomCategory] = useState("")
    const [prizeAmt, setPrizeAmt] = useState("")
    // 'cash' | 'non_cash' | 'both'. Three-way rather than a boolean because a
    // prize can genuinely be money AND something else, and the winner is owed
    // both halves — a boolean would leave one of them unrecorded.
    const [prizeType, setPrizeType] = useState("cash")
    const [prizeDesc, setPrizeDesc] = useState("")
    const wantsCash = prizeType === "cash" || prizeType === "both"
    const wantsOther = prizeType === "non_cash" || prizeType === "both"
    // Even numbers only; the stepper below moves by two.
    const [maxContestants, setMaxContestants] = useState(16)
    // Maps straight onto debates.participation_type, which already has these
    // exact values — no translation layer, no third state invented here.
    const [participation, setParticipation] = useState("open")
    const [entryAmt, setEntryAmt] = useState("")
    const [freeEntry, setFreeEntry] = useState(true)
    const [voteType, setVoteType] = useState("")
    // The debate's ONE date: when it streams. The Twitch channel and the seat
    // count are NOT collected here — connecting a channel is an OAuth round-trip,
    // so it happens on its own screen after the draft is safely saved.
    const [startDate, setStartDate] = useState("")

    const [prompts, setPrompts] = useState([newPrompt()])

    // The judge panel. Only sent (and only required) when the debate is hybrid —
    // a hybrid debate is decided by these people, so the backend rejects a hybrid
    // submission with an empty panel. Kept in state unconditionally so switching
    // to General vote and back doesn't discard what was already typed.
    const [judges, setJudges] = useState([newJudge()])
    const needsJudges = voteType === "hybrid"

    // The pre-disclosed judging rubrics, keyed by category. Fetched, not
    // hardcoded: the backend copies these same rows onto the debate at creation
    // (category_judging_criteria -> debate_judging_criteria), so a rubric baked
    // into this bundle could disagree with what the debate actually publishes.
    // Shape: { Business: [{ display_name, description, weight }, …], … }
    const [rubrics, setRubrics] = useState({})

    const [error, setError] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(null)
    // Connecting Twitch and paying now live on their own route
    // (/startadebate/:debateId/twitch) — the OAuth handoff leaves the site, so
    // that step needs a URL it can come back to. This form's job ends once the
    // draft is saved and the prize agreement is signed.
    const navigate = useNavigate()

    // Public endpoint — criteria that need a login to read aren't pre-disclosed.
    // `cancelled` guards the setState: if the sponsor navigates away before the
    // response lands, writing to an unmounted component's state is a leak.
    useEffect(() => {
        let cancelled = false
        api.get("/api/category-criteria")
            .then(({ data }) => { if (!cancelled) setRubrics(data || {}) })
            .catch(() => { if (!cancelled) setRubrics({}) })
        return () => { cancelled = true }
    }, [])

    // --- judge panel mutators, all immutable so React sees a new array --------
    // Same shape as `patch` on the prompt rows: map, replace the one that
    // matches, hand every other row back by reference.
    const patchJudge = (i, field, value) =>
        setJudges(judges.map((j, n) => (n === i ? { ...j, [field]: value } : j)))

    // The link list is nested one level deeper, so the row itself has to be
    // copied too — mutating `j.links[k]` in place would edit state directly and
    // the re-render would never happen.
    const patchLink = (i, k, value) =>
        setJudges(judges.map((j, n) => (
            n === i ? { ...j, links: j.links.map((l, m) => (m === k ? value : l)) } : j
        )))

    const addLink = (i) =>
        setJudges(judges.map((j, n) => (n === i ? { ...j, links: [...j.links, ""] } : j)))

    // Never drop to zero link rows: the row IS the input, so removing the last
    // one would leave no way to type a link. Clear it instead.
    const removeLink = (i, k) =>
        setJudges(judges.map((j, n) => (
            n === i
                ? { ...j, links: j.links.length > 1 ? j.links.filter((_, m) => m !== k) : [""] }
                : j
        )))

    const addJudgeRow = () => setJudges([...judges, newJudge()])
    const removeJudgeRow = (i) => setJudges(judges.filter((_, n) => n !== i))

    // `<input type="date">` gives 'YYYY-MM-DD' with no zone at all. It is sent
    // as that exact string — the server anchors it to midday UTC so the calendar
    // day survives the trip. Parsing it here with new Date() would read it as
    // midnight UTC, which is the previous evening in every US timezone.
    const todayStr = new Date().toLocaleDateString("en-CA")   // 'YYYY-MM-DD', local

    // The 10%-of-prize platform fee is gone — the platform charges a flat host
    // fee for entry capacity instead (HostTierStep), which the sponsor pays after
    // submitting. The prize is theirs to award and is not collected here.
    const entryNet = toNumber(entryAmt)

    // One POST for the whole draft. The debate row, its sponsor row and every
    // prompt are written in a single backend transaction, so a half-saved
    // application is impossible.
    const onSubmit = async (e) => {
        e.preventDefault()
        setError(null)

        // Fail before the network call on anything the backend would 400 on.
        if (!title.trim()) return setError(new Error("Give your debate a title"))
        if (!voteType) return setError(new Error("Pick how the debate is won"))
        // Whichever halves the prize has must actually be filled in. The server
        // enforces the same shape, and the DB has a CHECK on the combination.
        if (wantsCash && toNumber(prizeAmt) <= 0) {
            return setError(new Error("Enter the cash prize amount"))
        }
        if (wantsOther && !prizeDesc.trim()) {
            return setError(new Error("Describe what the winner receives"))
        }
        const maxN = Number(maxContestants)
        if (!Number.isInteger(maxN) || maxN < 2 || maxN % 2 !== 0) {
            return setError(new Error("Max contestants must be an even number, 2 or more"))
        }
        if (prompts.length === 0) return setError(new Error("Add at least one prompt"))
        const blank = prompts.findIndex((p) => !p.body.trim())
        if (blank !== -1) return setError(new Error(`Prompt ${blank + 1} needs a body`))

        // The start date is when the debate streams, so it isn't optional.
        // String compare, not Date math: both sides are 'YYYY-MM-DD', which
        // sorts lexicographically, and no timezone gets involved.
        if (!startDate) return setError(new Error("Pick the debate's start date"))
        if (startDate < todayStr) return setError(new Error("The start date is in the past"))

        // The backend enforces all of this too — these checks exist so the
        // sponsor doesn't have to round-trip to find out.
        if (needsJudges) {
            const filled = judges.filter((j) => j.email.trim() || j.qualification.trim())
            if (filled.length === 0) {
                return setError(new Error("A hybrid debate is decided by judges — add at least one"))
            }
            const noEmail = filled.findIndex((j) => !j.email.trim())
            if (noEmail !== -1) return setError(new Error(`Judge ${noEmail + 1} needs an email`))
            const noWhy = filled.findIndex((j) => !j.qualification.trim())
            if (noWhy !== -1) return setError(new Error(`Judge ${noWhy + 1} needs a note on why they're qualified`))
        }

        setSubmitting(true)
        try {
            // Strip the client-only `key` and the File handle — the server assigns
            // real ids, and video files upload separately to R2 before this runs.
            // Array position becomes prompt_order on the backend.
            const { data } = await api.post("/api/debate-applications", {
                title: title.trim(),
                category,
                custom_category: customCategory,
                win_type: voteType,
                prize_type: prizeType,
                // Only the halves this prize actually has are sent. The other
                // stays undefined rather than empty, so the server reads a clean
                // shape instead of "" vs null ambiguity.
                prize_amount: wantsCash ? prizeAmt : undefined,
                prize_description: wantsOther ? prizeDesc.trim() : undefined,
                max_contestants: Number(maxContestants) || undefined,
                participation_type: participation,
                entry_amount: entryAmt,
                free_entry: freeEntry,
                // The debate's schedule. The channel and seat count are attached
                // on the next screen, so the stream row lands with a date and no
                // destination yet.
                stream: { scheduled_at: startDate },
                // Text and position only: no title, no example video, no dates.
                prompts: prompts.map((p) => ({
                    prompt_type: p.prompt_type,
                    body: p.body,
                })),
                // Only a hybrid debate has a panel. `key` is stripped like the
                // prompts', and empty link rows are dropped here so an untouched
                // link box doesn't reach the server as "".
                judges: needsJudges
                    ? judges
                          .filter((j) => j.email.trim())
                          .map((j) => ({
                              email: j.email.trim(),
                              qualification: j.qualification.trim(),
                              links: j.links.map((l) => l.trim()).filter(Boolean),
                          }))
                    : undefined,
            })
            setSubmitted(data)
        } catch (err) {
            console.error(err)
            // axios puts the server's {error} payload on err.response.data.
            setError(new Error(err.response?.data?.error || err.message || "Submission failed"))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="applyPage">
            <p className="eyebrow">Apply to host</p>
            <h1 className="pageTitle">Casual</h1>
            <p className="pageLede">
                For debates and competitions among friends, or open to the whole web.
                Set the terms below and we'll review it before it goes live.
            </p>

            <p className="pageLede">
                Users will nominate each other the top contestants with the most nominations will enter to compete in the debate on livestream.
            </p>

            {/* One form, not two. The old split meant the debate fields lived in a
                form with no submit button while the prompts form owned submission —
                it worked because state is lifted, but Enter in a title field did
                nothing and native validation could never see half the fields. */}
            <form className="applyForm" onSubmit={onSubmit}>

                <div className="sectionHead">
                    <h2>The debate</h2>
                    <span className="rule" />
                </div>

                <div className="formContainer">

                    <div className="regularLabelAndInput">
                        <label htmlFor="title">Title</label>
                        <div className="fieldStack">
                            <input
                                id="title"
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Would be the best president?"
                            />
                            <span className="hint1">What competitors and voters see first.</span>
                        </div>
                    </div>

                    <div className="regularLabelAndInput">
                        <label htmlFor={wantsCash ? "prizeAmt" : "prizeDesc"}>Prize</label>
                        <div className="fieldStack">
                            {/* The toggle owns which inputs EXIST, not just which
                                are visible. A hidden-but-mounted field keeps its
                                value and would still be read at submit, so
                                switching away from cash could quietly send an
                                amount the sponsor no longer intends. */}
                            <div className="prizeToggleRow" role="group" aria-label="Prize type">
                                {[
                                    ["cash", "Cash prize"],
                                    ["non_cash", "Something else"],
                                    ["both", "Both"],
                                ].map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`segButton${prizeType === value ? " segButtonOn" : ""}`}
                                        aria-pressed={prizeType === value}
                                        onClick={() => setPrizeType(value)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {wantsCash && (
                                <>
                                    <input
                                        id="prizeAmt"
                                        className="wMd"
                                        type="text"
                                        inputMode="decimal"
                                        value={prizeAmt}
                                        onChange={(e) => setPrizeAmt(e.target.value)}
                                        placeholder="$500"
                                    />
                                    {!wantsOther && (
                                        <span className="hint">
                                            You'll sign an agreement to deliver this to the winner
                                            after you submit.
                                        </span>
                                    )}
                                </>
                            )}

                            {wantsOther && (
                                <>
                                    <input
                                        id="prizeDesc"
                                        type="text"
                                        value={prizeDesc}
                                        onChange={(e) => setPrizeDesc(e.target.value)}
                                        placeholder="A 3-month internship, studio time, a feature slot…"
                                        maxLength={500}
                                    />
                                    <span className="hint">
                                        {wantsCash
                                            ? "What the winner receives in addition to the cash."
                                            : "Describe what the winner receives."}{" "}
                                        You'll sign an agreement to deliver it after you submit.
                                    </span>
                                </>
                            )}
                            {/* {prizeAmt && (
                                <>
                                <div className="hintAndPop">
                                    <span className="hint">
                                        You award this to the winner. Separately, a{" "}
                                        <strong>one-time host fee</strong> covers your video-entry
                                        capacity — you pick that plan after submitting.
                                    </span>
                                    <PracticePop
                                        message = "The host fee is a flat charge for the number of video entries your debate can take — $10 for 100, $50 for 1,000, $100 for 10,000. It is not a cut of your prize."
                                    >
                                        <button type = "button" className = "tipMarkV2" aria-label="What's this?">?</button>
                                    </PracticePop>
                                </div>
                                </>
                            )} */}
                        </div>
                    </div>

                    <div className="regularLabelAndInput">
                        <label htmlFor="maxContestants">Max contestants</label>
                        <div className="inputandCanBeChangedLater">
                            {/* step=2 covers the arrows and the keyboard, but a
                                typed odd number would still pass, so the value is
                                snapped to even on change and the server rejects
                                odd regardless. */}
                            <input
                                id="maxContestants"
                                className="wMd"
                                type="number"
                                min="2"
                                step="2"
                                value={maxContestants}
                                onChange={(e) => {
                                    const n = Number(e.target.value)
                                    if (!Number.isFinite(n)) return setMaxContestants("")
                                    setMaxContestants(Math.max(2, Math.round(n / 2) * 2))
                                }}
                            />
                            <span className="hint">Even numbers only, so the bracket halves cleanly.</span>
                        </div>
                    </div>

                    <div className="regularLabelAndInput">
                        <span className="rowLabel" id="participation-label">Who can enter</span>
                        <div className="fieldStack">
                            <div className="prizeToggleRow" role="group" aria-labelledby="participation-label">
                                <button
                                    type="button"
                                    className={`segButton${participation === "open" ? " segButtonOn" : ""}`}
                                    aria-pressed={participation === "open"}
                                    onClick={() => setParticipation("open")}
                                >
                                    Open to all
                                </button>
                                <button
                                    type="button"
                                    className={`segButton${participation === "invitation_only" ? " segButtonOn" : ""}`}
                                    aria-pressed={participation === "invitation_only"}
                                    onClick={() => setParticipation("invitation_only")}
                                >
                                    Invite only
                                </button>
                            </div>
                            <span className="hint">
                                {participation === "open"
                                    ? "Anyone eligible can be nominated to enter up to the cap."
                                    : "Only competitors you invite can enter."}
                            </span>
                        </div>
                    </div>

                    <RadioGroup
                        id="category"
                        label="Category"
                        value={category}
                        onChange={setCategory}
                        options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                    >
                        {category === "other" && (
                            <input
                                className="otherinput"
                                type="text"
                                aria-label="Custom category"
                                value={customCategory}
                                onChange={(e) => setCustomCategory(e.target.value)}
                                placeholder="Name it"
                            />
                        )} 
                        {rubrics[category] && (
                            <div className="rubric">
                                <div className="rubricHead">
                                    <h3>Criteria</h3>
                                    <p>users will agree to this criteria before participating and voting</p>
                                </div>
                                <ul className="rubricList">
                                    {rubrics[category].map((item) => (
                                        <li className="rubricRow" key={item.criterion_key}>
                                            <div className="rubricText">
                                                <h4>{item.display_name}</h4>
                                                <p>{item.description}</p>
                                            </div>
                                            {/* weight is stored as a fraction (0.250) and
                                                displayed as a percent. */}
                                            <span className="rubricWeight">{pct(item.weight)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </RadioGroup>

                    

                    {/* <RadioGroup
                        id="freeEntry"
                        label="Free entry"
                        value={freeEntry ? "yes" : "no"}
                        onChange={(v) => setFreeEntry(v === "yes")}
                        options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                        tip={FREE_ENTRY_TIP}
                    /> */}

                    {/* <div className="regularLabelAndInput">
                        <label htmlFor="entryAmt">Entry fee</label>
                        <div className="fieldStack">
                            <input
                                id="entryAmt"
                                className="wMd"
                                type="text"
                                inputMode="decimal"
                                value={entryAmt}
                                onChange={(e) => setEntryAmt(e.target.value)}
                                placeholder="$5"
                            />
                            {entryAmt && (
                                <>
                                    <span className="hint">
                                        You receive <strong>{usd(entryNet)}</strong> per paid entry.
                                        Competitors are charged <strong>{usd(entryNet + 1)}</strong> — the
                                        extra dollar covers processing.
                                    </span>
                                    <PracticePop
                                        message = {"Stripe charges us .30¢ plus 2.9% to process transactions"}
                                    >
                                        <button type = "button" className = "tipMarkV2" aria-label="What's this?">?</button>
                                    </PracticePop>
                                </>
                            )}
                        </div>
                    </div> */}

                    <RadioGroup
                        id="voteType"
                        label="Won by"
                        value={voteType}
                        onChange={setVoteType}
                        options={[
                            { value: "hybrid", label: "Hybrid" },
                            { value: "general_vote", label: "General vote" },
                        ]}
                        tip={VOTE_TYPE_TIP}
                    />

                    {/* Hybrid means a panel picks the winner from the platform's
                        top ten, so the panel has to be declared up front — an
                        admin reviews it as part of approving the debate. */}
                    {needsJudges && (
                        <div className="judgePanel">
                            <div className="judgePanelHead">
                                <h3>Judges</h3>
                                <p>
                                    A hybrid debate is decided by your panel. We'll email each judge an
                                    invitation, and an admin reviews their qualifications before your
                                    debate is approved.
                                </p>
                            </div>

                            {judges.map((j, i) => (
                                <div className="judgeRow" key={j.key}>
                                    <div className="judgeRowHead">
                                        <span className="judgeIndex">Judge {i + 1}</span>
                                        {judges.length > 1 && (
                                            <button
                                                type="button"
                                                className="judgeRemove"
                                                onClick={() => removeJudgeRow(i)}
                                                aria-label={`Remove judge ${i + 1}`}
                                            >
                                                remove
                                            </button>
                                        )}
                                    </div>

                                    <label htmlFor={`judge-email-${j.key}`}>Email</label>
                                    <input
                                        id={`judge-email-${j.key}`}
                                        type="email"
                                        value={j.email}
                                        onChange={(e) => patchJudge(i, "email", e.target.value)}
                                        placeholder="judge@example.com"
                                    />

                                    <label htmlFor={`judge-why-${j.key}`}>Why they're qualified</label>
                                    <textarea
                                        id={`judge-why-${j.key}`}
                                        value={j.qualification}
                                        onChange={(e) => patchJudge(i, "qualification", e.target.value)}
                                        placeholder="Ten years judging collegiate policy debate; former editor at…"
                                    />

                                    <span className="rowLabel">Links</span>
                                    {j.links.map((link, k) => (
                                        // Keyed by index: these rows never reorder
                                        // (add appends, remove closes the gap), so
                                        // there is no stable id to key on and no
                                        // reconciliation bug to avoid.
                                        <div className="judgeLinkRow" key={k}>
                                            <input
                                                type="url"
                                                value={link}
                                                onChange={(e) => patchLink(i, k, e.target.value)}
                                                placeholder="https://linkedin.com/in/…"
                                                aria-label={`Judge ${i + 1} link ${k + 1}`}
                                            />
                                            <button
                                                type="button"
                                                className="judgeLinkRemove"
                                                onClick={() => removeLink(i, k)}
                                                aria-label={`Remove link ${k + 1}`}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <button type="button" className="judgeAddLink" onClick={() => addLink(i)}>
                                        + add another link
                                    </button>
                                </div>
                            ))}

                            <button type="button" className="judgeAdd" onClick={addJudgeRow}>
                                + add another judge
                            </button>
                        </div>
                    )}

                    <div className="regularLabelAndInput">
                        <label htmlFor="startDate">Start date</label>
                        <div className="inputandCanBeChangedLater">
                            <input
                                id="startDate"
                                className="wMd"
                                type="date"
                                min={todayStr}
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                            <span className="hint">
                                The day your debate streams. You'll connect your Twitch channel
                                after submitting.
                            </span>
                        </div>
                    </div>

                </div>

                <div className="sectionHead">
                    <h2>Prompts</h2>
                    <span className="rule" />
                </div>

                <div className="PromptExplanations">
                    <p>
                        prompts are released before the debate starts but debates may have prompts that are on or off the pre-disclosed list.
                    </p>
                    {/* <p>
                        Drag to reorder; the numbering follows.
                    </p> */}
                </div>

                <div className="formContainer">

                    <RenderPrompts
                        prompts={prompts}
                        setPrompts={setPrompts}
                    />

                    {error && <p className="formError">{String(error.message ?? error)}</p>}

                    {/* The last thing this page does: sign the prize agreement.
                        Connecting Twitch and paying happen on the next page. */}
                    {submitted && (
                        <>
                            <p className="formSuccess">
                                {`Draft saved — "${submitted.debate.title}" with ${submitted.prompts.length} prompt${submitted.prompts.length === 1 ? "" : "s"}, streaming ${new Date(`${startDate}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. One thing before review: sign the prize agreement.`}
                            </p>
                            <PrizeAgreementStep
                                debateId={submitted.debate.id}
                                onSigned={() =>
                                    navigate(`/startadebate/${submitted.debate.id}/twitch`)
                                }
                            />
                        </>
                    )}

                    {/* The submit button disappears once the draft exists, so a second
                        click can't create a duplicate application. */}
                    {!submitted && (
                        <div className="formActions">
                            {/* Not disabled on invalid — a disabled button gives a keyboard
                                user no explanation. It submits, then shows the error. */}
                            <button type="submit" disabled={submitting}>
                                {submitting ? "Sending…" : "Submit for review"}
                            </button>
                            <span className="note">An admin approves your debate before it goes live.</span>
                        </div>
                    )}

                </div>

            </form>
        </div>
    )
}

export default ApplyForDebateCasual
