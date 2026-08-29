import './DebateHeadline.css'

// ============================================================================
// DebateHeadline — the facts a debate is identified by, in one band.
//
// WHY IT EXISTS: screens 2 and 3 rendered a stream and a bracket with no title,
// no prize, no date and no host anywhere on them. Screen 1 carries all of that
// in NominateCard, so the moment a debate went live the page stopped saying
// WHICH debate you were looking at — and a finished one, which is mostly read by
// people who weren't there, said even less.
//
// WHAT COUNTS AS IMPORTANT, and why each is here rather than a nice-to-have:
//   title      — the question being argued. Everything else is context for it.
//   host       — who staged it and put the prize up. A sweepstakes-adjacent
//                contest with an anonymous organiser is not a credible one, so
//                the face and the name travel with it.
//   prize      — the money at stake, from prize_pool_cents (a GENERATED column:
//                sponsor + platform + user contributions). prize_type decides
//                whether that figure is the whole story or a non-cash line is.
//   dates      — when it ran, and when the result was announced. Those are
//                different facts and a past debate needs both.
//   the count  — contestants, matches, ballots: the size of the thing that
//                produced the winner. "Won a bracket" means something different
//                at 8 people than at 2.
//
// Every field is guarded. This renders from a live payload where the sponsor may
// have no logo, the debate may have no prize, and the result may not exist yet.
// ============================================================================

const money = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
        .format(Number(cents || 0) / 100)

// A date, in the zone the sponsor scheduled in — the same rule NominateCard
// uses. "8pm ET" and "5pm PT" are the same instant and only one of them is what
// was published, so debates.start_timezone travels with start_at.
//
// dateStyle/timeStyle CANNOT be combined with timeZoneName. Intl throws
// TypeError "Invalid option : option" for that pair, which took the whole
// headline down: the shorthand styles are a preset for the entire pattern, so
// asking for an extra component alongside them is a contradiction the spec
// rejects rather than merges. Wanting the zone label therefore means spelling
// every field out — which is what the withTime branch does.
const when = (value, { timeZone, withTime = false } = {}) => {
    if (!value) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    const opts = withTime
        ? {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
          }
        : { dateStyle: 'medium' }
    try {
        return new Intl.DateTimeFormat('en-US', {
            ...opts,
            ...(timeZone ? { timeZone } : {}),
        }).format(d)
    } catch {
        // Only the ZONE can still be bad here (an unrecognised IANA name raises
        // RangeError), so the fallback drops it and keeps the same pattern.
        // Re-using the full option set was what made the earlier fallback throw
        // the very error it was meant to catch.
        return new Intl.DateTimeFormat('en-US', opts).format(d)
    }
}

// A DATE column ('YYYY-MM-DD') is not an instant. Parsing it with `new Date()`
// reads it as UTC midnight and then prints it in the viewer's zone, which lands
// anyone west of Greenwich on the previous day — the same trap the DB writes
// have. Take the leading YYYY-MM-DD instead of trusting the parser.
//
// CAVEAT, stated rather than hidden: node-postgres hands a DATE back as a Date
// at LOCAL midnight on the API host, so JSON gives us e.g.
// '2026-08-23T04:00:00.000Z' for a US-hosted server and the leading 10
// characters are still the right day. On a server EAST of UTC the same date
// serialises as the previous day at 22:00Z and this would read one day early.
// The real fix is a pg type parser returning DATE as the raw string; until then
// this is correct for the deployment we have.
const plainDate = (value) => {
    if (!value) return null
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return null
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
        .format(new Date(y, m - 1, d))
}

const STATUS_WORD = {
    draft: 'Draft',
    open_entry: 'Entry open',
    live: 'Live',
    no_posting: 'Live',
    closed: 'Concluded',
    cancelled: 'Cancelled',
}

function Fact({ label, value, note }) {
    if (!value) return null
    return (
        <div className="dh-fact">
            <span className="dbt-label">{label}</span>
            <p>{value}</p>
            {note && <span className="dh-fact-note">{note}</span>}
        </div>
    )
}

