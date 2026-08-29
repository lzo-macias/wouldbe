import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import api from "../../lib/api"
import PrizeAgreementStep from "./PrizeAgreementStep"
import MatchPromptGrid from "./MatchPromptGrid"
import "./ApplyForDebateCasual.css"

// DAY_MS and fmtDate lived here to derive each prompt's open/close window.
// Prompts have no dates any more — the livestream is the only scheduled thing —
// so both are gone. PROMPT_KINDS went with them: the type selector was never
// exposed and every prompt goes in as "response".

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

// Criterion weights arrive as numeric(4,3) fractions, and pg returns numerics as
// STRINGS ("0.250") to avoid float precision loss — hence the Number() before the
// arithmetic. 0.250 -> "25%".
const pct = (fraction) => `${Math.round(Number(fraction) * 100)}%`

// ============================================================================
// PRESENTATION. The logic below this block is unchanged — same state, same
// validation, same single POST. What changed is everything the sponsor sees.
//
// THE BUG THAT MATTERED MOST: the page shell declares data-surface="dark", but
// this form was rendering --wb-gold-700 — the LIGHT-surface ink — on a
// near-black ground. That measures 1.29:1. The section headings were not hard
// to read, they were invisible. Nothing here names a gold value now; the
// surface picks it.
//
// SINGLE CHOICE HAD FOUR SHAPES: a 3-way segment, a 2-way segment, big option
// cards, and pills with empty radio circles that read as unselected or broken.
// Two shapes now — a segment when each option is a word, option cards when the
// choice needs a sentence to explain itself.
//
// AND A SUMMARY RAIL. The form is four screens long and used to answer "what's
// missing?" one error at a time, only after a submit.
// ============================================================================

const Tick = () => (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 7.3l2.7 2.7L11 4.4" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

// Every control below is declared at MODULE scope, not inside the form. A
// component defined inside another is a new type on every render, so React
// remounts it and any input under it loses focus mid-keystroke.

const Segmented = ({ label, value, onChange, options }) => (
    <div className="wb-seg" role="group" aria-label={label}>
        {options.map((o) => (
            <button key={o.value} type="button"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}>
                {o.label}
            </button>
        ))}
    </div>
)

const OptionCards = ({ label, value, onChange, options }) => (
    <div className="wb-opts" role="group" aria-label={label}>
        {options.map((o) => (
            <button key={o.value} type="button" className="wb-opt"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}>
                <span className="wb-opt__t">{o.label}<Tick /></span>
                <p className="wb-opt__d">{o.description}</p>
            </button>
        ))}
    </div>
)

// SINGLE-select, despite looking like a chip set. The backend takes one
// `category` plus an optional `custom_category`, and the rubric shown below is
// keyed off that one value — a multi-select would have nothing to send and no
// rubric to look up.
const ChipSelect = ({ label, value, onChange, options }) => (
    <div className="wb-chips" role="group" aria-label={label}>
        {options.map((o) => (
            <button key={o} type="button" className="wb-chipbtn"
                    aria-pressed={value === o}
                    onClick={() => onChange(value === o ? "" : o)}>
                <Tick />{o}
            </button>
        ))}
    </div>
)

const Row = ({ label, required, hint, error, children }) => (
    <div className="wb-row">
        <div className="wb-row__l">
            {label}
            {required && <span className="wb-row__req" aria-hidden="true">*</span>}
        </div>
        <div className="wb-row__c">
            {children}
            {error ? <p className="wb-err">{error}</p> : hint ? <p className="wb-hint">{hint}</p> : null}
        </div>
    </div>
)

