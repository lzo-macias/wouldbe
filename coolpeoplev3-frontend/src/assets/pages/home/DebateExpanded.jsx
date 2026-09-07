import React from 'react'
import { FieldList, OpenVote, WinnerBanner, Standings, standingsRows } from './DebatePage'
import { BRACKETS } from './debateFixture'
import './DebatePage.css'
import './DebateExpanded.css'

/* ============================================================================
 * DebateExpanded — what a debate card opens into, on the feed.
 *
 * A FEED CARD IS ONE PROMPT OUT OF A DEBATE, not the debate. It used to open
 * onto the whole apparatus — the lede, a stats strip, the bracket, a Responses
 * / Votes tab pair and a two-pane match list — which made the card and the
 * /debate screen two answers to the same question, and the card's answer was
 * the worse one because it had a quarter of the room to give it.
 *
 * So it opens onto exactly what the debate screen shows for the bracket you are
 * looking at: the ballot, and the rest of the responses. Both come from that
 * screen's own components, so the two can never drift. The Debate button in the
 * card's corner is how you get the tournament.
 * ==========================================================================*/

// One bracket is open at a time — that is the format, not a display choice — so
// there is one ballot and one field. Prefer the open one; if the debate has
// finished, the last one that actually ran.
const currentBracket = () =>
    BRACKETS.find((b) => b.state === 'open')
    ?? [...BRACKETS].reverse().find((b) => b.seats)
    ?? null

const winnerOf = (bk) =>
    bk.seats
        ? [...(bk.seats || []), ...(bk.field || [])].sort((a, b) => b.votes - a.votes)[0]
        : null

export default function DebateExpanded({ onSignIn }) {
    const bk = currentBracket()
    if (!bk) return <p className="xp__wait">Nothing has been released in this debate yet.</p>

    const signedIn = Boolean(localStorage.getItem('token'))

    // A BALLOT ONLY WHILE THERE IS SOMETHING TO DECIDE. Once a bracket has
    // settled the question is answered, and offering a vote on it is offering
    // to change a result — so the settled card says who took it instead, in the
    // same banner the debate screen uses.
    const open = bk.state === 'open'
    const win = open ? null : winnerOf(bk)

    return (
        <div className="xp xp--card">
            {open
                ? <OpenVote bk={bk} signedIn={signedIn} onSignIn={onSignIn} />
                : <WinnerBanner bk={bk} win={win} />}
            <section className="xp__sec">
                <h3 className="xp__h">
                    The responses <em>Everybody who answered this prompt</em>
                </h3>
                <div className="rest"><FieldList bk={bk} win={win} /></div>
            </section>

            {/* WHERE THAT LEAVES EVERYBODY. The same dashboard the debate screen
                closes with, and it closes the card for the same reason: somebody
                who has just read one bracket's responses is exactly the reader
                asking who is actually winning this thing. It is the whole
                debate's table, not this bracket's — which is the point, and is
                why it does not change when you open a different card. */}
            <section className="xp__sec xp__stand">
                <h3 className="xp__h">
                    Votes dashboard <em>Across every settled bracket</em>
                </h3>
                <Standings rows={standingsRows()} bare />
            </section>
        </div>
    )
}
