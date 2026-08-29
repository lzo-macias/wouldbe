/* Typed debates can have many votes open at once.
 *
 * THE CONFLICT: idx_debate_matches_one_open enforces ONE open ballot per debate.
 * That is right for a live debate — the host puts a single vote screen up in
 * front of a room watching one stream, and two at once is not a state the room
 * can act on. It is wrong for a typed debate, where five rounds' worth of
 * answers may already be published and every one of them is readable, and
 * therefore votable, at the same time. There is no host in the room to take
 * turns for.
 *
 * `auto_opened` is what separates the two. A typed match opens ITSELF the moment
 * its round's answers are released (see ensureTypedMatchVote) and is marked
 * auto_opened; a host-opened one is not. The uniqueness rule then applies only
 * to the host-opened kind, so the live guarantee survives intact and typed
 * debates are unbounded.
 */

exports.up = (pgm) => {
    pgm.addColumns('debate_matches', {
        // TRUE when the release of the round opened this vote, not a person.
        auto_opened: { type: 'boolean', notNull: true, default: false },
    });

    // Rebuild the guarantee, narrowed to host-opened rows.
    pgm.sql(`DROP INDEX IF EXISTS idx_debate_matches_one_open;`);
    pgm.sql(`
        CREATE UNIQUE INDEX idx_debate_matches_one_open
            ON debate_matches (debate_id)
            WHERE voting_state = 'open' AND auto_opened = false;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS idx_debate_matches_one_open;`);
    // Restoring the original index would fail on any debate that has more than
    // one auto-opened vote, which is the normal state of a typed debate — so the
    // rows are closed first. They can be reopened by re-reading the schedule.
    pgm.sql(`UPDATE debate_matches SET voting_state = 'closed' WHERE auto_opened = true;`);
    pgm.sql(`
        CREATE UNIQUE INDEX idx_debate_matches_one_open
            ON debate_matches (debate_id)
            WHERE voting_state = 'open';
    `);
    pgm.dropColumns('debate_matches', ['auto_opened']);
};
