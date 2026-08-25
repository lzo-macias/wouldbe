/*
================================================================================
 CoolPeople v3 / Would Be — Auth: email/phone verification state
================================================================================
 Adds the columns the verification routes need. Password reset needs NO column:
 the reset token is a short-lived JWT signed with a per-user secret derived from
 the current password hash, so it self-invalidates 30m out OR the moment the
 password changes (single-use by construction). See DB/auth.js.

 - email_verified_at / phone_verified_at : stamped once on successful verify.
 - phone_verification_code_hash / _expires_at : the pending SMS OTP (we store the
   bcrypt HASH of the code, never the code itself) + a 10-min expiry. TCPA: only
   send to a number the user supplied; record sms_transactional consent separately.
================================================================================
*/

exports.up = (pgm) => {
    pgm.addColumns('users', {
        email_verified_at: { type: 'timestamptz' },
        phone_verified_at: { type: 'timestamptz' },
        // bcrypt hash of the current SMS one-time code (never the plaintext)
        phone_verification_code_hash: { type: 'text' },
        phone_verification_expires_at: { type: 'timestamptz' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('users', [
        'email_verified_at',
        'phone_verified_at',
        'phone_verification_code_hash',
        'phone_verification_expires_at',
    ]);
};
