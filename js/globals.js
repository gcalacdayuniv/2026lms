// js/globals.js
export const CONFIG = {
    API_URL: "http://127.0.0.1:8787" 
};

export async function apiFetch(endpoint, options = {}) {
    const url = `${CONFIG.API_URL}${endpoint}`;
    const headers = {
        "Content-Type": "application/json",
        ...options.headers
    };
    
    try {
        const response = await fetch(url, { ...options, headers });
        return await response.json();
    } catch (error) {
        console.error("API Fetch Error:", error);
        return { success: false, message: "Network connection failed." };
    }
}
