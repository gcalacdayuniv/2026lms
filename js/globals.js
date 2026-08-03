// js/globals.js
export const CONFIG = {
    // Updated to the new API URL without the "www" to ensure uniform requests
    API_URL: 'https://plv.workers.dev'
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
