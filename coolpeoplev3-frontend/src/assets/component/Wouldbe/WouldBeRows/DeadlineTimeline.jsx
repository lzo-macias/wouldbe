import { DEADLINE_LABELS, formatDeadlineDate } from './deadlineFormat';

const ms = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime();

// A compact horizontal timeline of an office's deadlines with a "Today" marker
// folded in — styled to match the StartAWouldBe timeline (gold rail, round pins,
// rose YOU flag) but WITHOUT the per-deadline fundraising amounts.
//   allowedTypes (optional): only plot these deadline types (Today always shows).
// Accepts deadlines in EITHER shape: { type, date } or { deadline_type, deadline_date }.
function DeadlineTimeline({ deadlines, allowedTypes }) {
    const today = new Date().toISOString().slice(0, 10);
    const allow = allowedTypes ? new Set(allowedTypes) : null;

    // group every deadline by date so same-day deadlines share one node
    const byDate = new Map();
    for (const d of deadlines ?? []) {
        const type = d.type ?? d.deadline_type;
        const rawDate = d.date ?? d.deadline_date;
        if (!rawDate) continue;                      // skip undated rows
        if (allow && !allow.has(type)) continue;     // filter to allowed milestones
        const date = String(rawDate).slice(0, 10);   // handle full ISO timestamps
        const label = DEADLINE_LABELS[type] ?? type;
        if (byDate.has(date)) byDate.get(date).labels.push(label);
        else byDate.set(date, { date, labels: [label], isToday: false });
    }
    // fold Today in — reuse the node if a deadline already lands on today's date
    if (byDate.has(today)) byDate.get(today).isToday = true;
    else byDate.set(today, { date: today, labels: [], isToday: true });

    const points = [...byDate.values()].sort((a, b) => ms(a.date) - ms(b.date));
    const n = points.length;
    const todayIdx = points.findIndex((p) => p.isToday);
    // gold rail fills from the left edge to the "Today" pin. Nodes sit centered in
    // equal grid cells; the rail is inset 5.5% each side (so its width is 89%).
    const nodeCenterPct = ((todayIdx + 0.5) / n) * 100;
    const progress = Math.max(0, Math.min(100, ((nodeCenterPct - 5.5) / 89) * 100));

    return (
        <div className="dlTimeline">
            <div
                className="dlTrack"
                style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, minWidth: `${Math.max(480, n * 100)}px` }}
            >
                <div className="dlRail" style={{ '--progress': `${progress}%` }} />
                {points.map((p) =>
                    p.isToday ? (
                        <div className="dlNode dlToday" key={p.date}>
                            <div className="dlYouflag">
                                <div className="dlBubble">YOU</div>
                                <div className="dlStem" />
                            </div>
                            <div className="dlPin" />
                            <div className="dlLabel">Today</div>
                            <div className="dlDate">{formatDeadlineDate(p.date)}</div>
                        </div>
                    ) : (
                        <div className={`dlNode${ms(p.date) < ms(today) ? ' dlDone' : ''}`} key={p.date}>
                            <div className="dlPin" />
                            <div className="dlLabel">{p.labels.join(' · ')}</div>
                            <div className="dlDate">{formatDeadlineDate(p.date)}</div>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

export default DeadlineTimeline
