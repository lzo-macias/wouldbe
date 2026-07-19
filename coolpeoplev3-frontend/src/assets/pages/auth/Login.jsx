import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { storeAuth } from '../../lib/authStorage'

// Minimal login: POST /api/auth/login → store token + userId, go to /admin.
function Login() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const { data } = await api.post('/api/auth/login', { username, password });
            storeAuth(data); // persists token + refreshToken + userId on success
            navigate('/admin');
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui, sans-serif', color: '#1a1a2e' }}>
            <h1 style={{ fontSize: 24 }}>Log in</h1>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {error && <p style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: 8, margin: 0 }}>{error}</p>}
                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15 }}
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15 }}
                />
                <button
                    type="submit"
                    disabled={loading}
                    style={{ padding: '10px 12px', borderRadius: 8, border: 'none', background: '#1a1a2e', color: '#fff', fontSize: 15, cursor: 'pointer' }}
                >
                    {loading ? 'Logging in…' : 'Log in'}
                </button>
            </form>
        </div>
    );
}

export default Login
