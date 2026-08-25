/*
 * The debate's schedule is now the LIVESTREAM, not the prompts.
 *
 * WHAT CHANGED IN THE PRODUCT:
 *   Prompts used to carry the calendar — each one opened at start + i*interval
 *   and closed when the next opened, and the debate ran on that drip. Prompts are
 *   now just text, released without a per-prompt window, and the one scheduled
 *   event is the concluding Twitch stream. So the sponsor schedules a broadcast,
 *   not a sequence of deadlines.
 *
 *   Who appears on that broadcast is decided by NOMINATIONS: the most-nominated
 *   contestants are invited. invite_slots is how many of them — the cut line.
 *   Ranking already exists (nominations.getDebateNominationCounts orders by
 *   COUNT(DISTINCT nominator_user_id) DESC); this column records how far down
 *   that list to go, which the sponsor chooses at application time.
 *
 * WHY ON debate_streams AND NOT debates: it is a property of the broadcast. A
 * debate that is re-streamed, or streamed twice, gets its own slot count per
 * stream rather than one number pinned to the debate forever.
 *
 * NOT DROPPING prompts.release_at / response_deadline: existing debates were
 * scheduled with them, and the columns still describe those rows truthfully. New
 * applications simply leave them NULL.
 */

exports.up = (pgm) => {
    pgm.addColumns('debate_streams', {
        // how many top-nominated contestants get invited onto the stream.
        // NULL = not decided yet; the invite job refuses to run without it.
        invite_slots: {
            type: 'integer',
            check: 'invite_slots IS NULL OR (invite_slots > 0 AND invite_slots <= 100)',
        },
    });

    // "what is scheduled next" is the query this table now exists to answer.
    pgm.createIndex('debate_streams', ['status', 'scheduled_at'], {
        name: 'idx_debate_streams_upcoming',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('debate_streams', ['status', 'scheduled_at'], { name: 'idx_debate_streams_upcoming' });
    pgm.dropColumns('debate_streams', ['invite_slots']);
};
