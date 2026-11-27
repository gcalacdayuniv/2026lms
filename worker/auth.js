// worker/auth.js
// Who is calling? Signed login tokens plus one permission gate that every /api request passes through.
//
//  - The Worker secret SESSION_SECRET signs the tokens (HMAC-SHA256). Without it the gate stays OFF and the API
//    behaves as before, so a deploy can never lock everyone out. Set it with:  wrangler secret put SESSION_SECRET
//  - A token holds only the User_ID and an expiry. Role and account status are read from the database on every
//    request, so a suspended account or a changed role takes effect at once.
//  - Routes are listed in RULES. A route that is not listed is lecturer-only.

import { isAdminRole, isLecturerRole } from './roles.js';
import { ensureExamShares, ensureCourseRoom } from './schema.js';
import { ensureSessions } from './exam-session.js';

const TOKEN_DAYS = 7;
const MAX_BODY_BYTES = 2 * 1024 * 1024;   // larger bodies (photos) are checked by role and query only

// ---------- Token ----------

const enc = new TextEncoder();
const b64url = (bytes) => {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (str) => {
    const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
};

const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);

export const authEnabled = (env) => Boolean(env && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 16);

export async function signToken(env, userId, now = Date.now()) {
    const payload = { sub: userId, exp: Math.floor(now / 1000) + TOKEN_DAYS * 86400 };
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET, ['sign']), enc.encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
}

// Returns { id, iat } (iat = seconds when the token was issued), or null when the token is missing, forged or expired.
export async function verifyTokenInfo(env, token, now = Date.now()) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    try {
        const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET, ['verify']), fromB64url(parts[1]), enc.encode(parts[0]));
        if (!ok) return null;
        const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
        if (!payload || !payload.sub || typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
        return { id: String(payload.sub), iat: payload.exp - TOKEN_DAYS * 86400 };
    } catch (e) {
        return null;
    }
}

// Returns the User_ID, or null when the token is missing, forged or expired.
export async function verifyToken(env, token, now = Date.now()) {
    const info = await verifyTokenInfo(env, token, now);
    return info ? info.id : null;
}

