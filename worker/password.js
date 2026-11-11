// worker/password.js
// Salted PBKDF2-SHA256 password hashes.
//
// Stored form:  pbkdf2$<rounds>$<salt base64>$<hash base64>
// Older accounts still hold a plain SHA-256 hex hash. They keep working, and each one is replaced by a
// salted hash the next time that person signs in (needsUpgrade = true).
//
// Rounds are kept at 10,000 by default so a sign-in stays far below the 10 ms CPU limit of the free Workers plan.
// On a paid plan set the variable PBKDF2_ITERATIONS (for example 100000); older hashes upgrade the same way.

const DEFAULT_ROUNDS = 10000;
const MAX_ROUNDS = 100000;     // the most the Workers runtime accepts
const enc = new TextEncoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

export const roundsFor = (env) => {
    const n = parseInt(env && env.PBKDF2_ITERATIONS, 10);
    return Number.isFinite(n) && n >= 1000 ? Math.min(n, MAX_ROUNDS) : DEFAULT_ROUNDS;
};

async function derive(password, salt, rounds) {
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
    return new Uint8Array(bits);
}

// Compares without stopping at the first difference.
const sameBytes = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
};

export async function hashPassword(password, env) {
    const rounds = roundsFor(env);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(password, salt, rounds);
    return `pbkdf2$${rounds}$${toB64(salt)}$${toB64(hash)}`;
}

async function legacySha256(password) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(password)))));
}

// Returns { ok, needsUpgrade }.
export async function verifyPassword(password, stored, env) {
    if (typeof stored !== 'string' || !stored) return { ok: false, needsUpgrade: false };

    if (stored.startsWith('pbkdf2$')) {
        const [, roundsText, saltB64, hashB64] = stored.split('$');
        const rounds = parseInt(roundsText, 10);
        if (!rounds || rounds > MAX_ROUNDS || !saltB64 || !hashB64) return { ok: false, needsUpgrade: false };
        try {
            const got = await derive(password, fromB64(saltB64), rounds);
            const ok = sameBytes(got, fromB64(hashB64));
            return { ok, needsUpgrade: ok && rounds < roundsFor(env) };
        } catch (e) {
            return { ok: false, needsUpgrade: false };
        }
    }

    // Older accounts: unsalted SHA-256 in hex.
    const legacy = await legacySha256(password);
    const a = enc.encode(legacy);
    const b = enc.encode(stored.toLowerCase());
    const ok = sameBytes(a, b);
    return { ok, needsUpgrade: ok };
}
