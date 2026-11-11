// worker/auth.js
// Who is calling? Signed login tokens plus one permission gate that every /api request passes through.
//
//  - The Worker secret SESSION_SECRET signs the tokens (HMAC-SHA256). Without it the gate stays OFF and the API
//    behaves as before, so a deploy can never lock everyone out. Set it with:  wrangler secret put SESSION_SECRET
//  - A token holds only the User_ID and an expiry. Role and account status are read from the database on every
//    request, so a suspended account or a changed role takes effect at once.
//  - Routes are listed in RULES. A route that is not listed is lecturer-only.

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

// Returns the User_ID, or null when the token is missing, forged or expired.
export async function verifyToken(env, token, now = Date.now()) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    try {
        const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET, ['verify']), fromB64url(parts[1]), enc.encode(parts[0]));
        if (!ok) return null;
        const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
        if (!payload || !payload.sub || typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
        return String(payload.sub);
    } catch (e) {
        return null;
    }
}

// ---------- Rules ----------
// who:      'public' | 'any' (any signed-in user) | 'lecturer'
// self:     body/query fields that a student may only set to their own id (lecturers are not limited)
// mine:     body/query fields that must be the caller's own id, whoever the caller is
// enrolled: a student must be enrolled in the course named by courseId

const PUBLIC = { who: 'public' };
const LECTURER = { who: 'lecturer' };

export const RULES = {
    'POST /api/login': PUBLIC,
    'POST /api/register': PUBLIC,
    'GET /api/programs': PUBLIC,
    'POST /api/student-accessible-exams': PUBLIC,        // checks the student's own password itself

    'POST /api/change-password': { who: 'any', mine: ['userId'] },
    'POST /api/update-details': { who: 'any', mine: ['userId'] },
    'GET /api/courses': { who: 'any', self: ['studentId'] },
    'GET /api/my-courses': { who: 'any', mine: ['userId'], roleParam: 'role' },
    'POST /api/enroll': { who: 'any', self: ['studentId'] },
    'POST /api/unenroll': { who: 'any', self: ['studentId'] },
    'GET /api/course-details': { who: 'any', enrolled: true },
    'GET /api/no-class': { who: 'any', enrolled: true },
    'GET /api/student-summary': { who: 'any', self: ['studentId'], enrolled: true },
    'GET /api/group-members': { who: 'any', self: ['studentId'], enrolled: true },
    'GET /api/student-accessible-exams': { who: 'any', self: ['studentId'] },
    'POST /api/submit-accessible-exam': { who: 'any', self: ['studentId'] },
    'GET /api/student-sheet-photo': { who: 'any', self: ['studentId'] },
    'POST /api/upload-submission': { who: 'any' },
    'POST /api/upload-chunk': { who: 'any' },
    'POST /api/finish-chunked-upload': { who: 'any' },

    'GET /api/exams': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/exams': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/courses': { who: 'lecturer', mine: ['lecturerId'] },
    'POST /api/update-course-room': { who: 'lecturer', mine: ['lecturerId'] },
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
export async function authorize(request, env, path, url) {
    if (!path.startsWith('/api')) return { ok: true, user: null };
    if (!authEnabled(env)) return { ok: true, user: null };

    const rule = RULES[`${request.method} ${path}`] || LECTURER;
    if (rule.who === 'public') return { ok: true, user: null };

    const userId = await verifyToken(env, bearer(request));
    if (!userId) return deny(401, 'Your session has expired. Please sign in again.');

    const row = await env.DB.prepare('SELECT User_ID, role, account_status FROM Users WHERE User_ID = ?').bind(userId).first();
    if (!row) return deny(401, 'Your session has expired. Please sign in again.');
    if (String(row.account_status || '').toLowerCase() !== 'active') return deny(403, 'This account is not active.');

    const role = String(row.role || '').toLowerCase() === 'lecturer' ? 'lecturer' : 'student';
    const user = { id: row.User_ID, role };

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
            const e = await env.DB.prepare('SELECT 1 AS ok FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?').bind(fields.courseId, user.id).first();
            if (!e) return deny(403, 'You are not enrolled in this class.');
        }
    } else {
        for (const key of Object.keys(OWNER_SQL)) {
            if (!fields[key]) continue;
            const owner = await ownerOf(env, key, fields[key]);
            if (owner !== null && owner !== user.id) return deny(403, 'This belongs to another lecturer.');
        }
    }
    return { ok: true, user };
}
