// worker/roles.js
// Users.role is 'student', 'lecturer' or 'Admin' (set by hand in D1). An Admin is a lecturer with extra access:
// the periodic exam photos (a regular lecturer sees only the initial face verification photo).
export const isAdminRole = (role) => String(role || '').toLowerCase() === 'admin';
export const isLecturerRole = (role) => { const r = String(role || '').toLowerCase(); return r === 'lecturer' || r === 'admin'; };
