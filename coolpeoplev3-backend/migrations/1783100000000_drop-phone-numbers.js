/* Drop every phone number the schema was prepared to hold.
 *
 * WHY. The product commitment is that we do not collect phone numbers. The
 * schema contradicted that in four places on `users` and one on
 * `debate_nomination_invites` — and that last one held a THIRD PARTY's number,
 * someone who never agreed to anything, indexed and directly subpoenable.
 *
 * Columns that merely *could* hold PII are not harmless. They are a standing
 * invitation for the next write path to start filling them, and in a discovery
 * request "we have a phone_number column" is a question you have to answer.
 * Verified empty before writing this: 0 rows in either table had a number, so
 * nothing is lost here.
 *
 * WHAT REPLACES IT. Nomination-by-text is now a CLIENT-SIDE handoff: the invite
 * API returns a prepared message and the browser opens the nominator's own
 * Messages app via an `sms:` URL with no recipient. The nominator picks the
 * contact in their own OS picker and presses send themselves. The number never
 * reaches the page, the request, or the logs — so there is nothing here to store
 * and nothing to produce later.
 *
 * The SMS *delivery* columns go with it. We are no longer a sender, so
 * sms_status/sms_sent_at/sms_error can only ever have lied about an outcome we
 * cannot observe: once the OS takes over we have no idea whether the nominator
 * actually hit send. The token being claimed is the only real signal, and that
 * is already recorded in `claimed_at`.
 */

exports.up = (pgm) => {
    // ---- debate_nomination_invites -------------------------------------
    // Both of these NAME a column we're about to drop, so they go first.
    // Postgres would cascade them away silently otherwise, and the undelivered
    // index would lose its email half as collateral.
    pgm.dropConstraint('debate_nomination_invites', 'debate_nomination_invites_chck');
    pgm.dropIndex('debate_nomination_invites', ['debate_id', 'nominator_user_id', 'invitee_phone'], {
        name: 'idx_nom_invite_unique_phone',
    });
    pgm.dropIndex('debate_nomination_invites', 'created_at', {
        name: 'idx_nom_invite_undelivered',
    });

    pgm.dropColumns('debate_nomination_invites', [
        'invitee_phone',
        // the per-channel SMS record — see the header note
        'sms_status',
        'sms_sent_at',
        'sms_error',
    ]);

    // An invite still has to be addressed to SOMEBODY; there are just two ways
    // to say who now instead of three.
    pgm.addConstraint('debate_nomination_invites', 'debate_nomination_invites_chck', {
        check: 'invitee_email IS NOT NULL OR invitee_username IS NOT NULL',
    });

    // Same index, email-only predicate — there is no second channel to wait on.
    pgm.createIndex('debate_nomination_invites', 'created_at', {
        name: 'idx_nom_invite_undelivered',
        where: "email_status = 'queued'",
    });

    // ---- users ----------------------------------------------------------
    // phone_number carried a UNIQUE constraint; dropping the column takes it.
    pgm.dropColumns('users', [
        'phone_number',
        'phone_verified_at',
        'phone_verification_code_hash',
        'phone_verification_expires_at',
    ]);
};

/* Restores the SHAPE only. The numbers themselves are gone and are not coming
 * back, which is the entire point of the up migration — treat this as an escape
 * hatch for a bad deploy, not as an undo. */
exports.down = (pgm) => {
    pgm.addColumns('users', {
        phone_number: { type: 'varchar(32)', unique: true },
        phone_verified_at: { type: 'timestamptz' },
        phone_verification_code_hash: { type: 'text' },
        phone_verification_expires_at: { type: 'timestamptz' },
    });

    pgm.dropIndex('debate_nomination_invites', 'created_at', { name: 'idx_nom_invite_undelivered' });
    pgm.dropConstraint('debate_nomination_invites', 'debate_nomination_invites_chck');

    pgm.addColumns('debate_nomination_invites', {
        invitee_phone: { type: 'varchar(32)' },
        sms_status: {
            type: 'text',
            notNull: true,
            default: 'skipped',
            check: "sms_status IN ('skipped','queued','sent','failed')",
        },
        sms_sent_at: { type: 'timestamptz' },
        sms_error: { type: 'text' },
    });

    pgm.addConstraint('debate_nomination_invites', 'debate_nomination_invites_chck', {
        check: 'invitee_email IS NOT NULL OR invitee_phone IS NOT NULL OR invitee_username IS NOT NULL',
    });
    pgm.createIndex('debate_nomination_invites', ['debate_id', 'nominator_user_id', 'invitee_phone'], {
        name: 'idx_nom_invite_unique_phone',
        unique: true,
        where: "invitee_phone IS NOT NULL AND status = 'pending'",
    });
    pgm.createIndex('debate_nomination_invites', 'created_at', {
        name: 'idx_nom_invite_undelivered',
        where: "email_status = 'queued' OR sms_status = 'queued'",
    });
};
