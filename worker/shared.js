// worker/shared.js
// Helpers used by more than one route file: the visitor's local date, safe JSON parsing, sign-in checks and lockout, and batching.

import { hashPassword, verifyPassword } from './password.js';
import { ensureLoginTable, ensureAppSettings } from './schema.js';

export const SCAN_BATCH_SIZE = 90;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_PER_ACCOUNT = 5;
export const LOGIN_MAX_PER_IP = 30;

export const DEFAULT_TIMEZONE = 'Asia/Manila';

// Returns YYYY-MM-DD for "today" in the visitor's timezone (Cloudflare supplies it),
// falling back to Asia/Manila. Never uses the UTC date.
export function getRequestDate(request) {
    const requested = request && request.cf && request.cf.timezone;
    const zones = [requested, DEFAULT_TIMEZONE];
    for (const timeZone of zones) {
        if (!timeZone) continue;
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date());
        } catch (e) {
            // Invalid timezone name: try the next one.
        }
    }
    return new Date().toISOString().split('T')[0];
}

export const safeJson = (text) => { try { const v = JSON.parse(text || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };

// Finds the account for a sign-in identifier whose password matches. Older SHA-256 hashes are replaced by a
// salted hash on the spot. Returns the row (with Password removed) or null.
export async function findUserByCredentials(env, identifier, password, columns) {
    const rows = await env.DB.prepare(
        `SELECT ${columns}, Password
         FROM Users
         WHERE Username COLLATE NOCASE = ? OR Email COLLATE NOCASE = ? OR Contact_Number = ? OR Student_Number COLLATE NOCASE = ?
         LIMIT 3`
    ).bind(identifier, identifier, identifier, identifier).all();
    for (const row of rows.results || []) {
        const check = await verifyPassword(password, row.Password, env);
        if (!check.ok) continue;
        if (check.needsUpgrade) {
            try {
                const upgraded = await hashPassword(password, env);
                await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(upgraded, row.User_ID).run();
            } catch (err) { /* the sign-in still works; the hash is upgraded next time */ }
        }
        delete row.Password;
        return row;
    }
    return null;
}

// Sign-up limits: per address and per student number, counted over one hour whether or not the attempt succeeds.
// A school shares one address, so the per-address limit is generous; REGISTER_MAX_PER_IP changes it.
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_MAX_PER_STUDENT_NO = 5;
export const registerKeys = (request, env, studentNumber) => {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const perIp = parseInt(env && env.REGISTER_MAX_PER_IP, 10);
    return [
        { key: `reg:ip:${ip}`, max: Number.isFinite(perIp) && perIp > 0 ? perIp : 60 },
        { key: `reg:sn:${String(studentNumber || "").trim().toLowerCase().slice(0, 20)}`, max: REGISTER_MAX_PER_STUDENT_NO }
    ];
};

export const loginKeys = (request, identifier) => {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    return [
        { key: `u:${String(identifier || "").trim().toLowerCase().slice(0, 80)}`, max: LOGIN_MAX_PER_ACCOUNT },
        { key: `ip:${ip}`, max: LOGIN_MAX_PER_IP }
    ];
};

// Seconds until the next try is allowed, 0 when allowed.
export async function loginLockedFor(env, keys, windowMs = LOGIN_WINDOW_MS) {
    await ensureLoginTable(env);
    const now = Date.now();
    let wait = 0;
    for (const k of keys) {
        const row = await env.DB.prepare("SELECT Fails, First_At FROM Login_Attempts WHERE Attempt_Key = ?").bind(k.key).first();
        if (row && now - row.First_At < windowMs && row.Fails >= k.max) {
            wait = Math.max(wait, Math.ceil((row.First_At + windowMs - now) / 1000));
        }
    }
    return wait;
}

export async function loginFailed(env, keys, windowMs = LOGIN_WINDOW_MS) {
    await ensureLoginTable(env);
    const now = Date.now();
    for (const k of keys) {
        await env.DB.prepare(
            `INSERT INTO Login_Attempts (Attempt_Key, Fails, First_At) VALUES (?, 1, ?)
             ON CONFLICT(Attempt_Key) DO UPDATE SET
                Fails = CASE WHEN ? - First_At >= ? THEN 1 ELSE Fails + 1 END,
                First_At = CASE WHEN ? - First_At >= ? THEN ? ELSE First_At END`
        ).bind(k.key, now, now, windowMs, now, windowMs, now).run();
    }
}

export const loginCleared = async (env, keys) => {
    await env.DB.prepare("DELETE FROM Login_Attempts WHERE Attempt_Key = ?").bind(keys[0].key).run();
};

// Attempts older than a day can no longer lock anyone out (the longest window is 1 hour), so they are dead weight.
// Without this the table only shrinks when someone signs in successfully.
export const ATTEMPT_KEEP_MS = 24 * 60 * 60 * 1000;
export async function purgeOldAttempts(env, keepMs = ATTEMPT_KEEP_MS) {
    await ensureLoginTable(env);
    const r = await env.DB.prepare("DELETE FROM Login_Attempts WHERE First_At < ?").bind(Date.now() - keepMs).run();
    return r?.meta?.changes ?? 0;
}

export const tooManyTries = (corsHeaders, wait, what = "wrong attempts") => new Response(JSON.stringify({
    error: `Too many ${what}. Try again in ${Math.ceil(wait / 60)} minute${Math.ceil(wait / 60) === 1 ? "" : "s"}.`
}), { status: 429, headers: { ...corsHeaders, "Retry-After": String(wait) } });

export async function runInChunks(env, statements) {
    for (let i = 0; i < statements.length; i += SCAN_BATCH_SIZE) {
        await env.DB.batch(statements.slice(i, i + SCAN_BATCH_SIZE));
    }
}

export const CLEAR_REACTIVATION_SQL = "Advanced_Term = NULL, Reactivation_Until = NULL, Reactivation_Requested = NULL";
export const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"];

// Fallback term by calendar in GMT+8 (Aug-Dec 1st semester, Jan-May 2nd, Jun-Jul Summer).
export function calendarTerm(now = new Date()) {
    const d = new Date(now.getTime() + 8 * 3600 * 1000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    if (m >= 8) return { ay: `${y}-${y + 1}`, sem: "1st Semester" };
    return { ay: `${y - 1}-${y}`, sem: m <= 5 ? "2nd Semester" : "Summer" };
}

export function validTerm(ay, sem) {
    const m = /^(\d{4})-(\d{4})$/.exec(String(ay || ""));
    return !!m && Number(m[2]) === Number(m[1]) + 1 && SEMESTERS.includes(sem);
}

// Last day of each term (end of Finals), set by an admin: { "2026-2027|1st Semester": "2026-12-19" }.
export const termKey = (ay, sem) => `${ay}|${sem}`;
export async function getTermEnds(env) {
    try {
        await ensureAppSettings(env);
        const row = await env.DB.prepare("SELECT Value FROM App_Settings WHERE Key = 'term_ends'").first();
        const m = row && row.Value ? JSON.parse(row.Value) : {};
        return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
}

// The term an admin set, else the calendar term. source says which one it is.
export async function getCurrentTerm(env, now = new Date()) {
    try {
        await ensureAppSettings(env);
        const row = await env.DB.prepare("SELECT Value, Updated_By, Updated_At FROM App_Settings WHERE Key = 'current_term'").first();
        if (row && row.Value) {
            const t = JSON.parse(row.Value);
            if (validTerm(t.ay, t.sem)) return { ay: t.ay, sem: t.sem, source: "set", updatedBy: row.Updated_By || null, updatedAt: row.Updated_At || null, endDate: (await getTermEnds(env))[termKey(t.ay, t.sem)] || null };
        }
    } catch (e) { /* fall back to the calendar */ }
    const cal = calendarTerm(now);
    return { ...cal, source: "calendar", endDate: (await getTermEnds(env))[termKey(cal.ay, cal.sem)] || null };
}
