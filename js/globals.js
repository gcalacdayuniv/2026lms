// js/globals.js
export const CONFIG = {
    API_URL: "https://2026-api.plv.workers.dev"
};

export const AppState = {
    user: null,
    token: null,   // login session token sent with every API request

    init: () => {
        try { AppState.token = localStorage.getItem('portal_token'); } catch (e) { AppState.token = null; }
        const storedUser = localStorage.getItem('portal_user');
        if (storedUser) {
            try {
                AppState.user = JSON.parse(storedUser);
            } catch (e) {
                console.error("Session parse error", e);
                localStorage.removeItem('portal_user');
            }
        }
    },
    
    setUser: (userData) => {
        AppState.user = userData;
        if (userData) {
            localStorage.setItem('portal_user', JSON.stringify(userData));
        } else {
            localStorage.removeItem('portal_user');
            AppState.setToken(null);
        }
    },

    setToken: (token) => {
        AppState.token = token || null;
        try {
            if (token) localStorage.setItem('portal_token', token);
            else localStorage.removeItem('portal_token');
        } catch (e) { /* storage unavailable: the token stays in memory for this tab */ }
    }
};

// Endpoints that work without a login. A 401 from these means "wrong password", not "session expired".
const PUBLIC_ENDPOINTS = ['/api/login', '/api/register', '/api/student-accessible-exams'];

// Called when the server says the session is missing or expired: go back to the login screen.
export const handleSessionExpired = () => {
    if (!AppState.user) return;
    AppState.setUser(null);
    window.location.hash = '#login';
};

const DEFAULT_TIMEOUT_MS = 30000;

// Calls the Worker API and returns the parsed JSON.
// options.timeoutMs changes the time limit (default 30 seconds).
export const apiFetch = async (endpoint, options = {}) => {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

    const config = {
        ...fetchOptions,
        headers: {
            'Content-Type': 'application/json',
            ...(AppState.token ? { 'Authorization': `Bearer ${AppState.token}` } : {}),
            ...fetchOptions.headers
        }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (!config.signal) config.signal = controller.signal;

    try {
        const response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);

        let data = null;
        try {
            data = await response.json();
        } catch (parseError) {
            // The server answered with something that is not JSON.
        }

        if (response.status === 401 && !PUBLIC_ENDPOINTS.some(p => endpoint.startsWith(p))) {
            handleSessionExpired();
        }
        if (!response.ok) {
            throw new Error((data && data.error) || 'An error occurred during the request.');
        }
        if (data === null) {
            throw new Error('The server sent an unexpected response. Please try again.');
        }

        return data;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        if (error.name === 'AbortError') {
            throw new Error('The request took too long. Please check your connection and try again.');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};
