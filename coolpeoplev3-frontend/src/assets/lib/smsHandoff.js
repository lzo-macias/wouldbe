// ============================================================================
// smsHandoff — hand a pre-drafted message to the USER'S OWN messaging app.
//
// WHY THIS EXISTS RATHER THAN AN SMS PROVIDER.
// We do not collect phone numbers. Not "we delete them" — we never receive one.
// So there is no number for this app to text, and no Twilio account behind it.
// Instead the browser opens the nominator's own Messages app with the body
// already written and the To: field EMPTY. They pick the recipient out of their
// own OS contact picker and press send themselves.
//
// The number therefore never enters this page, the request, or any server log,
// and there is nothing for us to hand over if we are ever asked for it. That
// property is the whole point, so:
//
//   • A recipient MAY be put in the sms: URL, but ONLY from a number the user
//     typed into this page and that we never transmit. It goes straight from the
//     input into the URL the OS opens and is discarded when the dialog closes:
//     no request carries it, no column holds it, nothing logs it. That keeps the
//     property that matters — we cannot be made to produce what we never had —
//     while letting a nominator who knows the number skip their contact picker.
//     Leaving it out is still the safer default, and is what happens when the
//     field is blank.
//   • NEVER use the Contact Picker API (navigator.contacts) to "help" here. It
//     returns the number into our JS, where analytics and error reporting can
//     see it. The OS picker inside Messages is the one that stays private.
//   • NEVER add an <input> for the number. Session-replay tools record keystrokes.
//
// WHAT WE GIVE UP: we cannot know whether they actually hit send. Nothing here
// reports "delivered", because nothing here could. The invite token being
// claimed later is the only honest signal.
//
// It also happens to keep the human in the loop for every single message — they
// choose each recipient and press send — which is the distinction regulators
// draw between a person texting a person and a platform blasting a contact list.
// ============================================================================

const enc = encodeURIComponent

// iOS and Android disagree about the separator in an sms: link. iOS wants
// `sms:&body=`, Android wants `sms:?body=`. Getting it wrong opens Messages with
// an empty draft, which looks like the button silently failed.
//
// Duplicated from MyWouldBeShare's own note on purpose-by-reference: this is the
// shared copy, and that component predates it.
export const isIOS = () =>
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        // iPadOS 13+ reports itself as a Mac; the touch points give it away.
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/**
 * An `sms:` URL carrying a body, and optionally a recipient.
 *
 * The separator differs by platform (see above) and the RECIPIENT, when there is
 * one, goes before it — `sms:+15551234567&body=…` on iOS, `sms:+1…?body=…` on
 * Android. With no recipient the scheme still needs the separator, so the URL
 * starts `sms:?` / `sms:&` and Messages opens with an empty To: field.
 *
 * `to` is expected pre-normalised (see normalizeUsPhone). It is never validated
 * against a directory and never leaves the device.
 */
export const smsHref = (text, to = '') =>
    `sms:${to}${isIOS() ? '&' : '?'}body=${enc(text)}`

/**
 * Digits → E.164, for the sms: URL only.
 *
 * US-default because this platform is US-elections-only by construction. Returns
 * null for anything unusable so the caller can say so rather than opening
 * Messages with a mangled recipient — which looks like the app misfired.
 *
 * This is a COPY of what the server used to do in notify.js. That copy was
 * deleted with the phone columns; this one lives on the client on purpose,
 * because the client is now the only place a number ever exists.
 */
export function normalizeUsPhone(raw) {
    if (!raw) return null
    const trimmed = String(raw).trim()
    const hadPlus = trimmed.startsWith('+')
    const digits = trimmed.replace(/\D/g, '')
    if (!digits) return null
    if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
    if (digits.length === 10) return `+1${digits}`
    // 11 digits starting with 1 is a US number typed with the country code.
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return null
}

/**
 * Try, in order: the native share sheet, then Messages, then the clipboard.
 *
 * The share sheet goes first on mobile because it reaches Signal, WhatsApp and
 * iMessage in one tap, and it has the same privacy shape — the OS owns the
 * recipient list, we never see who was picked.
 *
 * Returns 'shared' | 'sms' | 'copied' | 'failed' so the caller can say what
 * actually happened instead of guessing. A share the user cancels reports
 * 'shared' too: AbortError is indistinguishable from a completed share in the
 * spec, and claiming failure over a deliberate cancel would be worse.
 *
 * MUST be called directly from a click handler. Both navigator.share and the
 * clipboard require transient user activation, and an await before them can
 * spend it — which is why the caller does its network work first, then calls
 * this from a separate button press.
 */
export async function handOffToMessages(text, to = '') {
    // A typed recipient means they want Messages specifically, addressed to that
    // person — the share sheet would throw away the number and make them pick
    // all over again. Straight to sms:, which is a navigation and therefore
    // works even when an awaited fetch has already spent the user activation.
    if (to) {
        window.location.href = smsHref(text, to)
        return 'sms'
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
        try {
            // `text` only, no `url` field: some targets drop one or the other,
            // and the link is already inside the sentence.
            await navigator.share({ text })
            return 'shared'
        } catch (err) {
            // The user backed out. Not an error, and not something to retry
            // behind their back by opening Messages anyway.
            if (err?.name === 'AbortError') return 'shared'
            // Anything else (no permission, unsupported target) falls through.
        }
    }

    // Desktop browsers mostly do nothing with sms:, and give no error when they
    // don't — so this is deliberately not the last rung of the ladder.
    if (typeof window !== 'undefined' && /Android|iPad|iPhone|iPod/.test(navigator.userAgent)) {
        window.location.href = smsHref(text, to)
        return 'sms'
    }

    try {
        await navigator.clipboard.writeText(text)
        return 'copied'
    } catch {
        return 'failed'
    }
}
