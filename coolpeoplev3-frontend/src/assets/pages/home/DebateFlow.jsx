import React, { lazy, Suspense } from 'react'
import './wouldbeflow.css'
import './dcompose.css'

const StartADebate = lazy(() => import('../debate/StartADebate/StartADebate'))

/* ============================================================================
 * DebateFlow — hosting a debate, in the feed column.
 *
 * IT IS THE REAL FORM, MOUNTED HERE. StartADebate is the application this app
 * already has — your existing drafts, casual or corporate, the prompts, the
 * prize, the agreement. Nothing is reimplemented; what changed is that the two
 * places it used to NAVIGATE to are now steps in the same column.
 *
 * THE FLOW WAS PAGE-BY-PAGE and did not need to be: /startadebate for the
 * form, then a route for broadcast setup, then the debate itself. Three routes
 * for one sitting, and every hop threw away the feed behind it.
 *
 * IT IS ONE PANEL NOW. Every debate is written, so there is no channel to
 * connect and no broadcast step; the form carries its own end state, because it
 * is also reachable at /startadebate where there is no flow around it.
 *
 * THE ONE THING THAT IS STILL A PAGE is the prize agreement — a contract read
 * on a screen with nothing else on it, which is the honest way to ask somebody
 * to promise something at their own expense.
 * ==========================================================================*/

export default function DebateFlow({ onClose }) {
    return (
        <div className="wbf">
            <Suspense fallback={<p className="wbf__wait">Loading the form…</p>}>
                <div className="wbf__form">
                    <StartADebate embedded onCancel={onClose} />
                </div>
            </Suspense>
        </div>
    )
}
