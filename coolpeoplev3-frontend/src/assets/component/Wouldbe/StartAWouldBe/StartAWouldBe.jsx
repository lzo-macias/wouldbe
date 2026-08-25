import React, { useState } from 'react'
import { DEADLINE_LABELS, formatDeadlineDate, formatUSD } from '../WouldBeRows/deadlineFormat'
import "./StartAWouldBe.css"
import HowItWorksTimeline from "../HowItWorksTimeline/HowItWorksTimeline.jsx"
import Grid2x from "../../../component/grid/Grid2x.jsx"
import { useNavigate } from 'react-router-dom'

const ms = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime()

// The candidacy milestones plotted on the timeline: petitioning opens, the filing/
// petition close, the primary, and the general. FEC financial-report dates are
// intentionally excluded — they'd crowd the line and aren't candidacy gates.
const TIMELINE_TYPES = new Set([
  "petition_circulation_start",
  "petition_filing_deadline",
  "filing_close",
  "primary_date",
  "general_date",
])

function StartAWouldBe({ office, jurisdiction, onComplete }) {
  const originalGoalCents = office.goalCents
  // Seed from the recommended goal; fall back to the $5,000 floor (500000 cents)
  // when the office has no recommended goal (that endpoint can return null).
  const [goalCents, setGoalCents] = useState(originalGoalCents ?? 500000)

  // The recommended goal is fixed to what the backend saved for this office — it
  // never moves with the slider. The slider only sets `goalCents`, the user's own
  // adjustable target, which drives the per-deadline amounts and the "your goal"
  // figure shown under the slider.
  const recommendedGoalCents = originalGoalCents ?? 500000
  const navigate = useNavigate()
  // ---- build the timeline points from the real deadlines ------------------
  // Group same-day deadlines onto one node, fold "Today" in, then split the goal
  // evenly across the real deadlines so each node shows a cumulative target.
  const today = new Date().toISOString().slice(0, 10)
  const byDate = new Map()
  for (const d of office.deadlines ?? []) {
    const type = d.type ?? d.deadline_type
    const rawDate = d.date ?? d.deadline_date
    if (!rawDate) continue
    if (!TIMELINE_TYPES.has(type)) continue   // only the candidacy milestones
    const date = String(rawDate).slice(0, 10)
    const label = DEADLINE_LABELS[type] ?? type
    if (byDate.has(date)) byDate.get(date).labels.push(label)
    else byDate.set(date, { date, labels: [label], isToday: false })
  }
  if (byDate.has(today)) byDate.get(today).isToday = true
  else byDate.set(today, { date: today, labels: [], isToday: true })

  const points = [...byDate.values()].sort((a, b) => ms(a.date) - ms(b.date))
  const deadlinePoints = points.filter((p) => !p.isToday)
  const perDeadline = deadlinePoints.length ? goalCents / deadlinePoints.length : 0
  const goalAt = (point) => {
    const idx = deadlinePoints.findIndex((p) => p.date === point.date)
    return idx === -1 ? 0 : Math.round(perDeadline * (idx + 1))
  }

  const n = points.length
  const todayIdx = points.findIndex((p) => p.isToday)
  // gold rail fills from the left edge up to the "Today" pin. Nodes sit centered
  // in equal grid cells; the rail is inset 5.5% on each side (width 89%).
  const nodeCenterPct = ((todayIdx + 0.5) / n) * 100
  const progress = Math.max(0, Math.min(100, ((nodeCenterPct - 5.5) / 89) * 100))

  const goalAdjusted = originalGoalCents != null && originalGoalCents !== goalCents

const startACampaign = async () => {
    const userId = localStorage.getItem("userId")
    // The goal chosen on this screen goes UP to the parent — the campaign row
    // can't be created here, because POST /api/wouldbes is gated on attestations
    // that the next screen records.
    if (userId) onComplete(goalCents)
    else navigate("/login")
  }
  return (
    <div>
    <div className='StartAWouldBeMainContainer'>
      {/* HERO */}
      <section className='hero'>
        <h1 className='headline'>
          <img src="/logos/WouldBeLogo.svg" alt="would be" className='headlineLogo' />
          <span className='headlineText'>a great {jurisdiction.state_code} {office.office_name} representative</span>
        </h1>

        {/* TIMELINE PANEL */}
        <div className='panel'>
          <div className='panel-head'>
            <div className='panel-title'>Campaign timeline<b>{office.office_name}</b></div>
            <div className='goal-chip'>Recommended financing goal <b>{formatUSD(recommendedGoalCents)}</b></div>
          </div>
          <div className='timeline'>
            <div
              className='track'
              style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
            >
              <div className='rail' style={{ '--progress': `${progress}%` }} />
              {points.map((p) =>
                p.isToday ? (
                  <div className='node today' key={p.date}>
                    <div className='youflag'>
                      <div className='bubble'>YOU</div>
                      <div className='stem' />
                      <div className='caret' />
                    </div>
                    <div className='label'>Today</div>
                    <div className='date'>{formatDeadlineDate(p.date)}</div>
                    <div className='amt'>&nbsp;</div>
                  </div>
                ) : (
                  <div className={`node${ms(p.date) < ms(today) ? ' done' : ''}`} key={p.date}>
                    <div className='pin' />
                    <div className='label'>{p.labels.join(' · ')}</div>
                    <div className='date'>{formatDeadlineDate(p.date)}</div>
                    <div className='amt'>{formatUSD(goalAt(p))}</div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className='grid'>
          <div className='card tint'>
            <h3>Seat details</h3>
            <ul className='reasons'>
              <li><span className='k'>State</span><span className='v'>{jurisdiction.state_code}</span></li>
              <li><span className='k'>Office</span><span className='v'>{office.office_name}</span></li>
              <li><span className='k'>Jurisdiction</span><span className='v'>{jurisdiction.type}</span></li>
              {office.regulations?.residency_requirement === "yes" && (
                <li><span className='k'>Residency</span><span className='v'>{office.regulations.residency_duration} in {jurisdiction.name}</span></li>
              )}
              <li><span className='k'>Minimum age</span><span className='v'>{office.regulations?.min_age}</span></li>
            </ul>
            {office.regulations?.eligibility_source_url && (
              <div className='src'>
                Source: <a href={office.regulations.eligibility_source_url} target='_blank' rel='noreferrer'>{office.regulations.eligibility_source_url}</a>
              </div>
            )}
            <a className='link-plain' href="#">See full campaign plan →</a>
          </div>

          <div className='card stat-card'>
            <div className='stat-top'><span className='stat-arrow'>▲</span><span className='stat-num'>37%</span></div>
            <p className='stat-desc'>higher chance for a <b>new entrant</b> here compared to other offices.</p>
            <div className='divider' />
            <div className='badge-incumbent'><span className='b-dot' /> No incumbent</div>
            <p className='incumbent-note'>The representative who previously held this office isn’t running again.</p>
          </div>

          <div className='card goal-card'>
            <div className='goal-eyebrow'>Recommended goal</div>
            <div className='goal-amount'>{formatUSD(recommendedGoalCents)}</div>
            <div className='goal-caption'>Drag to set your own fundraising target</div>
            <div className='slider-wrap'>
              <input
                type="range"
                min={500000}
                max={100000000}
                step={100000}
                value={goalCents}
                onChange={(e) => setGoalCents(Number(e.target.value))}
              />
              <div className='range-legend'><span>{formatUSD(500000)}</span><span>{formatUSD(100000000)}</span></div>
            </div>
            <div className='goal-your'>
              <span>Your goal</span>
              <b>{formatUSD(goalCents)}{goalAdjusted && <em> adjusted</em>}</b>
            </div>
            <button className='start-btn' onClick={startACampaign}>Start a campaign →</button>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className='how'>
        <h2>How it works</h2>
        <HowItWorksTimeline/>
      </section>
      {/* <section >
        <div className='second'>
         <img src="/logos/WouldBeLogo.svg" alt="would be" className='barrier' />

        </div>
        <Grid2x/>
      </section> */}
    </div>
    </div>

  )
}

export default StartAWouldBe
