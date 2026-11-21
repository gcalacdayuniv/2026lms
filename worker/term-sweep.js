// Accounts are deactivated when every class a student is in has been archived, or ended at least
// 2 weeks ago (2 weeks after the admin-set last day of its term). A student can come back with a class code.
import { getTermEnds } from './shared.js';
import { ensureAppSettings, ensureCourseRoom } from './schema.js';

export const DEACTIVATE_AFTER_DAYS = 14;
const DAY = 86400000;

// Today in GMT+8 as YYYY-MM-DD.
const todayManila = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

// Term keys whose last day was more than 14 days ago.
export const endedTermKeys = (ends, now = Date.now()) => {
    const cutoff = todayManila(now - DEACTIVATE_AFTER_DAYS * DAY);
    return Object.entries(ends || {}).filter(([, d]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff).map(([k]) => k);
};

// Returns how many accounts were (or would be) deactivated. Students with no class are left alone.
export async function sweepEndedAccounts(env, { dryRun = false, now = Date.now() } = {}) {
    await ensureCourseRoom(env);
    const keys = endedTermKeys(await getTermEnds(env), now);
    const marks = keys.length ? keys.map(() => "?").join(",") : "'~'";
    const where = `u.role COLLATE NOCASE = 'student' AND LOWER(COALESCE(u.account_status, '')) = 'active'
        AND EXISTS (SELECT 1 FROM Enrollments e0 WHERE e0.Student_ID = u.User_ID)
        AND NOT EXISTS (
            SELECT 1 FROM Enrollments e JOIN Courses c ON c.Course_ID = e.Course_ID
            WHERE e.Student_ID = u.User_ID AND COALESCE(c.Archived, 0) = 0
              AND (COALESCE(c.AcademicYear, '') || '|' || COALESCE(c.Semester, '')) NOT IN (${marks}))`;
    if (dryRun) {
        const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM Users u WHERE ${where}`).bind(...keys).first();
        return r.n;
    }
    const r = await env.DB.prepare(`UPDATE Users SET account_status = 'Inactive' WHERE User_ID IN (SELECT u.User_ID FROM Users u WHERE ${where})`).bind(...keys).run();
    return (r.meta && r.meta.changes) || 0;
}

// Runs the sweep at most once every 6 hours (called from a small share of requests).
export async function maybeSweep(env, now = Date.now()) {
    await ensureAppSettings(env);
    const row = await env.DB.prepare("SELECT Value FROM App_Settings WHERE Key = 'last_end_sweep'").first();
    if (row && now - Number(row.Value) < 6 * 3600000) return 0;
    await env.DB.prepare("INSERT INTO App_Settings (Key, Value, Updated_At) VALUES ('last_end_sweep', ?, CURRENT_TIMESTAMP) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, Updated_At = CURRENT_TIMESTAMP").bind(String(now)).run();
    return sweepEndedAccounts(env, { now });
}
