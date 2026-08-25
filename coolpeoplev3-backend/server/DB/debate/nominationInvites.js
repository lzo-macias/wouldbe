const { client, withTransaction } = require("../index.js")
const crypto = require("crypto")

const {
    normalizeEmail,
    normalizePhone,
    sendEmail,
    sendSms,
    APP_URL,
} = require("../../services/notify")

// ============================================================================
// debate_nomination_invites — "nominate someone by email or username".
//
// TWO OUTCOMES, one entry point. The handle either matches an account or it
// doesn't, and the caller should not have to know which before asking:
//
//   MATCHED   → a real nominations row is written immediately (the tally is
//               only ever about accounts), and the invite row is the record of
//               the notice sent to them.
//   UNMATCHED → no nominations row is possible — nominee_user_id is NOT NULL and
//               there is nobody to point it at. The invite row holds the contact
//               details plus a claim token, and stays 'pending' until whoever
//               owns that address signs up, at which point claimInvitesForUser
//               turns it into the nomination it was always meant to be.
//
// DELIVERY NEVER FAILS THE WRITE. The sends happen AFTER the transaction
// commits and their outcome is recorded on the row afterwards. An invite that
// was written but whose email bounced is a delivery problem; rolling the
// nomination back over it would be a data-loss problem.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message)
    e.status = status
    return e
}

// 30 days. Long enough that "I'll deal with it later" still works, short enough
// that a leaked link from last year is dead.
const INVITE_TTL_DAYS = 30

