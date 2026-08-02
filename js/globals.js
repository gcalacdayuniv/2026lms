// js/globals.js
export const CONFIG = {
    // Points to your dedicated Cloudflare Worker backend API
    API_URL: "https://2026-api.plv.workers.dev" 
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
        const text = await response.text(); 
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            throw new Error(`Server returned non-JSON response. Status: ${response.status}`);
        }
        
        if (!response.ok) {
            throw new Error(data.error || "API request failed");
        }
        
        return data;
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}
