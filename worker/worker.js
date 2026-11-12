// worker/worker.js
import { authorize, signToken, authEnabled } from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { questionPoints, examMaxPoints, essayIndexes, scoreExam, studentQuestion, questionStats, scoreSummary } from './grading.js';
// worker/upload-guard.js
// Cheap checks that run BEFORE any upload bytes are streamed to Google Drive.
// Uses a few small D1 queries and no heavy CPU work, so it fits the free Workers plan.

// A 25 MB file is about 33.4 MB of base64 text. Leave a little room for the wrapper.
const MAX_SINGLE_BODY_BYTES = 36 * 1024 * 1024;
// One piece of a chunked upload (the browser sends about 3.6 MB pieces).
const MAX_CHUNK_BODY_BYTES = 4 * 1024 * 1024;
// Largest total base64 size accepted across all pieces (25 MB file).
const MAX_TOTAL_BASE64_CHARS = 36 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt']);
const TERMS = ['MidTerm', 'FinalTerm'];
const TYPES = ['file', 'url'];
const MIME_RE = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/;

class UploadError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// Rejects a request whose declared size is missing or too large.
function checkContentLength(request, maxBytes) {
    const len = parseInt(request.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(len) && len > maxBytes) {
        throw new UploadError(`File is too large. Maximum upload is ${Math.round(maxBytes / (1024 * 1024))} MB per request.`, 413);
    }
}

// Validates the submission details (the same fields recordSubmission() uses).
function validateMeta(meta) {
    if (!meta || typeof meta !== 'object') throw new UploadError('Missing submission details.');

    const { courseId, studentId, term, title, description, type, filename, mimeType } = meta;

    if (!courseId || typeof courseId !== 'string' || !studentId || typeof studentId !== 'string') {
        throw new UploadError('Missing course or student.');
    }
    if (!TERMS.includes(term)) throw new UploadError('Invalid term.');
    if (!TYPES.includes(type)) throw new UploadError('Invalid submission type.');

    if (typeof title !== 'string' || !title.trim() || title.length > 150) {
        throw new UploadError('Title is required (150 characters maximum).');
    }
    if (description != null && (typeof description !== 'string' || description.length > 2000)) {
        throw new UploadError('Description is too long (2000 characters maximum).');
    }

    if (typeof filename !== 'string' || !filename.trim() || filename.length > 220 || /[\\/]/.test(filename)) {
        throw new UploadError('Invalid file name.');
    }
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new UploadError('File type not allowed. Use PDF, Word or PowerPoint files.');
    }
    if (type === 'url' && ext !== 'txt') throw new UploadError('Invalid link submission.');
    if (type === 'file' && ext === 'txt') throw new UploadError('File type not allowed. Use PDF, Word or PowerPoint files.');

    if (mimeType != null && mimeType !== '' && (typeof mimeType !== 'string' || mimeType.length > 100 || !MIME_RE.test(mimeType))) {
        throw new UploadError('Invalid file type.');
    }

    if (meta.pathParts != null) {
        if (!Array.isArray(meta.pathParts) || meta.pathParts.length > 5 ||
            meta.pathParts.some(p => typeof p !== 'string' || p.length > 100)) {
            throw new UploadError('Invalid folder path.');
        }
    }

    if (meta.includedMembers != null) {
        if (!Array.isArray(meta.includedMembers) || meta.includedMembers.length > 20 ||
            meta.includedMembers.some(m => typeof m !== 'string')) {
            throw new UploadError('Invalid group members.');
        }
    }
}

// The uploader must be an Active user enrolled in the course, and so must every group member.
async function verifyUploader(env, meta) {
    const ids = [meta.studentId];
    if (meta.isGroup && Array.isArray(meta.includedMembers)) {
        for (const m of meta.includedMembers) if (!ids.includes(m)) ids.push(m);
    }

    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
        `SELECT u.User_ID
         FROM Users u
         JOIN Enrollments e ON e.Student_ID = u.User_ID AND e.Course_ID = ?
         WHERE u.User_ID IN (${placeholders}) AND u.account_status COLLATE NOCASE = 'active'`
    ).bind(meta.courseId, ...ids).all();

    const ok = new Set((rows.results || []).map(r => r.User_ID));
    if (!ok.has(meta.studentId)) {
        throw new UploadError('You are not enrolled in this course, or your account is not active.', 403);
    }
    if (ids.some(id => !ok.has(id))) {
        throw new UploadError('A selected group member is not an active student of this course.', 403);
    }
}

// Validates the chunk details sent in the X-Chunk-Meta header.
function validateChunkMeta(info, maxChunks) {
    const { uploadId, index, total } = info || {};
    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(uploadId || '')) ||
        !Number.isInteger(index) || !Number.isInteger(total) ||
        total < 1 || total > maxChunks || index < 0 || index >= total) {
        throw new UploadError('Invalid chunk details.');
    }
    return { uploadId, index, total };
}


// ---------- Attendance date management and timezone-aware dates ----------
// Attendance date management: list, change, delete and merge dates that have records.
// Also exports a timezone-aware "today" helper so the server never falls back to UTC.

const DEFAULT_TIMEZONE = 'Asia/Manila';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Status priority when merging two records for the same student (higher wins).
const STATUS_PRIORITY = { Absent: 4, Late: 3, Excused: 2, Present: 1 };

// Returns YYYY-MM-DD for "today" in the visitor's timezone (Cloudflare supplies it),
// falling back to Asia/Manila. Never uses the UTC date.
function getRequestDate(request) {
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

const json = (corsHeaders, body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

const pickStatus = (a, b) =>
    (STATUS_PRIORITY[a] || 0) >= (STATUS_PRIORITY[b] || 0) ? a : b;

const insertStmt = (env, courseId, studentId, date, status, points) =>
    env.DB.prepare(
        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), courseId, studentId, date, status, points);

// Returns a Response when the request is handled here, otherwise null.
async function handleAttendanceDates(request, env, path, url, corsHeaders) {
    if (!path.startsWith('/api/attendance-dates')) return null;
    const method = request.method;

    // List every date that has records for a course.
    if (method === 'GET' && path === '/api/attendance-dates') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json(corsHeaders, { error: 'Missing courseId' }, 400);

        const rows = await env.DB.prepare(
            `SELECT Date,
                    COUNT(*) AS Total,
                    SUM(CASE WHEN Status = 'Present' THEN 1 ELSE 0 END) AS Present,
                    SUM(CASE WHEN Status = 'Late' THEN 1 ELSE 0 END) AS Late,
                    SUM(CASE WHEN Status = 'Excused' THEN 1 ELSE 0 END) AS Excused,
                    SUM(CASE WHEN Status = 'Absent' THEN 1 ELSE 0 END) AS Absent,
                    SUM(COALESCE(Performance_Points, 0)) AS Points
             FROM Attendance WHERE Course_ID = ?
             GROUP BY Date ORDER BY Date DESC`
        ).bind(courseId).all();

        const noClass = await env.DB.prepare(
            "SELECT Date FROM Course_Sessions WHERE Course_ID = ? AND Is_No_Class = 1"
        ).bind(courseId).all();
        const noClassDates = new Set((noClass.results || []).map(r => r.Date));

        const dates = (rows.results || []).map(r => ({ ...r, Is_No_Class: noClassDates.has(r.Date) }));
        return json(corsHeaders, { success: true, dates });
    }

    // Change the date of all records on a date.
    if (method === 'POST' && path === '/api/attendance-dates/change') {
        const { courseId, oldDate, newDate } = await request.json();
        if (!courseId || !DATE_RE.test(oldDate || '') || !DATE_RE.test(newDate || '')) {
            return json(corsHeaders, { error: 'Invalid parameters' }, 400);
        }
        if (oldDate === newDate) return json(corsHeaders, { success: true, unchanged: true });

        const source = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, oldDate).first();
        if (!source || !source.c) return json(corsHeaders, { error: 'No records found on that date.' }, 404);

        const target = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, newDate).first();
        if (target && target.c > 0) {
            return json(corsHeaders, {
                error: 'The new date already has records. Use Merge instead.',
                code: 'DATE_HAS_RECORDS'
            }, 409);
        }

        const noClass = await env.DB.prepare(
            "SELECT Session_ID FROM Course_Sessions WHERE Course_ID = ? AND Date = ? AND Is_No_Class = 1"
        ).bind(courseId, newDate).first();
        if (noClass) {
            return json(corsHeaders, { error: 'The new date is marked as No Class.', code: 'NO_CLASS_DATE' }, 409);
        }

        await env.DB.prepare(
            "UPDATE Attendance SET Date = ? WHERE Course_ID = ? AND Date = ?"
        ).bind(newDate, courseId, oldDate).run();

        return json(corsHeaders, { success: true });
    }

    // Delete all records on a date.
    if (method === 'DELETE' && path === '/api/attendance-dates') {
        const { courseId, date } = await request.json();
        if (!courseId || !DATE_RE.test(date || '')) {
            return json(corsHeaders, { error: 'Invalid parameters' }, 400);
        }
        await env.DB.prepare(
            "DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, date).run();
        return json(corsHeaders, { success: true });
    }

    // Merge two dates into one. Points are added; status priority is Absent > Late > Excused > Present.
    if (method === 'POST' && path === '/api/attendance-dates/merge') {
        const { courseId, dateA, dateB, keepDate } = await request.json();
        if (!courseId || !DATE_RE.test(dateA || '') || !DATE_RE.test(dateB || '') || dateA === dateB) {
            return json(corsHeaders, { error: 'Two different dates are required.' }, 400);
        }
        if (keepDate !== dateA && keepDate !== dateB) {
            return json(corsHeaders, { error: 'keepDate must be one of the two dates.' }, 400);
        }

        const rows = await env.DB.prepare(
            `SELECT Student_ID, Date, Status, Performance_Points
             FROM Attendance WHERE Course_ID = ? AND Date IN (?, ?)`
        ).bind(courseId, dateA, dateB).all();

        const merged = new Map();
        for (const r of (rows.results || [])) {
            const points = parseInt(r.Performance_Points, 10) || 0;
            const existing = merged.get(r.Student_ID);
            if (!existing) {
                merged.set(r.Student_ID, { status: r.Status, points });
            } else {
                existing.status = pickStatus(existing.status, r.Status);
                existing.points += points;
            }
        }
        if (merged.size === 0) return json(corsHeaders, { error: 'No records to merge.' }, 404);

        const statements = [
            env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date IN (?, ?)")
                .bind(courseId, dateA, dateB)
        ];
        for (const [studentId, v] of merged) {
            statements.push(insertStmt(env, courseId, studentId, keepDate, v.status, v.points));
        }
        await env.DB.batch(statements);

        return json(corsHeaders, { success: true, merged: merged.size, keepDate });
    }

    return null;
}
// ---------- End attendance date management ----------

