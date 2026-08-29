import { useState } from 'react'
import { formatUSD } from '../WouldBeRows/deadlineFormat'
import "./StartAWouldBe.css"
import FilingTimeline from '../FilingTimeline/FilingTimeline'
import HowItWorksTimeline from "../HowItWorksTimeline/HowItWorksTimeline.jsx"
import { useNavigate } from 'react-router-dom'

// ============================================================================
// Start a WouldBe — the pitch for one seat, and the goal you commit to.
//
// Built on the gold system in index.css (.wb-*), which is where every colour,
// rule and radius on this screen comes from. The page had grown its own local
// palette — a second --ink/--line/--panel set, a #f5385d "today" marker that
// belonged to no palette at all, and a near-black goal card — so the one screen
// that asks for money looked like it came from a different product than the one
// that lists the offices.
//
// THE LAYOUT is the system's campaign shape: a reading column and a sticky
// rail. That is not a style choice. The goal slider and "Start a campaign" are
// the only two controls on the page, and they used to sit in the third cell of
// a three-across grid — so on any laptop they scrolled off while the reader was
// still in the seat details. In the rail they stay put.
// ============================================================================

const GOAL_FLOOR_CENTS = 500000        // $5,000
const GOAL_CEILING_CENTS = 100000000   // $1,000,000

