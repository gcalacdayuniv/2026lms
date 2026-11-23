// js/session-role.js
// The signed-in user's role is saved on the device at sign-in. When an Admin changes it (or sets the first Admin in D1),
// an open or restored session would keep the old screens, so the app asks the server once at start and reloads if it differs.
import { apiFetch, AppState } from './globals.js';

export const refreshSessionRole = async () => {
    if (!AppState.user || !AppState.token) return;
    try {
        const me = await apiFetch('/api/me');
        if (!me || !me.role) return;
        const before = `${String(AppState.user.role || '').toLowerCase()}|${AppState.user.isAdmin ? 1 : 0}`;
        const after = `${String(me.role).toLowerCase()}|${me.isAdmin ? 1 : 0}`;
        if (before === after) return;
        AppState.setUser({ ...AppState.user, role: me.role, isAdmin: !!me.isAdmin });
        window.location.reload();
    } catch (e) { /* offline or signed out: keep what is saved */ }
};