// The free-form prompt list a LIVE debate uses. Reordering is ↑/↓ buttons, not
// the drag handle it had: a drag gesture with no keyboard path excludes anyone
// not using a mouse, and this is a required field.
const PromptList = ({ prompts, setPrompts }) => {
    const patch = (i, value) =>
        setPrompts(prompts.map((p, j) => (j === i ? { ...p, body: value } : p)))
    const remove = (i) => setPrompts(prompts.filter((_, j) => j !== i))
    const shift = (i, dir) => {
        const to = i + dir
        if (to < 0 || to >= prompts.length) return
        setPrompts(move(prompts, i, to))
    }

    return (
        <>
            <div className="wb-prompts">
                {prompts.map((p, i) => (
                    <div className="wb-prompt" key={p.key}>
                        <span className="wb-prompt__n">{i + 1}</span>
                        <div className="wb-prompt__body">
                            <div className="wb-prompt__bar">
                                <button type="button" className="wb-iconbtn" onClick={() => shift(i, -1)}
                                        disabled={i === 0} aria-label={`Move prompt ${i + 1} up`}>↑</button>
                                <button type="button" className="wb-iconbtn" onClick={() => shift(i, 1)}
                                        disabled={i === prompts.length - 1}
                                        aria-label={`Move prompt ${i + 1} down`}>↓</button>
                                <span style={{ flex: 1 }} />
                                <button type="button" className="wb-iconbtn" onClick={() => remove(i)}
                                        disabled={prompts.length === 1}
                                        aria-label={`Remove prompt ${i + 1}`}>×</button>
                            </div>
                            <textarea className="wb-textarea" value={p.body}
                                      onChange={(e) => patch(i, e.target.value)}
                                      placeholder="What are competitors responding to?"
                                      aria-label={`Prompt ${i + 1}`} />
                        </div>
                    </div>
                ))}
            </div>
            <button type="button" className="wb-addrow" style={{ marginTop: 10 }}
                    onClick={() => setPrompts([...prompts, newPrompt()])}>
                + Add prompt
            </button>
        </>
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
    // HOW THE DEBATE IS ARGUED, picked before anything else on this form
    // depends on it: 'live' streams on Twitch, 'typed' is played in writing with
    // one prompt per bracket match. It changes which prompt UI renders, whether
    // a stream is scheduled, and where the sponsor goes after submitting.
    const [format, setFormat] = useState("live")
    // FOR FUN — no prize, no gate, one question. It forces typed + open + no
    // prize, which the server also enforces; holding it as its own flag rather
    // than inferring it from "prize is empty" means the sponsor's intent
    // survives a change of mind about any of the three.
    const [isForFun, setIsForFun] = useState(false)
    // Even numbers only; the stepper below moves by two.
    const [maxContestants, setMaxContestants] = useState(16)
    // Maps straight onto debates.participation_type, which already has these
    // exact values — no translation layer, no third state invented here.
    const [participation, setParticipation] = useState("open")
    // No UI for either any more (the entry-fee block is gone), but both are
    // still sent — so they are the fixed defaults the server expects, not state
    // with a setter nothing can call.
    const entryAmt = ""
    const freeEntry = true
    const [voteType, setVoteType] = useState("")
    // The debate's ONE date: when it streams. The Twitch channel and the seat
    // count are NOT collected here — connecting a channel is an OAuth round-trip,
    // so it happens on its own screen after the draft is safely saved.
    // A DATETIME, not a date. normalizeStart REJECTS a bare day ("the 4th is not
    // a start time") and requires an IANA zone alongside it, so this form was
    // 400ing on every submit with "a start TIME is required". The zone is the
    // browser's, which is the zone the sponsor is picking the hour in.
    const [startDate, setStartDate] = useState("")
    // "Is that time in the past?" is a question about the clock, and the clock
    // cannot be read during render. It is answered when the value changes and
    // remembered here, so the summary rail and the field agree.
    const [startIsPast, setStartIsPast] = useState(false)
    const startTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    const [prompts, setPrompts] = useState([newPrompt()])
    // TYPED prompts are keyed by bracket SLOT ("left:0:1"), not by array
    // position: the contestant stepper can resize the bracket at any moment, and
    // an index-keyed map would slide a final's question into a first-round match
    // when it did. { [slotKey]: body }
    const [matchPrompts, setMatchPrompts] = useState({})

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

    // For fun is written by definition — the server forces it, and the form
    // has to agree or it would show a live debate's prompt list for a typed one.
    const isTyped = isForFun || format === "typed"
    // The bracket's slot keys, derived the same way the server does it: pad to
    // the next power of two, mirror it, and every match eliminates one person —
    // so an N-field plays N-1 matches. Kept in step with the authoritative copy
    // by MatchPromptGrid, which ASKS the server for the labelled slots; this is
    // only for counting and for the completeness check below.
    const matchSlotKeys = (() => {
        if (!isTyped) return []
        const n = Number(maxContestants)
        if (!Number.isFinite(n) || n < 2) return []
        const size = 2 ** Math.ceil(Math.log2(Math.max(n, 2)))
        const half = size / 2
        const sideRounds = Math.round(Math.log2(half))
        const keys = []
        for (let round = 0; round < sideRounds; round++) {
            const matches = half / 2 ** (round + 1)
            for (const side of ["left", "right"]) {
                for (let position = 0; position < matches; position++) {
                    keys.push(`${side}:${round}:${position}`)
                }
            }
        }
        keys.push(`final:${sideRounds}:0`)
        return keys
    })()

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
        // TWO PROMPT SHAPES. A live debate keeps the free-form ordered list; a
        // typed one needs exactly one prompt per bracket match, and the count is
        // arithmetic on the field size rather than the sponsor's choice. The
        // server enforces both — these checks just save a round trip.
        if (isTyped) {
            const missing = matchSlotKeys.filter((k) => !(matchPrompts[k] || "").trim())
            if (!matchSlotKeys.length) {
                return setError(new Error("Set a contestant cap so the bracket can be worked out"))
            }
            if (missing.length) {
                return setError(
                    new Error(
                        `${missing.length} match${missing.length === 1 ? "" : "es"} still ${
                            missing.length === 1 ? "has" : "have"
                        } no prompt — every match needs its own question`
                    )
                )
            }
        } else {
            if (prompts.length === 0) return setError(new Error("Add at least one prompt"))
            const blank = prompts.findIndex((p) => !p.body.trim())
            if (blank !== -1) return setError(new Error(`Prompt ${blank + 1} needs a body`))
        }

        // The start INSTANT — a day and an hour. The API rejects a bare date
        // ("the 4th" is not a start time), so this is a datetime-local value and
        // the comparison is Date math rather than a string compare against a
        // day: "today at 9am" really is in the past by lunchtime.
        if (!startDate) return setError(new Error("Pick when the debate starts"))
        if (new Date(startDate).getTime() <= Date.now()) {
            return setError(new Error("The start time is in the past"))
        }

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
                // How it is argued. A typed debate never schedules a stream and
                // skips the Twitch step entirely.
                format,
                is_for_fun: isForFun,
                // The debate's schedule. A LIVE debate attaches its channel and
                // seat count on the next screen, so the stream row lands with a
                // date and no destination yet; a typed debate schedules no
                // stream at all, but still needs the instant — it is the
                // debate's own start_at either way.
                //
                // The zone travels with the hour because the hour is meaningless
                // without it: 8pm ET and 5pm PT are the same instant and only
                // one of them is what the sponsor picked.
                stream: { scheduled_at: startDate, timezone: startTimezone },
                // TWO SHAPES, decided by format. Typed prompts carry the bracket
                // slot they belong to — that coordinate is what ties each
                // question to the match it is asked in.
                prompts: isTyped
                    ? matchSlotKeys.map((key) => {
                          const [side, round, position] = key.split(":")
                          return {
                              bracket_side: side,
                              bracket_round: Number(round),
                              bracket_position: Number(position),
                              body: matchPrompts[key],
                          }
                      })
                    : prompts.map((p) => ({
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


    // ---- the summary rail's checklist ---------------------------------------
    // Derived from the SAME conditions onSubmit enforces, so the rail can never
    // say "ready" on a form the submit will reject. That is the whole value of
    // it: the old form answered "what's missing?" one error at a time, and only
    // after you pressed the button.
    const checks = useMemo(() => {
        const list = [
            { k: "Title", done: title.trim().length > 0 },
            {
                k: "Prize",
                done: (!wantsCash || toNumber(prizeAmt) > 0) && (!wantsOther || !!prizeDesc.trim()),
            },
            { k: "Bracket size", done: Number.isInteger(Number(maxContestants)) && Number(maxContestants) >= 2 && Number(maxContestants) % 2 === 0 },
            { k: "Category", done: !!category && (category !== "other" || !!customCategory.trim()) },
            { k: "Won by", done: !!voteType },
            { k: "Start time", done: !!startDate && !startIsPast },
            {
                k: isTyped ? "A prompt for every match" : "At least one prompt",
                done: isTyped
                    ? matchSlotKeys.length > 0 && matchSlotKeys.every((key) => (matchPrompts[key] || "").trim())
                    : prompts.length > 0 && prompts.every((p) => p.body.trim()),
            },
        ]
        // Only a hybrid debate has a panel to fill in, so the denominator moves
        // with the format rather than counting a row that does not apply.
        if (needsJudges) {
            const filled = judges.filter((j) => j.email.trim() || j.qualification.trim())
            list.push({
                k: "Judging panel",
                done: filled.length > 0 && filled.every((j) => j.email.trim() && j.qualification.trim()),
            })
        }
        return list
    }, [title, wantsCash, prizeAmt, wantsOther, prizeDesc, maxContestants, category,
        customCategory, voteType, startDate, startIsPast, isTyped, matchSlotKeys,
        matchPrompts, prompts, needsJudges, judges])

    const doneCount = checks.filter((c) => c.done).length
    const ready = doneCount === checks.length

    const contestantsErr =
        maxContestants && Number(maxContestants) % 2 !== 0
            ? "Must be an even number so the bracket halves cleanly."
            : null

    return (
        /* data-surface="dark" is the line that fixes the invisible headings: it
           flips --wb-gold-ink from #7A5211 (1.29:1 here) to #E8C56A. The page
           shell already declares it, and declaring it again costs nothing —
           this form is also reachable on its own. */
        <div className="wb-form-page" data-surface="dark">
            <div className="wb-form-wrap">
                {/* One form, not two. The old split meant the debate fields lived in a
                    form with no submit button while the prompts form owned submission —
                    it worked because state is lifted, but Enter in a title field did
                    nothing and native validation could never see half the fields. */}
                <form id="applyForm" onSubmit={onSubmit}>
                    <header className="wb-form-head">
                        <span className="wb-form-kicker">Apply to host</span>
                        <h1 className="wb-form-title">Casual</h1>
                        <p className="wb-form-dek">
                            For debates and competitions among friends, or open to the whole web.
                            Set the terms below and we&apos;ll review it before it goes live.
                        </p>
                        <p className="wb-form-dek">
                            Anyone can nominate contestants. The most-nominated entrants fill
                            the bracket and compete{isTyped ? " in writing" : " on stream"}.
                        </p>
                    </header>

                    <fieldset className="wb-fs">
                        <legend className="wb-fs__legend">The debate</legend>
                        <div className="wb-panel">
                            <Row label="Kind" required
                                 hint={isForFun
                                     ? "No prize, no entry gate, and it's written rather than streamed. Anyone can enter; nominating still works, it just isn't required. The winner takes a standing arrow."
                                     : "A prize debate: you put something up, and you'll sign an agreement to deliver it."}>
                                <Segmented label="Kind" value={isForFun ? "fun" : "prize"}
                                           onChange={(v) => setIsForFun(v === "fun")}
                                           options={[
                                               { value: "prize", label: "Prize debate" },
                                               { value: "fun", label: "For fun" },
                                           ]} />
                            </Row>

                            {/* FOR A FOR-FUN DEBATE THE PROMPT IS THE TITLE. It
                                is one question, so storing it twice would let the
                                two drift — the label changes, the field does not. */}
                            <Row label={isForFun ? "The question" : "Title"} required
                                 hint={isForFun
                                     ? "This is the whole debate — it's the title and the prompt at once."
                                     : "What competitors and voters see first."}>
                                <input className="wb-input" id="title" value={title}
                                       onChange={(e) => setTitle(e.target.value)}
                                       placeholder={isForFun
                                           ? "Does pineapple belong on pizza?"
                                           : "Would be the best president?"} />
                            </Row>

                            {/* The segment owns which inputs EXIST, not just which are
                                visible. A hidden-but-mounted field keeps its value and
                                would still be read at submit, so switching away from
                                cash could quietly send an amount nobody intends. */}
                            {!isForFun && (
                            <Row label="Prize" required
                                 hint="You'll sign an agreement to deliver this to the winner after you submit.">
                                <div className="wb-inline">
                                    <Segmented label="Prize type" value={prizeType} onChange={setPrizeType}
                                               options={[
                                                   { value: "cash", label: "Cash" },
                                                   { value: "non_cash", label: "Something else" },
                                                   { value: "both", label: "Both" },
                                               ]} />
                                    {wantsCash && (
                                        <input className="wb-input wb-input--short" inputMode="decimal"
                                               value={prizeAmt} onChange={(e) => setPrizeAmt(e.target.value)}
                                               placeholder="$500" aria-label="Cash amount" />
                                    )}
                                </div>
                                {wantsOther && (
                                    <input className="wb-input" value={prizeDesc} maxLength={500}
                                           onChange={(e) => setPrizeDesc(e.target.value)}
                                           placeholder="A 3-month internship, studio time, a feature slot…"
                                           aria-label="Non-cash prize" />
                                )}
                            </Row>
                            )}

                            {/* HOW IT IS ARGUED — asked early, because everything below
                                reads differently depending on the answer: a typed debate
                                writes a prompt per match and never touches Twitch. */}
                            {!isForFun && (
                            <Row label="Format" required>
                                <OptionCards label="Format" value={format} onChange={setFormat}
                                    options={[
                                        { value: "live", label: "Live",
                                          description: "Contestants argue on a Twitch stream. You connect the channel after submitting and put each match to a vote as it happens." },
                                        { value: "typed", label: "Typed",
                                          description: "No stream. Every match has its own written prompt; the two contestants answer it and the room scores the answers." },
                                    ]} />
                            </Row>
                            )}

                            <Row label="Bracket size" required error={contestantsErr}
                                 hint="Even numbers only, so the bracket halves cleanly.">
                                {/* step=2 covers the arrows and the keyboard, but a typed
                                    odd number would still pass, so the value snaps to even
                                    on change and the server rejects odd regardless. */}
                                <input className="wb-input wb-input--short" type="number" min="2" step="2"
                                       value={maxContestants} aria-invalid={!!contestantsErr}
                                       onChange={(e) => {
                                           const n = Number(e.target.value)
                                           if (!Number.isFinite(n)) return setMaxContestants("")
                                           setMaxContestants(Math.max(2, Math.round(n / 2) * 2))
                                       }} />
                            </Row>

                            {!isForFun && (
                            <Row label="Who can enter"
                                 hint={participation === "open"
                                     ? "Anyone eligible can be nominated to enter, up to the cap."
                                     : "Only competitors you invite can enter."}>
                                <Segmented label="Who can enter" value={participation} onChange={setParticipation}
                                           options={[
                                               { value: "open", label: "Open to all" },
                                               { value: "invitation_only", label: "Invite only" },
                                           ]} />
                            </Row>
                            )}

                            <Row label="Category" required
                                 hint="It's how people find this debate, and it decides the judging criteria below.">
                                <ChipSelect label="Category" value={category} onChange={setCategory}
                                            options={CATEGORIES} />
                                {category === "other" && (
                                    <input className="wb-input wb-input--short" aria-label="Custom category"
                                           value={customCategory} onChange={(e) => setCustomCategory(e.target.value)}
                                           placeholder="Name it" />
                                )}
                                {rubrics[category] && (
                                    <div className="wb-rubric">
                                        <h3>Criteria</h3>
                                        <p>Entrants and voters agree to this before taking part.</p>
                                        <ul>
                                            {rubrics[category].map((item) => (
                                                <li key={item.criterion_key}>
                                                    <div>
                                                        <h4>{item.display_name}</h4>
                                                        <p>{item.description}</p>
                                                    </div>
                                                    {/* weight is stored as a fraction (0.250)
                                                        and displayed as a percent. */}
                                                    <span className="wb-rubric__w">{pct(item.weight)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </Row>

                            <Row label="Won by" required
                                 hint={voteType === "hybrid"
                                     ? "The platform votes a top ten, then your panel picks the winner."
                                     : voteType
                                     ? "The platform picks the top ten and the winner."
                                     : undefined}>
                                <div className="wb-inline">
                                    <Segmented label="Won by" value={voteType} onChange={setVoteType}
                                               options={[
                                                   { value: "hybrid", label: "Hybrid" },
                                                   { value: "general_vote", label: "General vote" },
                                               ]} />
                                    <button type="button" className="wb-help" title={VOTE_TYPE_TIP}
                                            aria-label={VOTE_TYPE_TIP}>?</button>
                                </div>
                            </Row>

                            {/* Hybrid means a panel picks the winner from the platform's
                                top ten, so the panel has to be declared up front — an
                                admin reviews it as part of approving the debate. */}
                            {needsJudges && (
                                <Row label="Judges" required
                                     hint="We'll email each judge an invitation, and an admin reviews their qualifications before your debate is approved.">
                                    {judges.map((j, i) => (
                                        <div className="wb-judge" key={j.key} style={{ width: "100%" }}>
                                            <div className="wb-judge__head">
                                                <span className="wb-judge__n">Judge {i + 1}</span>
                                                {judges.length > 1 && (
                                                    <button type="button" className="wb-iconbtn"
                                                            onClick={() => removeJudgeRow(i)}
                                                            aria-label={`Remove judge ${i + 1}`}>×</button>
                                                )}
                                            </div>
                                            <input className="wb-input" type="email" value={j.email}
                                                   onChange={(e) => patchJudge(i, "email", e.target.value)}
                                                   placeholder="judge@example.com"
                                                   aria-label={`Judge ${i + 1} email`} />
                                            <textarea className="wb-textarea" value={j.qualification}
                                                      onChange={(e) => patchJudge(i, "qualification", e.target.value)}
                                                      placeholder="Ten years judging collegiate policy debate; former editor at…"
                                                      aria-label={`Why judge ${i + 1} is qualified`} />
                                            <span className="wb-judge__l">Links</span>
                                            {j.links.map((link, k) => (
                                                // Keyed by index: these rows never reorder
                                                // (add appends, remove closes the gap), so
                                                // there is no stable id to key on and no
                                                // reconciliation bug to avoid.
                                                <div className="wb-judge__link" key={k}>
                                                    <input className="wb-input" type="url" value={link}
                                                           onChange={(e) => patchLink(i, k, e.target.value)}
                                                           placeholder="https://linkedin.com/in/…"
                                                           aria-label={`Judge ${i + 1} link ${k + 1}`} />
                                                    <button type="button" className="wb-iconbtn"
                                                            onClick={() => removeLink(i, k)}
                                                            aria-label={`Remove link ${k + 1}`}>×</button>
                                                </div>
                                            ))}
                                            <button type="button" className="wb-addrow" onClick={() => addLink(i)}>
                                                + add another link
                                            </button>
                                        </div>
                                    ))}
                                    <button type="button" className="wb-addrow" onClick={addJudgeRow}>
                                        + add another judge
                                    </button>
                                </Row>
                            )}

                            {/* datetime-local, not date: the API rejects a bare day,
                                because "the 4th" is not a start time and assuming
                                midnight would publish an hour nobody chose. The value is
                                wall-clock in the browser's zone, which is sent with it. */}
                            {/* NO SEVEN-DAY RULE HERE. A debate has to be open
                                for nominations a week before it starts, but that
                                week runs from APPROVAL, and this form cannot know
                                when an admin will press the button — so blocking a
                                date here would enforce the wrong gap and refuse
                                perfectly good ones. The rule lives in approveDebate,
                                which is the only place that knows both ends of it.
                                All the sponsor needs from this screen is the lead
                                time to plan around, which is what the span says. */}
                            <Row label="Starts" required
                                 error={startIsPast ? "That time has already passed." : null}
                                 hint={isTyped
                                     ? `When the first prompts open. Times are in ${startTimezone}.`
                                     : `When your debate streams — times are in ${startTimezone}. You'll connect your Twitch channel after submitting.`}>
                                <input className="wb-date" type="datetime-local"
                                       min={`${todayStr}T00:00`} value={startDate}
                                       onChange={(e) => {
                                           const v = e.target.value
                                           setStartDate(v)
                                           setStartIsPast(!!v && new Date(v).getTime() <= Date.now())
                                       }}
                                       aria-label="Start date and time" />
                                <span className="wb-lead">
                                    Approval usually takes 1–2 days, and your debate needs to be open
                                    for nominations for a week before it starts — so give yourself
                                    about 9 days from today.
                                </span>
                            </Row>
                        </div>
                    </fieldset>

                    <fieldset className="wb-fs">
                        <legend className="wb-fs__legend">Prompts</legend>
                        <p className="wb-form-dek" style={{ fontSize: 14.5, marginBottom: 16 }}>
                            {isTyped
                                ? "A typed debate is played in writing: every match in the bracket has its own prompt, and the two contestants in that match answer it."
                                : "Prompts are published before the debate starts. During the debate you can use these or go off-list."}
                        </p>
                        <div className="wb-panel" style={{ padding: 18 }}>
                            {/* One prompt per MATCH for a typed debate — the count comes
                                from the bracket size, not from an "add" button — and the
                                free-form ordered list for a live one, where the stream is
                                the debate and prompts are supporting material. */}
                            {isTyped ? (
                                <MatchPromptGrid
                                    fieldSize={maxContestants}
                                    category={category === "other" ? customCategory : category}
                                    prompts={matchPrompts}
                                    setPrompts={setMatchPrompts}
                                    disabled={!!submitted}
                                />
                            ) : (
                                <PromptList prompts={prompts} setPrompts={setPrompts} />
                            )}
                        </div>
                    </fieldset>

                    {error && <p className="formError" role="alert">{String(error.message ?? error)}</p>}

                    {/* The last thing this page does: sign the prize agreement.
                        Connecting Twitch and paying happen on the next page. */}
                    {submitted && (
                        <div style={{ display: "grid", gap: 16, marginTop: 8 }}>
                            <p className="formSuccess">
                                {`Draft saved — "${submitted.debate.title}" with ${submitted.prompts.length} prompt${submitted.prompts.length === 1 ? "" : "s"}, ${isTyped ? "opening" : "streaming"} ${new Date(startDate).toLocaleString(undefined, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}. One thing before review: sign the prize agreement.`}
                            </p>
                            {/* A TYPED debate has no channel to connect, so it does not go
                                to the Twitch step — sending it there would ask the sponsor
                                to authorise a broadcast that will never happen. */}
                            <PrizeAgreementStep
                                debateId={submitted.debate.id}
                                onSigned={() =>
                                    navigate(
                                        isTyped
                                            ? `/debate/${submitted.debate.id}`
                                            : `/startadebate/${submitted.debate.id}/twitch`
                                    )
                                }
                            />
                        </div>
                    )}
                </form>

                <aside className="wb-summary">
                    <div className="wb-summary__card">
                        <span className="wb-summary__h">Before you submit</span>
                        <div className="wb-prog">
                            <div className="wb-prog__bar">
                                <i style={{ width: `${(doneCount / checks.length) * 100}%` }} />
                            </div>
                            <span className="wb-prog__n"><b>{doneCount}</b> of {checks.length} ready</span>
                        </div>
                        <ul className="wb-checks">
                            {checks.map((c) => (
                                <li key={c.k} data-done={c.done}><Tick />{c.k}</li>
                            ))}
                        </ul>

                        {/* The submit button disappears once the draft exists, so a
                            second click can't create a duplicate application.

                            NOT disabled on an incomplete form: a disabled button gives a
                            keyboard user no explanation. It submits, and onSubmit names
                            the first thing that is wrong. The checklist above is where
                            "what's left" is answered.

                            The button lives in the rail, OUTSIDE the <form>, so
                            `form="applyForm"` is what associates it — a bare
                            type="submit" out here submits nothing, and an onClick
                            handler instead would leave Enter-in-a-field doing
                            nothing. */}
                        {!submitted && (
                            <button type="submit" form="applyForm" className="wb-btn wb-btn--primary"
                                    disabled={submitting}>
                                {submitting ? "Sending…" : ready ? "Submit for review" : `${checks.length - doneCount} left`}
                            </button>
                        )}
                        <p className="wb-hint" style={{ margin: 0 }}>
                            An admin approves your debate before it goes live. You can edit it until then.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    )
}

export default ApplyForDebateCasual