const displayName = (u) =>
    [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username

// resolveHandle — decide whether the nominator typed an address or a handle, and
// find the account behind it if there is one.
//
// The '@' is not the test: "@samreed" is a username and "sam@reed.com" is an
// address, and both contain one. normalizeEmail's shape check (something, @,
// something, dot, something) is what actually separates them, so a leading '@'
// is stripped first — it is how people write handles, and it would otherwise
// make "@sam@x.com" un-parseable either way.
const resolveHandle = async (rawHandle, db = client) => {
    const handle = String(rawHandle || "").trim()
    if (!handle) throw httpError(400, "an email address or username is required")

    const email = normalizeEmail(handle)
    if (email) {
        const { rows } = await db.query(
            `SELECT id, username, first_name, last_name, email
             FROM users WHERE email = $1 AND is_active = true`,
            [email]
        )
        return { kind: "email", email, username: null, user: rows[0] || null }
    }

    const username = handle.replace(/^@/, "")
    // A username with whitespace or an @ left in it is a mistyped email, not a
    // handle — say so rather than reporting "no such user" for an address.
    if (/[\s@]/.test(username)) {
        throw httpError(400, "that doesn't look like a valid email address")
    }
    const { rows } = await db.query(
        `SELECT id, username, first_name, last_name, email
         FROM users WHERE username = $1 AND is_active = true`,
        [username]
    )
    return { kind: "username", email: null, username, user: rows[0] || null }
}

// inviteToNominate — the whole flow behind the nominate form.
//   handle : email address OR username (required)
//   phone  : optional; when present the invite is texted as well as emailed
const inviteToNominate = async ({ debate_id, nominator_user_id, handle, phone }) => {
    if (!nominator_user_id) throw httpError(401, "authentication required")
    if (!debate_id) throw httpError(400, "debate_id is required")

    // Reject an unusable number BEFORE anything is written. Silently dropping it
    // would mean the form says "we texted them" about a number we never had.
    const rawPhone = phone == null ? "" : String(phone).trim()
    const invitee_phone = rawPhone ? normalizePhone(rawPhone) : null
    if (rawPhone && !invitee_phone) {
        throw httpError(400, "that phone number isn't valid — use a 10-digit US number, or +country code")
    }

    const resolved = await resolveHandle(handle)

    // Named by handle and no such handle exists: there is no address to invite
    // them at, so this cannot become an invite. It is the one case the caller has
    // to fix rather than something we can queue.
    if (resolved.kind === "username" && !resolved.user) {
        throw httpError(404, `no account named @${resolved.username} — invite them by email instead`)
    }
    if (resolved.user && resolved.user.id === nominator_user_id) {
        throw httpError(400, "you cannot nominate yourself")
    }

    const token = crypto.randomBytes(32).toString("base64url")
    // For a matched account, the address of record is theirs, not whatever was
    // typed — a username invite has no typed address at all, and an email invite
    // to an alias should still reach the inbox the account actually uses.
    const invitee_email = resolved.user ? resolved.user.email : resolved.email

    let row
    let nomination = null
    try {
        ;({ row, nomination } = await withTransaction(async (tx) => {
            let nominationRow = null

            if (resolved.user) {
                // The tally row. UNIQUE (debate, nominator, nominee) makes a
                // repeat a 23505; that is "you already nominated them", which is
                // not a new invite and must not send a second notice.
                const ins = await tx.query(
                    `INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
                     VALUES ($1, $2, $3)
                     RETURNING *;`,
                    [debate_id, nominator_user_id, resolved.user.id]
                )
                nominationRow = ins.rows[0]
            }

            const inviteIns = await tx.query(
                `INSERT INTO debate_nomination_invites (
                    debate_id, nominator_user_id,
                    invitee_email, invitee_phone, invitee_username,
                    invitee_user_id, nomination_id, token, status, expires_at
                 ) VALUES (
                    $1, $2,
                    $3, $4, $5,
                    $6, $7, $8, $9,
                    NOW() + ($10 || ' days')::interval
                 )
                 RETURNING *;`,
                [
                    debate_id,
                    nominator_user_id,
                    invitee_email,
                    invitee_phone,
                    resolved.username,
                    resolved.user?.id || null,
                    nominationRow?.id || null,
                    token,
                    // A matched invite is already the nomination it was for; only
                    // an unmatched one is still 'pending' anything.
                    nominationRow ? "nominated" : "pending",
                    String(INVITE_TTL_DAYS),
                ]
            )
            return { row: inviteIns.rows[0], nomination: nominationRow }
        }))
    } catch (err) {
        if (err.status) throw err
        if (err.code === "23505") {
            // Which unique it was matters to the reader: the tally's, or one of
            // the two partial invite indexes. Matched on the table prefix rather
            // than a literal name — node-pg-migrate names this one
            // `nominations_uniq_debate_id_...`, not the `..._key` Postgres would
            // pick, and pinning the exact string makes the message a lie the day
            // it changes.
            throw httpError(
                409,
                String(err.constraint || "").startsWith("nominations_")
                    ? "you have already nominated this person for this debate"
                    : "you have already invited that person to this debate"
            )
        }
        if (err.code === "23503") throw httpError(400, "that debate does not exist")
        if (err.code === "22P02") throw httpError(400, "invalid id format")
        console.error(err)
        throw err
    }

    // ---- delivery, after the commit ----
    const { rows: debateRows } = await client.query(
        `SELECT title FROM debates WHERE id = $1`,
        [debate_id]
    )
    const { rows: fromRows } = await client.query(
        `SELECT username, first_name, last_name FROM users WHERE id = $1`,
        [nominator_user_id]
    )
    const debateTitle = debateRows[0]?.title || "a debate"
    const from = fromRows[0] ? displayName(fromRows[0]) : "Someone"

    // A matched account already has the nomination; their link is the debate.
    // An unmatched invite needs the token, which is the only thing that ties a
    // future signup back to this row.
    const link = nomination
        ? `${APP_URL}/debate/${debate_id}`
        : `${APP_URL}/debate/${debate_id}?invite=${token}`

    const subject = `${from} nominated you for "${debateTitle}"`
    const body = nomination
        ? `${from} nominated you for "${debateTitle}" on CoolPeople. A nomination means you can enter free: ${link}`
        : `${from} nominated you for "${debateTitle}" on CoolPeople. Create an account with this link to claim it and enter free: ${link}`

    // Both channels are attempted regardless of each other's outcome, and
    // neither throws — sendEmail/sendSms resolve to a status either way.
    const [emailResult, smsResult] = await Promise.all([
        sendEmail({ to: invitee_email, subject, text: body }),
        sendSms({ to: invitee_phone, body }),
    ])

    const { rows: updated } = await client.query(
        `UPDATE debate_nomination_invites SET
             email_status  = $2,
             email_sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE email_sent_at END,
             email_error   = $3,
             sms_status    = $4,
             sms_sent_at   = CASE WHEN $4 = 'sent' THEN NOW() ELSE sms_sent_at END,
             sms_error     = $5,
             updated_at    = NOW()
         WHERE id = $1
         RETURNING *;`,
        [row.id, emailResult.status, emailResult.error, smsResult.status, smsResult.error]
    )

    return {
        invite: updated[0] || row,
        // Present only when there was an account to nominate — this is what tells
        // the form whether to say "nominated" or "invited".
        nomination,
        nominee: resolved.user
            ? {
                  id: resolved.user.id,
                  username: resolved.user.username,
                  name: displayName(resolved.user),
              }
            : null,
        delivery: { email: emailResult.status, sms: smsResult.status },
    }
}

// listInvitesSent — the caller's own invites for one debate. Scoped to the
// nominator: these rows hold a third party's email and phone, and the only
// person entitled to see them is whoever typed them in.
const listInvitesSent = async ({ debate_id, nominator_user_id }) => {
    if (!nominator_user_id) throw httpError(401, "authentication required")
    if (!debate_id) throw httpError(400, "debate_id is required")
    const { rows } = await client.query(
        `SELECT id, invitee_email, invitee_phone, invitee_username, invitee_user_id,
                status, email_status, sms_status, claimed_at, created_at
         FROM debate_nomination_invites
         WHERE debate_id = $1 AND nominator_user_id = $2
         ORDER BY created_at DESC;`,
        [debate_id, nominator_user_id]
    )
    return rows
}

// claimInvitesForUser — turn every pending invite addressed to this person into
// the nomination it stood for. Called once, at signup.
//
// Matched on email OR phone, because either is enough to identify the person the
// nominator meant, and an invite sent to a number the user later registers with
// is just as much theirs. Expired rows are stamped 'expired' rather than
// silently claimed — the invite ran out, and pretending otherwise would let a
// year-old link enter a debate.
//
// BEST EFFORT BY DESIGN: this runs inside signup, and a failure here must never
// cost someone their account. Errors are logged and swallowed by the caller.
const claimInvitesForUser = async ({ user_id, email, phone_number }) => {
    if (!user_id) return { claimed: 0, expired: 0 }
    const normalizedEmail = normalizeEmail(email)
    const normalizedPhone = normalizePhone(phone_number)
    if (!normalizedEmail && !normalizedPhone) return { claimed: 0, expired: 0 }

    return withTransaction(async (tx) => {
        // Expire first, so the claim step below cannot pick up a stale row.
        const expired = await tx.query(
            `UPDATE debate_nomination_invites
             SET status = 'expired', updated_at = NOW()
             WHERE status = 'pending'
               AND expires_at IS NOT NULL AND expires_at < NOW()
               AND (invitee_email = $1 OR invitee_phone = $2)
             RETURNING id;`,
            [normalizedEmail, normalizedPhone]
        )

        const { rows: pending } = await tx.query(
            `SELECT id, debate_id, nominator_user_id
             FROM debate_nomination_invites
             WHERE status = 'pending'
               AND (invitee_email = $1 OR invitee_phone = $2)
             FOR UPDATE;`,
            [normalizedEmail, normalizedPhone]
        )

        let claimed = 0
        for (const invite of pending) {
            // Someone can be invited to the same debate by two different people;
            // both become real nominations, which is correct — the tally counts
            // DISTINCT nominators. What cannot happen is nominating yourself, so
            // an invite whose sender turns out to be this same person is skipped.
            if (invite.nominator_user_id === user_id) continue

            // ON CONFLICT DO NOTHING, not an error: the nominator may already
            // have nominated this account by hand between invite and signup.
            const ins = await tx.query(
                `INSERT INTO nominations (debate_id, nominator_user_id, nominee_user_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (debate_id, nominator_user_id, nominee_user_id) DO NOTHING
                 RETURNING id;`,
                [invite.debate_id, invite.nominator_user_id, user_id]
            )
            await tx.query(
                `UPDATE debate_nomination_invites
                 SET status = 'nominated',
                     invitee_user_id = $2,
                     nomination_id = COALESCE($3, nomination_id),
                     claimed_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1;`,
                [invite.id, user_id, ins.rows[0]?.id || null]
            )
            claimed += 1
        }
        return { claimed, expired: expired.rows.length }
    })
}

module.exports = {
    inviteToNominate,
    listInvitesSent,
    claimInvitesForUser,
}
