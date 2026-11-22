// worker/exam-photos.js
// Secure exam mode: who it applies to, and the photos taken while a student sits an exam.
//  - Applies to every online exam. A student flagged Legally Blind is exempt unless the lecturer turns it on for them;
//    the lecturer can also turn it off for anyone (Users.Exam_Secure = 'on' | 'off' | empty = default).
//  - The app takes a photo when the exam starts and every 30 seconds. Photos live in Google Drive (Apps Script),
//    only a reference is kept here, and only the class's lecturer can see them.
import { json } from './http.js';
import { callGas } from './gas.js';

const PHOTO_MAX_B64 = 400000;     // about 300 KB; the app sends small 320 px pictures of 15 to 30 KB
const MAX_PHOTOS_PER_ATTEMPT = 400;

let ready = false;
export async function ensureExamSecurity(env) {
    if (ready) return;
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS Exam_Photos (
            Photo_ID TEXT PRIMARY KEY,
            Assignment_ID TEXT NOT NULL,
            Class_Exam_ID TEXT NOT NULL,
            Student_ID TEXT NOT NULL,
            Kind TEXT,
            Taken_At TEXT,
            File_ID TEXT
        )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_exam_photos_ce ON Exam_Photos (Class_Exam_ID, Student_ID)").run();
    try {
        for (const [table, column] of [['Users', 'Exam_Secure'], ['Exam_Assignments', 'Submit_Reason']]) {
            const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            if (!(info.results || []).some(c => c.name === column)) {
                await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`).run();
            }
        }
        ready = true;
    } catch (e) { ready = false; }
}

export const isLegallyBlind = (eye) => /legally\s*blind/i.test(String(eye || ''));

// true = secure mode applies to this student's exams.
export const secureApplies = (user) => {
    if (!user) return false;
    if (user.Exam_Secure === 'on') return true;
    if (user.Exam_Secure === 'off') return false;
    return !isLegallyBlind(user.eye_condition);
};

export async function secureFor(env, userId) {
    await ensureExamSecurity(env);
    const u = await env.DB.prepare("SELECT eye_condition, Exam_Secure FROM Users WHERE User_ID = ?").bind(userId).first();
    return secureApplies(u);
}

export async function handleExamPhotos(request, env, path, url, corsHeaders) {
    if (path !== '/api/exam-photo' && path !== '/api/exam-photos') return null;
    await ensureExamSecurity(env);

    // A student's photo while the exam is in progress.
    if (request.method === 'POST' && path === '/api/exam-photo') {
        const { assignmentId, studentId, kind, base64 } = await request.json();
        if (!assignmentId || !studentId) return json(corsHeaders, { error: 'Missing details.' }, 400);
        if (typeof base64 !== 'string' || base64.length < 200 || base64.length > PHOTO_MAX_B64) return json(corsHeaders, { error: 'The photo is missing or too large.' }, 400);
        const a = await env.DB.prepare("SELECT Assignment_ID, Class_Exam_ID, Status, Is_Enabled FROM Exam_Assignments WHERE Assignment_ID = ? AND Student_ID = ?").bind(assignmentId, studentId).first();
        if (!a || !a.Is_Enabled) return json(corsHeaders, { error: 'Exam assignment not found.' }, 404);
        if (a.Status === 'Completed') return json(corsHeaders, { success: false, code: 'closed' });
        if (!(await secureFor(env, studentId))) return json(corsHeaders, { success: false, code: 'not-secure' });
        const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM Exam_Photos WHERE Assignment_ID = ?").bind(assignmentId).first();
        if (count && count.n >= MAX_PHOTOS_PER_ATTEMPT) return json(corsHeaders, { success: false, code: 'limit' });

        const photoId = crypto.randomUUID();
        const takenAt = new Date().toISOString();
        const gas = await callGas(env, JSON.stringify({
            filename: `${takenAt.replace(/[:.]/g, '-')}_${kind === 'start' ? 'start' : 'check'}.jpg`,
            mimeType: 'image/jpeg',
            base64,
            pathParts: ['Exam Photos', a.Class_Exam_ID, studentId]
        }));
        if (!gas.fileId) throw new Error('Google Drive did not return a file id.');
        await env.DB.prepare("INSERT INTO Exam_Photos (Photo_ID, Assignment_ID, Class_Exam_ID, Student_ID, Kind, Taken_At, File_ID) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(photoId, assignmentId, a.Class_Exam_ID, studentId, kind === 'start' ? 'start' : 'check', takenAt, gas.fileId).run();
        return json(corsHeaders, { success: true }, 201);
    }

    // Lecturer: the list of photos for one class exam (no pictures), or one picture.
    if (request.method === 'GET' && path === '/api/exam-photos') {
        const classExamId = url.searchParams.get('classExamId');
        const photoId = url.searchParams.get('photoId');
        if (photoId) {
            const row = await env.DB.prepare("SELECT File_ID FROM Exam_Photos WHERE Photo_ID = ?").bind(photoId).first();
            if (!row || !row.File_ID) return json(corsHeaders, { error: 'No photo.' }, 404);
            const gas = await callGas(env, JSON.stringify({ action: 'read', fileId: row.File_ID }));
            if (!gas.base64) throw new Error('Google Drive did not return the photo.');
            return json(corsHeaders, { success: true, mimeType: gas.mimeType || 'image/jpeg', base64: gas.base64 });
        }
        if (!classExamId) return json(corsHeaders, { error: 'Missing classExamId' }, 400);
        const rows = await env.DB.prepare(
            `SELECT p.Photo_ID, p.Student_ID, p.Kind, p.Taken_At, u.Name
             FROM Exam_Photos p LEFT JOIN Users u ON u.User_ID = p.Student_ID
             WHERE p.Class_Exam_ID = ? ORDER BY u.Name, p.Taken_At`
        ).bind(classExamId).all();
        return json(corsHeaders, { success: true, photos: rows.results || [] });
    }
    return null;
}
