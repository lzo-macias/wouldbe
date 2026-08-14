/*
 * Streaming on Twitch is now optional, and opting out has to be RECORDED.
 *
 * WHY A COLUMN AND NOT JUST A CLIENT-SIDE SKIP: without a stored flag, "skipped"
 * and "hasn't got to it yet" look identical — both are a stream row with no
 * channel. The sponsor would be shown the connect screen again on every reload,
 * and an admin reviewing the application could not tell a deliberate no from an
 * unfinished setup.
 *
 * NOT debate_streams.status = 'cancelled': that means a broadcast was scheduled
 * and then called off. This is a broadcast that was never going to happen, which
 * is a different fact about a different decision.
 *
 * The date stays on the row either way. The debate still has a day it runs; it
 * just isn't being streamed.
 */

exports.up = (pgm) => {
    pgm.addColumns('debate_streams', {
        // when the sponsor declined to stream on Twitch. NULL = still open.
        channel_opt_out_at: { type: 'timestamptz' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('debate_streams', ['channel_opt_out_at']);
};
