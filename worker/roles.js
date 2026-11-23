// worker/roles.js
import { json } from './http.js';
// Users.role is 'student', 'lecturer' or 'Admin' (the first Admin is set by hand in D1; Admins change roles in Manage Users). An Admin is a lecturer with extra access:
// the periodic exam photos (a regular lecturer sees only the initial face verification photo).
export const isAdminRole = (role) => String(role || '').toLowerCase() === 'admin';
export const isLecturerRole = (role) => { const r = String(role || '').toLowerCase(); return r === 'lecturer' || r === 'admin'; };

// Admin tools > Manage Users: an Admin changes a user's role. Roles are stored as 'student', 'lecturer' and 'Admin'.
const ROLE_VALUE = { student: 'student', lecturer: 'lecturer', admin: 'Admin' };

export async function handleRoles(request, env, path, url, corsHeaders, caller) {
    // The signed-in user's current role, so a screen opened before a role change can catch up without signing in again.
    if (path === '/api/me' && request.method === 'GET') {
        if (!caller) return json(corsHeaders, { success: true, role: null, isAdmin: false });
        const me = await env.DB.prepare('SELECT role FROM Users WHERE User_ID = ?').bind(caller.id).first();
        return json(corsHeaders, { success: true, role: isAdminRole(me && me.role) ? 'Lecturer' : (me && me.role) || null, isAdmin: isAdminRole(me && me.role) });
    }
    if (path !== '/api/update-user-role' || request.method !== 'POST') return null;
    if (caller && !caller.admin) return json(corsHeaders, { error: 'Only an Admin can change a role.' }, 403);
    const body = await request.json();
    const role = ROLE_VALUE[String(body.role || '').toLowerCase()];
    if (!body.userId || !role) return json(corsHeaders, { error: 'Choose Student, Lecturer or Admin.' }, 400);
    if (caller && caller.id === body.userId) return json(corsHeaders, { error: 'Ask another Admin to change your own role, so the school is never left without one.' }, 400);
    const target = await env.DB.prepare('SELECT User_ID, role FROM Users WHERE User_ID = ?').bind(body.userId).first();
    if (!target) return json(corsHeaders, { error: 'User not found.' }, 404);
    if (role === 'student') {
        const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM Courses WHERE Lecturer_ID = ?').bind(body.userId).first();
        if (owned && owned.n > 0) return json(corsHeaders, { error: 'This lecturer still has classes. Archive or move them before making the user a student.' }, 400);
    }
    await env.DB.prepare('UPDATE Users SET role = ? WHERE User_ID = ?').bind(role, body.userId).run();
    return json(corsHeaders, { success: true, role });
}
