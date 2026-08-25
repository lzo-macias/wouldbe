import axios from "axios";
import { clearAuth } from "./authStorage";

// ============================================================================
// Shared axios instance for the whole app.
//   - baseURL comes from VITE_API_BASE_URL, so pointing at a live backend is a
//     one-line change in .env (no code edits, no per-file `${API}` prefixes).
//   - a request interceptor attaches the access token automatically, so call
//     sites never build Authorization headers by hand.
//   - a response interceptor transparently refreshes an expired access token
//     once (via POST /api/auth/refresh) and replays the original request.
//
// Usage:  import api from "../lib/api";  await api.get("/api/auth/me");
// ============================================================================
const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL,
});

// --- Attach the access token to every outgoing request -----------------------
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// --- Refresh-on-401, then replay the original request ------------------------
// One in-flight refresh is shared across concurrent 401s so we never fire two
// refreshes at once (which would burn the single-use refresh token).
let refreshing = null;

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const original = error.config;
        const status = error.response?.status;
        const refreshToken = localStorage.getItem("refreshToken");

        const canRetry =
            status === 401 &&
            refreshToken &&
            original &&
            !original._retry &&
            !original.url?.includes("/api/auth/refresh");

        if (!canRetry) {
            // A 401 we cannot refresh our way out of means the stored access
            // token is dead and there is nothing to renew it with (no refresh
            // token, or the refresh call itself just 401'd). Drop the session.
            //
            // Without this, an expired token sits in localStorage forever: the
            // request interceptor keeps attaching it to EVERY request, every one
            // 401s, and the app never notices it is logged out. That is what
            // filled the server log with identical TokenExpiredError traces on
            // each page load.
            //
            // 401 only — 403 means "authenticated, not allowed", and clearing a
            // perfectly good session over one forbidden route would be wrong.
            //
            // Login/signup are excluded: a 401 there means "wrong password", and
            // it says nothing about the token already in storage. Someone typing
            // a bad password on the login screen should not be signed out of the
            // session they already have.
            const isCredentialCheck =
                original?.url?.includes("/api/auth/login") ||
                original?.url?.includes("/api/auth/signup");
            if (status === 401 && !isCredentialCheck && localStorage.getItem("token")) {
                clearAuth();
            }
            return Promise.reject(error);
        }

        original._retry = true;
        try {
            // Use a bare axios call (not `api`) so the request interceptor
            // doesn't attach the stale access token, and so this call can't
            // recurse back into this same interceptor.
            refreshing =
                refreshing ||
                axios
                    .post(`${import.meta.env.VITE_API_BASE_URL}/api/auth/refresh`, { refreshToken })
                    .then((r) => r.data.token);

            const newToken = await refreshing;
            refreshing = null;
            localStorage.setItem("token", newToken);
            original.headers.Authorization = `Bearer ${newToken}`;
            return api(original); // replay the original request
        } catch (refreshErr) {
            refreshing = null;
            clearAuth(); // refresh token is dead → drop the whole session
            return Promise.reject(refreshErr);
        }
    }
);

export default api;
