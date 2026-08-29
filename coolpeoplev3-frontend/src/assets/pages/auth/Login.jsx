import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import api from '../../lib/api'
import { storeAuth } from '../../lib/authStorage'
import './Auth.css'

// ============================================================================
// LOG IN.
//
// What the previous version got wrong, roughly by severity:
//
//  1. NO LABELS. Both fields leaned on placeholders, which vanish the moment
//     you type — so anyone who tabs away mid-form, or is using a screen reader,
//     has no idea what the second box wants. Real <label for> now, and the
//     placeholder shows the FORMAT rather than repeating the label.
//  2. IT ALWAYS WENT TO /admin. A regular account has no admin page, so a
//     successful login dropped most people onto a screen that refuses them.
//     It returns you to where you were instead.
//  3. NO WAY OUT. No link to sign up, no password reset. A login screen with no
//     recovery path is a dead end for anybody who mistypes.
//  4. Inline styles, top-anchored, no error or caps-lock affordance.
//
// TWO THINGS I DID NOT BUILD, rather than build them as decoration:
//
//   NO "CONTINUE WITH GOOGLE". There is no OAuth on this server — the auth
//   routes are username + password and nothing else. A Google button would be
//   a control that cannot work, which is worse than its absence.
//
//   THE FORGOT LINK IS CONDITIONAL. POST /forgot-password exists on the API but
//   there is no /forgot route in this app yet, so the link points at the
//   endpoint's future home and is only rendered once that page exists — see
//   HAS_RESET below. Linking to a 404 is not a recovery path.
//
// SECURITY NOTE ON THE ERROR COPY: it says the details do not match, never "no
// account with that username". The second version is an account-enumeration
// oracle — it lets anyone check which handles are registered. The server's
// message is passed through, so this is a floor, not a guarantee.
// ============================================================================

// Flip when the reset page lands. Kept as a constant rather than a comment so
// the link and its route go live together.
const HAS_RESET = false

const Eye = ({ off }) => (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M1.5 9S4 3.8 9 3.8 16.5 9 16.5 9 14 14.2 9 14.2 1.5 9 1.5 9z"
              stroke="currentColor" strokeWidth="1.5" />
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        {off && <path d="M3 3l12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
)

const Warn = () => (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 5.2v4.4M9 12.3v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
)

function Login() {
    const navigate = useNavigate()
    const location = useLocation()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [show, setShow] = useState(false)
    const [caps, setCaps] = useState(false)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)

    const ready = username.trim().length > 0 && password.length > 0

    async function handleSubmit(e) {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            const { data } = await api.post('/api/auth/login', { username, password })
            storeAuth(data)   // token + refreshToken + userId
            // BACK WHERE THEY CAME FROM. Somebody who pressed "add your
            // response" and was sent here wants that match, not a dashboard —
            // and a regular account has no /admin to land on anyway.
            const back = location.state?.from
            navigate(back || '/', { replace: true })
        } catch (err) {
            setError(err.response?.data?.error || "Those details don't match an account.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="wb-auth">
            <div className="wb-auth__inner">
                <div className="wb-auth__brand">
                    <Link className="wb-auth__logo" to="/">would be</Link>
                    <span className="wb-auth__rule" aria-hidden="true" />
                </div>

                <div>
                    <h1 className="wb-auth__h">Log in</h1>
                    <p className="wb-auth__sub">
                        New here? <Link to="/signup">Create an account</Link>
                    </p>
                </div>

                {error && (
                    <div className="wb-alert" role="alert">
                        <Warn />
                        <span><b>Couldn&rsquo;t sign you in.</b> {error}</span>
                    </div>
                )}

                <form className="wb-form" noValidate onSubmit={handleSubmit}>
                    <div className="wb-f">
                        <div className="wb-f__top">
                            <label className="wb-f__l" htmlFor="wb-id">Username</label>
                        </div>
                        <div className="wb-f__wrap">
                            {/* USERNAME, not email. `authenticate()` looks up
                                WHERE username = $1, so labelling this "email or
                                username" would invite a value that always
                                fails. */}
                            <input
                                id="wb-id" className="wb-in" type="text"
                                value={username} onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                                autoCapitalize="none" autoCorrect="off" spellCheck="false"
                                placeholder="yourhandle"
                                aria-invalid={Boolean(error)}
                                required
                            />
                        </div>
                    </div>

                    <div className="wb-f">
                        <div className="wb-f__top">
                            <label className="wb-f__l" htmlFor="wb-pw">Password</label>
                            {HAS_RESET && <Link className="wb-f__aux" to="/forgot">Forgot?</Link>}
                        </div>
                        <div className="wb-f__wrap">
                            <input
                                id="wb-pw" className="wb-in wb-in--pw"
                                type={show ? 'text' : 'password'}
                                value={password} onChange={(e) => setPassword(e.target.value)}
                                onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                                autoComplete="current-password"
                                aria-invalid={Boolean(error)}
                                aria-describedby={caps ? 'wb-caps' : undefined}
                                required
                            />
                            <button
                                type="button" className="wb-eye"
                                onClick={() => setShow((v) => !v)}
                                aria-label={show ? 'Hide password' : 'Show password'}
                                aria-pressed={show}
                            >
                                <Eye off={show} />
                            </button>
                        </div>
                        {/* People mistype passwords with caps lock on constantly
                            and the field masks the evidence — worth the four
                            lines it costs to say so. */}
                        {caps && <p className="wb-note wb-note--warn" id="wb-caps">Caps lock is on</p>}
                    </div>

                    <button type="submit" className="wb-btn wb-btn--primary wb-auth__cta"
                            disabled={!ready || loading}>
                        {loading ? <><span className="wb-spin" />Signing in</> : 'Log in'}
                    </button>
                </form>

                <p className="wb-auth__foot">
                    By continuing you agree to the <Link to="/terms">Terms</Link> and{' '}
                    <Link to="/privacy">Privacy Policy</Link>.
                </p>
            </div>
        </div>
    )
}

export default Login