// A password change or reset signs the account out everywhere: tokens issued before Users.Password_Changed_At stop working.
// The column is added automatically the first time it is needed.
let passwordColumnReady = false;
async function ensurePasswordColumn(env) {
    if (passwordColumnReady) return;
    try {
        await env.DB.prepare('ALTER TABLE Users ADD COLUMN Password_Changed_At INTEGER').run();
    } catch (e) {
        if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
    passwordColumnReady = true;
}

export async function markPasswordChanged(env, userId) {
    await ensurePasswordColumn(env);
    await env.DB.prepare('UPDATE Users SET Password_Changed_At = ? WHERE User_ID = ?').bind(Math.floor(Date.now() / 1000), userId).run();
}

// ---------- Rules ----------
// who:      'public' | 'any' (any signed-in user) | 'lecturer'
// self:     body/query fields that a student may only set to their own id (lecturers are not limited)
// mine:     body/query fields that must be the caller's own id, whoever the caller is
// adminAny: an Admin may use the route on any lecturer's class (ownership is not checked for them)
// enrolled: a student must be enrolled in the course named by courseId

const PUBLIC = { who: 'public' };
const LECTURER = { who: 'lecturer' };

export const RULES = {
    'POST /api/login': PUBLIC,
    'POST /api/register': PUBLIC,
    'POST /api/forgot-password': PUBLIC,          // always answers the same; rate limited
    'POST /api/request-password-reset': PUBLIC,   // always answers the same, so it reveals nothing
    'GET /api/password-reset-requests': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/dismiss-password-request': { who: 'lecturer' },
    'GET /api/programs': PUBLIC,
    'POST /api/student-accessible-exams': PUBLIC,        // checks the student's own password itself

    'POST /api/change-password': { who: 'any', mine: ['userId'] },
    'POST /api/update-details': { who: 'any', mine: ['userId'] },
    'GET /api/my-prefs': { who: 'any', mine: ['userId'] },
    'POST /api/my-prefs': { who: 'any', mine: ['userId'] },
    'POST /api/admin-update-student': { who: 'lecturer' },
    'GET /api/current-term': { who: 'any' },
    'POST /api/current-term': { who: 'lecturer', mine: ['userId'] },
    'GET /api/courses': { who: 'any', self: ['studentId'] },
    'GET /api/my-courses': { who: 'any', mine: ['userId'], roleParam: 'role' },
    'POST /api/enroll': { who: 'lecturer' },   // students join with an invite code (/api/join-class)
    'POST /api/join-class': { who: 'any', self: ['studentId'] },
    'GET /api/class-invite': { who: 'lecturer' },
    'POST /api/class-invite': { who: 'lecturer' },
    'POST /api/unenroll': { who: 'any', self: ['studentId'] },
    'GET /api/course-details': { who: 'any', enrolled: true },
    'GET /api/no-class': { who: 'any', enrolled: true },
    'GET /api/class-modes': { who: 'any', enrolled: true },
    'GET /api/student-summary': { who: 'any', self: ['studentId'], enrolled: true },
    'GET /api/seat-map': { who: 'any', self: ['studentId'], enrolled: true },   // seat numbers only, no names
    'GET /api/group-members': { who: 'any', self: ['studentId'], enrolled: true },
    'GET /api/group-sets': { who: 'any', enrolled: true },
    'GET /api/group-set': { who: 'lecturer' },
    'POST /api/group-set-create': { who: 'lecturer' },
    'POST /api/group-set-rename': { who: 'lecturer' },
    'POST /api/group-set-delete': { who: 'lecturer' },
    'POST /api/group-set-save': { who: 'lecturer' },
    'GET /api/student-groups': { who: 'any', self: ['studentId'], enrolled: true },
    'GET /api/student-accessible-exams': { who: 'any', self: ['studentId'] },
    'POST /api/submit-accessible-exam': { who: 'any', self: ['studentId'] },
    'POST /api/start-accessible-exam': { who: 'any', self: ['studentId'] },
    'POST /api/exam-draft': { who: 'any', self: ['studentId'] },
    'POST /api/exam-away': { who: 'any', self: ['studentId'] },
    'POST /api/logout': { who: 'any', mine: ['userId'] },
    'GET /api/me': { who: 'any' },
    'GET /api/site-icon': { who: 'public' },   // the favicon is needed before sign-in
    'POST /api/site-icon': { who: 'lecturer' },   // the handler lets Admins only
    'GET /api/exam-photos': { who: 'lecturer', adminAny: true },   // an Admin may read any class's photos (the handler limits a lecturer to the initial photo)
    'POST /api/admin-delete-exam-photos': { who: 'lecturer', adminAny: true },   // Admin tools > Exam Photos > Select > Delete (the handler refuses a lecturer)
    'GET /api/admin-exam-photos': { who: 'lecturer', adminAny: true },   // Admin tools > Exam Photos (the handler refuses a lecturer)
    'POST /api/exam-photo': { who: 'any', self: ['studentId'] },   // GET /api/exam-photos is lecturer-only (owner checked by classExamId / photoId)
    'GET /api/student-exam-review': { who: 'any', self: ['studentId'] },
    'GET /api/student-sheet-photo': { who: 'any', self: ['studentId'] },
    'GET /api/student-sheet-review': { who: 'any', self: ['studentId'] },
    'POST /api/upload-submission': { who: 'any' },
    'GET /api/default-upload-term': { who: 'any', enrolled: true },
    'POST /api/upload-chunk': { who: 'any' },
    'POST /api/finish-chunked-upload': { who: 'any' },

    'GET /api/exams': { who: 'lecturer', mine: ['lecturerId'] },
    'GET /api/exam-data': { who: 'lecturer', sharedOk: true },        // a lecturer an exam was shared with may open it
    'POST /api/class-exams': { who: 'lecturer', sharedOk: true },     // ... and assign it to their own class
    'POST /api/exams': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/courses': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/update-course-room': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/update-course': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/update-student-details': { who: 'lecturer', mine: ['lecturerId'] }
    // Everything else (attendance, assessments, scores, exams admin, scans, user admin ...) is lecturer-only
    // and checked against the courses, exams and sheets the lecturer owns.
};

// ---------- Ownership ----------
// A lecturer may only touch their own courses. Each id found in the query or body is traced back to its course.

const OWNER_SQL = {
    courseId: 'SELECT Lecturer_ID AS owner FROM Courses WHERE Course_ID = ?',
    assessmentId: 'SELECT c.Lecturer_ID AS owner FROM Assessments a JOIN Courses c ON c.Course_ID = a.Course_ID WHERE a.Assessment_ID = ?',
    examId: 'SELECT Lecturer_ID AS owner FROM Exams WHERE Exam_ID = ?',
    photoId: 'SELECT c.Lecturer_ID AS owner FROM Exam_Photos p JOIN Class_Exams ce ON ce.Class_Exam_ID = p.Class_Exam_ID JOIN Courses c ON c.Course_ID = ce.Course_ID WHERE p.Photo_ID = ?',
    classExamId: 'SELECT c.Lecturer_ID AS owner FROM Class_Exams ce JOIN Courses c ON c.Course_ID = ce.Course_ID WHERE ce.Class_Exam_ID = ?',
    submissionId: 'SELECT c.Lecturer_ID AS owner FROM Submissions s JOIN Courses c ON c.Course_ID = s.Course_ID WHERE s.Submission_ID = ?',
    sessionId: 'SELECT c.Lecturer_ID AS owner FROM Scan_Sessions s JOIN Courses c ON c.Course_ID = s.Course_ID WHERE s.Session_ID = ?',
    fileUrl: 'SELECT c.Lecturer_ID AS owner FROM Submissions s JOIN Courses c ON c.Course_ID = s.Course_ID WHERE s.File_URL = ?',
    sheetId: 'SELECT c.Lecturer_ID AS owner FROM Scan_Sheets h JOIN Scan_Sessions s ON s.Session_ID = h.Session_ID JOIN Courses c ON c.Course_ID = s.Course_ID WHERE h.Sheet_ID = ?'
};

// null when the row does not exist (the route answers "not found" itself), otherwise the owner's id.
async function ownerOf(env, key, value) {
    try {
        const row = await env.DB.prepare(OWNER_SQL[key]).bind(String(value)).first();
        return row ? row.owner : null;
    } catch (e) {
        return null;   // a table that does not exist yet (scan tables) has nothing to protect
    }
}

// ---------- Gate ----------

const deny = (status, error) => ({ ok: false, status, error });

const bearer = (request) => {
    const h = request.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : '';
};

async function readFields(request, url) {
    const fields = {};
    url.searchParams.forEach((v, k) => { fields[k] = v; });
    const type = request.headers.get('Content-Type') || '';
    const size = parseInt(request.headers.get('Content-Length') || '0', 10);
    const special = request.headers.has('X-Chunk-Meta') || request.headers.has('X-Submission-Meta');
    if ((request.method === 'POST' || request.method === 'DELETE') && type.includes('json') && !special && size <= MAX_BODY_BYTES) {
        try {
            const body = await request.clone().json();
            if (body && typeof body === 'object' && !Array.isArray(body)) {
                Object.keys(body).forEach(k => {
                    if (typeof body[k] === 'string' || typeof body[k] === 'number') fields[k] = String(body[k]);
                });
            }
        } catch (e) { /* not JSON: only the query is checked */ }
    }
    return fields;
}

// Returns { ok: true, user } or { ok: false, status, error }. user is null for public routes or when the gate is off.
async function isSharedWith(env, examId, lecturerId) {
    try {
        await ensureExamShares(env);
        const r = await env.DB.prepare('SELECT 1 AS ok FROM Exam_Shares WHERE Exam_ID = ? AND Lecturer_ID = ?').bind(examId, lecturerId).first();
        return !!r;
    } catch (e) { return false; }
}

export async function authorize(request, env, path, url) {
    if (!path.startsWith('/api')) return { ok: true, user: null };
    if (!authEnabled(env)) return { ok: true, user: null };

    const rule = RULES[`${request.method} ${path}`] || LECTURER;
    if (rule.who === 'public') return { ok: true, user: null };

    const info = await verifyTokenInfo(env, bearer(request));
    if (!info) return deny(401, 'Your session has expired. Please sign in again.');
    const userId = info.id;

    await ensurePasswordColumn(env);
    await ensureSessions(env);
    const row = await env.DB.prepare('SELECT User_ID, role, account_status, Password_Changed_At, Sessions_Valid_From, Last_Seen_At FROM Users WHERE User_ID = ?').bind(userId).first();
    if (!row) return deny(401, 'Your session has expired. Please sign in again.');
    if (row.Sessions_Valid_From && info.iat < row.Sessions_Valid_From) return deny(401, 'You were signed out because your account was signed in on another device. Any exam in progress was submitted with your saved answers.');
    if (row.Password_Changed_At && info.iat < row.Password_Changed_At) return deny(401, 'Your password was changed. Please sign in again.');
    if (String(row.account_status || '').toLowerCase() !== 'active') return deny(403, 'This account is not active.');

    const role = isLecturerRole(row.role) ? 'lecturer' : 'student';
    const user = { id: row.User_ID, role, admin: isAdminRole(row.role) };
    // "Last seen" backs the one-device-at-a-time warning; written at most once a minute.
    if (role === 'student' && (!row.Last_Seen_At || Date.now() - row.Last_Seen_At > 60000)) {
        await env.DB.prepare('UPDATE Users SET Last_Seen_At = ? WHERE User_ID = ?').bind(Date.now(), row.User_ID).run();
    }

    if (rule.who === 'lecturer' && role !== 'lecturer') return deny(403, 'Only a lecturer can do this.');

    const fields = await readFields(request, url);

    for (const f of rule.mine || []) {
        if (fields[f] !== undefined && fields[f] !== '' && fields[f] !== user.id) return deny(403, 'You can only do this for your own account.');
    }
    if (rule.roleParam && fields[rule.roleParam] === 'lecturer' && role !== 'lecturer') return deny(403, 'Only a lecturer can do this.');

    if (role === 'student') {
        for (const f of rule.self || []) {
            if (fields[f] !== undefined && fields[f] !== '' && fields[f] !== user.id) return deny(403, 'You can only see or change your own records.');
        }
        if (rule.enrolled && fields.courseId) {
            await ensureCourseRoom(env);
            const e = await env.DB.prepare('SELECT 1 AS ok FROM Enrollments en JOIN Courses c ON c.Course_ID = en.Course_ID WHERE en.Course_ID = ? AND en.Student_ID = ? AND COALESCE(c.Archived, 0) = 0').bind(fields.courseId, user.id).first();
            if (!e) return deny(403, 'You are not enrolled in this class, or it is archived.');
        }
    } else {
        for (const key of Object.keys(OWNER_SQL)) {
            if (!fields[key]) continue;
            if (user.admin && rule.adminAny) continue;
            const owner = await ownerOf(env, key, fields[key]);
            if (owner !== null && owner !== user.id) {
                // Some exam routes are open to a lecturer the owner shared the exam with.
                if (key === 'examId' && rule.sharedOk && await isSharedWith(env, fields[key], user.id)) continue;
                return deny(403, 'This belongs to another lecturer.');
            }
        }
    }
    return { ok: true, user };
}
