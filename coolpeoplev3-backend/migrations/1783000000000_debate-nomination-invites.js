/* debate_nomination_invites — nominating someone who is NOT (yet) on the site.
 *
 * WHY A SECOND TABLE. `nominations` is the tally, and every column in it is a
 * FK to users: debate_id, nominator_user_id, nominee_user_id, all NOT NULL. That
 * is correct — a nomination is a countable vote for a real account, and letting
 * a typed-in email into that table would mean a tally where two rows might or
 * might not be the same person. So the reach-out lives here instead, and a row
 * here becomes a row THERE only once there is an account to point at.
 *
 * The invite therefore has two shapes, distinguished by invitee_user_id:
 *   RESOLVED   — the handle matched an existing account. The nomination is
 *                created immediately; this row is the record of the notice we
 *                sent them, with nomination_id pointing at it.
 *   UNRESOLVED — nobody by that email/phone yet. The row holds the contact
 *                details and a claim token, and stays 'pending' until whoever
 *                owns that address signs up and claims it.
 *
 * DELIVERY IS PER CHANNEL, in columns, not in a queue table. There are exactly
 * two channels and they succeed and fail independently — an email that lands
 * while the SMS bounces is a normal outcome, and one `status` column cannot say
 * that. `notifications` is not reusable here for the same reason the tally
 * isn't: recipient_user_id is NOT NULL, and the whole point of an invite is that
 * there may be no user to name.
 *
 * CONTACT DETAILS ARE PII belonging to someone who has not agreed to anything.
 * They are stored because you cannot send an invite without them, and nothing
 * else reads them: the only routes over this table are the nominator's own list
 * and the claim path.
 */

exports.up = (pgm) => {
    pgm.createTable('debate_nomination_invites', {
        // surrogate primary key
        id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
        // which debate they are being invited into
        debate_id: { type: 'uuid', notNull: true, references: 'debates(id)', onDelete: 'CASCADE' },
        // who sent it — always the caller's token, never the body
        nominator_user_id: { type: 'uuid', notNull: true, references: 'users(id)' },

        // ---- what the nominator typed (normalised, at least one required) ----
        // citext so a re-invite to "Sam@x.com" collides with "sam@x.com"
        invitee_email: { type: 'citext' },
        // E.164 only ('+15551234567'), normalised on the write path
        invitee_phone: { type: 'varchar(32)' },
        // set when they were named by handle rather than by address
        invitee_username: { type: 'citext' },

        // ---- resolution ----
        // the account this invite turned out to be for: stamped at send time if
        // the handle already matched one, or at claim time if they signed up
        invitee_user_id: { type: 'uuid', references: 'users(id)' },
        // the tally row this became, once there was an account to point at
        nomination_id: { type: 'uuid', references: 'nominations(id)', onDelete: 'SET NULL' },

        // opaque claim secret in the invite link. Unguessable, single-purpose,
        // and NOT a JWT: it must survive a password reset and be revocable by
        // deleting one row.
        token: { type: 'text', notNull: true, unique: true },
        status: {
            type: 'text',
            notNull: true,
            default: 'pending',
            check: "status IN ('pending','nominated','revoked','expired')",
        },
        // when an unresolved invite was claimed by a new signup
        claimed_at: { type: 'timestamptz' },
        // invites are a reach-out, not a standing offer
        expires_at: { type: 'timestamptz' },

        // ---- delivery, per channel ----
        // 'skipped' = no address for this channel (the default case for SMS,
        // which is optional). 'queued' = recorded but no provider configured yet.
        email_status: {
            type: 'text',
            notNull: true,
            default: 'skipped',
            check: "email_status IN ('skipped','queued','sent','failed')",
        },
        email_sent_at: { type: 'timestamptz' },
        email_error: { type: 'text' },
        sms_status: {
            type: 'text',
            notNull: true,
            default: 'skipped',
            check: "sms_status IN ('skipped','queued','sent','failed')",
        },
        sms_sent_at: { type: 'timestamptz' },
        sms_error: { type: 'text' },

        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }, {
        constraints: {
            // An invite with no way to reach anyone is not an invite.
            check: 'invitee_email IS NOT NULL OR invitee_phone IS NOT NULL OR invitee_username IS NOT NULL',
        },
    });

    /* One live invite per (debate, nominator, contact). PARTIAL, and one index
     * per column, because a plain UNIQUE over all three would treat NULLs as
     * distinct and let the same person be re-invited by email forever. Scoped to
     * status='pending' on purpose: once an invite is 'nominated' or 'revoked' it
     * is history, and re-inviting after that is a new decision, not a duplicate. */
    pgm.createIndex('debate_nomination_invites', ['debate_id', 'nominator_user_id', 'invitee_email'], {
        name: 'idx_nom_invite_unique_email',
        unique: true,
        where: "invitee_email IS NOT NULL AND status = 'pending'",
    });
    pgm.createIndex('debate_nomination_invites', ['debate_id', 'nominator_user_id', 'invitee_phone'], {
        name: 'idx_nom_invite_unique_phone',
        unique: true,
        where: "invitee_phone IS NOT NULL AND status = 'pending'",
    });

    // The claim path looks up by email to find what is waiting for a new signup.
    pgm.createIndex('debate_nomination_invites', 'invitee_email', {
        name: 'idx_nom_invite_pending_email',
        where: "status = 'pending'",
    });
    // "who have I invited to this debate" — the nominator's own list.
    pgm.createIndex('debate_nomination_invites', ['debate_id', 'nominator_user_id'], {
        name: 'idx_nom_invite_by_nominator',
    });
    // The sender picks up anything a provider has not taken yet.
    pgm.createIndex('debate_nomination_invites', 'created_at', {
        name: 'idx_nom_invite_undelivered',
        where: "email_status = 'queued' OR sms_status = 'queued'",
    });
};

exports.down = (pgm) => {
    pgm.dropTable('debate_nomination_invites');
};
