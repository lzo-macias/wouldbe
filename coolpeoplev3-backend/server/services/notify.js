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
const SMS_ENABLED = !!process.env.SMS_API_KEY;

// The address invite links point at. Falls back to localhost so a dev invite
// still contains a link you can click.
const APP_URL = process.env.APP_PUBLIC_URL || "http://localhost:5173";

// E.164 is what every SMS provider wants: a leading + and 8–15 digits, nothing
// else. Anything a person types ("(555) 123-4567", "555.123.4567") is stripped
// to digits first; a bare 10-digit number is assumed US, which is the only
// assumption this platform can make — it is US-elections-only by construction.
// Returns null for anything that cannot be made into a valid number, so the
// caller can reject it rather than storing junk it will never be able to text.
const normalizePhone = (raw) => {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    const hadPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return null;
    if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    if (digits.length === 10) return `+1${digits}`;
    // 11 digits starting with 1 is a US number someone typed with the country code.
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
};

// Deliberately loose: one @, something either side, a dot in the domain. Strict
// RFC 5322 validation is a famous waste of time — the only real test of an
// address is whether mail to it lands, and that is what email_status records.
const normalizeEmail = (raw) => {
    if (!raw) return null;
    const value = String(raw).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
};

// sendEmail / sendSms — both resolve to { status, error }, and NEITHER throws.
// A send failure is a fact about one channel, recorded on the row; it must not
// unwind the caller's transaction or its sibling channel.
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

const sendSms = async ({ to, body }) => {
    if (!to) return { status: "skipped", error: null };
    if (!SMS_ENABLED) {
        console.log(`[notify] sms QUEUED (no provider configured) → ${to}`);
        return { status: "queued", error: null };
    }
    try {
        // TODO(provider): POST to the SMS API here.
        void body;
        return { status: "sent", error: null };
    } catch (err) {
        console.error("[notify] sms failed", err);
        return { status: "failed", error: String(err.message || err).slice(0, 500) };
    }
};

module.exports = {
    EMAIL_ENABLED,
    SMS_ENABLED,
    APP_URL,
    normalizePhone,
    normalizeEmail,
    sendEmail,
    sendSms,
};
