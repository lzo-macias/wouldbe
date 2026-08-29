import {
    CANDIDACY_MILESTONES,
    DEADLINE_LABELS,
    formatDeadlineDate,
    formatUSD,
} from '../WouldBeRows/deadlineFormat'

// ============================================================================
// FilingTimeline — an office's candidacy milestones on one horizontal rail.
//
// One component, two screens: the office browser's detail panel and the
// start-a-WouldBe page. They had grown two implementations of the same picture
// (.dl* in WouldBeRows.css, .track/.node in StartAWouldBe.css) that disagreed
// on the pin colour, the rail inset and whether "today" was a node — so the
// same office's dates looked like two different facts depending on which screen
// you were on. This is the .wb-ftl block from the gold system, rendered once.
//
// TWO THINGS IT GETS RIGHT that the pair before it did not:
//
//   The rail runs CENTRE TO CENTRE, not edge to edge. A rail that overshoots
//   the outermost dot implies dates beyond the ones plotted, which on a filing
//   calendar is not a small lie.
//
//   TODAY is an overlay pin, interpolated between the two milestones it falls
//   between — not a node spliced into the list. As a node it made the axis
//   meaningless: the gaps between marks stop being comparable the moment one of
//   them isn't a deadline.
// ============================================================================

const ms = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime()

// Nodes are centred in equal flex cells, so the i-th centre is (i + .5)/n. The
// rail insets are the same arithmetic, kept here so the two cannot drift.
const centrePct = (i, n) => ((i + 0.5) / n) * 100

/**
 * @param {Array}  deadlines  rows in EITHER shape the app carries them in:
 *                            { type, date } or { deadline_type, deadline_date }.
 * @param {Array}  types      which deadline types to plot (default: the
 *                            candidacy milestones).
 * @param {number} goalCents  when given, each milestone also carries the
 *                            cumulative fundraising target due by then — the
 *                            reason a filing calendar is on a money screen.
 * @param {string} empty      what to say when the office has no dates seeded.
 */
function FilingTimeline({
    deadlines = [],
    types = CANDIDACY_MILESTONES,
    goalCents = null,
    empty = "We haven't loaded this office's petition, filing and election dates yet.",
}) {
    const allowed = new Set(types)

    // Same-day deadlines collapse onto one node — two labels, one dot, rather
    // than two dots at the same x fighting for the same 90px of label space.
    const byDate = new Map()
    for (const d of deadlines) {
        const type = d.type ?? d.deadline_type
        const raw = d.date ?? d.deadline_date
        if (!raw || !allowed.has(type)) continue
        const date = String(raw).slice(0, 10)
        const label = DEADLINE_LABELS[type] ?? type
        if (byDate.has(date)) byDate.get(date).labels.push(label)
        else byDate.set(date, { date, labels: [label] })
    }

    const steps = [...byDate.values()].sort((a, b) => ms(a.date) - ms(b.date))
    const n = steps.length

    if (!n) {
        return (
            <div className="wb-empty">
                <span className="wb-empty__t">No filing dates on record yet</span>
                {empty}
            </div>
        )
    }

    const nowMs = ms(new Date().toISOString().slice(0, 10))
    const passed = steps.filter((s) => ms(s.date) <= nowMs).length

    let todayPct
    if (passed === 0) todayPct = centrePct(0, n)
    else if (passed >= n) todayPct = centrePct(n - 1, n)
    else {
        const a = steps[passed - 1]
        const b = steps[passed]
        const span = ms(b.date) - ms(a.date)
        const t = span > 0 ? (nowMs - ms(a.date)) / span : 0
        todayPct = centrePct(passed - 1, n) + t * (centrePct(passed, n) - centrePct(passed - 1, n))
    }

    const railInset = 100 / (2 * n)
    const perStep = goalCents ? goalCents / n : 0

    return (
        // Narrow columns scroll the rail rather than crushing four labels into
        // slivers; the min-width is sized from the step count, which only the
        // render knows.
        <div className="wb-ftl-scroll">
            <div className="wb-ftl" style={{ minWidth: `${n * 96}px` }}>
                <div className="wb-ftl__rail" style={{ left: `${railInset}%`, right: `${railInset}%` }} />
                <div
                    className="wb-ftl__done"
                    style={{ left: `${railInset}%`, width: `${Math.max(0, todayPct - railInset)}%` }}
                />
                <div className="wb-ftl__you" style={{ left: `${todayPct}%` }}>TODAY</div>
                <div className="wb-ftl__steps">
                    {steps.map((s, i) => {
                        const done = ms(s.date) <= nowMs
                        // "now" is the NEXT deadline — the one still to be met.
                        const now = !done && i === passed
                        return (
                            <span
                                key={s.date}
                                className={`wb-ftl__step${done ? ' wb-ftl__step--done' : ''}${now ? ' wb-ftl__step--now' : ''}`}
                            >
                                <span className="wb-ftl__dot" />
                                <span className="wb-ftl__lab">{s.labels.join(' · ')}</span>
                                <span className="wb-ftl__d">{formatDeadlineDate(s.date)}</span>
                                {goalCents ? (
                                    <span className="wb-ftl__amt">
                                        {formatUSD(Math.round(perStep * (i + 1)))}
                                    </span>
                                ) : null}
                            </span>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default FilingTimeline
