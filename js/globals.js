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
export const handleSessionExpired = (message) => {
    if (!AppState.user) return;
    AppState.setUser(null);
    AppState.setToken(null);
    window.location.hash = '#login';
    // Screens that need to stop (an exam on screen) and the message for the student listen for this.
    try { window.dispatchEvent(new CustomEvent('app:session-ended', { detail: { message: message || '' } })); } catch (e) { /* old browser */ }
};

// A stable id for this browser, so the server can tell "another device" from "this device signing in again".
export const getDeviceId = () => {
    try {
        let id = localStorage.getItem('device_id');
        if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('device_id', id); }
        return id;
    } catch (e) { return 'tab-' + (window.__tabDeviceId = window.__tabDeviceId || Math.random().toString(16).slice(2)); }
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

    const isGet = !config.method || String(config.method).toUpperCase() === 'GET';
    try {
        let response;
        try {
            response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);
        } catch (netErr) {
            // A read that failed before reaching the server is tried once more; writes are never repeated.
            if (!isGet || netErr.name === 'AbortError' || config.signal.aborted) throw netErr;
            await new Promise(r => setTimeout(r, 800));
            response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);
        }

        let data = null;
        try {
            data = await response.json();
        } catch (parseError) {
            // The server answered with something that is not JSON.
        }

        if (response.status === 401 && !PUBLIC_ENDPOINTS.some(p => endpoint.startsWith(p))) {
            handleSessionExpired(data && data.error);
        }
        if (!response.ok) {
            const failure = new Error((data && data.error) || 'An error occurred during the request.');
            failure.data = data;   // extra fields from the server (the login screen reads data.reactivation)
            throw failure;
        }
        if (data === null) {
            throw new Error('The server sent an unexpected response. Please try again.');
        }

        return data;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        if (error.name === 'AbortError') {
            const slow = new Error('The request took too long. Please check your connection and try again.'); slow.network = true; throw slow;
        }
        if (error instanceof TypeError) {
            const down = new Error(navigator.onLine === false ? 'You are offline. Connect to the internet and try again.' : 'Could not reach the server. Please check your connection and try again.'); down.network = true; throw down;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

// POST a JSON body to the Worker API (same errors as apiFetch).
export const apiPost = (endpoint, body, options = {}) => apiFetch(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) });

// The base64 text of a file or picture (without the "data:...;base64," prefix).
export const fileToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
});