// Finds the account for a sign-in identifier whose password matches. Older SHA-256 hashes are replaced by a
// salted hash on the spot. Returns the row (with Password removed) or null.
async function findUserByCredentials(env, identifier, password, columns) {
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

// ---------- Exam scoring ----------
// Question types, points and grading live in ./grading.js.

const safeJson = (text) => { try { const v = JSON.parse(text || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };

const ASSESSMENT_TERMS = ['MidTerm', 'FinalTerm'];
const ASSESSMENT_CATEGORIES = ['Written', 'Narrative', 'Individual', 'Performance', 'Report', 'MajorExam'];

// ---- Scanned answer sheets (OMR) ---------------------------------------------------------------
// Every scanned sheet is stored so it can be reviewed, counted (correct / wrong / blank / double) and
// corrected later. Answers are lists with one entry per question: 0.. = the shaded choice,
// -1 = blank, -2 = more than one circle shaded. Original_Answers is what the reader saw; Answers is
// the current (possibly corrected) version. The score is always recalculated here from the saved key.
const SCAN_BLANK = -1;
const SCAN_MULTIPLE = -2;
const SCAN_MAX_QUESTIONS = 100;
const SCAN_MAX_CHOICES = 5;
const SCAN_MAX_SHEETS = 300;
const SCAN_BATCH_SIZE = 90;
let scanTablesReady = false;

async function ensureScanTables(env) {
    if (scanTablesReady) return;
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS Scan_Sessions (
                Session_ID TEXT PRIMARY KEY,
                Course_ID TEXT NOT NULL,
                Assessment_ID TEXT NOT NULL,
                Title TEXT,
                Term TEXT,
                Category TEXT,
                Num_Questions INTEGER NOT NULL,
                Num_Choices INTEGER NOT NULL,
                Answer_Key TEXT NOT NULL,
                Bonus_Flags TEXT NOT NULL,
                Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
                Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS Scan_Sheets (
                Sheet_ID TEXT PRIMARY KEY,
                Session_ID TEXT NOT NULL,
                Student_ID TEXT NOT NULL,
                Student_No_Read TEXT,
                Original_Answers TEXT NOT NULL,
                Answers TEXT NOT NULL,
                Score REAL,
                Edited INTEGER DEFAULT 0,
                Created_At DATETIME DEFAULT CURRENT_TIMESTAMP,
                Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `),
        env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_sessions_assessment ON Scan_Sessions (Course_ID, Assessment_ID)"),
        env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_sheets_student ON Scan_Sheets (Session_ID, Student_ID)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_scan_sessions_course ON Scan_Sessions (Course_ID)")
    ]);
    // Scan_ID = the id the app gave one captured sheet. It makes a retried upload harmless and tells a
    // re-upload of the same capture apart from a different sheet of the same student.
    try {
        await env.DB.prepare("ALTER TABLE Scan_Sheets ADD COLUMN Scan_ID TEXT").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    // Photo_File_ID = Google Drive file id of the low-resolution photo of the captured sheet.
    try {
        await env.DB.prepare("ALTER TABLE Scan_Sheets ADD COLUMN Photo_File_ID TEXT").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    // Photo_Layout = how the photo is drawn: "rect1" = the sheet straightened to its frame at 5 px per unit
    // (so the app can cut out the row of any question). Empty = an older, plain photo.
    try {
        await env.DB.prepare("ALTER TABLE Scan_Sheets ADD COLUMN Photo_Layout TEXT").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    scanTablesReady = true;
}

const SCAN_PHOTO_MAX_B64 = 900000; // about 650 KB of image; the app sends about 100 to 200 KB

const parseJsonList = (text) => {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : [];
    } catch (e) {
        return [];
    }
};

const isAnswerList = (list, n, c) =>
    Array.isArray(list) && list.length === n && list.every(a => Number.isInteger(a) && a >= SCAN_MULTIPLE && a < c);

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Counts and score for one sheet. Bonus questions add points; the total never goes above the max.
function gradeScan(answers, key, bonus, max) {
    let raw = 0, bonusPoints = 0, wrong = 0, blank = 0, multiple = 0;
    answers.forEach((a, i) => {
        if (a === SCAN_BLANK) blank++;
        else if (a === SCAN_MULTIPLE) multiple++;
        else if (a === key[i]) {
            if (bonus[i]) bonusPoints++;
            else raw++;
        } else wrong++;
    });
    return { raw, bonus: bonusPoints, wrong, blank, multiple, score: Math.min(Number(max), raw + bonusPoints) };
}

// Replaces ONE student's score in an assessment without touching anyone else's.
const scanScoreStatements = (env, assessmentId, studentId, score) => [
    env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(assessmentId, studentId),
    env.DB.prepare("INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), assessmentId, studentId, score)
];

async function runInChunks(env, statements) {
    for (let i = 0; i < statements.length; i += SCAN_BATCH_SIZE) {
        await env.DB.batch(statements.slice(i, i + SCAN_BATCH_SIZE));
    }
}

// Returns a Response when the request is handled here, otherwise null.
async function handleScanSheets(request, env, path, url, corsHeaders) {
    if (path !== '/api/scan-sessions' && path !== '/api/student-sheet-photo' && !path.startsWith('/api/scan-sheets')) return null;
    await ensureScanTables(env);
    const method = request.method;

    // Saved scans of a course, newest first, with simple counts.
    if (method === 'GET' && path === '/api/scan-sessions') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json(corsHeaders, { error: 'Missing courseId' }, 400);

        const rows = await env.DB.prepare(
            `SELECT s.Session_ID, s.Assessment_ID, s.Title, s.Term, s.Category, s.Num_Questions, s.Num_Choices,
                    s.Created_At, s.Updated_At, a.Max_Score,
                    (SELECT COUNT(*) FROM Scan_Sheets h WHERE h.Session_ID = s.Session_ID) AS Sheets,
                    (SELECT COUNT(*) FROM Scan_Sheets h WHERE h.Session_ID = s.Session_ID AND h.Edited = 1) AS Edited
             FROM Scan_Sessions s
             LEFT JOIN Assessments a ON a.Assessment_ID = s.Assessment_ID
             WHERE s.Course_ID = ?
             ORDER BY s.Updated_At DESC`
        ).bind(courseId).all();
        return json(corsHeaders, { success: true, sessions: rows.results || [] });
    }

    // One saved scan: the key and every student's saved answers.
    if (method === 'GET' && path === '/api/scan-sheets') {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) return json(corsHeaders, { error: 'Missing sessionId' }, 400);

        const session = await env.DB.prepare(
            `SELECT s.Session_ID, s.Course_ID, s.Assessment_ID, s.Title, s.Term, s.Category, s.Num_Questions, s.Num_Choices,
                    s.Answer_Key, s.Bonus_Flags, s.Created_At, s.Updated_At, a.Max_Score
             FROM Scan_Sessions s LEFT JOIN Assessments a ON a.Assessment_ID = s.Assessment_ID
             WHERE s.Session_ID = ?`
        ).bind(sessionId).first();
        if (!session) return json(corsHeaders, { error: 'Saved scan not found.' }, 404);

        const rows = await env.DB.prepare(
            `SELECT h.Sheet_ID, h.Student_ID, h.Student_No_Read, h.Original_Answers, h.Answers, h.Score, h.Edited, h.Updated_At, h.Photo_File_ID, h.Photo_Layout, h.Scan_ID,
                    u.Name, u.Student_Number
             FROM Scan_Sheets h LEFT JOIN Users u ON u.User_ID = h.Student_ID
             WHERE h.Session_ID = ?
             ORDER BY u.Name ASC`
        ).bind(sessionId).all();

        const sheets = (rows.results || []).map(r => ({
            ...r,
            Original_Answers: parseJsonList(r.Original_Answers),
            Answers: parseJsonList(r.Answers)
        }));
        const { Answer_Key, Bonus_Flags, ...rest } = session;
        return json(corsHeaders, {
            success: true,
            session: { ...rest, Answer_Key: parseJsonList(Answer_Key), Bonus_Flags: parseJsonList(Bonus_Flags) },
            sheets
        });
    }

    // Saves a batch of scanned sheets and records each student's score in the assessment.
    if (method === 'POST' && path === '/api/scan-sheets/save') {
        const body = await request.json();
        const { courseId, assessmentId, title, term, category, numQuestions, numChoices, answerKey, bonus, sheets, allowRegrade } = body;
        const removals = Array.isArray(body.removals) ? body.removals.filter(r => r && r.studentId && r.scanId) : [];

        const n = Number(numQuestions);
        const c = Number(numChoices);
        if (!courseId || !assessmentId) return json(corsHeaders, { error: 'Missing course or assessment.' }, 400);
        if (!Number.isInteger(n) || n < 1 || n > SCAN_MAX_QUESTIONS) return json(corsHeaders, { error: `Questions must be 1 to ${SCAN_MAX_QUESTIONS}.` }, 400);
        if (!Number.isInteger(c) || c < 2 || c > SCAN_MAX_CHOICES) return json(corsHeaders, { error: `Choices must be 2 to ${SCAN_MAX_CHOICES}.` }, 400);
        if (!Array.isArray(answerKey) || answerKey.length !== n || !answerKey.every(k => Number.isInteger(k) && k >= 0 && k < c)) {
            return json(corsHeaders, { error: 'Invalid answer key.' }, 400);
        }
        if (!Array.isArray(bonus) || bonus.length !== n) return json(corsHeaders, { error: 'Invalid bonus flags.' }, 400);
        if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > SCAN_MAX_SHEETS) {
            return json(corsHeaders, { error: `Send 1 to ${SCAN_MAX_SHEETS} sheets at a time.` }, 400);
        }
        const key = answerKey;
        const bonusFlags = bonus.map(Boolean);

        const assessment = await env.DB.prepare(
            "SELECT Assessment_ID, Max_Score FROM Assessments WHERE Assessment_ID = ? AND Course_ID = ?"
        ).bind(assessmentId, courseId).first();
        if (!assessment) return json(corsHeaders, { error: 'Assessment not found.' }, 404);

        const enrolled = await env.DB.prepare("SELECT Student_ID FROM Enrollments WHERE Course_ID = ?").bind(courseId).all();
        const enrolledIds = new Set((enrolled.results || []).map(r => r.Student_ID));
        const seen = new Set();
        for (const sheet of sheets) {
            if (!sheet || !sheet.studentId || !enrolledIds.has(sheet.studentId)) {
                return json(corsHeaders, { error: 'A sheet belongs to a student who is not enrolled in this course.' }, 400);
            }
            if (seen.has(sheet.studentId)) return json(corsHeaders, { error: 'Two sheets belong to the same student.' }, 400);
            seen.add(sheet.studentId);
            if (sheet.scanId != null && (typeof sheet.scanId !== 'string' || sheet.scanId.length > 64)) {
                return json(corsHeaders, { error: 'A sheet has an invalid scan id.' }, 400);
            }
            if (!isAnswerList(sheet.answers, n, c)) return json(corsHeaders, { error: 'A sheet has invalid answers.' }, 400);
            if (sheet.originalAnswers != null && !isAnswerList(sheet.originalAnswers, n, c)) {
                return json(corsHeaders, { error: 'A sheet has invalid original answers.' }, 400);
            }
        }

        const cleanTitle = String(title || '').trim().slice(0, 150);
        const existing = await env.DB.prepare(
            "SELECT * FROM Scan_Sessions WHERE Course_ID = ? AND Assessment_ID = ?"
        ).bind(courseId, assessmentId).first();

        let sessionId;
        let keyChanged = false;
        const statements = [];
        const regradeStatements = [];
        const savedBefore = new Map();
        if (existing) {
            const prior = await env.DB.prepare(
                "SELECT Student_ID, Scan_ID, Answers, Score, Updated_At FROM Scan_Sheets WHERE Session_ID = ?"
            ).bind(existing.Session_ID).all();
            (prior.results || []).forEach(r => savedBefore.set(r.Student_ID, r));
        }
        if (existing) {
            sessionId = existing.Session_ID;
            const oldKey = parseJsonList(existing.Answer_Key);
            const oldBonus = parseJsonList(existing.Bonus_Flags).map(Boolean);
            keyChanged = !sameList(oldKey, key) || !sameList(oldBonus, bonusFlags);

            const others = await env.DB.prepare(
                "SELECT COUNT(*) AS cnt FROM Scan_Sheets WHERE Session_ID = ?" + (seen.size ? ` AND Student_ID NOT IN (${[...seen].map(() => '?').join(',')})` : '')
            ).bind(sessionId, ...seen).first();
            if (others && others.cnt > 0 && (existing.Num_Questions !== n || existing.Num_Choices !== c)) {
                return json(corsHeaders, {
                    error: `This assessment already has saved sheets for a ${existing.Num_Questions}-question sheet with ${existing.Num_Choices} choices. Use the same sheet size, or delete the saved scan first.`
                }, 409);
            }
            statements.push(env.DB.prepare(
                `UPDATE Scan_Sessions SET Title = ?, Term = ?, Category = ?, Num_Questions = ?, Num_Choices = ?,
                        Answer_Key = ?, Bonus_Flags = ?, Updated_At = CURRENT_TIMESTAMP WHERE Session_ID = ?`
            ).bind(cleanTitle, term || null, category || null, n, c, JSON.stringify(key), JSON.stringify(bonusFlags), sessionId));
        } else {
            sessionId = crypto.randomUUID();
            statements.push(env.DB.prepare(
                `INSERT INTO Scan_Sessions (Session_ID, Course_ID, Assessment_ID, Title, Term, Category, Num_Questions, Num_Choices, Answer_Key, Bonus_Flags)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(sessionId, courseId, assessmentId, cleanTitle, term || null, category || null, n, c, JSON.stringify(key), JSON.stringify(bonusFlags)));
        }

        // One sheet per student per assessment. A second, different sheet for a student who already has one
        // is not written unless the caller says replace: it comes back as a conflict instead.
        const written = new Set();
        const conflicts = [];
        let unchanged = 0;
        for (const sheet of sheets) {
            const before = savedBefore.get(sheet.studentId);
            if (before) {
                const sameCapture = before.Scan_ID && before.Scan_ID === sheet.scanId;
                if (!sameCapture) {
                    if (sameList(parseJsonList(before.Answers), sheet.answers)) {
                        unchanged++;
                        continue;
                    }
                    if (sheet.replace !== true) {
                        conflicts.push({
                            studentId: sheet.studentId, scanId: sheet.scanId || null,
                            existingScore: before.Score, existingUpdated: before.Updated_At,
                            newScore: gradeScan(sheet.answers, key, bonusFlags, assessment.Max_Score).score
                        });
                        continue;
                    }
                }
            }
            written.add(sheet.studentId);
            const original = sheet.originalAnswers || sheet.answers;
            const graded = gradeScan(sheet.answers, key, bonusFlags, assessment.Max_Score);
            statements.push(env.DB.prepare(
                `INSERT INTO Scan_Sheets (Sheet_ID, Session_ID, Student_ID, Student_No_Read, Original_Answers, Answers, Score, Edited, Scan_ID)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(Session_ID, Student_ID) DO UPDATE SET
                    Student_No_Read = excluded.Student_No_Read, Original_Answers = excluded.Original_Answers,
                    Answers = excluded.Answers, Score = excluded.Score, Edited = excluded.Edited,
                    Photo_File_ID = CASE WHEN Scan_Sheets.Scan_ID IS excluded.Scan_ID THEN Scan_Sheets.Photo_File_ID ELSE NULL END,
                    Photo_Layout = CASE WHEN Scan_Sheets.Scan_ID IS excluded.Scan_ID THEN Scan_Sheets.Photo_Layout ELSE NULL END,
                    Scan_ID = excluded.Scan_ID,
                    Updated_At = CURRENT_TIMESTAMP`
            ).bind(
                crypto.randomUUID(), sessionId, sheet.studentId, String(sheet.studentNo || '').slice(0, 20),
                JSON.stringify(original), JSON.stringify(sheet.answers), graded.score, sameList(original, sheet.answers) ? 0 : 1,
                sheet.scanId || null
            ));
            statements.push(...scanScoreStatements(env, assessmentId, sheet.studentId, graded.score));
        }

        // Undo: the app assigned a captured sheet to a different student after it was uploaded. Only the
        // sheet that carries that capture's id is removed, together with the score it recorded.
        let removed = 0;
        const removedIds = new Set();
        for (const r of removals) {
            const before = savedBefore.get(r.studentId);
            if (!before || before.Scan_ID !== r.scanId || written.has(r.studentId)) continue;
            statements.push(env.DB.prepare("DELETE FROM Scan_Sheets WHERE Session_ID = ? AND Student_ID = ? AND Scan_ID = ?").bind(sessionId, r.studentId, r.scanId));
            statements.push(env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(assessmentId, r.studentId));
            removedIds.add(r.studentId);
            removed++;
        }

        // The key changed: sheets saved earlier in this assessment must be graded again with the new key.
        // Nothing is written until the caller confirms (allowRegrade), because other students' scores change.
        let regraded = 0;
        if (keyChanged) {
            const old = await env.DB.prepare("SELECT Student_ID, Answers FROM Scan_Sheets WHERE Session_ID = ?").bind(sessionId).all();
            for (const row of old.results || []) {
                if (written.has(row.Student_ID) || removedIds.has(row.Student_ID)) continue;
                const answers = parseJsonList(row.Answers);
                if (!isAnswerList(answers, n, c)) continue;
                const graded = gradeScan(answers, key, bonusFlags, assessment.Max_Score);
                regradeStatements.push(env.DB.prepare(
                    "UPDATE Scan_Sheets SET Score = ?, Updated_At = CURRENT_TIMESTAMP WHERE Session_ID = ? AND Student_ID = ?"
                ).bind(graded.score, sessionId, row.Student_ID));
                regradeStatements.push(...scanScoreStatements(env, assessmentId, row.Student_ID, graded.score));
                regraded++;
            }
            if (regraded > 0 && !allowRegrade) {
                return json(corsHeaders, { success: false, needsConfirm: true, regradeCount: regraded });
            }
        }

        await runInChunks(env, statements.concat(regradeStatements));
        return json(corsHeaders, { success: true, sessionId, saved: written.size, unchanged, conflicts, removed, regraded }, 201);
    }

    // Keeps the low-resolution photo of a captured sheet in Google Drive (through the same Apps Script web app
    // as the other uploads). Only a sheet that is already saved with this capture id can receive a photo.
    if (method === 'POST' && path === '/api/scan-sheets/photo') {
        const body = await request.json();
        const { courseId, assessmentId, studentId, scanId, base64 } = body;
        const layout = body.layout === 'rect1' ? 'rect1' : null;
        if (!courseId || !assessmentId || !studentId || typeof scanId !== 'string' || !scanId || scanId.length > 64) {
            return json(corsHeaders, { error: 'Missing sheet details.' }, 400);
        }
        if (typeof base64 !== 'string' || base64.length < 100 || base64.length > SCAN_PHOTO_MAX_B64) {
            return json(corsHeaders, { error: 'The photo is missing or too large.' }, 400);
        }
        const row = await env.DB.prepare(
            `SELECT h.Sheet_ID, h.Photo_File_ID, s.Session_ID
             FROM Scan_Sheets h JOIN Scan_Sessions s ON s.Session_ID = h.Session_ID
             WHERE s.Course_ID = ? AND s.Assessment_ID = ? AND h.Student_ID = ? AND h.Scan_ID = ?`
        ).bind(courseId, assessmentId, studentId, scanId).first();
        // Not an error for the app: the sheet may still be waiting to be saved, or was replaced.
        if (!row) return json(corsHeaders, { success: false, code: 'no-sheet' });
        if (row.Photo_File_ID) return json(corsHeaders, { success: true, fileId: row.Photo_File_ID, already: true });

        const gas = await callGas(env, JSON.stringify({
            filename: `scan_${row.Sheet_ID}.jpg`,
            mimeType: 'image/jpeg',
            base64,
            pathParts: ['Scan Sheets', courseId, row.Session_ID]
        }));
        if (!gas.fileId) throw new Error('Google Drive did not return a file id.');
        await env.DB.prepare("UPDATE Scan_Sheets SET Photo_File_ID = ?, Photo_Layout = ? WHERE Sheet_ID = ?").bind(gas.fileId, layout, row.Sheet_ID).run();
        return json(corsHeaders, { success: true, fileId: gas.fileId }, 201);
    }

    // A student's own answer sheet photo, so they can check it is their paper. Only the sheet that belongs to the
    // given student is returned.
    if (method === 'GET' && path === '/api/student-sheet-photo') {
        const sheetId = url.searchParams.get('sheetId');
        const studentId = url.searchParams.get('studentId');
        if (!sheetId || !studentId) return json(corsHeaders, { error: 'Missing sheetId or studentId' }, 400);
        const row = await env.DB.prepare("SELECT Student_ID, Photo_File_ID, Photo_Layout FROM Scan_Sheets WHERE Sheet_ID = ?").bind(sheetId).first();
        if (!row || row.Student_ID !== studentId || !row.Photo_File_ID) return json(corsHeaders, { error: 'No photo is stored for this sheet.' }, 404);
        const gas = await callGas(env, JSON.stringify({ action: 'read', fileId: row.Photo_File_ID }));
        if (!gas.base64) throw new Error('Google Drive did not return the photo.');
        return json(corsHeaders, { success: true, fileId: row.Photo_File_ID, layout: row.Photo_Layout || null, mimeType: gas.mimeType || 'image/jpeg', base64: gas.base64 });
    }

    // Gives the stored photo of one saved sheet back as base64 (read from Google Drive through the Apps Script web app).
    // The app asks for one sheet at a time and keeps the answer on the device for 7 days.
    if (method === 'GET' && path === '/api/scan-sheets/photo') {
        const sheetId = url.searchParams.get('sheetId');
        if (!sheetId) return json(corsHeaders, { error: 'Missing sheetId' }, 400);
        const row = await env.DB.prepare("SELECT Photo_File_ID, Photo_Layout FROM Scan_Sheets WHERE Sheet_ID = ?").bind(sheetId).first();
        if (!row || !row.Photo_File_ID) return json(corsHeaders, { error: 'No photo is stored for this sheet.' }, 404);
        const gas = await callGas(env, JSON.stringify({ action: 'read', fileId: row.Photo_File_ID }));
        if (!gas.base64) throw new Error('Google Drive did not return the photo.');
        return json(corsHeaders, { success: true, fileId: row.Photo_File_ID, layout: row.Photo_Layout || null, mimeType: gas.mimeType || 'image/jpeg', base64: gas.base64 });
    }

    // Corrects one student's answers later; the score in the assessment is updated too.
    if (method === 'POST' && path === '/api/scan-sheets/correct') {
        const { sheetId, answers } = await request.json();
        if (!sheetId) return json(corsHeaders, { error: 'Missing sheetId' }, 400);

        const sheet = await env.DB.prepare(
            `SELECT h.Sheet_ID, h.Student_ID, h.Original_Answers, s.Assessment_ID, s.Num_Questions, s.Num_Choices, s.Answer_Key, s.Bonus_Flags
             FROM Scan_Sheets h JOIN Scan_Sessions s ON s.Session_ID = h.Session_ID
             WHERE h.Sheet_ID = ?`
        ).bind(sheetId).first();
        if (!sheet) return json(corsHeaders, { error: 'Saved sheet not found.' }, 404);

        const assessment = await env.DB.prepare("SELECT Max_Score FROM Assessments WHERE Assessment_ID = ?").bind(sheet.Assessment_ID).first();
        if (!assessment) return json(corsHeaders, { error: 'The assessment of this scan no longer exists.' }, 404);

        if (!isAnswerList(answers, sheet.Num_Questions, sheet.Num_Choices)) {
            return json(corsHeaders, { error: 'Invalid answers.' }, 400);
        }

        const key = parseJsonList(sheet.Answer_Key);
        const bonusFlags = parseJsonList(sheet.Bonus_Flags).map(Boolean);
        const graded = gradeScan(answers, key, bonusFlags, assessment.Max_Score);
        const edited = sameList(parseJsonList(sheet.Original_Answers), answers) ? 0 : 1;

        await env.DB.batch([
            env.DB.prepare(
                "UPDATE Scan_Sheets SET Answers = ?, Score = ?, Edited = ?, Updated_At = CURRENT_TIMESTAMP WHERE Sheet_ID = ?"
            ).bind(JSON.stringify(answers), graded.score, edited, sheetId),
            ...scanScoreStatements(env, sheet.Assessment_ID, sheet.Student_ID, graded.score)
        ]);
        return json(corsHeaders, { success: true, score: graded.score, edited: Boolean(edited), counts: graded });
    }

    // Removes a saved scan (its stored answers only; scores already recorded stay).
    if (method === 'DELETE' && path === '/api/scan-sessions') {
        const { sessionId } = await request.json();
        if (!sessionId) return json(corsHeaders, { error: 'Missing sessionId' }, 400);
        await env.DB.batch([
            env.DB.prepare("DELETE FROM Scan_Sheets WHERE Session_ID = ?").bind(sessionId),
            env.DB.prepare("DELETE FROM Scan_Sessions WHERE Session_ID = ?").bind(sessionId)
        ]);
        return json(corsHeaders, { success: true });
    }

    return null;
}

async function ensureAccessibleExamTables(env) {
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS Class_Exams (
                Class_Exam_ID TEXT PRIMARY KEY,
                Course_ID TEXT NOT NULL,
                Exam_ID TEXT NOT NULL,
                Assessment_ID TEXT NOT NULL,
                Term TEXT DEFAULT 'MidTerm',
                Category TEXT DEFAULT 'MajorExam',
                Is_Active INTEGER DEFAULT 1,
                From_Date TEXT,
                To_Date TEXT,
                Created_At DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS Exam_Assignments (
                Assignment_ID TEXT PRIMARY KEY,
                Class_Exam_ID TEXT NOT NULL,
                Student_ID TEXT NOT NULL,
                Is_Enabled INTEGER DEFAULT 1,
                Status TEXT DEFAULT 'Pending',
                Raw_Score REAL,
                Bonus_Score REAL,
                Final_Score REAL,
                Max_Score REAL,
                Answers_JSON TEXT,
                Submitted_At DATETIME
            )
        `)
    ]);
    await ensureManualMarksColumn(env);
}

// Columns added after the first release. Each is added once to an existing database.
//   Manual_Marks: essay marks given by the lecturer, JSON { "<question index>": points }
//   Time_Limit:   minutes allowed for the exam (empty = no limit)
//   Started_At:   when the student opened the exam (ISO time), used for the countdown
const EXTRA_COLUMNS = [
    ["Exam_Assignments", "Manual_Marks", "TEXT"],
    ["Exam_Assignments", "Started_At", "TEXT"],
    ["Class_Exams", "Time_Limit", "INTEGER"]
];
let extraColumnsChecked = false;
async function ensureManualMarksColumn(env) {
    if (extraColumnsChecked) return;
    try {
        for (const [table, column, type] of EXTRA_COLUMNS) {
            const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            if (!(info.results || []).some(c => c.name === column)) {
                await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
            }
        }
        extraColumnsChecked = true;
    } catch (e) {
        // another request may have added a column already; check again next time
        extraColumnsChecked = false;
    }
}

const GRACE_SECONDS = 120;   // a submission this long after the time limit is still accepted
const parseTime = (t) => {
    if (!t) return null;
    const text = String(t);
    const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(" ", "T") + "Z");
    return Number.isFinite(ms) ? ms : null;
};
const cleanLimit = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 600) : null;
};

function isWithinScheduleWindow(fromDate, toDate) {
    const now = new Date();
    if (fromDate) {
        const start = new Date(fromDate.length === 10 ? `${fromDate}T00:00:00` : fromDate);
        if (!isNaN(start.getTime()) && now < start) return false;
    }
    if (toDate) {
        const end = new Date(toDate.length === 10 ? `${toDate}T23:59:59` : toDate);
        if (!isNaN(end.getTime()) && now > end) return false;
    }
    return true;
}

async function getStudentAccessibleExamsList(env, studentId) {
    await ensureAccessibleExamTables(env);

    const rows = await env.DB.prepare(
        `SELECT ea.Assignment_ID, ea.Class_Exam_ID, ea.Is_Enabled, ea.Status, ea.Final_Score, ea.Max_Score as Recorded_Max, ea.Manual_Marks,
                ce.Course_ID, ce.Exam_ID, ce.Assessment_ID, ce.Term, ce.Category, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit, ea.Started_At,
                e.Title as Exam_Title, e.ExamData,
                c.CourseCode, c.CourseTitle
         FROM Exam_Assignments ea
         JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
         JOIN Exams e ON ce.Exam_ID = e.Exam_ID
         JOIN Courses c ON ce.Course_ID = c.Course_ID
         WHERE ea.Student_ID = ? AND ea.Is_Enabled = 1 AND ce.Is_Active = 1
         ORDER BY ce.Created_At DESC`
    ).bind(studentId).all();

    const availableExams = [];

    for (const r of (rows.results || [])) {
        if (!isWithinScheduleWindow(r.From_Date, r.To_Date)) {
            continue;
        }

        let parsed = [];
        try {
            parsed = JSON.parse(r.ExamData || "[]");
        } catch (e) {
            parsed = [];
        }

        const questions = parsed.map((q, idx) => studentQuestion(q, idx, r.Assignment_ID));

        const regularCount = questions.filter(q => !q.isBonus).length;
        const bonusCount = questions.filter(q => q.isBonus).length;

        availableExams.push({
            assignmentId: r.Assignment_ID,
            classExamId: r.Class_Exam_ID,
            examId: r.Exam_ID,
            courseId: r.Course_ID,
            courseCode: r.CourseCode,
            courseTitle: r.CourseTitle,
            examTitle: r.Exam_Title,
            term: r.Term,
            category: r.Category,
            fromDate: r.From_Date,
            toDate: r.To_Date,
            status: r.Status,
            finalScore: r.Final_Score,
            maxScore: r.Recorded_Max || examMaxPoints(parsed),
            regularCount,
            bonusCount,
            totalPoints: examMaxPoints(parsed),
            timeLimit: r.Time_Limit || null,
            startedAt: r.Started_At || null,
            essayPending: r.Status === 'Completed' && essayIndexes(parsed).length > 0 && scoreExam(parsed, [], safeJson(r.Manual_Marks)).pending > 0,
            questions
        });
    }

    return availableExams;
}

const MAX_UPLOAD_CHUNKS = 10; // keep in sync with gas/Code.gs
const MAX_LEGACY_JSON_BYTES = 8 * 1024 * 1024; // old whole-JSON upload path (small files only)

// ---- Submission upload helpers -------------------------------------------------
// Sends a body to the Google Apps Script web app and returns its parsed JSON answer.
// Throws an Error with a user-readable message on failure.
async function callGas(env, body) {
    if (!env.GAS_WEBHOOK_URL) {
        throw new Error("Server Configuration Error: GAS_WEBHOOK_URL is missing.");
    }

    let gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
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

// Streams  prefix + <client request body, untouched> + suffix  to Google Apps Script.
// The (large) base64 body is never decoded or parsed in the Worker, which keeps CPU
// and memory use tiny and fits the free plan.
async function streamToGas(env, request, prefix, suffix, maxBytes) {
    if (!request.body) {
        throw new Error("Upload body is missing.");
    }

    // Browsers send Content-Length, so the body can be piped straight through.
    // If it is missing, fall back to buffering the bytes (still no decoding/parsing).
    let contentLength = parseInt(request.headers.get('Content-Length') || '', 10);
    let buffered = null;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        buffered = new Uint8Array(await request.arrayBuffer());
        contentLength = buffered.byteLength;
    }
    if (contentLength <= 0) {
        throw new Error("Upload body is empty.");
    }
    if (maxBytes && contentLength > maxBytes) {
        throw new UploadError(`File is too large. Maximum upload is ${Math.round(maxBytes / (1024 * 1024))} MB per request.`, 413);
    }

    const encoder = new TextEncoder();
    const pre = encoder.encode(prefix);
    const suf = encoder.encode(suffix);

    const { readable, writable } = new FixedLengthStream(pre.length + contentLength + suf.length);
    const writer = writable.getWriter();
    const pump = (async () => {
        await writer.write(pre);
        if (buffered) {
            await writer.write(buffered);
        } else {
            const reader = request.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
            }
        }
        await writer.write(suf);
        await writer.close();
    })();
    pump.catch(() => {});

    return callGas(env, readable);
}

// Saves the Submissions row(s) after the file reached Drive.
async function recordSubmission(env, body, fileUrl) {
    const isGroup = body.isGroup;
    const includedMembers = body.includedMembers || [];

    const uploader = await env.DB.prepare("SELECT Name FROM Users WHERE User_ID = ?").bind(body.studentId).first();
    const uploaderName = uploader ? uploader.Name : "Student";

    let memberNames = [];
    if (isGroup && includedMembers.length > 0) {
        const placeholders = includedMembers.map(() => '?').join(',');
        const mems = await env.DB.prepare(`SELECT Name FROM Users WHERE User_ID IN (${placeholders})`).bind(...includedMembers).all();
        memberNames = mems.results.map(m => m.Name);
    }

    let finalDescription = body.description;
    if (isGroup) {
        const allGroupText = memberNames.length > 0 ? memberNames.join(', ') : 'None';
        finalDescription = `${body.description}\n\n[Group Upload by: ${uploaderName}]\n[Included Members: ${allGroupText}]`;
    }

    const subId = crypto.randomUUID();
    await env.DB.prepare(
        `INSERT INTO Submissions (Submission_ID, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(subId, body.courseId, body.studentId, body.term, body.title, finalDescription, body.type, fileUrl).run();

    if (isGroup && includedMembers.length > 0) {
        const statements = [];
        for (const memberId of includedMembers) {
            const mSubId = crypto.randomUUID();
            statements.push(
                env.DB.prepare(
                    `INSERT INTO Submissions (Submission_ID, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                ).bind(mSubId, body.courseId, memberId, body.term, body.title, finalDescription, body.type, fileUrl)
            );
        }
        await env.DB.batch(statements);
    }
}

// Origins allowed to call this API. ALLOWED_ORIGIN may hold several origins separated by commas.
// Never falls back to "*": an unknown origin simply receives the primary allowed origin,
// which the browser then rejects.
function resolveAllowedOrigin(env, requestOrigin) {
    const configured = String(env.ALLOWED_ORIGIN || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
    const list = [...configured, "https://plv.workers.dev", "https://www.plv.workers.dev"];
    if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
    return list[0];
}

// Room = the classroom the class meets in. Added to an existing Courses table the first time it is needed.
let courseRoomReady = false;
async function ensureCourseRoom(env) {
    if (courseRoomReady) return;
    try {
        await env.DB.prepare("ALTER TABLE Courses ADD COLUMN Room TEXT").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    courseRoomReady = true;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '');
        const requestOrigin = request.headers.get("Origin");

        const allowedOrigin = resolveAllowedOrigin(env, requestOrigin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Submission-Meta, X-Chunk-Meta",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Who is calling, and may they do this? (Off until the SESSION_SECRET secret is set.)
            const gate = await authorize(request, env, path, url);
            if (!gate.ok) {
                return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers: corsHeaders });
            }

            if (path === "/api/courses" || path === "/api/my-courses" || path === "/api/course-details" || path === "/api/update-course-room") {
                await ensureCourseRoom(env);
            }

            if (request.method === "GET" && path === "/api/exams") {
                const lecturerId = url.searchParams.get("lecturerId");
                const exams = await env.DB.prepare("SELECT Exam_ID, Title, ExamData, Created_At FROM Exams WHERE Lecturer_ID = ? ORDER BY Created_At DESC").bind(lecturerId).all();
                return new Response(JSON.stringify({ success: true, exams: exams.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/exam-data") {
                const examId = url.searchParams.get("examId");
                const exam = await env.DB.prepare("SELECT * FROM Exams WHERE Exam_ID = ?").bind(examId).first();
                return new Response(JSON.stringify({ success: true, exam }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/exams") {
                const body = await request.json();
                const id = crypto.randomUUID();
                await env.DB.prepare("INSERT INTO Exams (Exam_ID, Lecturer_ID, Title, ExamData) VALUES (?, ?, ?, ?)").bind(id, body.lecturerId, body.title, JSON.stringify(body.examData)).run();
                return new Response(JSON.stringify({ success: true, examId: id }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/exams/update") {
                const body = await request.json();
                const { examId, title, examData } = body;
                if (!examId || !Array.isArray(examData)) {
                    return new Response(JSON.stringify({ error: "Missing examId or examData." }), { status: 400, headers: corsHeaders });
                }

                if (title && String(title).trim()) {
                    await env.DB.prepare("UPDATE Exams SET Title = ?, ExamData = ? WHERE Exam_ID = ?")
                        .bind(String(title).trim(), JSON.stringify(examData), examId).run();
                } else {
                    await env.DB.prepare("UPDATE Exams SET ExamData = ? WHERE Exam_ID = ?")
                        .bind(JSON.stringify(examData), examId).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/class-exams") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                await ensureAccessibleExamTables(env);

                const classExams = await env.DB.prepare(
                    `SELECT ce.*, e.Title as ExamTitle, a.Title as AssessmentTitle, a.Max_Score
                     FROM Class_Exams ce
                     JOIN Exams e ON ce.Exam_ID = e.Exam_ID
                     LEFT JOIN Assessments a ON ce.Assessment_ID = a.Assessment_ID
                     WHERE ce.Course_ID = ?`
                ).bind(courseId).all();

                const assignments = await env.DB.prepare(
                    `SELECT ea.*
                     FROM Exam_Assignments ea
                     JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
                     WHERE ce.Course_ID = ?`
                ).bind(courseId).all();

                return new Response(JSON.stringify({
                    success: true,
                    classExams: classExams.results,
                    assignments: assignments.results
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/class-exams") {
                const body = await request.json();
                const {
                    courseId,
                    examId,
                    term,
                    category,
                    isActive,
                    fromDate,
                    toDate,
                    assignments
                } = body;
                const timeLimit = cleanLimit(body.timeLimit);
                const timeLimitGiven = Object.prototype.hasOwnProperty.call(body, "timeLimit");

                if (!courseId || !examId) {
                    return new Response(JSON.stringify({ error: "Course and Exam are required." }), { status: 400, headers: corsHeaders });
                }

                await ensureAccessibleExamTables(env);

                const exam = await env.DB.prepare("SELECT * FROM Exams WHERE Exam_ID = ?").bind(examId).first();
                if (!exam) {
                    return new Response(JSON.stringify({ error: "Exam not found." }), { status: 404, headers: corsHeaders });
                }

                let parsedQuestions = [];
                try {
                    parsedQuestions = JSON.parse(exam.ExamData || "[]");
                } catch (e) {
                    parsedQuestions = [];
                }

                const defaultMaxScore = examMaxPoints(parsedQuestions);
                const selectedTerm = ASSESSMENT_TERMS.includes(term) ? term : 'MidTerm';
                const selectedCategory = ASSESSMENT_CATEGORIES.includes(category) ? category : 'MajorExam';
                const today = getRequestDate(request);

                let existingClassExam = await env.DB.prepare(
                    "SELECT * FROM Class_Exams WHERE Course_ID = ? AND Exam_ID = ?"
                ).bind(courseId, examId).first();

                let assessmentId = existingClassExam ? existingClassExam.Assessment_ID : null;
                let existingAssessment = null;

                if (assessmentId) {
                    existingAssessment = await env.DB.prepare(
                        "SELECT * FROM Assessments WHERE Assessment_ID = ? AND Course_ID = ?"
                    ).bind(assessmentId, courseId).first();
                }

                if (!existingAssessment) {
                    existingAssessment = await env.DB.prepare(
                        "SELECT * FROM Assessments WHERE Course_ID = ? AND Title COLLATE NOCASE = ? AND Term = ?"
                    ).bind(courseId, exam.Title.trim(), selectedTerm).first();
                }

                if (!existingAssessment) {
                    assessmentId = crypto.randomUUID();
                    await env.DB.prepare(
                        `INSERT INTO Assessments (Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`
                    ).bind(assessmentId, courseId, selectedTerm, selectedCategory, exam.Title.trim(), defaultMaxScore, today).run();
                } else {
                    assessmentId = existingAssessment.Assessment_ID;
                    await env.DB.prepare(
                        `UPDATE Assessments SET Term = ?, Category = ?, Title = ?, Max_Score = ? WHERE Assessment_ID = ?`
                    ).bind(selectedTerm, selectedCategory, exam.Title.trim(), defaultMaxScore, assessmentId).run();
                }

                let classExamId = existingClassExam ? existingClassExam.Class_Exam_ID : crypto.randomUUID();
                const activeFlag = isActive ? 1 : 0;

                if (existingClassExam) {
                    await env.DB.prepare(
                        `UPDATE Class_Exams
                         SET Assessment_ID = ?, Term = ?, Category = ?, Is_Active = ?, From_Date = ?, To_Date = ?, Time_Limit = ?
                         WHERE Class_Exam_ID = ?`
                    ).bind(assessmentId, selectedTerm, selectedCategory, activeFlag, fromDate || null, toDate || null, timeLimitGiven ? timeLimit : (existingClassExam.Time_Limit || null), classExamId).run();
                } else {
                    await env.DB.prepare(
                        `INSERT INTO Class_Exams (Class_Exam_ID, Course_ID, Exam_ID, Assessment_ID, Term, Category, Is_Active, From_Date, To_Date, Time_Limit)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(classExamId, courseId, examId, assessmentId, selectedTerm, selectedCategory, activeFlag, fromDate || null, toDate || null, timeLimit).run();
                }

                if (Array.isArray(assignments)) {
                    const existingAssignRes = await env.DB.prepare(
                        "SELECT * FROM Exam_Assignments WHERE Class_Exam_ID = ?"
                    ).bind(classExamId).all();
                    const existingMap = {};
                    (existingAssignRes.results || []).forEach(a => {
                        existingMap[a.Student_ID] = a;
                    });

                    const statements = [];
                    for (const item of assignments) {
                        if (!item.studentId) continue;
                        const enabledFlag = item.isEnabled ? 1 : 0;
                        const prev = existingMap[item.studentId];

                        if (prev) {
                            statements.push(
                                env.DB.prepare(
                                    "UPDATE Exam_Assignments SET Is_Enabled = ? WHERE Assignment_ID = ?"
                                ).bind(enabledFlag, prev.Assignment_ID)
                            );
                        } else {
                            statements.push(
                                env.DB.prepare(
                                    `INSERT INTO Exam_Assignments (Assignment_ID, Class_Exam_ID, Student_ID, Is_Enabled, Status)
                                     VALUES (?, ?, ?, ?, 'Pending')`
                                ).bind(crypto.randomUUID(), classExamId, item.studentId, enabledFlag)
                            );
                        }
                    }

                    if (statements.length > 0) {
                        await env.DB.batch(statements);
                    }
                }

                return new Response(JSON.stringify({
                    success: true,
                    classExamId,
                    assessmentId
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/reset-exam-attempt") {
                const body = await request.json();
                const { classExamId, studentId } = body;

                if (!classExamId || !studentId) {
                    return new Response(JSON.stringify({ error: "Missing classExamId or studentId." }), { status: 400, headers: corsHeaders });
                }

                await ensureAccessibleExamTables(env);

                await env.DB.prepare(
                    `UPDATE Exam_Assignments
                     SET Status = 'Pending', Raw_Score = NULL, Bonus_Score = NULL, Final_Score = NULL, Answers_JSON = NULL, Manual_Marks = NULL, Started_At = NULL, Submitted_At = NULL
                     WHERE Class_Exam_ID = ? AND Student_ID = ?`
                ).bind(classExamId, studentId).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/student-accessible-exams") {
                const studentId = url.searchParams.get("studentId");
                if (!studentId) {
                    return new Response(JSON.stringify({ error: "Missing studentId" }), { status: 400, headers: corsHeaders });
                }

                const user = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Student_Number, account_status, role, course, year, section, Program_Course, Program_Year, Program_Section, eye_condition
                     FROM Users WHERE User_ID = ?`
                ).bind(studentId).first();

                if (!user) {
                    return new Response(JSON.stringify({ error: "Student not found." }), { status: 404, headers: corsHeaders });
                }

                const availableExams = await getStudentAccessibleExamsList(env, user.User_ID);

                return new Response(JSON.stringify({
                    success: true,
                    student: user,
                    exams: availableExams
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/student-accessible-exams") {
                const body = await request.json();
                const id = (body.identifier || "").trim();

                if (!id || !body.password) {
                    return new Response(JSON.stringify({ error: "Please enter your identifier and password." }), { status: 400, headers: corsHeaders });
                }

                const user = await findUserByCredentials(env, id, body.password,
                    "User_ID, Username, Name, Student_Number, account_status, role, course, year, section, eye_condition");

                if (!user) {
                    return new Response(JSON.stringify({ error: "Invalid credentials." }), { status: 401, headers: corsHeaders });
                }

                if (user.account_status.toLowerCase() !== 'active') {
                    return new Response(JSON.stringify({ error: `Account is ${user.account_status}.` }), { status: 403, headers: corsHeaders });
                }

                const availableExams = await getStudentAccessibleExamsList(env, user.User_ID);

                return new Response(JSON.stringify({
                    success: true,
                    student: user,
                    exams: availableExams
                }), { status: 200, headers: corsHeaders });
            }

            // The student opens the exam: the clock starts once and keeps running if the page is closed or reloaded.
            if (request.method === "POST" && path === "/api/start-accessible-exam") {
                const body = await request.json();
                const { assignmentId, studentId } = body;
                if (!assignmentId || !studentId) {
                    return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers: corsHeaders });
                }
                await ensureAccessibleExamTables(env);

                const record = await env.DB.prepare(
                    `SELECT ea.Assignment_ID, ea.Status, ea.Is_Enabled, ea.Started_At, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit
                     FROM Exam_Assignments ea JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
                     WHERE ea.Assignment_ID = ? AND ea.Student_ID = ?`
                ).bind(assignmentId, studentId).first();
                if (!record) {
                    return new Response(JSON.stringify({ error: "Exam assignment not found." }), { status: 404, headers: corsHeaders });
                }
                if (!record.Is_Enabled || !record.Is_Active || record.Status === "Completed" || !isWithinScheduleWindow(record.From_Date, record.To_Date)) {
                    return new Response(JSON.stringify({ error: "This exam is not open." }), { status: 403, headers: corsHeaders });
                }

                let startedAt = record.Started_At;
                if (!startedAt) {
                    startedAt = new Date().toISOString();
                    await env.DB.prepare("UPDATE Exam_Assignments SET Started_At = ? WHERE Assignment_ID = ? AND Started_At IS NULL").bind(startedAt, assignmentId).run();
                    const again = await env.DB.prepare("SELECT Started_At FROM Exam_Assignments WHERE Assignment_ID = ?").bind(assignmentId).first();
                    startedAt = (again && again.Started_At) || startedAt;
                }

                const limit = record.Time_Limit || null;
                let remainingSeconds = null;
                if (limit) {
                    const began = parseTime(startedAt) ?? Date.now();
                    remainingSeconds = Math.max(0, Math.round((began + limit * 60 * 1000 - Date.now()) / 1000));
                }
                return new Response(JSON.stringify({ success: true, startedAt, timeLimit: limit, remainingSeconds }), { status: 200, headers: corsHeaders });
            }

            // Results of one class exam: class summary, score spread and an analysis of every question.
            if (request.method === "GET" && path === "/api/exam-results") {
                const classExamId = url.searchParams.get("classExamId");
                if (!classExamId) {
                    return new Response(JSON.stringify({ error: "Missing classExamId" }), { status: 400, headers: corsHeaders });
                }
                await ensureAccessibleExamTables(env);

                const ce = await env.DB.prepare(
                    `SELECT ce.Class_Exam_ID, ce.Time_Limit, e.Title as Exam_Title, e.ExamData
                     FROM Class_Exams ce JOIN Exams e ON ce.Exam_ID = e.Exam_ID WHERE ce.Class_Exam_ID = ?`
                ).bind(classExamId).first();
                if (!ce) {
                    return new Response(JSON.stringify({ error: "Class exam not found." }), { status: 404, headers: corsHeaders });
                }
                const questions = safeJson(ce.ExamData) || [];

                const rows = await env.DB.prepare(
                    `SELECT ea.Student_ID, ea.Is_Enabled, ea.Status, ea.Final_Score, ea.Max_Score, ea.Answers_JSON, ea.Manual_Marks, ea.Started_At, ea.Submitted_At, u.Name, u.Student_Number
                     FROM Exam_Assignments ea LEFT JOIN Users u ON u.User_ID = ea.Student_ID
                     WHERE ea.Class_Exam_ID = ? AND ea.Is_Enabled = 1
                     ORDER BY u.Name`
                ).bind(classExamId).all();
                const all = rows.results || [];
                const done = all.filter(r => r.Status === "Completed");

                const answerSets = done.map(r => { const a = safeJson(r.Answers_JSON); return Array.isArray(a) ? a : []; });
                const markSets = done.map(r => safeJson(r.Manual_Marks) || {});
                const stats = questions.map((q, i) => questionStats(
                    q, i,
                    answerSets.map(a => a[i] ?? ""),
                    markSets.map(m => (Object.prototype.hasOwnProperty.call(m, i) ? m[i] : null))
                ));

                const students = all.map(r => {
                    const began = parseTime(r.Started_At);
                    const ended = parseTime(r.Submitted_At);
                    const completed = r.Status === "Completed";
                    return {
                        studentId: r.Student_ID,
                        name: r.Name || r.Student_ID,
                        studentNumber: r.Student_Number || "",
                        status: completed ? "Completed" : (r.Started_At ? "In progress" : "Not started"),
                        score: completed ? r.Final_Score : null,
                        max: completed ? r.Max_Score : null,
                        percent: completed && r.Max_Score > 0 ? Math.round((r.Final_Score / r.Max_Score) * 1000) / 10 : null,
                        minutes: completed && began !== null && ended !== null && ended >= began ? Math.round(((ended - began) / 60000) * 10) / 10 : null
                    };
                });

                const summary = scoreSummary(done.map(r => ({ score: Number(r.Final_Score) || 0, max: Number(r.Max_Score) || 0 })));
                const times = students.filter(s => s.minutes !== null).map(s => s.minutes);

                return new Response(JSON.stringify({
                    success: true,
                    examTitle: ce.Exam_Title,
                    timeLimit: ce.Time_Limit || null,
                    assigned: all.length,
                    submitted: done.length,
                    summary,
                    avgMinutes: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null,
                    questions: stats,
                    students
                }), { status: 200, headers: corsHeaders });
            }

            // Essays are scored by the lecturer. This lists the essay questions and every student's written answers.
            if (request.method === "GET" && path === "/api/exam-essays") {
                const classExamId = url.searchParams.get("classExamId");
                if (!classExamId) {
                    return new Response(JSON.stringify({ error: "Missing classExamId" }), { status: 400, headers: corsHeaders });
                }
                await ensureAccessibleExamTables(env);

                const ce = await env.DB.prepare(
                    `SELECT ce.Class_Exam_ID, ce.Course_ID, e.Title as Exam_Title, e.ExamData
                     FROM Class_Exams ce JOIN Exams e ON ce.Exam_ID = e.Exam_ID
                     WHERE ce.Class_Exam_ID = ?`
                ).bind(classExamId).first();
                if (!ce) {
                    return new Response(JSON.stringify({ error: "Class exam not found." }), { status: 404, headers: corsHeaders });
                }
                const questions = safeJson(ce.ExamData) || [];
                const essays = essayIndexes(questions).map(i => ({
                    index: i,
                    part: questions[i][0],
                    question: questions[i][1],
                    rubric: typeof questions[i][3] === "string" ? questions[i][3] : "",
                    points: questionPoints(questions[i]),
                    isBonus: Boolean(questions[i][5])
                }));

                const rows = await env.DB.prepare(
                    `SELECT ea.Student_ID, ea.Status, ea.Final_Score, ea.Max_Score, ea.Answers_JSON, ea.Manual_Marks, u.Name, u.Student_Number
                     FROM Exam_Assignments ea LEFT JOIN Users u ON u.User_ID = ea.Student_ID
                     WHERE ea.Class_Exam_ID = ? AND ea.Status = 'Completed'
                     ORDER BY u.Name`
                ).bind(classExamId).all();

                const students = (rows.results || []).map(r => {
                    const answers = safeJson(r.Answers_JSON) || [];
                    const marks = safeJson(r.Manual_Marks) || {};
                    return {
                        studentId: r.Student_ID,
                        name: r.Name || r.Student_ID,
                        studentNumber: r.Student_Number || "",
                        finalScore: r.Final_Score,
                        maxScore: r.Max_Score,
                        answers: essays.map(e => String(Array.isArray(answers) ? (answers[e.index] ?? "") : "")),
                        marks: essays.map(e => (Object.prototype.hasOwnProperty.call(marks, e.index) ? marks[e.index] : null))
                    };
                });

                return new Response(JSON.stringify({
                    success: true,
                    examTitle: ce.Exam_Title,
                    essays,
                    students
                }), { status: 200, headers: corsHeaders });
            }

            // Saves the lecturer's essay points for one student and recalculates that student's score.
            if (request.method === "POST" && path === "/api/grade-essay") {
                const body = await request.json();
                const { classExamId, studentId } = body;
                if (!classExamId || !studentId || !body.marks || typeof body.marks !== "object") {
                    return new Response(JSON.stringify({ error: "Invalid marks." }), { status: 400, headers: corsHeaders });
                }
                await ensureAccessibleExamTables(env);

                const record = await env.DB.prepare(
                    `SELECT ea.Assignment_ID, ea.Status, ea.Max_Score, ea.Answers_JSON, ea.Manual_Marks, ce.Assessment_ID, e.ExamData
                     FROM Exam_Assignments ea
                     JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
                     JOIN Exams e ON ce.Exam_ID = e.Exam_ID
                     WHERE ea.Class_Exam_ID = ? AND ea.Student_ID = ?`
                ).bind(classExamId, studentId).first();
                if (!record) {
                    return new Response(JSON.stringify({ error: "Exam record not found." }), { status: 404, headers: corsHeaders });
                }
                if (record.Status !== "Completed") {
                    return new Response(JSON.stringify({ error: "This student has not submitted the exam yet." }), { status: 400, headers: corsHeaders });
                }

                const questions = safeJson(record.ExamData) || [];
                const essaySet = new Set(essayIndexes(questions));
                const marks = safeJson(record.Manual_Marks) || {};
                for (const key of Object.keys(body.marks)) {
                    const idx = parseInt(key, 10);
                    if (!essaySet.has(idx)) continue;
                    const raw = body.marks[key];
                    if (raw === null || raw === "") { delete marks[idx]; continue; }
                    const n = Number(raw);
                    if (!Number.isFinite(n) || n < 0) {
                        return new Response(JSON.stringify({ error: "Points must be a number, 0 or more." }), { status: 400, headers: corsHeaders });
                    }
                    marks[idx] = Math.round(Math.min(questionPoints(questions[idx]), n) * 100) / 100;
                }

                const answers = safeJson(record.Answers_JSON) || [];
                const scored = scoreExam(questions, answers, marks);
                const maxScore = record.Max_Score > 0 ? record.Max_Score : examMaxPoints(questions);
                const finalScore = Math.min(maxScore, Math.round((scored.raw + scored.bonus) * 100) / 100);

                const statements = [
                    env.DB.prepare(
                        "UPDATE Exam_Assignments SET Raw_Score = ?, Bonus_Score = ?, Final_Score = ?, Manual_Marks = ? WHERE Assignment_ID = ?"
                    ).bind(scored.raw, scored.bonus, finalScore, JSON.stringify(marks), record.Assignment_ID)
                ];
                if (record.Assessment_ID) {
                    statements.push(
                        env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(record.Assessment_ID, studentId),
                        env.DB.prepare("INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)")
                            .bind(crypto.randomUUID(), record.Assessment_ID, studentId, finalScore)
                    );
                }
                await env.DB.batch(statements);

                return new Response(JSON.stringify({
                    success: true,
                    rawScore: scored.raw,
                    bonusScore: scored.bonus,
                    finalScore,
                    maxScore,
                    pending: scored.pending
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/submit-accessible-exam") {
                const body = await request.json();
                const { assignmentId, studentId, answers } = body;

                if (!assignmentId || !studentId || !Array.isArray(answers)) {
                    return new Response(JSON.stringify({ error: "Invalid submission payload." }), { status: 400, headers: corsHeaders });
                }

                await ensureAccessibleExamTables(env);

                const record = await env.DB.prepare(
                    `SELECT ea.*, ce.Course_ID, ce.Exam_ID, ce.Assessment_ID, ce.Term, ce.Category, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit,
                            e.Title as Exam_Title, e.ExamData
                     FROM Exam_Assignments ea
                     JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
                     JOIN Exams e ON ce.Exam_ID = e.Exam_ID
                     WHERE ea.Assignment_ID = ? AND ea.Student_ID = ?`
                ).bind(assignmentId, studentId).first();

                if (!record) {
                    return new Response(JSON.stringify({ error: "Exam assignment not found." }), { status: 404, headers: corsHeaders });
                }

                if (!record.Is_Enabled || !record.Is_Active) {
                    return new Response(JSON.stringify({ error: "This exam is no longer enabled." }), { status: 403, headers: corsHeaders });
                }

                if (record.Status === 'Completed') {
                    return new Response(JSON.stringify({ error: "You have already submitted this exam." }), { status: 400, headers: corsHeaders });
                }

                if (!isWithinScheduleWindow(record.From_Date, record.To_Date)) {
                    return new Response(JSON.stringify({ error: "This exam is outside the scheduled date window and is closed." }), { status: 403, headers: corsHeaders });
                }

                if (record.Time_Limit && record.Started_At) {
                    const began = parseTime(record.Started_At);
                    if (began !== null && Date.now() > began + (record.Time_Limit * 60 + GRACE_SECONDS) * 1000) {
                        return new Response(JSON.stringify({ error: "Time is up and this attempt was too late to be accepted. Ask your lecturer to re-open the exam." }), { status: 403, headers: corsHeaders });
                    }
                }

                let quizData = [];
                try {
                    quizData = JSON.parse(record.ExamData || "[]");
                } catch (e) {
                    quizData = [];
                }

                // keep stored answers small: one entry per question, essays up to 10,000 characters
                const cleanAnswers = quizData.map((q, idx) => {
                    const a = answers[idx];
                    if (Array.isArray(a)) return a.slice(0, 40).map(x => String(x ?? "").slice(0, 500));
                    return String(a ?? "").slice(0, 10000);
                });
                const scored = scoreExam(quizData, cleanAnswers, null);
                const rawScore = scored.raw;
                const bonusScore = scored.bonus;

                let maxScore = examMaxPoints(quizData);

                let assessment = null;
                if (record.Assessment_ID) {
                    assessment = await env.DB.prepare(
                        "SELECT * FROM Assessments WHERE Assessment_ID = ?"
                    ).bind(record.Assessment_ID).first();
                }

                const today = getRequestDate(request);
                let targetAssessmentId = record.Assessment_ID;

                if (!assessment) {
                    targetAssessmentId = crypto.randomUUID();
                    await env.DB.prepare(
                        `INSERT INTO Assessments (Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        targetAssessmentId,
                        record.Course_ID,
                        record.Term || 'MidTerm',
                        record.Category || 'MajorExam',
                        record.Exam_Title.trim(),
                        maxScore,
                        today
                    ).run();

                    await env.DB.prepare(
                        "UPDATE Class_Exams SET Assessment_ID = ? WHERE Class_Exam_ID = ?"
                    ).bind(targetAssessmentId, record.Class_Exam_ID).run();
                } else {
                    maxScore = assessment.Max_Score > 0 ? assessment.Max_Score : maxScore;
                }

                const finalScore = Math.min(maxScore, rawScore + bonusScore);

                await env.DB.batch([
                    env.DB.prepare(
                        `UPDATE Exam_Assignments
                         SET Status = 'Completed', Raw_Score = ?, Bonus_Score = ?, Final_Score = ?, Max_Score = ?, Answers_JSON = ?, Submitted_At = CURRENT_TIMESTAMP
                         WHERE Assignment_ID = ?`
                    ).bind(rawScore, bonusScore, finalScore, maxScore, JSON.stringify(cleanAnswers), assignmentId),
                    env.DB.prepare(
                        "DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?"
                    ).bind(targetAssessmentId, studentId),
                    env.DB.prepare(
                        "INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)"
                    ).bind(crypto.randomUUID(), targetAssessmentId, studentId, finalScore)
                ]);

                return new Response(JSON.stringify({
                    success: true,
                    rawScore,
                    bonusScore,
                    finalScore,
                    maxScore,
                    essayPending: scored.pending,
                    examTitle: record.Exam_Title
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/upload-submission") {
                try {
                    const metaHeader = request.headers.get("X-Submission-Meta");
                    let body, gasData;

                    if (metaHeader) {
                        // New path: metadata in a header, raw base64 file in the body (streamed, never parsed here).
                        checkContentLength(request, MAX_SINGLE_BODY_BYTES);
                        body = JSON.parse(decodeURIComponent(metaHeader));
                        validateMeta(body);
                        await verifyUploader(env, body);

                        const gasMeta = JSON.stringify({
                            filename: body.filename,
                            mimeType: body.mimeType,
                            pathParts: body.pathParts || []
                        });
                        const prefix = gasMeta.slice(0, -1) + ',"base64":"';
                        gasData = await streamToGas(env, request, prefix, '"}', MAX_SINGLE_BODY_BYTES);
                    } else {
                        // Legacy path: whole payload as JSON (small files only).
                        checkContentLength(request, MAX_LEGACY_JSON_BYTES);
                        body = await request.json();
                        validateMeta(body);
                        await verifyUploader(env, body);
                        gasData = await callGas(env, JSON.stringify(body));
                    }

                    await recordSubmission(env, body, gasData.fileUrl);
                    return new Response(JSON.stringify({ success: true, fileUrl: gasData.fileUrl }), { status: 201, headers: corsHeaders });
                } catch (err) {
                    const msg = err && err.message ? err.message : "Upload failed.";
                    const status = err instanceof UploadError ? err.status : 500;
                    return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders });
                }
            }

            // Large files: the browser sends the base64 text in pieces (each piece is streamed to
            // Google Drive untouched), then asks the Worker to join them and record the submission.
            if (request.method === "POST" && path === "/api/upload-chunk") {
                try {
                    const metaHeader = request.headers.get("X-Chunk-Meta");
                    if (!metaHeader) {
                        return new Response(JSON.stringify({ error: "Missing X-Chunk-Meta header." }), { status: 400, headers: corsHeaders });
                    }
                    checkContentLength(request, MAX_CHUNK_BODY_BYTES);
                    const info = JSON.parse(decodeURIComponent(metaHeader));
                    const { uploadId, index, total } = validateChunkMeta(info, MAX_UPLOAD_CHUNKS);

                    if (!info.courseId || !info.studentId) {
                        throw new UploadError("Missing course or student.");
                    }
                    await verifyUploader(env, { courseId: info.courseId, studentId: info.studentId });

                    const prefix = JSON.stringify({ action: "chunk", uploadId, index, total }).slice(0, -1) + ',"data":"';
                    await streamToGas(env, request, prefix, '"}', MAX_CHUNK_BODY_BYTES);
                    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                } catch (err) {
                    const status = err instanceof UploadError ? err.status : 500;
                    return new Response(JSON.stringify({ error: err && err.message ? err.message : "Chunk upload failed." }), { status, headers: corsHeaders });
                }
            }

            if (request.method === "POST" && path === "/api/finish-chunked-upload") {
                try {
                    const body = await request.json();
                    const total = body.total;
                    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(body.uploadId || "")) ||
                        !Number.isInteger(total) || total < 1 || total > MAX_UPLOAD_CHUNKS) {
                        return new Response(JSON.stringify({ error: "Invalid upload details." }), { status: 400, headers: corsHeaders });
                    }
                    validateMeta(body);
                    await verifyUploader(env, body);

                    const gasData = await callGas(env, JSON.stringify({
                        action: "finish",
                        uploadId: body.uploadId,
                        total,
                        filename: body.filename,
                        mimeType: body.mimeType,
                        pathParts: body.pathParts || []
                    }));
                    await recordSubmission(env, body, gasData.fileUrl);
                    return new Response(JSON.stringify({ success: true, fileUrl: gasData.fileUrl }), { status: 201, headers: corsHeaders });
                } catch (err) {
                    const status = err instanceof UploadError ? err.status : 500;
                    return new Response(JSON.stringify({ error: err && err.message ? err.message : "Upload failed." }), { status, headers: corsHeaders });
                }
            }

            if (request.method === "POST" && path === "/api/register") {
                const body = await request.json();

                const studentNoFormat = /^\d{2}-\d{4}$/;
                if (!studentNoFormat.test(body.student_number)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }
                if (studentNoFormat.test(body.username)) {
                    return new Response(JSON.stringify({ error: "Username cannot match the Student Number format (00-0000)" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    `SELECT Username, Student_Number, Email, Contact_Number FROM Users
                     WHERE Username COLLATE NOCASE = ?
                     OR Student_Number COLLATE NOCASE = ?
                     OR Email COLLATE NOCASE = ?
                     OR Contact_Number = ?`
                ).bind(body.username, body.student_number, body.email, body.contact_number).first();

                if (existing) {
                    const conflicts = [];
                    if (existing.Username && body.username && existing.Username.toLowerCase() === body.username.toLowerCase()) conflicts.push("Username");
                    if (existing.Student_Number && body.student_number && existing.Student_Number.toLowerCase() === body.student_number.toLowerCase()) conflicts.push("Student Number");
                    if (existing.Email && body.email && existing.Email.toLowerCase() === body.email.toLowerCase()) conflicts.push("Email");
                    if (existing.Contact_Number && body.contact_number && existing.Contact_Number === body.contact_number) conflicts.push("Contact Number");

                    return new Response(JSON.stringify({ error: `The following is already registered to another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
                }

                let finalAvatarUrl = null;
                if (body.avatarBase64) {
                    if (!env.GAS_WEBHOOK_URL) {
                        return new Response(JSON.stringify({ error: "Server Configuration Error: GAS_WEBHOOK_URL is missing. Please redeploy the Cloudflare Worker." }), { status: 500, headers: corsHeaders });
                    }

                    const courseVal = body.course ? body.course.trim() : "";
                    const yearVal = body.year ? body.year.trim() : "";
                    const sectionVal = body.section ? body.section.trim() : "";
                    const courseYearSection = [courseVal, yearVal, sectionVal].filter(Boolean).join(" ") || "General";
                    const formattedFilename = `${body.student_number}_${body.name}.jpg`;

                    const gasPayload = {
                        filename: formattedFilename,
                        mimeType: "image/jpeg",
                        base64: body.avatarBase64,
                        pathParts: [courseYearSection, "Profile Picture"]
                    };

                    let gasResponse = await fetch(env.GAS_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify(gasPayload),
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
                        return new Response(JSON.stringify({
                            error: `Google created the file, but intercepted the JSON response. Raw Google Output: ${gasText.substring(0, 150)}...`
                        }), { status: 500, headers: corsHeaders });
                    }

                    if (!gasData.success) {
                        return new Response(JSON.stringify({ error: "Google Drive Error: " + gasData.error }), { status: 500, headers: corsHeaders });
                    }
                    finalAvatarUrl = gasData.fileUrl;
                }

                const userId = crypto.randomUUID();
                const hashedPassword = await hashPassword(body.password, env);

                await env.DB.prepare(
                    `INSERT INTO Users (User_ID, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, eye_condition, role, registration_timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                ).bind(
                    userId, body.username, hashedPassword, body.name, finalAvatarUrl,
                    body.email, body.contact_number, body.student_number,
                    'Inactive', body.course ? body.course.trim() : null, body.year ? body.year.trim() : null, body.section ? body.section.trim() : null, body.eye_condition ? body.eye_condition.trim() : null, 'Student'
                ).run();

                return new Response(JSON.stringify({ success: true, message: "User registered" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/login") {
                const body = await request.json();
                const id = body.identifier;

                const user = (id && body.password)
                    ? await findUserByCredentials(env, id, body.password,
                        "User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, role, course, year, section, Program_Course, Program_Year, Program_Section, eye_condition")
                    : null;

                if (!user) {
                    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: corsHeaders });
                }

                if (user.account_status.toLowerCase() !== 'active') {
                    let errorMessage = "";
                    const statusLower = user.account_status.toLowerCase();

                    if (statusLower === 'inactive') {
                        errorMessage = "Account is pending approval. Please wait for an admin or lecturer to activate your account.";
                    } else if (statusLower === 'suspended') {
                        errorMessage = "Account is Suspended";
                    } else if (statusLower === 'ud') {
                        errorMessage = "Account is Unofficially Dropped";
                    } else if (statusLower === 'dropped') {
                        errorMessage = "Account is Dropped";
                    } else {
                        errorMessage = `Account is ${user.account_status}`;
                    }

                    return new Response(JSON.stringify({
                        error: errorMessage
                    }), { status: 403, headers: corsHeaders });
                }

                const token = authEnabled(env) ? await signToken(env, user.User_ID) : undefined;
                return new Response(JSON.stringify({ success: true, user, token }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/change-password") {
                const body = await request.json();
                const { userId, currentPassword, newPassword } = body;

                const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();

                if (!user || !(await verifyPassword(currentPassword, user.Password, env)).ok) {
                    return new Response(JSON.stringify({ error: "Incorrect current password" }), { status: 400, headers: corsHeaders });
                }

                const newHash = await hashPassword(newPassword, env);
                await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, userId).run();

                return new Response(JSON.stringify({ success: true, message: "Password updated successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-details") {
                const body = await request.json();
                const { userId, password, name, username, email, contact, studentNumber, programCourse, programYear, programSection } = body;

                const studentNoFormat = /^\d{2}-\d{4}$/;
                if (!studentNoFormat.test(studentNumber)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }

                const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();

                if (!user || !(await verifyPassword(password, user.Password, env)).ok) {
                    return new Response(JSON.stringify({ error: "Incorrect password" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    `SELECT Username, Student_Number, Email, Contact_Number FROM Users
                     WHERE (Username COLLATE NOCASE = ?
                     OR Student_Number COLLATE NOCASE = ?
                     OR Email COLLATE NOCASE = ?
                     OR Contact_Number = ?)
                     AND User_ID != ?`
                ).bind(username, studentNumber, email, contact, userId).first();

                if (existing) {
                    const conflicts = [];
                    if (existing.Username && username && existing.Username.toLowerCase() === username.toLowerCase()) conflicts.push("Username");
                    if (existing.Student_Number && studentNumber && existing.Student_Number.toLowerCase() === studentNumber.toLowerCase()) conflicts.push("Student Number");
                    if (existing.Email && email && existing.Email.toLowerCase() === email.toLowerCase()) conflicts.push("Email");
                    if (existing.Contact_Number && contact && existing.Contact_Number === contact) conflicts.push("Contact Number");

                    return new Response(JSON.stringify({ error: `The following information is already taken by another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `UPDATE Users SET Name = ?, Username = ?, Email = ?, Contact_Number = ?, Student_Number = ? WHERE User_ID = ?`
                ).bind(name, username, email, contact, studentNumber, userId).run();

                // Optional: the student's own Program Course / Year / Section
                if (programCourse !== undefined || programYear !== undefined || programSection !== undefined) {
                    const cleanProg = (v) => (v === undefined || v === null) ? null : (String(v).trim() || null);
                    await env.DB.prepare(
                        `UPDATE Users SET Program_Course = ?, Program_Year = ?, Program_Section = ? WHERE User_ID = ?`
                    ).bind(cleanProg(programCourse), cleanProg(programYear), cleanProg(programSection), userId).run();
                }

                return new Response(JSON.stringify({ success: true, message: "Details updated successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/grade-submission") {
                const body = await request.json();
                const { submissionId, fileUrl, gradeNarrative, gradeIndividual, gradeReport } = body;

                if (!submissionId) {
                    return new Response(JSON.stringify({ error: "Missing submissionId" }), { status: 400, headers: corsHeaders });
                }

                if (fileUrl) {
                    await env.DB.prepare(
                        `UPDATE Submissions SET Grade_Narrative = ?, Grade_Individual = ?, Grade_Report = ? WHERE File_URL = ?`
                    ).bind(gradeNarrative, gradeIndividual, gradeReport, fileUrl).run();
                } else {
                    await env.DB.prepare(
                        `UPDATE Submissions SET Grade_Narrative = ?, Grade_Individual = ?, Grade_Report = ? WHERE Submission_ID = ?`
                    ).bind(gradeNarrative, gradeIndividual, gradeReport, submissionId).run();
                }

                return new Response(JSON.stringify({ success: true, message: "Grade saved successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/reset-student-password") {
                const body = await request.json();
                const { studentId } = body;

                if (!studentId) {
                    return new Response(JSON.stringify({ error: "Missing studentId" }), { status: 400, headers: corsHeaders });
                }

                const newHash = await hashPassword("123456", env);
                await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, studentId).run();

                return new Response(JSON.stringify({ success: true, message: "Password reset successfully" }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/users") {
                const users = await env.DB.prepare(
                    `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, Program_Course, Program_Year, Program_Section, eye_condition, role, registration_timestamp
                     FROM Users ORDER BY Name ASC`
                ).all();
                return new Response(JSON.stringify({ success: true, users: users.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-user-status") {
                const body = await request.json();
                if (!body.studentId || !body.status) {
                    return new Response(JSON.stringify({ error: "Missing required parameters." }), { status: 400, headers: corsHeaders });
                }
                await env.DB.prepare(
                    `UPDATE Users SET account_status = ? WHERE User_ID = ?`
                ).bind(body.status, body.studentId).run();
                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/programs") {
                const body = await request.json();
                const code = body.programCode ? body.programCode.trim().toUpperCase() : "";

                if (!code) {
                    return new Response(JSON.stringify({ error: "Program code is required" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare("SELECT Program_ID FROM Programs WHERE ProgramCode = ?").bind(code).first();
                if (existing) {
                    return new Response(JSON.stringify({ error: "Course (Program) already exists in the list." }), { status: 400, headers: corsHeaders });
                }

                const id = crypto.randomUUID();
                await env.DB.prepare("INSERT INTO Programs (Program_ID, ProgramCode) VALUES (?, ?)").bind(id, code).run();

                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/programs") {
                try {
                    const programs = await env.DB.prepare("SELECT * FROM Programs ORDER BY ProgramCode ASC").all();
                    return new Response(JSON.stringify({ success: true, programs: programs.results }), { status: 200, headers: corsHeaders });
                } catch (err) {
                    return new Response(JSON.stringify({ success: true, programs: [] }), { status: 200, headers: corsHeaders });
                }
            }

            if (request.method === "POST" && path === "/api/courses") {
                const body = await request.json();
                const courseId = crypto.randomUUID();

                const targetCourse = body.targetCourse ? body.targetCourse.trim() : "";
                const targetYear = body.targetYear ? body.targetYear.trim() : "";
                const targetSection = body.targetSection ? body.targetSection.trim() : "";
                const room = body.room ? String(body.room).trim().slice(0, 60) : "";

                await env.DB.prepare(
                    `INSERT INTO Courses (Course_ID, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Target_Course, Target_Year, Target_Section, Room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(courseId, body.courseCode, body.courseTitle, body.scheduleDay, body.timePeriod, body.lecturerId, targetCourse, targetYear, targetSection, room).run();

                return new Response(JSON.stringify({ success: true, message: "Course created successfully" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-course-room") {
                const body = await request.json();
                const course = await env.DB.prepare("SELECT Lecturer_ID FROM Courses WHERE Course_ID = ?").bind(body.courseId).first();
                if (!course) {
                    return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
                }
                if (course.Lecturer_ID !== body.lecturerId) {
                    return new Response(JSON.stringify({ error: "Only the lecturer of this class can change the room." }), { status: 403, headers: corsHeaders });
                }
                const room = body.room ? String(body.room).trim().slice(0, 60) : "";
                await env.DB.prepare("UPDATE Courses SET Room = ? WHERE Course_ID = ?").bind(room, body.courseId).run();
                return new Response(JSON.stringify({ success: true, room }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-course-terms") {
                const body = await request.json();

                await env.DB.prepare(
                    `UPDATE Courses SET Midterm_Start = ?, Midterm_End = ?, Final_Start = ?, Final_End = ? WHERE Course_ID = ?`
                ).bind(
                    body.midtermStart || null,
                    body.midtermEnd || null,
                    body.finalStart || null,
                    body.finalEnd || null,
                    body.courseId
                ).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/courses") {
                const studentId = url.searchParams.get("studentId");

                let courses;

                if (studentId) {
                    const student = await env.DB.prepare("SELECT course, year, section FROM Users WHERE User_ID = ?").bind(studentId).first();

                    if (!student) {
                        return new Response(JSON.stringify({ error: "Student not found" }), { status: 404, headers: corsHeaders });
                    }

                    const sCourse = student.course ? student.course.trim() : "";
                    const sYear = student.year ? student.year.trim() : "";
                    const sSection = student.section ? student.section.trim() : "";

                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName
                         FROM Courses c
                         JOIN Users u ON c.Lecturer_ID = u.User_ID
                         WHERE (c.Target_Course IS NULL OR TRIM(c.Target_Course) = '' OR TRIM(c.Target_Course) COLLATE NOCASE = ?)
                           AND (c.Target_Year IS NULL OR TRIM(c.Target_Year) = '' OR TRIM(c.Target_Year) COLLATE NOCASE = ?)
                           AND (c.Target_Section IS NULL OR TRIM(c.Target_Section) = '' OR TRIM(c.Target_Section) COLLATE NOCASE = ?)`
                    ).bind(sCourse, sYear, sSection).all();
                } else {
                    courses = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName
                         FROM Courses c
                         JOIN Users u ON c.Lecturer_ID = u.User_ID`
                    ).all();
                }

                return new Response(JSON.stringify({ success: true, courses: courses.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/enroll") {
                const body = await request.json();

                const existing = await env.DB.prepare(
                    `SELECT Enrollment_ID FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).first();

                if (existing) {
                    return new Response(JSON.stringify({ error: "You are already enrolled in this course." }), { status: 400, headers: corsHeaders });
                }

                const enrollId = crypto.randomUUID();
                await env.DB.prepare(
                    `INSERT INTO Enrollments (Enrollment_ID, Course_ID, Student_ID) VALUES (?, ?, ?)`
                ).bind(enrollId, body.courseId, body.studentId).run();

                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/unenroll") {
                const body = await request.json();

                if (!body.courseId || !body.studentId) {
                    return new Response(JSON.stringify({ error: "Missing required parameters." }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `DELETE FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).run();

                await env.DB.prepare(
                    `DELETE FROM Attendance WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.courseId, body.studentId).run();

                try {
                    await env.DB.prepare(
                        `DELETE FROM Assessment_Scores WHERE Student_ID = ? AND Assessment_ID IN (SELECT Assessment_ID FROM Assessments WHERE Course_ID = ?)`
                    ).bind(body.studentId, body.courseId).run();
                } catch (err) {
                    // Assessment tables not created yet; nothing to clean up.
                }

                try {
                    await env.DB.prepare(
                        `DELETE FROM Exam_Assignments WHERE Student_ID = ? AND Class_Exam_ID IN (SELECT Class_Exam_ID FROM Class_Exams WHERE Course_ID = ?)`
                    ).bind(body.studentId, body.courseId).run();
                } catch (err) {
                    // Exam assignment tables not created yet; nothing to clean up.
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/my-courses") {
                const userId = url.searchParams.get("userId");
                const role = url.searchParams.get("role");

                if (role === 'lecturer') {
                    // StudentCount and TodayMarked feed the dashboard cards. "today" is the caller's local date
                    // (YYYY-MM-DD), because attendance dates are stored in local time.
                    const todayParam = url.searchParams.get("today") || "";
                    const today = /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : "";
                    const myCourses = await env.DB.prepare(
                        `SELECT c.*,
                            (SELECT COUNT(*) FROM Enrollments e WHERE e.Course_ID = c.Course_ID) AS StudentCount,
                            (SELECT COUNT(*) FROM Attendance a WHERE a.Course_ID = c.Course_ID AND a.Date = ?) AS TodayMarked
                         FROM Courses c WHERE c.Lecturer_ID = ?`
                    ).bind(today, userId).all();
                    return new Response(JSON.stringify({ success: true, courses: myCourses.results }), { status: 200, headers: corsHeaders });
                } else {
                    const enrolled = await env.DB.prepare(
                        `SELECT c.*, u.Name as LecturerName, e.Seat_Number,
                            (SELECT COUNT(*) FROM Attendance a WHERE a.Course_ID = c.Course_ID AND a.Student_ID = e.Student_ID AND a.Status = 'Present') AS Att_Present,
                            (SELECT COUNT(*) FROM Attendance a WHERE a.Course_ID = c.Course_ID AND a.Student_ID = e.Student_ID AND a.Status = 'Late') AS Att_Late,
                            (SELECT COUNT(*) FROM Attendance a WHERE a.Course_ID = c.Course_ID AND a.Student_ID = e.Student_ID AND a.Status = 'Excused') AS Att_Excused,
                            (SELECT COUNT(*) FROM Attendance a WHERE a.Course_ID = c.Course_ID AND a.Student_ID = e.Student_ID AND a.Status = 'Absent') AS Att_Absent
                         FROM Enrollments e
                         JOIN Courses c ON e.Course_ID = c.Course_ID
                         JOIN Users u ON c.Lecturer_ID = u.User_ID
                         WHERE e.Student_ID = ?`
                    ).bind(userId).all();
                    return new Response(JSON.stringify({ success: true, courses: enrolled.results }), { status: 200, headers: corsHeaders });
                }
            }

            if (request.method === "GET" && path === "/api/course-details") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                const course = await env.DB.prepare("SELECT * FROM Courses WHERE Course_ID = ?").bind(courseId).first();
                if (!course) {
                    return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
                }

                const students = await env.DB.prepare(
                    `SELECT u.User_ID, u.Name, u.Avatar, u.Student_Number, u.course, u.year, u.section, u.Program_Course, u.Program_Year, u.Program_Section, u.Email, u.Contact_Number, u.eye_condition, u.account_status, e.Seat_Number, e.Group_Name, e.Assigned_Topic
                     FROM Enrollments e
                     JOIN Users u ON e.Student_ID = u.User_ID
                     WHERE e.Course_ID = ?`
                ).bind(courseId).all();

                return new Response(JSON.stringify({ success: true, course: course, students: students.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/unenrolled-students") {
                const courseId = url.searchParams.get("courseId");
                const courseFilter = url.searchParams.get("courseFilter");
                const yearFilter = url.searchParams.get("yearFilter");
                const sectionFilter = url.searchParams.get("sectionFilter");
                const statusFilter = url.searchParams.get("statusFilter");

                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                let query = `SELECT User_ID, Student_Number, Name, course, year, section, Program_Course, Program_Year, Program_Section, account_status
                             FROM Users
                             WHERE role COLLATE NOCASE = 'student'
                             AND User_ID NOT IN (SELECT Student_ID FROM Enrollments WHERE Course_ID = ?)`;
                const params = [courseId];

                if (statusFilter) {
                    query += ` AND account_status COLLATE NOCASE = ?`;
                    params.push(statusFilter);
                }
                if (courseFilter) {
                    query += ` AND course COLLATE NOCASE = ?`;
                    params.push(courseFilter);
                }
                if (yearFilter) {
                    query += ` AND year COLLATE NOCASE = ?`;
                    params.push(yearFilter);
                }
                if (sectionFilter) {
                    query += ` AND section COLLATE NOCASE = ?`;
                    params.push(sectionFilter);
                }

                query += ` ORDER BY Name ASC`;
                const students = await env.DB.prepare(query).bind(...params).all();

                return new Response(JSON.stringify({ success: true, students: students.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/update-student-info") {
                const body = await request.json();

                await env.DB.prepare(
                    `UPDATE Enrollments SET Seat_Number = ?, Group_Name = ?, Assigned_Topic = ? WHERE Course_ID = ? AND Student_ID = ?`
                ).bind(body.seatNumber, body.groupName, body.assignedTopic, body.courseId, body.studentId).run();

                if (body.eyeCondition !== undefined) {
                    await env.DB.prepare(
                        `UPDATE Users SET eye_condition = ? WHERE User_ID = ?`
                    ).bind(body.eyeCondition, body.studentId).run();
                }

                // Lecturer-assigned Program Course / Year / Section (separate from class course/year/section).
                // Only touched when at least one field is sent, so older clients keep working.
                if (body.programCourse !== undefined || body.programYear !== undefined || body.programSection !== undefined) {
                    const clean = (v) => (v === undefined || v === null) ? null : (String(v).trim() || null);
                    await env.DB.prepare(
                        `UPDATE Users SET Program_Course = ?, Program_Year = ?, Program_Section = ? WHERE User_ID = ?`
                    ).bind(clean(body.programCourse), clean(body.programYear), clean(body.programSection), body.studentId).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            // Lecturer edits a student's profile details. Only the lecturer who owns the course,
            // and only for a student enrolled in that course.
            if (request.method === "POST" && path === "/api/update-student-details") {
                const body = await request.json();
                const { lecturerId, courseId, studentId } = body;

                if (!lecturerId || !courseId || !studentId) {
                    return new Response(JSON.stringify({ error: "Missing lecturerId, courseId or studentId" }), { status: 400, headers: corsHeaders });
                }

                const course = await env.DB.prepare("SELECT Lecturer_ID FROM Courses WHERE Course_ID = ?").bind(courseId).first();
                if (!course || course.Lecturer_ID !== lecturerId) {
                    return new Response(JSON.stringify({ error: "You can only edit students of your own classes" }), { status: 403, headers: corsHeaders });
                }

                const enrolled = await env.DB.prepare("SELECT 1 AS ok FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?").bind(courseId, studentId).first();
                if (!enrolled) {
                    return new Response(JSON.stringify({ error: "Student is not enrolled in this class" }), { status: 403, headers: corsHeaders });
                }

                const clean = (v) => (v === undefined || v === null) ? "" : String(v).trim();
                const opt = (v) => clean(v) || null;
                const name = clean(body.name);
                const studentNumber = clean(body.studentNumber);
                const email = clean(body.email);
                const contact = clean(body.contact);

                if (!name) {
                    return new Response(JSON.stringify({ error: "Name is required" }), { status: 400, headers: corsHeaders });
                }
                if (!/^\d{2}-\d{4}$/.test(studentNumber)) {
                    return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    `SELECT Student_Number, Email, Contact_Number FROM Users
                     WHERE (Student_Number COLLATE NOCASE = ?
                     OR (? != '' AND Email COLLATE NOCASE = ?)
                     OR (? != '' AND Contact_Number = ?))
                     AND User_ID != ?`
                ).bind(studentNumber, email, email, contact, contact, studentId).first();

                if (existing) {
                    const conflicts = [];
                    if (existing.Student_Number && existing.Student_Number.toLowerCase() === studentNumber.toLowerCase()) conflicts.push("Student Number");
                    if (email && existing.Email && existing.Email.toLowerCase() === email.toLowerCase()) conflicts.push("Email");
                    if (contact && existing.Contact_Number && existing.Contact_Number === contact) conflicts.push("Contact Number");
                    return new Response(JSON.stringify({ error: `Already used by another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `UPDATE Users SET Name = ?, Student_Number = ?, Email = ?, Contact_Number = ?,
                            course = ?, year = ?, section = ?,
                            Program_Course = ?, Program_Year = ?, Program_Section = ?
                     WHERE User_ID = ?`
                ).bind(
                    name, studentNumber, opt(email), opt(contact),
                    opt(body.course), opt(body.year), opt(body.section),
                    opt(body.programCourse), opt(body.programYear), opt(body.programSection),
                    studentId
                ).run();

                const student = await env.DB.prepare(
                    `SELECT User_ID, Name, Student_Number, Email, Contact_Number, course, year, section, Program_Course, Program_Year, Program_Section
                     FROM Users WHERE User_ID = ?`
                ).bind(studentId).first();

                return new Response(JSON.stringify({ success: true, student }), { status: 200, headers: corsHeaders });
            }

            const attendanceDatesResponse = await handleAttendanceDates(request, env, path, url, corsHeaders);
            if (attendanceDatesResponse) return attendanceDatesResponse;

            const scanSheetsResponse = await handleScanSheets(request, env, path, url, corsHeaders);
            if (scanSheetsResponse) return scanSheetsResponse;

            if (request.method === "GET" && path === "/api/no-class") {
                const courseId = url.searchParams.get("courseId");
                const sessions = await env.DB.prepare(
                    "SELECT Date FROM Course_Sessions WHERE Course_ID = ? AND Is_No_Class = 1 ORDER BY Date DESC"
                ).bind(courseId).all();
                return new Response(JSON.stringify({ success: true, dates: sessions.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/no-class") {
                const body = await request.json();
                const { courseId, date } = body;

                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare("SELECT Session_ID FROM Course_Sessions WHERE Course_ID = ? AND Date = ?").bind(courseId, date).first();
                if (!existing) {
                    const sessionId = crypto.randomUUID();
                    await env.DB.prepare("INSERT INTO Course_Sessions (Session_ID, Course_ID, Date, Is_No_Class) VALUES (?, ?, ?, 1)").bind(sessionId, courseId, date).run();

                    await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "DELETE" && path === "/api/no-class") {
                const body = await request.json();
                const { courseId, date } = body;

                await env.DB.prepare("DELETE FROM Course_Sessions WHERE Course_ID = ? AND Date = ? AND Is_No_Class = 1").bind(courseId, date).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/attendance") {
                const courseId = url.searchParams.get("courseId");
                const date = url.searchParams.get("date");

                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const session = await env.DB.prepare(
                    "SELECT Is_No_Class FROM Course_Sessions WHERE Course_ID = ? AND Date = ?"
                ).bind(courseId, date).first();

                const isNoClass = session ? session.Is_No_Class === 1 : false;

                const records = await env.DB.prepare(
                    "SELECT Student_ID, Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Date = ?"
                ).bind(courseId, date).all();

                return new Response(JSON.stringify({ success: true, records: records.results, isNoClass: isNoClass }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/attendance") {
                const body = await request.json();
                const { courseId, date, records } = body;

                if (!courseId || !date) {
                    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: corsHeaders });
                }

                if (records && Array.isArray(records)) {
                    await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();

                    if (records.length > 0) {
                        const statements = [];
                        for (const record of records) {
                            const attId = crypto.randomUUID();
                            statements.push(
                                env.DB.prepare(
                                    "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
                                ).bind(attId, courseId, record.studentId, date, record.status, record.points)
                            );
                        }
                        await env.DB.batch(statements);
                    }
                }

                return new Response(JSON.stringify({ success: true, message: "Attendance saved" }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/attendance/single") {
                const body = await request.json();
                const { courseId, studentId, date, status, points } = body;

                if (!courseId || !studentId || !date) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Student_ID = ? AND Date = ?").bind(courseId, studentId, date).run();

                if (status) {
                    const attId = crypto.randomUUID();
                    await env.DB.prepare(
                        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
                    ).bind(attId, courseId, studentId, date, status, points || 0).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/add-participation-points") {
                const body = await request.json();
                const { courseId, studentId, date, points } = body;

                if (!courseId || !studentId || !date || typeof points !== 'number') {
                    return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: corsHeaders });
                }

                const existing = await env.DB.prepare(
                    "SELECT Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Student_ID = ? AND Date = ?"
                ).bind(courseId, studentId, date).first();

                if (existing) {
                    const newTotal = (parseInt(existing.Performance_Points) || 0) + points;
                    await env.DB.prepare(
                        "UPDATE Attendance SET Performance_Points = ? WHERE Course_ID = ? AND Student_ID = ? AND Date = ?"
                    ).bind(newTotal, courseId, studentId, date).run();
                } else {
                    const attId = crypto.randomUUID();
                    await env.DB.prepare(
                        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, 'Present', ?)"
                    ).bind(attId, courseId, studentId, date, points).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/assessments") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                const list = await env.DB.prepare(
                    `SELECT Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date
                     FROM Assessments WHERE Course_ID = ? ORDER BY Date DESC, Created_At DESC`
                ).bind(courseId).all();

                return new Response(JSON.stringify({ success: true, assessments: list.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/assessments") {
                const body = await request.json();
                const { assessmentId, courseId, term, category, title, maxScore, date } = body;

                const cleanTitle = title ? String(title).trim() : "";
                const max = parseFloat(maxScore);

                if (!courseId || !cleanTitle) {
                    return new Response(JSON.stringify({ error: "Course and title are required." }), { status: 400, headers: corsHeaders });
                }
                if (!ASSESSMENT_TERMS.includes(term)) {
                    return new Response(JSON.stringify({ error: "Invalid term." }), { status: 400, headers: corsHeaders });
                }
                if (!ASSESSMENT_CATEGORIES.includes(category)) {
                    return new Response(JSON.stringify({ error: "Invalid category." }), { status: 400, headers: corsHeaders });
                }
                if (!(max > 0)) {
                    return new Response(JSON.stringify({ error: "Maximum score must be greater than 0." }), { status: 400, headers: corsHeaders });
                }

                if (assessmentId) {
                    const existing = await env.DB.prepare(
                        "SELECT Assessment_ID FROM Assessments WHERE Assessment_ID = ? AND Course_ID = ?"
                    ).bind(assessmentId, courseId).first();
                    if (!existing) {
                        return new Response(JSON.stringify({ error: "Assessment not found." }), { status: 404, headers: corsHeaders });
                    }

                    await env.DB.prepare(
                        `UPDATE Assessments SET Term = ?, Category = ?, Title = ?, Max_Score = ?, Date = ? WHERE Assessment_ID = ?`
                    ).bind(term, category, cleanTitle, max, date || null, assessmentId).run();

                    return new Response(JSON.stringify({ success: true, assessmentId }), { status: 200, headers: corsHeaders });
                }

                const newId = crypto.randomUUID();
                await env.DB.prepare(
                    `INSERT INTO Assessments (Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date) VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).bind(newId, courseId, term, category, cleanTitle, max, date || null).run();

                return new Response(JSON.stringify({ success: true, assessmentId: newId }), { status: 201, headers: corsHeaders });
            }

            if (request.method === "DELETE" && path === "/api/assessments") {
                const body = await request.json();
                const { assessmentId } = body;

                if (!assessmentId) {
                    return new Response(JSON.stringify({ error: "Missing assessmentId" }), { status: 400, headers: corsHeaders });
                }

                await ensureScanTables(env);
                await env.DB.batch([
                    env.DB.prepare("DELETE FROM Scan_Sheets WHERE Session_ID IN (SELECT Session_ID FROM Scan_Sessions WHERE Assessment_ID = ?)").bind(assessmentId),
                    env.DB.prepare("DELETE FROM Scan_Sessions WHERE Assessment_ID = ?").bind(assessmentId),
                    env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ?").bind(assessmentId),
                    env.DB.prepare("DELETE FROM Assessments WHERE Assessment_ID = ?").bind(assessmentId)
                ]);

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/assessment-scores") {
                const assessmentId = url.searchParams.get("assessmentId");
                if (!assessmentId) {
                    return new Response(JSON.stringify({ error: "Missing assessmentId" }), { status: 400, headers: corsHeaders });
                }

                const scores = await env.DB.prepare(
                    "SELECT Student_ID, Score FROM Assessment_Scores WHERE Assessment_ID = ?"
                ).bind(assessmentId).all();

                return new Response(JSON.stringify({ success: true, scores: scores.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "POST" && path === "/api/assessment-scores") {
                const body = await request.json();
                const { assessmentId, scores } = body;

                if (!assessmentId || !Array.isArray(scores)) {
                    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: corsHeaders });
                }

                const assessment = await env.DB.prepare(
                    "SELECT Max_Score FROM Assessments WHERE Assessment_ID = ?"
                ).bind(assessmentId).first();
                if (!assessment) {
                    return new Response(JSON.stringify({ error: "Assessment not found." }), { status: 404, headers: corsHeaders });
                }

                const statements = [
                    env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ?").bind(assessmentId)
                ];

                for (const entry of scores) {
                    const value = parseFloat(entry.score);
                    if (!entry.studentId || isNaN(value) || value < 0 || value > assessment.Max_Score) {
                        return new Response(JSON.stringify({ error: `Invalid score. Scores must be between 0 and ${assessment.Max_Score}.` }), { status: 400, headers: corsHeaders });
                    }
                    statements.push(
                        env.DB.prepare(
                            "INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)"
                        ).bind(crypto.randomUUID(), assessmentId, entry.studentId, value)
                    );
                }

                await env.DB.batch(statements);

                return new Response(JSON.stringify({ success: true, saved: scores.length }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/student-summary") {
                const courseId = url.searchParams.get("courseId");
                const studentId = url.searchParams.get("studentId");

                if (!courseId || !studentId) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const course = await env.DB.prepare("SELECT Midterm_Start, Midterm_End, Final_Start, Final_End, ScheduleDay FROM Courses WHERE Course_ID = ?").bind(courseId).first();
                if (!course) {
                    return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
                }

                const sessions = await env.DB.prepare("SELECT Date, Is_No_Class FROM Course_Sessions WHERE Course_ID = ?").bind(courseId).all();

                const records = await env.DB.prepare(
                    "SELECT Date, Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Student_ID = ? ORDER BY Date ASC"
                ).bind(courseId, studentId).all();

                const enrollment = await env.DB.prepare(
                    "SELECT Seat_Number, Group_Name, Assigned_Topic FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?"
                ).bind(courseId, studentId).first();

                const submissions = await env.DB.prepare(
                    "SELECT * FROM Submissions WHERE Course_ID = ? AND Student_ID = ? ORDER BY Timestamp DESC"
                ).bind(courseId, studentId).all();

                let assessments = [];
                try {
                    // Sheet_ID = this student's scanned answer sheet (with a stored photo) for the assessment, if any.
                    await ensureScanTables(env);
                    const assessmentRes = await env.DB.prepare(
                        `SELECT a.Assessment_ID, a.Term, a.Category, a.Title, a.Max_Score, a.Date, s.Score,
                                (SELECT h.Sheet_ID FROM Scan_Sheets h JOIN Scan_Sessions ss ON ss.Session_ID = h.Session_ID
                                  WHERE ss.Assessment_ID = a.Assessment_ID AND h.Student_ID = ? AND h.Photo_File_ID IS NOT NULL LIMIT 1) AS Sheet_ID,
                                (SELECT h.Scan_ID FROM Scan_Sheets h JOIN Scan_Sessions ss ON ss.Session_ID = h.Session_ID
                                  WHERE ss.Assessment_ID = a.Assessment_ID AND h.Student_ID = ? AND h.Photo_File_ID IS NOT NULL LIMIT 1) AS Sheet_Version
                         FROM Assessments a
                         LEFT JOIN Assessment_Scores s ON s.Assessment_ID = a.Assessment_ID AND s.Student_ID = ?
                         WHERE a.Course_ID = ?
                         ORDER BY a.Date ASC, a.Created_At ASC`
                    ).bind(studentId, studentId, studentId, courseId).all();
                    assessments = assessmentRes.results;
                } catch (err) {
                    try {
                        const assessmentRes = await env.DB.prepare(
                            `SELECT a.Assessment_ID, a.Term, a.Category, a.Title, a.Max_Score, a.Date, s.Score
                             FROM Assessments a
                             LEFT JOIN Assessment_Scores s ON s.Assessment_ID = a.Assessment_ID AND s.Student_ID = ?
                             WHERE a.Course_ID = ?
                             ORDER BY a.Date ASC, a.Created_At ASC`
                        ).bind(studentId, courseId).all();
                        assessments = assessmentRes.results;
                    } catch (err2) {
                        assessments = [];
                    }
                }

                return new Response(JSON.stringify({
                    success: true,
                    studentId: studentId,
                    course: course,
                    sessions: sessions.results,
                    records: records.results,
                    enrollment: enrollment || {},
                    submissions: submissions.results,
                    assessments: assessments
                }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/recitation-pool") {
                const courseId = url.searchParams.get("courseId");
                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
                }

                const pool = await env.DB.prepare(`
                    SELECT u.User_ID, u.Name, u.Avatar, e.Seat_Number, COALESCE(SUM(a.Performance_Points), 0) as Total_Points
                    FROM Enrollments e
                    JOIN Users u ON e.Student_ID = u.User_ID
                    LEFT JOIN Attendance a ON e.Student_ID = a.Student_ID AND e.Course_ID = a.Course_ID
                    WHERE e.Course_ID = ?
                    GROUP BY u.User_ID, u.Name, u.Avatar, e.Seat_Number
                `).bind(courseId).all();

                return new Response(JSON.stringify({ success: true, students: pool.results }), { status: 200, headers: corsHeaders });
            }

            if (request.method === "GET" && path === "/api/group-members") {
                const courseId = url.searchParams.get("courseId");
                const studentId = url.searchParams.get("studentId");
                const groupName = url.searchParams.get("groupName");

                if (!courseId) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                if (groupName) {
                    const members = await env.DB.prepare(
                        `SELECT u.User_ID, u.Name, u.Student_Number, u.Avatar
                         FROM Enrollments e
                         JOIN Users u ON e.Student_ID = u.User_ID
                         WHERE e.Course_ID = ? AND e.Group_Name = ?`
                    ).bind(courseId, groupName).all();

                    return new Response(JSON.stringify({
                        success: true,
                        groupName: groupName,
                        members: members.results
                    }), { status: 200, headers: corsHeaders });
                }

                if (!studentId) {
                    return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
                }

                const enrollment = await env.DB.prepare(
                    "SELECT Group_Name FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?"
                ).bind(courseId, studentId).first();

                if (!enrollment || !enrollment.Group_Name) {
                    return new Response(JSON.stringify({ success: true, groupName: null, members: [] }), { status: 200, headers: corsHeaders });
                }

                const members = await env.DB.prepare(
                    `SELECT u.User_ID, u.Name, u.Student_Number
                     FROM Enrollments e
                     JOIN Users u ON e.Student_ID = u.User_ID
                     WHERE e.Course_ID = ? AND e.Group_Name = ? AND u.User_ID != ?`
                ).bind(courseId, enrollment.Group_Name, studentId).all();

                return new Response(JSON.stringify({
                    success: true,
                    groupName: enrollment.Group_Name,
                    members: members.results
                }), { status: 200, headers: corsHeaders });
            }

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
// This is a sample comment
