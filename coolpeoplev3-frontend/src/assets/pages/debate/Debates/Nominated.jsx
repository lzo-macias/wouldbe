// ============================================================================
// Nominated — the public nomination tally, ranked.
//
// Rows come from GET /api/debates/:id/full → `nominations`, i.e.
// getDebateNominationCounts: one row per NOMINEE, keyed on nominee_user_id (not
// `id`), with nomination_count, the nominee's identity, their optional public
// `link`, every ACTIVE campaign they hold (`wouldbes`, id + title), and
// `vote_points` — the sum of every 1–5 they have been given against a criterion
// in this debate.
//
// THE ROW READS LEFT TO RIGHT AS: who they are, then what they've earned.
//
//   rank · face · name ······ campaigns · points · nominations
//
// ORDER CHANGES THE MOMENT THE FIRST BALLOT LANDS. Before any votes, the board
// is a nomination tally and ranks by nominations — it is the only signal there
// is. Once anyone has been scored it ranks by POINTS, because the debate has
// started answering the question the nominations were only guessing at. The
// nomination count stays on every row either way; it is still worth showing,
// it just stops being what the order means.
//
// The two counts sit together on the right, nominations hugging the edge, so
// the column of numbers lines up down the board and the eye compares like with
// like. The face is its own element rather than living inside .dbt-who: it is
// identity, the same size on every row, and it should not be pushed around by
// the name's flex growth next to it.
//
// NO FETCHING HERE ANY MORE. This component used to request /api/wouldbes/:id
// once per nominee just to get a title — N requests to render one column, all
// of them repeated on every mount. The titles come down with the tally now.
// ============================================================================

import Trophy from './Trophy'

import { votingStarted } from './boardSignals'

const fullName = (n) =>
    [n.first_name, n.last_name].filter(Boolean).join(' ') || n.username

/**
 * @param {array}  nominated     the tally from /debates/:id/full
 * @param {string} winnerUserId  the crowned winner's user id, once the debate
 *                               has one. Null while it is still being decided —
 *                               and the difference matters: the leader of a live
 *                               debate has not won it, so they get a different
 *                               mark and a different word.
 */
function Nominated({ nominated = [], winnerUserId = null }) {
    // Has anyone been scored yet? One pass, and it decides the sort below AND
    // what the board calls itself — see votingStarted() below, which AnyDebate
    // uses for the tab label so the two can never disagree.
    const scored = votingStarted(nominated)

    // Sorting a COPY: nominated is props, and Array.prototype.sort mutates in
    // place. Points first once they exist, nominations as the tie-break so a
    // field with equal points still ranks in a stable, meaningful order.
    const ordered = [...nominated].sort((a, b) =>
        scored
            ? (b.vote_points || 0) - (a.vote_points || 0) ||
              (b.nomination_count || 0) - (a.nomination_count || 0)
            : (b.nomination_count || 0) - (a.nomination_count || 0)
    )

    if (!ordered.length) return <p className="dbt-empty">No nominations yet.</p>

    return (
        <ol>
            {ordered.map((contestant, i) => {
                // Guarded: `wouldbes` is a jsonb array from the server and is []
                // for anyone with no launched campaign, but an older cached
                // payload could still arrive without the key at all.
                const wouldbes = contestant.wouldbes || []
                const points = contestant.vote_points || 0
                // Two different claims, and they must not be confused:
                //   won     — the debate is decided and this is the champion
                //   leading — most points so far, nothing decided
                // A trophy on a live leader would announce a result that hasn't
                // happened; the word and the styling both change.
                const won = !!winnerUserId && contestant.nominee_user_id === winnerUserId
                const leading = !won && !winnerUserId && scored && i === 0
                return (
                    <li
                        key={contestant.nominee_user_id}
                        className={won ? 'is-winner' : leading ? 'is-leading' : undefined}
                    >
                        {won || leading ? (
                            <span
                                className={`dbt-crown ${won ? 'dbt-crown--won' : 'dbt-crown--leading'}`}
                                title={won ? 'Won this debate' : 'Leading on points'}
                            >
                                <Trophy size={18} />
                            </span>
                        ) : (
                            <span className="dbt-rank">{i + 1}</span>
                        )}

                        {/* Between the rank and the name, always the same size —
                            a blank disc when there is no photo, so the names stay
                            on one vertical line down the whole board. */}
                        {contestant.profile_photo_url ? (
                            <img
                                className="dbt-avatar"
                                src={contestant.profile_photo_url}
                                alt=""
                            />
                        ) : (
                            <span className="dbt-avatar dbt-avatar--blank" aria-hidden="true">
                                {(fullName(contestant) || '?').charAt(0)}
                            </span>
                        )}

                        <div className="dbt-who">
                            <p>{fullName(contestant)}</p>
                            {(won || leading) && (
                                <span className="dbt-winner-tag">
                                    {won ? 'Winner' : 'Leading'}
                                </span>
                            )}
                        </div>

                        {contestant.link && (
                            <div className="dbt-links">
                                {/* The URL is validated to http/https on the write
                                    path; rel="noopener noreferrer" is still required. */}
                                <a
                                    href={contestant.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {contestant.link}
                                </a>
                            </div>
                        )}

                        {/* THEIR ACTIVE CAMPAIGN, ALWAYS. Whatever the board is
                            currently ranking by — nominations, votes, points —
                            a person standing for something is the most useful
                            thing on their row, and the one piece of it that
                            leads somewhere. Only launched, non-retired campaigns
                            reach this payload, so anything here is live. */}
                        {!!wouldbes.length && (
                            <div className="dbt-links dbt-wouldbes">
                                {wouldbes.map((w) => (
                                    <a key={w.id} href={`/wouldbe/${w.id}`}>
                                        {w.title}
                                    </a>
                                ))}
                            </div>
                        )}

                        {/* Points, then nominations against the right edge. The
                            label says "points" and not "votes" on purpose: this
                            is the SUM of 1–5 criterion scores, so it grows by
                            five per criterion scored, not by one per person.

                            NOTHING SCORED, NOTHING SHOWN. A "0 Points" on every
                            row before the first ballot is a column of noise, and
                            it reads as a real score of zero rather than as "no
                            votes have been cast yet" — which are not the same
                            claim. The column simply isn't there until it means
                            something. */}
                        {points > 0 && (
                            <div className="dbt-tally dbt-tally--points">
                                <span>{points}</span>
                                <p>Points</p>
                            </div>
                        )}

                        <div className="dbt-tally">
                            <span>{contestant.nomination_count}</span>
                            <p>Nominations</p>
                        </div>
                    </li>
                )
            })}
        </ol>
    )
}

export default Nominated
