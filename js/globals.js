// js/globals.js
export const CONFIG = {
    API_URL: "https://2026-api.plv.workers.dev",
    GAS_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbz1yDwSQxGfbxT-ra0t1zC0TBCQKTFTFYhYi34dYtlc1E0jv6T1SE1mbcD0JZ3ZY6rJ/exec"
};

export const AppState = {
    user: null,
    
    init: () => {
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
        }
    }
};

export const apiFetch = async (endpoint, options = {}) => {
    const defaultHeaders = {
        'Content-Type': 'application/json'
    };

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers
        }
    };

    try {
        const response = await fetch(`${CONFIG.API_URL}${endpoint}`, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'An error occurred during the request.');
        }

        return data;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        throw error;
    }
};
