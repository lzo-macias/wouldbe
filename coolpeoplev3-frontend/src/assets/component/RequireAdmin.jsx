import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

// Route guard: renders children only for an authenticated admin. Verifies the
// localStorage token against GET /api/admin/me (which is requireAuth+requireAdmin).
// Non-admins / logged-out users get an access-denied screen instead.
function RequireAdmin({ children }) {
    const [status, setStatus] = useState('checking'); // 'checking' | 'ok' | 'denied'

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) { setStatus('denied'); return; }
        let cancelled = false;
        api.get(`/api/admin/me`)
            .then(() => { if (!cancelled) setStatus('ok'); })
            .catch(() => { if (!cancelled) setStatus('denied'); });
        return () => { cancelled = true; };
    }, []);

    if (status === 'checking') {
        return <div style={{ padding: 48, fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>Checking access…</div>;
    }
    if (status === 'denied') {
        return (
            <div style={{ padding: 48, fontFamily: 'system-ui, sans-serif', textAlign: 'center', color: '#1a1a2e' }}>
                <h1 style={{ fontSize: 22 }}>Admins only</h1>
                <p style={{ color: '#6b7280' }}>You need an admin account to view this page.</p>
                <Link to="/" style={{ color: '#2563eb' }}>← Back home</Link>
            </div>
        );
    }
    return children;
}

export default RequireAdmin
