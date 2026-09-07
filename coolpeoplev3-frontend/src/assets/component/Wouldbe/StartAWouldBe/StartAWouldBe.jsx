import { useState } from 'react'
import ImagePicker from "../../ImagePicker/ImagePicker"
import { formatUSD } from '../WouldBeRows/deadlineFormat'
import "./StartAWouldBe.css"
import FilingTimeline from '../FilingTimeline/FilingTimeline'
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

// A jurisdiction's `type` is a database enum — state_leg_lower, us_house,
// municipal — and none of those are words a candidate uses. Anything not in the
// map falls through to the jurisdiction's own name rather than to the raw value:
// an unmapped enum on screen is the bug this map exists to stop.
const JURISDICTION_TYPE = {
  us_senate: "US Senate",
  us_house: "US House district",
  state_leg_upper: "State Senate district",
  state_leg_lower: "State House district",
  statewide: "Statewide",
  county: "County",
  municipal: "City or town",
  school_district: "School district",
  special_district: "Special district",
  national: "National",
}

function StartAWouldBe({ office, jurisdiction, onComplete }) {
  const originalGoalCents = office.goalCents
  // Seed from the recommended goal; fall back to the $5,000 floor when the
  // office has no recommended goal (that endpoint can return null).
  // Optional. Held here until there is an endpoint for it — see ImagePicker.
  const [image, setImage] = useState(null)
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
                  {/* THE NAME, then what kind of thing it is. This printed
                      `jurisdiction.type` alone — a raw column value, so the row
                      read "Jurisdiction: state_leg_lower", which is a database
                      enum shown to a candidate. The name is the answer to
                      "which jurisdiction"; the type is a note under it. */}
                  <dd className="wb-req__v">
                    {jurisdiction.name || JURISDICTION_TYPE[jurisdiction.type] || "—"}
                    {jurisdiction.name && JURISDICTION_TYPE[jurisdiction.type] && (
                      <small>{JURISDICTION_TYPE[jurisdiction.type]}</small>
                    )}
                  </dd>
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

          {/* OPTIONAL, and it belongs with the ask rather than in the plan:
              plan components already take their own images, and this is the one
              picture that stands for the campaign itself. */}
          <div className="sawb-img">
            <span className="sawb-img__l">Campaign image</span>
            <ImagePicker value={image} onChange={setImage} note={null} />
          </div>

          <button className="wb-btn wb-btn--primary sawb-cta" onClick={startACampaign}>
            Start a campaign →
          </button>
          {/* THE TERMS, under the button that accepts them. A four-card "How it
              works" ran above this explaining the model in the abstract; the
              one sentence that changes whether somebody presses the button is
              that nothing is collected until the goal is met, and it belongs
              here rather than four scrolls up. */}
          <span className="sawb-terms">
            Campaigns only get fundraised when the goal is reached, not before.
            Everyone who pledged gets notified that it is time to contribute.
          </span>
        </div>
      </aside>
    </div>
  )
}

export default StartAWouldBe
