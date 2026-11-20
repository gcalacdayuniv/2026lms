// worker/gas.js
// Talking to the Google Apps Script web app (Drive uploads, scan photos, avatars).

// The Apps Script address, with the shared secret (the GAS_SECRET Secret) added when one is set.
// The Apps Script refuses requests without it, so knowing the address alone is not enough to use the Drive folder.
export function gasUrl(env) {
    if (!env.GAS_SECRET) return env.GAS_WEBHOOK_URL;
    const u = new URL(env.GAS_WEBHOOK_URL);
    u.searchParams.set('key', env.GAS_SECRET);
    return u.toString();
}

// Sends a body to the Google Apps Script web app and returns its parsed JSON answer.
// Throws an Error with a user-readable message on failure.
export async function callGas(env, body) {
    if (!env.GAS_WEBHOOK_URL) {
        throw new Error("Server Configuration Error: GAS_WEBHOOK_URL is missing.");
    }

    let gasResponse = await fetch(gasUrl(env), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        redirect: 'manual'
    });

    if (gasResponse.status === 302 || gasResponse.status === 303) {
        const redirectUrl = gasResponse.headers.get('Location');
        gasResponse = await fetch(redirectUrl);
    }

    const gasText = await gasResponse.text();
    let gasData;
    try {
        gasData = JSON.parse(gasText);
    } catch (parseError) {
        throw new Error(`Google created the file, but intercepted the JSON response. Raw Google Output: ${gasText.substring(0, 150)}...`);
    }

    if (!gasData.success) {
        throw new Error("Google Drive Error: " + gasData.error);
    }
    return gasData;
}