/**
 * @param {object} debate  the /debates/:id/full header — includes sponsor_name,
 *                         sponsor_photo_url and sponsor_verified_at, which are
 *                         joined in server-side precisely so this can render the
 *                         host without a second request.
 * @param {object} result  the announced debate_results row, when there is one
 * @param {object} stats   { contestants, matches, ballots, criteria }
 */
function DebateHeadline({ debate, result = null, stats = {} }) {
    if (!debate?.id) return null

    // prize_type is the source of truth ('cash' | 'non_cash' | 'both'); there is
    // no `cash_prize` column and prize_pool_cents is 0 for a non-cash contest.
    const hasCash = debate.prize_type === 'cash' || debate.prize_type === 'both'
    // A FOR-FUN DEBATE HAS NO PRIZE FACT. "For fun — no prize." under a PRIZE
    // label is the absence dressed up as a value, and it takes a third of the
    // fact row to say nothing. The debate's own copy already explains what is
    // at stake.
    const isForFun = !!debate.is_for_fun
    const poolCents = debate.prize_pool_cents ?? debate.sponsor_contribution_cents

    const ran = when(debate.start_at || debate.start_date, {
        timeZone: debate.start_timezone,
        withTime: !!debate.start_at,
    })
    const ended = plainDate(debate.end_date)
    const announced = when(result?.announced_at || debate.results_announce_at)
    // The prize is not settled while a result can still be disputed — that
    // window is on the result row, and for a finished debate it is one of the
    // few forward-looking facts left.
    const disputesClose = when(result?.dispute_window_ends_at)

    return (
        <header className="dh">
            <div className="dh-top">
                <div className="dh-id">
                    <span className={`dh-status dh-status--${debate.status}`}>
                        {STATUS_WORD[debate.status] || debate.status}
                    </span>
                    <h1>{debate.title}</h1>
                    {debate.description && <p className="dh-desc">{debate.description}</p>}
                </div>

                {/* The host. sponsor_photo_url already falls back from a
                    corporate logo to the person's own avatar server-side, so
                    there is one field to read here, not a branch. */}
                <div className="dh-host">
                    <span className="dbt-label">hosted by</span>
                    <div className="dh-host-who">
                        {debate.sponsor_photo_url ? (
                            <img src={debate.sponsor_photo_url} alt="" />
                        ) : (
                            <span className="dh-host-blank" aria-hidden="true">
                                {(debate.sponsor_name || '?').charAt(0)}
                            </span>
                        )}
                        <div>
                            <strong>{debate.sponsor_name || 'A sponsor'}</strong>
                            {debate.sponsor_verified_at && (
                                <span className="dh-verified">Verified</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="dh-facts">
                {isForFun ? null : hasCash ? (
                    <Fact
                        label="prize pool"
                        value={money(poolCents)}
                        note={debate.prize_description || undefined}
                    />
                ) : (
                    <Fact label="prize" value={debate.prize_description} />
                )}
                <Fact label="ran" value={ran} note={ended ? `through ${ended}` : undefined} />
                <Fact
                    label="result announced"
                    value={announced}
                    note={disputesClose ? `disputes close ${disputesClose}` : undefined}
                />
                {/* WHAT THE COUNT COUNTS. Nobody competes in a for-fun debate —
                    there is no bracket to be a contestant in — so the same
                    number is a count of answers, and calling it "contestants"
                    describes a contest that is not happening. */}
                <Fact
                    label={isForFun ? 'responses' : 'contestants'}
                    value={
                        isForFun
                            ? (stats.responses ?? stats.contestants)
                                ? String(stats.responses ?? stats.contestants)
                                : null
                            : stats.contestants
                                ? String(stats.contestants)
                                : null
                    }
                    note={
                        isForFun
                            ? undefined
                            : stats.matches
                                ? `${stats.matches} match${stats.matches === 1 ? '' : 'es'}`
                                : undefined
                    }
                />
                <Fact
                    label="ballots cast"
                    value={stats.ballots ? String(stats.ballots) : null}
                    note={
                        stats.criteria
                            ? `scored on ${stats.criteria} criteria`
                            : undefined
                    }
                />
            </div>
        </header>
    )
}

export default DebateHeadline
