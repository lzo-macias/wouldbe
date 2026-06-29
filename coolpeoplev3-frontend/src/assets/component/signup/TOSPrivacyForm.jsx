import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import "../../styling/Signup.css";
import { ArrowRight } from "./icons";

// Screen 1 of signup: the two documents the user signs — Terms of Service, then
// Privacy Policy. Each is shown in a scrollable panel with an accept checkbox.
// Acceptance is lifted UP via onComplete({accepted_tos, accepted_privacy}); the
// parent stores the booleans and passes them down to the account step, which
// sends them to POST /api/auth/signup (recorded with ip + user-agent server-side).
function TOSPrivacyForm({ onComplete }) {
    const navigate = useNavigate();
    const [subStep, setSubStep] = useState("tos");        // "tos" → "privacy"
    const [acceptedTos, setAcceptedTos] = useState(false);
    const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
    const [error, setError] = useState(null);

    function handleTos(e) {
        e.preventDefault();
        if (!acceptedTos) return setError("Please read and accept the Terms of Service to continue.");
        setError(null);
        setSubStep("privacy");
    }
    function handlePrivacy(e) {
        e.preventDefault();
        if (!acceptedPrivacy) return setError("Please read and accept the Privacy Policy to continue.");
        setError(null);
        onComplete({ accepted_tos: acceptedTos, accepted_privacy: acceptedPrivacy });
    }

    const isTos = subStep === "tos";

    return (
        <div className="su-page">
            <div className="su-card">
                <h1 className="su-logo">would be</h1>
                <p className="su-heading">{isTos ? "Terms of Service" : "Privacy Policy"}</p>

                <div className="su-dots">
                    <span className={`su-dot ${isTos ? "active" : ""}`} />
                    <span className={`su-dot ${!isTos ? "active" : ""}`} />
                </div>

                {error && <p className="su-error">{error}</p>}

                {isTos ? <TosCopy /> : <PrivacyCopy />}

                <form onSubmit={isTos ? handleTos : handlePrivacy}>
                    <label className="su-accept">
                        <input
                            type="checkbox"
                            checked={isTos ? acceptedTos : acceptedPrivacy}
                            onChange={(e) => (isTos ? setAcceptedTos : setAcceptedPrivacy)(e.target.checked)}
                        />
                        I have read and accept the {isTos ? "Terms of Service" : "Privacy Policy"}.
                    </label>

                    <div className="su-footer">
                        <div className="su-footer-left">
                            {isTos
                                ? <button type="button" className="su-cancel" onClick={() => navigate("/login")}>cancel</button>
                                : <button type="button" className="su-cancel" onClick={() => { setError(null); setSubStep("tos"); }}>back</button>}
                            <button type="button" className="su-signin" onClick={() => navigate("/login")}>sign in</button>
                        </div>
                        <button type="submit" className="su-primary">
                            {isTos ? "ACCEPT" : "CONFIRM"} <ArrowRight />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* ── Document copy (readable summary of the full agreements; the complete PDFs
   are linked for the binding version). ───────────────────────────────────── */

function DraftNote() {
    return (
        <div className="su-doc-banner">
            Draft pending final legal review. By continuing you accept the current version; the binding text is the full document linked below.
        </div>
    );
}

function TosCopy() {
    return (
        <div className="su-doc">
            <DraftNote />
            <p>These Terms govern your use of CoolPeople (the &ldquo;Service&rdquo;). By creating an account you agree to them and to the Privacy Policy. Your acceptance is recorded electronically with the date, version, and technical metadata (IP address and device/browser), which serves as your signature.</p>

            <h3>1. Eligibility &amp; age</h3>
            <p>You must be at least 18 to register, create a WouldBe campaign, pledge, tip, subscribe, or enter a paid debate. Limited debate features may be available to minors only with verified parental/guardian consent.</p>

            <h3>2. What CoolPeople is — and isn&rsquo;t</h3>
            <p>CoolPeople is a civic-engagement platform. It is <strong>not</strong> a political committee, donor, or contribution processor, and it <strong>never solicits, holds, or transmits campaign contributions</strong>. Office, deadline, and eligibility information is general information only — not legal, tax, or compliance advice.</p>

            <h3>3. Pledges are promises, not payments</h3>
            <p>A pledge is a <strong>non-binding, non-transacting</strong> promise to give if a campaign reaches its goal. No money moves on the Service. If a goal is met, you may be linked to the candidate&rsquo;s own external processor; any contribution happens off-platform under that processor&rsquo;s terms.</p>

            <h3>4. Candidate responsibilities</h3>
            <p>If you run a WouldBe, you are solely responsible for your own compliance with election, campaign-finance, and tax law (including any committee registration), and for the truthfulness of every attestation you submit. False attestations violate these Terms and may violate law.</p>

            <h3>5. Money &amp; fees</h3>
            <p>The only real money on the Service is: optional <strong>tips to the platform</strong>, a <strong>flat fee paid by a debate poster/sponsor</strong>, and a small <strong>per-transaction markup on debate-side transactions</strong>. Campaign pledges are never charged. Payments are handled by our processor; we don&rsquo;t store card numbers. Fees are non-refundable except where required by law.</p>

            <h3>6. Your content</h3>
            <p>You keep ownership of what you post and grant CoolPeople a license to host, display, and distribute it to operate the Service, including any livestream recording you consent to. You must have the rights to what you upload.</p>

            <h3>7. Conduct &amp; moderation</h3>
            <p>No fraud, vote manipulation, impersonation, prohibited contributions, infringing or unlawful content, or circumventing safety controls. We may label, remove, restrict, suspend, or terminate accounts to enforce these Terms or the law, with reporting and appeals available.</p>

            <h3>8. Disclaimers &amp; liability</h3>
            <p>The Service is provided &ldquo;as is.&rdquo; To the extent permitted by law, CoolPeople is not liable for indirect or consequential damages, and total liability is capped as stated in the full Terms. You agree to indemnify us for misuse or violations.</p>

            <h3>9. Changes &amp; contact</h3>
            <p>We may update these Terms; material changes get a new version and effective date. Questions: legal@coolpeople.example.</p>

            <a className="su-doc-link" href="/terms-of-service.pdf" target="_blank" rel="noreferrer">View the full Terms of Service (PDF) →</a>
        </div>
    );
}

function PrivacyCopy() {
    return (
        <div className="su-doc">
            <DraftNote />
            <p>This Policy explains what we collect, how we use and share it, and your choices. It is part of the Terms.</p>

            <h3>1. Money &amp; political data, up front</h3>
            <p>CoolPeople never touches campaign contributions; pledges are promises that never transact. The only money we handle is tips, the debate poster&rsquo;s flat fee, and a small per-transaction markup on debate transactions. We <strong>do not sell individual political data</strong>.</p>

            <h3>2. What we collect</h3>
            <p>Account &amp; profile (name, username, email, phone, date of birth, password as a hash), content you post, attestations and consents (with IP/user-agent for legal records), limited payment metadata, and device/usage data.</p>

            <h3>3. Your address is used once, then discarded</h3>
            <p>If you provide an address, we use it momentarily to resolve your civic jurisdictions and then keep only the derived districts — <strong>we do not store your street address</strong>.</p>

            <h3>4. How we use it</h3>
            <p>To run the Service, verify eligibility/age, match you to relevant offices and notifications (using pre-established objective criteria applied uniformly, per 11 CFR 110.13), process the limited payments above, moderate content, and meet legal obligations.</p>

            <h3>5. Sharing</h3>
            <p>Only with processors acting for us (payments, media storage, geocoding, analytics, livestreaming), as part of public-by-design content, for legal/safety reasons (including mandatory child-safety reporting under 18 U.S.C. § 2258A), or in a business transfer.</p>

            <h3>6. Your rights</h3>
            <p>Depending on where you live (GDPR / CCPA-CPRA), you can access, correct, delete, port, or object to processing, and submit a data-subject request in-product or to privacy@coolpeople.example. We respond within the legally required time (generally 30 days).</p>

            <h3>7. Communications &amp; children</h3>
            <p>We message you only as permitted; you can opt out anytime. General accounts and all money features are 18+; minors&rsquo; limited features require verified parental consent.</p>

            <a className="su-doc-link" href="/privacy-policy.pdf" target="_blank" rel="noreferrer">View the full Privacy Policy (PDF) →</a>
        </div>
    );
}

export default TOSPrivacyForm
