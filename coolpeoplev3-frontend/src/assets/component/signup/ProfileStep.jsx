import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from "../../lib/api";
import "./Signup.css";
import { storeAuth } from "../../lib/authStorage";
import { UserIcon, IdIcon, MailIcon, CalendarIcon, LockIcon, ArrowRight } from "./icons";

// Screen 2 of signup (Figma "page 2") — creates the account.
// accepted_tos / accepted_privacy come DOWN as props (signed on screen 1).
// onComplete() advances to the profile step after a successful signup + login.
function ProfileStep({ accepted_tos, accepted_privacy, onComplete }) {
    const navigate = useNavigate();

    // backend createUsers requires: first_name, last_name, username, password, date_of_birth
    const [firstname, setFirstName] = useState("");
    const [lastname, setLastName] = useState("");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [dateOfBirth, setDateOfBirth] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);

        if (!firstname || !lastname || !username || !password || !dateOfBirth) {
            return setError("First name, last name, username, password, and date of birth are required.");
        }
        if (password !== confirmPassword) {
            return setError("Passwords do not match.");
        }

        setLoading(true);
        try {
            // 1) create the account — POST /api/auth/signup returns { token, user }.
            //    Persist userId (and the token) straight from this response, so a
            //    successful signup ALWAYS stores userId, independent of step 2.
            const { data: signup } = await api.post('/api/auth/signup', {
                first_name: firstname,
                last_name: lastname,
                username,
                email: email || null,
                password,
                date_of_birth: dateOfBirth,                    // 'YYYY-MM-DD'
                accepted_tos,                                  // ← signed on screen 1
                accepted_privacy,
                age_verification_method: "self_attestation",   // matches the DB CHECK
            });
            let userId = storeAuth(signup);                    // userId + token (if signup returned one)

            // 2) get a refresh token (+ confirm session). Best-effort: signup already
            //    stored userId + token, so a hiccup here doesn't lose the session.
            try {
                const { data: login } = await api.post('/api/auth/login', { username, password });
                userId = storeAuth(login) || userId;
            } catch { /* non-fatal — signup response already authenticated us */ }

            // 3) advance to the profile step
            onComplete(userId);
        } catch (err) {
            setError(err.response?.data?.error || "Sign-up failed. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="su-page">
            <form className="su-card" onSubmit={handleSubmit}>
                <h1 className="su-logo">would be</h1>
                <p className="su-heading">Sign up for your account</p>

                {error && <p className="su-error">{error}</p>}

                <div className="su-fields">
                    <div className="su-input">
                        <UserIcon />
                        <input placeholder="First name" value={firstname} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                    </div>
                    <div className="su-input">
                        <UserIcon />
                        <input placeholder="Last name" value={lastname} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                    </div>
                    <div className="su-input">
                        <IdIcon />
                        <input placeholder="Choose a username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                    </div>
                    <div className="su-input">
                        <MailIcon />
                        <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                        <span className="su-optional">optional</span>
                    </div>
                    <div className="su-input">
                        <CalendarIcon />
                        <input type="date" placeholder="Date of birth" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                    </div>
                    <div className="su-input">
                        <LockIcon />
                        <input type="password" placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                    </div>
                    <div className="su-input">
                        <LockIcon />
                        <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                    </div>
                </div>

                <div className="su-footer">
                    <div className="su-footer-left">
                        <button type="button" className="su-cancel" onClick={() => navigate("/login")}>cancel</button>
                        <button type="button" className="su-signin" onClick={() => navigate("/login")}>sign in</button>
                    </div>
                    <button type="submit" className="su-primary" disabled={loading}>
                        {loading ? "CREATING…" : "CONFIRM"} <ArrowRight />
                    </button>
                </div>
            </form>
        </div>
    );
}

export default ProfileStep
