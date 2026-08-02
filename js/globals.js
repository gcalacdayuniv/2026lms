// js/globals.js
export const CONFIG = {
    // An empty string ensures the app uses the exact same domain it is currently running on.
    API_URL: "" 
};

export const AppState = {
    user: JSON.parse(localStorage.getItem("professionalPortalUser")) || null
};

export async function apiFetch(endpoint, options = {}) {
    const url = `${CONFIG.API_URL}${endpoint}`;
    
    const headers = {
        "Content-Type": "application/json",
        ...options.headers
    };

    try {
        const response = await fetch(url, { ...options, headers });
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || "API request failed");
        }
        
        return data;
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}
