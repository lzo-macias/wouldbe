import React, { useState } from 'react'
import './DebateCards.css'

// ============================================================================
// CriteriaAndPromptsCard — two flippable panels: the prompts a debate will ask,
// and the criteria its winner is judged on.
//
// `prompts` defaults to empty on purpose: GET /api/debates/:id/prompts is
// admin-gated, so a public viewer legitimately has none to show. The card must
// render the criteria panel regardless rather than crashing on undefined.
// ============================================================================

function CriteriaAndPromptsCard({ criteria = [], prompts = [], debate = {} }) {
    const [screen, setScreen] = useState('1')

    // win_type is the column ('sponsor_decision' | 'general_vote' | 'hybrid').
    const sponsorDecides = debate.win_type === 'sponsor_decision'

    const screens = {
        '1': (
            <>
                <div className="dbt-titlebar">
                    <h3>Prompts</h3>
                </div>
                <div className="dbt-body">
                    <p className="dbt-blurb">
                        these prompts will be asked during the debate — some may be
                        omitted, and some not listed here may be added
                    </p>
                    {prompts.length ? (
                        <ol className="dbt-list">
                            {prompts.map((element, i) => (
                                <li key={element.id || i}>{element.description}</li>
                            ))}
                        </ol>
                    ) : (
                        <p className="dbt-empty">
                            The prompts for this debate haven't been published yet.
                        </p>
                    )}
                    <button
                        type="button"
                        className="dbt-flip"
                        onClick={() => setScreen('2')}
                        aria-label="Show judging criteria"
                    >
                        Criteria
                        <span className="dbt-flip-arrow" aria-hidden="true">&rsaquo;</span>
                    </button>
                </div>
            </>
        ),
        '2': (
            <>
                <div className="dbt-titlebar">
                    <h3>Criteria</h3>
                </div>
                <div className="dbt-body">
                    {sponsorDecides && (
                        <p className="dbt-blurb">
                            the winner will be chosen among the contestants with the
                            most nominations by
                            {debate.sponsor_photo_url && (
                                <img src={debate.sponsor_photo_url} alt="" />
                            )}
                            <span>{debate.sponsor_name}</span> along the following
                            criteria
                        </p>
                    )}
                    {criteria.length ? (
                        <ol className="dbt-list">
                            {criteria.map((element, i) => (
                                <li key={element.criterion_id || i}>
                                    <strong>{element.display_name}</strong>
                                    {element.description}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="dbt-empty">
                            The judging criteria for this debate haven't been set yet.
                        </p>
                    )}
                    <button
                        type="button"
                        className="dbt-flip"
                        onClick={() => setScreen('1')}
                        aria-label="Show prompts"
                    >
                        <span className="dbt-flip-arrow" aria-hidden="true">&lsaquo;</span>
                        Prompts
                    </button>
                </div>
            </>
        ),
    }

    return <div className="dbt-card">{screens[screen]}</div>
}

export default CriteriaAndPromptsCard
