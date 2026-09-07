import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import api from '../../../lib/api'
import PrizeAgreementStep from '../../../component/StartADebate/PrizeAgreementStep'
import './prizeagreement.css'

/* ============================================================================
 * PrizeAgreement — signing the promise, on its own page.
 *
 * IT IS A CONTRACT, and it was rendering inline at the bottom of the compose
 * card: eleven clauses of legal text squeezed into a feed column, and unstyled,
 * because PrizeAgreementStep.css is scoped to `.applyPage` — a wrapper the
 * inline card never had. So the one thing on this platform somebody is
 * personally liable for looked like a paragraph that had lost its stylesheet.
 *
 * A page, then. Not because the flow wants a hop — everything else about
 * posting stayed in the feed — but because this is the one step where the
 * reader is agreeing to deliver something at their own expense, and a screen
 * with nothing else on it is the honest way to ask for that.
 *
 * The draft is already saved when they arrive, so leaving without signing loses
 * nothing: it sits unsubmitted until they come back.
 * ==========================================================================*/

export default function PrizeAgreement() {
    const { debateId } = useParams()
    const navigate = useNavigate()
    const [debate, setDebate] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        api.get(`/api/debates/${debateId}/full`)
            .then(({ data }) => { if (!cancelled) setDebate(data.debate) })
            .catch(() => { if (!cancelled) setError('Could not load this debate.') })
        return () => { cancelled = true }
    }, [debateId])

    return (
        <div className="pgPage">
            <div className="pgWrap">
                <Link className="pgBack" to="/homev2">← Back to your feed</Link>

                <header className="pgHead">
                    <span className="pgKicker">One thing before review</span>
                    <h1 className="pgTitle">Sign the prize agreement</h1>
                    <p className="pgDek">
                        {debate
                            ? <>Your draft <b>“{debate.title}”</b> is saved. It goes to review once this is signed — and stays a draft until then, so nothing is lost if you close this.</>
                            : 'Your draft is saved. It goes to review once this is signed.'}
                    </p>
                </header>

                {error && <p className="pgError" role="alert">{error}</p>}

                {/* .applyPage is what PrizeAgreementStep.css is scoped to. Kept
                    as the wrapper rather than rewriting those 109 lines against a
                    new name: the stylesheet is correct, it was simply never
                    given the element it needs. */}
                <div className="applyPage pgBody">
                    <PrizeAgreementStep
                        debateId={debateId}
                        onSigned={() => navigate(`/debate/${debateId}`)}
                    />
                </div>
            </div>
        </div>
    )
}
