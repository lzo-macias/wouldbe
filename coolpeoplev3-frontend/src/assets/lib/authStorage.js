// Single place that persists auth to localStorage, so EVERY successful login or
// signup stores the same keys the same way. Accepts either {user:{id}} or a bare
// userId. Only writes keys that are present (never stores "undefined").
// Returns the stored userId (or null).
export function storeAuth(data = {}) {
    const { token, refreshToken, user, userId } = data;
    if (token) localStorage.setItem("token", token);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    const id = userId ?? user?.id ?? null;
    if (id) localStorage.setItem("userId", id);
    return id;
}

export function clearAuth() {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userId");
}
