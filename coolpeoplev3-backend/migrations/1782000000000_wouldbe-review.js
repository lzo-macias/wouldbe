/*
 * Admin review for WouldBe campaigns.
 *
 * THE HOLE THIS FILLS: wouldbe.launch_status has six values and NOTHING ever
 * wrote it after creation. Every campaign sat at 'draft' forever, and
 * pledges.js refuses a pledge unless launch_status = 'active' — so no campaign
 * could ever take a pledge. Debates had an approve/reject path; campaigns had
 * none, and no admin route listed them either.
 *
 * WHAT DECIDES APPROVAL is already built and simply wasn't being consulted:
 *   candidateCommittees.hasActiveVerifiedCommittee({ userId, raceId })
 * — described in its own file as "THE launch gate §5 consults". A public
 * fundraising campaign without a registered committee is the one thing on this
 * platform that is actually illegal, so it is a hard gate, not a checklist item.
 *
 * These columns are the review RECORD: who decided, when, and why. The reason is
 * shown back to the candidate — "failed" with no explanation is how you generate
 * a support ticket for every rejection.
 */

exports.up = (pgm) => {
    pgm.addColumns('wouldbe', {
        // shown to the candidate on a rejection, and kept on an approval as the
        // admin's note to the file
        review_note: { type: 'text' },
        // when an admin last decided. NULL = never reviewed.
        reviewed_at: { type: 'timestamptz' },
        // which admin. No FK to admin_users: the reviewer is a USER who happens
        // to hold an admin role, and roles change.
        reviewed_by_user_id: { type: 'uuid', references: 'users(id)' },
    });

    // The review queue's query: "everything not yet live, oldest first".
    pgm.createIndex('wouldbe', ['launch_status', 'created_at'], {
        name: 'idx_wouldbe_review_queue',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('wouldbe', ['launch_status', 'created_at'], { name: 'idx_wouldbe_review_queue' });
    pgm.dropColumns('wouldbe', ['review_note', 'reviewed_at', 'reviewed_by_user_id']);
};
