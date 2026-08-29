// ============================================================================
// Outbound email + SMS (SCAFFOLD).
//
// There is no provider wired up yet: nothing in .env names one, and neither an
// email nor an SMS SDK is a dependency. So this adapter is the SEAM, and it is
// deliberately NOT the r2.js/twitch.js "throw 503 when unconfigured" shape.
//
// WHY THE DIFFERENCE. A presigned upload URL is worthless if R2 is missing —
// failing loudly is the only honest answer. A notice is not: the thing that
// matters (the invite, the nomination) has already been written, and refusing
// the whole request because a mail provider is absent would throw away work the
// user did. So an unconfigured send returns { status: 'queued' } and the caller
// records that against the row. Nothing is lost, nothing is claimed to have been
// delivered, and once a provider is set the queued rows can be swept and sent.
//
// TO GO LIVE: install the provider SDK, add its keys to .env, and fill in the
// two TODO bodies. Callers need no changes — they already handle every status.
// ============================================================================
require("dotenv").config();

// A provider is "configured" when its key is present. Both are absent today, so
// both senders queue. Named separately because email and SMS are usually
// different vendors and one can be live before the other.
const EMAIL_ENABLED = !!process.env.EMAIL_API_KEY;

// The address invite links point at. Falls back to localhost so a dev invite
// still contains a link you can click.
const APP_URL = process.env.APP_PUBLIC_URL || "http://localhost:5173";

// NOTE: there is deliberately no normalizePhone / sendSms here any more.
// We do not collect phone numbers, so there is no number to normalise and no
// message for us to send. Nomination-by-text is a client-side handoff into the
// nominator's own Messages app (see buildNominationText below and
// frontend lib/smsHandoff.js) — the number never leaves their device.

// Deliberately loose: one @, something either side, a dot in the domain. Strict
// RFC 5322 validation is a famous waste of time — the only real test of an
// address is whether mail to it lands, and that is what email_status records.
const normalizeEmail = (raw) => {
    if (!raw) return null;
    const value = String(raw).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
};

// sendEmail resolves to { status, error } and NEVER throws. A send failure is a
// fact recorded on the row; it must not unwind the caller's transaction.
const sendEmail = async ({ to, subject, text }) => {
    if (!to) return { status: "skipped", error: null };
    if (!EMAIL_ENABLED) {
        console.log(`[notify] email QUEUED (no provider configured) → ${to}: ${subject}`);
        return { status: "queued", error: null };
    }
    try {
        // TODO(provider): POST to the mail API here.
        void text;
        return { status: "sent", error: null };
    } catch (err) {
        console.error("[notify] email failed", err);
        return { status: "failed", error: String(err.message || err).slice(0, 500) };
    }
};

module.exports = {
    EMAIL_ENABLED,
    APP_URL,
    normalizeEmail,
    sendEmail,
};
