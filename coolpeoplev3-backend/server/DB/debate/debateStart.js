const { withTransaction } = require("../index.js")

// ============================================================================
// debateStart — the debate's scheduled start: an exact instant plus the zone the
// sponsor picked it in.
//
// A timestamptz alone cannot answer "what time did they say". Postgres stores an
// instant and renders it in whatever zone the reader is in, so 2026-09-04T00:00Z
// is "8pm Wednesday" in New York and "5pm Wednesday" in Los Angeles. The sponsor
// scheduled ONE of those. Keeping the IANA zone next to the instant is what lets
// the page say "8:00 PM EDT" to everyone, which is what a viewer deciding whether
// to show up actually needs.
//
// IANA names only ('America/New_York'), never abbreviations: "EST" means
// something different in Australia and is wrong in New York for half the year.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// _isValidZone — Intl is the only timezone database in the runtime, so ask it.
// A bad name throws RangeError rather than returning false.
const _isValidZone = (tz) => {
    if (typeof tz !== "string" || !tz.includes("/")) return false
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz })
        return true
    } catch {
        return false
    }
}

// _partsInZone — the wall-clock fields an instant shows as, in a given zone.
const _partsInZone = (instantMs, tz) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
    const p = {}
    for (const { type, value } of fmt.formatToParts(new Date(instantMs))) {
        if (type !== "literal") p[type] = value
    }
    // hour12:false still emits "24" for midnight in some ICU versions.
    return { ...p, hour: p.hour === "24" ? "00" : p.hour }
}

// _zoneOffsetMs — how far the zone is from UTC AT that instant. Derived by
// formatting the instant in the zone and reading the wall clock back as if it
// were UTC; the difference IS the offset. Doing it per-instant rather than with a
// fixed number is what makes DST correct — the same zone is -04:00 in August and
// -05:00 in November.
const _zoneOffsetMs = (instantMs, tz) => {
    const p = _partsInZone(instantMs, tz)
    const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
    return asIfUtc - instantMs
}

// _wallClockToInstant — "2026-09-04 20:00 in America/New_York" -> the UTC instant.
//
// Two passes on purpose. The offset depends on the instant, and the instant is
// what we're solving for, so the first pass uses the offset at the naive guess and
// the second re-reads it at the corrected instant. That second pass is what gets
// the hour right across a DST boundary, where the guess can land on the wrong side
// of the transition.
const _wallClockToInstant = (y, mo, d, h, mi, tz) => {
    const guess = Date.UTC(y, mo - 1, d, h, mi)
    const firstPass = guess - _zoneOffsetMs(guess, tz)
    return guess - _zoneOffsetMs(firstPass, tz)
}

// normalizeStart — turn what a form sends into the three values we store.
//
// scheduled_at accepts either:
//   'YYYY-MM-DDTHH:mm'        — what <input type="datetime-local"> gives. It
//                               carries NO zone, and is read as wall-clock time
//                               in `timezone`. This is the normal case.
//   a full ISO with an offset — already an unambiguous instant; used as-is, with
//                               `timezone` recorded for display.
//
// A date with no time is REJECTED. The debate is a scheduled livestream now, so
// "the 4th" is not a start time, and silently assuming midnight would put a
// wrong hour on the page rather than telling the sponsor to pick one.
const normalizeStart = ({ scheduled_at, timezone }) => {
    if (!scheduled_at) throw httpError(400, "a start date and time is required")
    if (!_isValidZone(timezone)) {
        throw httpError(400, "timezone must be an IANA zone name, e.g. America/New_York")
    }

    const raw = String(scheduled_at).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw httpError(400, "a start TIME is required, not just a date — the debate streams at a specific hour")
    }

    let instantMs
    const naive = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/)
    if (naive) {
        const [, y, mo, d, h, mi] = naive
        instantMs = _wallClockToInstant(+y, +mo, +d, +h, +mi, timezone)
    } else {
        instantMs = new Date(raw).getTime()
        if (Number.isNaN(instantMs)) throw httpError(400, "the start time is not a valid date")
    }

    // The calendar day IN THE SPONSOR'S ZONE, as a 'YYYY-MM-DD' string. Both
    // halves matter: a 9pm-ET debate is 01:00 UTC the NEXT day, so deriving the
    // day from the instant's UTC date files it under tomorrow; and a JS Date bound
    // to a DATE column is serialised in the server's zone, which shifts it again.
    const p = _partsInZone(instantMs, timezone)
    const start_day = `${p.year}-${p.month}-${p.day}`

    return { start_at: new Date(instantMs).toISOString(), start_timezone: timezone, start_day }
}

// setDebateStart — write the schedule. Updates the debate and, if one exists, the
// debate_streams row that mirrors it, in one transaction so the page and the
// broadcast can never disagree about when this thing happens.
//
// start_date is written from start_day, keeping the DATE column the feed and the
// deadline filters read as a true shadow of start_at rather than a second,
// drifting source of truth.
const setDebateStart = async ({ debate_id, scheduled_at, timezone }) => {
    if (!debate_id) throw httpError(400, "debate_id is required")
    const { start_at, start_timezone, start_day } = normalizeStart({ scheduled_at, timezone })

    try {
        return await withTransaction(async (tx) => {
            const result = await tx.query(
                `UPDATE debates
                    SET start_at             = $2,
                        start_timezone       = $3,
                        start_date           = $4,
                        end_date             = $4,
                        concluding_stream_at = $2,
                        updated_at           = NOW()
                  WHERE id = $1
                  RETURNING *;`,
                [debate_id, start_at, start_timezone, start_day]
            )
            if (result.rows.length === 0) throw httpError(404, "debate not found")

            // The stream row is the same event; it just may not exist yet (the
            // Twitch channel is connected on a later screen).
            await tx.query(
                `UPDATE debate_streams
                    SET scheduled_at = $2, updated_at = NOW()
                  WHERE debate_id = $1`,
                [debate_id, start_at]
            )
            return result.rows[0]
        })
    } catch (err) {
        if (err.status) throw err
        if (err.code === "22P02") throw httpError(400, "debate_id is malformed")
        // debates_prize_shape_chk is NOT VALID: rows created before it exists were
        // never checked, and Postgres re-checks the whole row on ANY update. So a
        // draft with prize_type='cash' and no money on it rejects a write that
        // never touched a prize field.
        if (err.code === "23514" && /prize_shape/.test(err.constraint || "")) {
            throw httpError(409, "this debate's prize is incomplete (a cash prize needs an amount) — fix the prize before setting a start time")
        }
        console.error(err)
        throw err
    }
}

module.exports = { normalizeStart, setDebateStart }
