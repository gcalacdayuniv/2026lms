// js/globals.js
// Update this URL once your Cloudflare Worker is deployed
export const CONFIG = {
    API_URL: "https://your-worker-domain.workers.dev" 
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