function StartAWouldBe({ office, jurisdiction, onComplete }) {
  const originalGoalCents = office.goalCents
  // Seed from the recommended goal; fall back to the $5,000 floor when the
  // office has no recommended goal (that endpoint can return null).
  const [goalCents, setGoalCents] = useState(originalGoalCents ?? GOAL_FLOOR_CENTS)

  // The recommended goal is fixed to what the backend saved for this office — it
  // never moves with the slider. The slider only sets `goalCents`, the user's own
  // adjustable target, which drives the per-deadline amounts and the "your goal"
  // figure shown under the slider.
  const recommendedGoalCents = originalGoalCents ?? GOAL_FLOOR_CENTS
  const navigate = useNavigate()

  const goalAdjusted = originalGoalCents != null && originalGoalCents !== goalCents
  const reg = office.regulations ?? {}

  const startACampaign = async () => {
    const userId = localStorage.getItem("userId")
    // The goal chosen on this screen goes UP to the parent — the campaign row
    // can't be created here, because POST /api/wouldbes is gated on attestations
    // that the next screen records.
    if (userId) onComplete(goalCents)
    else navigate("/login")
  }

  return (
    <div className="wb-campaign sawb">
      <div className="sawb-main">
        {/* HERO — the thesis on the brushed plate. The screen has no image to
            lead with, and a bare <h1> on white was leaving the top of the page
            to do no work at all. */}
        <section className="wb-hero">
          <div className="wb-hero__plate">
            <h1 className="wb-hero__thesis sawb-thesis">
              <img src="/logos/WouldBeLogo.svg" alt="would be" className="sawb-logo" />
              <span>a great {jurisdiction.state_code} {office.office_name} representative</span>
            </h1>
            <div className="wb-hero__facts">
              <span className="wb-chip">{jurisdiction.state_code}</span>
              <span className="wb-chip">{jurisdiction.type}</span>
              {reg.min_age && <span className="wb-chip">{reg.min_age}+</span>}
            </div>
          </div>
        </section>

        {/* CAMPAIGN TIMELINE */}
        <div className="wb-timeline-card">
          <div className="wb-tlh">
            <span className="wb-tlh__t">Campaign timeline · {office.office_name}</span>
            <span className="wb-tlh__g">
              Recommended goal <b>{formatUSD(recommendedGoalCents)}</b>
            </span>
          </div>

          <FilingTimeline deadlines={office.deadlines ?? []} goalCents={goalCents} />
        </div>

        <div className="wb-sections">
          {/* SEAT DETAILS — a definition list, not a dump. */}
          <section className="wb-sec">
            <h2 className="wb-sec__h">Seat details</h2>
            <div className="wb-detail__card">
              <div>
                <div className="wb-detail__eyebrow">Requirements</div>
                <h3 className="wb-detail__title">
                  {jurisdiction.state_code} {office.office_name}
                </h3>
              </div>
              <dl className="wb-reqs">
                <div className="wb-req wb-req--pass">
                  <dt className="wb-req__k">State</dt>
                  <dd className="wb-req__v">{jurisdiction.state_code}</dd>
                </div>
                <div className="wb-req wb-req--pass">
                  <dt className="wb-req__k">Office</dt>
                  <dd className="wb-req__v">{office.office_name}</dd>
                </div>
                <div className="wb-req wb-req--pass">
                  <dt className="wb-req__k">Jurisdiction</dt>
                  <dd className="wb-req__v">{jurisdiction.type}</dd>
                </div>
                {reg.residency_requirement === "yes" && (
                  <div className="wb-req wb-req--pass">
                    <dt className="wb-req__k">Residency</dt>
                    <dd className="wb-req__v">
                      {reg.residency_duration}
                      <small>in {jurisdiction.name}</small>
                    </dd>
                  </div>
                )}
                {reg.min_age && (
                  <div className="wb-req wb-req--pass">
                    <dt className="wb-req__k">Minimum age</dt>
                    <dd className="wb-req__v">{reg.min_age}</dd>
                  </div>
                )}
              </dl>
              {reg.eligibility_source_url && (
                <p className="wb-src">
                  Source:{' '}
                  <a href={reg.eligibility_source_url} target="_blank" rel="noreferrer">
                    {reg.eligibility_source_url}
                  </a>
                </p>
              )}
            </div>
          </section>

          {/* WHY THIS SEAT */}
          <section className="wb-sec">
            <h2 className="wb-sec__h">Why this seat</h2>
            <div className="wb-detail__card">
              <div className="sawb-figure">
                <span className="sawb-figure__n">37%</span>
                <p className="sawb-figure__d">
                  higher chance for a <b>new entrant</b> here compared to other offices.
                </p>
              </div>
              <div className="wb-callout">
                <span aria-hidden="true">◆</span>
                <span>
                  <b>No incumbent.</b> The representative who previously held this
                  office isn't running again.
                </span>
              </div>
            </div>
          </section>

          {/* HOW IT WORKS */}
          <section className="wb-sec">
            <h2 className="wb-sec__h">How it works</h2>
            <HowItWorksTimeline />
          </section>
        </div>
      </div>

      {/* THE RAIL — the goal, and the only button on the page. */}
      <aside className="wb-rail">
        <div className="wb-rail__card">
          <div>
            <div className="wb-detail__eyebrow">Recommended goal</div>
            <div className="sawb-goal">{formatUSD(recommendedGoalCents)}</div>
            <p className="sawb-goal__cap">Drag to set your own fundraising target</p>
          </div>

          <div>
            <input
              className="sawb-range"
              type="range"
              aria-label="Your fundraising goal"
              min={GOAL_FLOOR_CENTS}
              max={GOAL_CEILING_CENTS}
              step={100000}
              value={goalCents}
              onChange={(e) => setGoalCents(Number(e.target.value))}
            />
            <div className="sawb-range__legend">
              <span>{formatUSD(GOAL_FLOOR_CENTS)}</span>
              <span>{formatUSD(GOAL_CEILING_CENTS)}</span>
            </div>
          </div>

          <div className="sawb-your">
            <span>Your goal</span>
            <b>
              {formatUSD(goalCents)}
              {goalAdjusted && <em>adjusted</em>}
            </b>
          </div>

          <button className="wb-btn wb-btn--primary sawb-cta" onClick={startACampaign}>
            Start a campaign →
          </button>
        </div>
      </aside>
    </div>
  )
}

export default StartAWouldBe
