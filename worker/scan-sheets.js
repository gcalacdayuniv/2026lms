// worker/scan-sheets.js
// Scanned answer sheets (OMR): saving, reviewing, correcting, photos and deleting scan sessions.

import { gradeScanSet } from './scan-grade.js';
import { reviewQuestion } from './grading.js';
import { scanContext, convertSheet } from './exam-scan-results.js';
import { json } from './http.js';
import { runInChunks, safeJson } from './shared.js';
import { ensureScanTables, ensureAccessibleExamTables } from './schema.js';
import { callGas } from './gas.js';

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

const SCAN_PHOTO_MAX_B64 = 900000; // about 650 KB of image; the app sends about 100 to 200 KB

const parseJsonList = (text) => {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : [];
    } catch (e) {
        return [];
    }
};

const SCAN_MAX_CELLS = 130;
const SCAN_MAX_OPTIONS = 20;
const SCAN_KINDS = "amtpsxd";

// Answer cells of a mixed-type sheet: [kind, choices, itemNo, sub, part, tag]. Returns the cleaned list or null.
const cleanLayout = (cells) => {
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > SCAN_MAX_CELLS) return null;
    const out = [];
    for (const c of cells) {
        if (!Array.isArray(c) || typeof c[0] !== "string" || !SCAN_KINDS.includes(c[0]) || c[0].length !== 1) return null;
        if (!Number.isInteger(c[1]) || c[1] < 2 || c[1] > SCAN_MAX_OPTIONS) return null;
        out.push([c[0], c[1], Number(c[2]) || 0, Number(c[3]) || 0, Number(c[4]) || 0, String(c[5] || "").slice(0, 12)]);
    }
    return out;
};

const isAnswerList = (list, n, c, cells = null) => {
    if (!Array.isArray(list) || list.length !== n) return false;
    if (!cells) return list.every(a => Number.isInteger(a) && a >= SCAN_MULTIPLE && a < c);
    return list.every((a, i) => {
        if (!Number.isInteger(a)) return false;
        if (a === SCAN_BLANK || a === SCAN_MULTIPLE) return true;
        const cell = cells[i];
        if (cell[0] === "m") return a >= 1000 && a < 1000 + (1 << cell[1]);
        return a >= 0 && a < cell[1];
    });
};

// Points typed by the lecturer for questions marked by hand: { "3": 4.5 } (index of the question in the set).
const cleanMarks = (m) => {
    const out = {};
    if (m && typeof m === "object" && !Array.isArray(m)) {
        Object.keys(m).slice(0, 200).forEach(k => {
            const v = Number(m[k]);
            if (/^\d{1,3}$/.test(k) && Number.isFinite(v) && v >= 0 && v <= 1000) out[k] = Math.round(v * 100) / 100;
        });
    }
    return out;
};
const parseMarks = (text) => { try { return cleanMarks(JSON.parse(text || "{}")); } catch (e) { return {}; } };

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

const SCAN_MAX_SETS = 6;
// Sets of a mixed-type exam: [{ key, bonus, items: [{ t, s, n, b, row, shown }] }]
const isMixedSets = (list, n) => Array.isArray(list) && list.length >= 1 && list.length <= SCAN_MAX_SETS && JSON.stringify(list).length < 600000 && list.every(s =>
    s && Array.isArray(s.key) && s.key.length === n && s.key.every(k => Number.isInteger(k) && k >= 0) &&
    Array.isArray(s.bonus) && s.bonus.length === n &&
    Array.isArray(s.items) && s.items.length <= 200 && s.items.every(it => it && typeof it.t === "string" && Array.isArray(it.row) && Number.isInteger(it.s) && it.s >= 0 && Number.isInteger(it.n) && it.n >= 0 && it.s + it.n <= n &&
        (it.shown === undefined || (Array.isArray(it.shown) && it.shown.length <= SCAN_MAX_OPTIONS))));
const cleanMixedSets = (list) => list.map(s => ({
    key: s.key, bonus: s.bonus.map(Boolean),
    items: s.items.map(it => ({ t: String(it.t), no: Number(it.no) || 0, o: Number(it.o) || 0, s: it.s, n: it.n, b: Boolean(it.b), row: it.row, shown: it.shown, sp: Math.max(1, Math.min(50, Number(it.sp) || 1)) }))
}));
// Grades one sheet: a mixed-type sheet (layout) by its set's items, a plain sheet by key and bonus flags.
const gradeSheetAny = (ctx, answers, setNo, marks, max) => {
    if (ctx.layout) {
        const set = Number.isInteger(setNo) && setNo > 0 && ctx.setKeys[setNo] ? ctx.setKeys[setNo] : ctx.setKeys[0];
        const g = gradeScanSet(set, answers, marks, max);
        return { raw: g.raw, bonus: g.bonus, wrong: g.wrong, blank: g.blank, multiple: g.multiple, pending: g.pending, score: g.score };
    }
    const k = keyOfSet(ctx.setKeys, setNo, ctx.key, ctx.bonus);
    return gradeScan(answers, k.key, k.bonus, max);
};
const isSetKeys = (list, n, c) => Array.isArray(list) && list.length >= 1 && list.length <= SCAN_MAX_SETS && list.every(s =>
    s && Array.isArray(s.key) && s.key.length === n && s.key.every(k => Number.isInteger(k) && k >= 0 && k < c) &&
    Array.isArray(s.bonus) && s.bonus.length === n);
const cleanSetKeys = (list) => list.map(s => ({ key: s.key, bonus: s.bonus.map(Boolean), order: Array.isArray(s.order) && s.order.length === s.key.length && s.order.every(Number.isInteger) ? s.order : undefined }));
// Key and bonus flags for a sheet of printed set setNo; falls back to the session's own key (Set A).
const keyOfSet = (setKeys, setNo, key, bonus) => {
    const s = Number.isInteger(setNo) && setNo > 0 ? setKeys[setNo] : null;
    return s ? { key: s.key, bonus: s.bonus.map(Boolean) } : { key, bonus };
};

// Replaces ONE student's score in an assessment without touching anyone else's.
const scanScoreStatements = (env, assessmentId, studentId, score) => [
    env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(assessmentId, studentId),
    env.DB.prepare("INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), assessmentId, studentId, score)
];

// Returns a Response when the request is handled here, otherwise null.
export async function handleScanSheets(request, env, path, url, corsHeaders) {
    if (path !== '/api/scan-sessions' && path !== '/api/student-sheet-photo' && path !== '/api/student-sheet-review' && !path.startsWith('/api/scan-sheets')) return null;
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
                    s.Answer_Key, s.Bonus_Flags, s.Set_Keys, s.Layout, s.Created_At, s.Updated_At, a.Max_Score
             FROM Scan_Sessions s LEFT JOIN Assessments a ON a.Assessment_ID = s.Assessment_ID
             WHERE s.Session_ID = ?`
        ).bind(sessionId).first();
        if (!session) return json(corsHeaders, { error: 'Saved scan not found.' }, 404);

        const rows = await env.DB.prepare(
            `SELECT h.Sheet_ID, h.Student_ID, h.Student_No_Read, h.Original_Answers, h.Answers, h.Score, h.Edited, h.Updated_At, h.Photo_File_ID, h.Photo_Layout, h.Scan_ID, h.Set_No, h.Marks,
                    u.Name, u.Student_Number
             FROM Scan_Sheets h LEFT JOIN Users u ON u.User_ID = h.Student_ID
             WHERE h.Session_ID = ?
             ORDER BY u.Name ASC`
        ).bind(sessionId).all();

        const sheets = (rows.results || []).map(r => ({
            ...r,
            Original_Answers: parseJsonList(r.Original_Answers),
            Answers: parseJsonList(r.Answers),
            Marks: parseMarks(r.Marks)
        }));
        const { Answer_Key, Bonus_Flags, Set_Keys, Layout, ...rest } = session;
        return json(corsHeaders, {
            success: true,
            session: { ...rest, Answer_Key: parseJsonList(Answer_Key), Bonus_Flags: parseJsonList(Bonus_Flags), Set_Keys: parseJsonList(Set_Keys), Layout: Layout ? parseJsonList(Layout) : null },
            sheets
        });
    }

    // Saves a batch of scanned sheets and records each student's score in the assessment.
    if (method === 'POST' && path === '/api/scan-sheets/save') {
        const body = await request.json();
        const { courseId, assessmentId, title, term, category, numQuestions, numChoices, answerKey, bonus, sheets, allowRegrade } = body;
        const removals = Array.isArray(body.removals) ? body.removals.filter(r => r && r.studentId && r.scanId) : [];

        const layout = body.layout != null ? cleanLayout(body.layout) : null;
        if (body.layout != null && !layout) return json(corsHeaders, { error: 'Invalid answer sheet layout.' }, 400);
        const n = layout ? layout.length : Number(numQuestions);
        const c = layout ? Math.max(...layout.map(x => x[1])) : Number(numChoices);
        if (!courseId || !assessmentId) return json(corsHeaders, { error: 'Missing course or assessment.' }, 400);
        if (!Number.isInteger(n) || n < 1 || n > (layout ? SCAN_MAX_CELLS : SCAN_MAX_QUESTIONS)) return json(corsHeaders, { error: `Questions must be 1 to ${SCAN_MAX_QUESTIONS}.` }, 400);
        if (!Number.isInteger(c) || c < 2 || c > (layout ? SCAN_MAX_OPTIONS : SCAN_MAX_CHOICES)) return json(corsHeaders, { error: `Choices must be 2 to ${SCAN_MAX_CHOICES}.` }, 400);
        if (!Array.isArray(answerKey) || answerKey.length !== n || !answerKey.every(k => Number.isInteger(k) && k >= 0 && (layout || k < c))) {
            return json(corsHeaders, { error: 'Invalid answer key.' }, 400);
        }
        if (!Array.isArray(bonus) || bonus.length !== n) return json(corsHeaders, { error: 'Invalid bonus flags.' }, 400);
        if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > SCAN_MAX_SHEETS) {
            return json(corsHeaders, { error: `Send 1 to ${SCAN_MAX_SHEETS} sheets at a time.` }, 400);
        }
        const key = answerKey;
        const bonusFlags = bonus.map(Boolean);
        let setKeys = [];
        if (layout) {
            if (!isMixedSets(body.setKeys, n)) return json(corsHeaders, { error: 'Invalid exam set keys.' }, 400);
            setKeys = cleanMixedSets(body.setKeys);
        } else if (body.setKeys != null) {
            if (!isSetKeys(body.setKeys, n, c)) return json(corsHeaders, { error: 'Invalid exam set keys.' }, 400);
            setKeys = cleanSetKeys(body.setKeys);
        }
        const ctx = { layout, setKeys, key, bonus: bonusFlags };

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
            if (!isAnswerList(sheet.answers, n, c, layout)) return json(corsHeaders, { error: 'A sheet has invalid answers.' }, 400);
            if (sheet.set != null && !(Number.isInteger(sheet.set) && sheet.set >= 0 && sheet.set < Math.max(1, setKeys.length))) {
                return json(corsHeaders, { error: 'A sheet has an invalid exam set.' }, 400);
            }
            if (sheet.originalAnswers != null && !isAnswerList(sheet.originalAnswers, n, c, layout)) {
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
                "SELECT Student_ID, Scan_ID, Answers, Marks, Score, Updated_At FROM Scan_Sheets WHERE Session_ID = ?"
            ).bind(existing.Session_ID).all();
            (prior.results || []).forEach(r => savedBefore.set(r.Student_ID, r));
        }
        if (existing) {
            sessionId = existing.Session_ID;
            const oldKey = parseJsonList(existing.Answer_Key);
            const oldBonus = parseJsonList(existing.Bonus_Flags).map(Boolean);
            keyChanged = !sameList(oldKey, key) || !sameList(oldBonus, bonusFlags) || JSON.stringify(parseJsonList(existing.Set_Keys)) !== JSON.stringify(setKeys) || (existing.Layout || null) !== (layout ? JSON.stringify(layout) : null);

            const others = await env.DB.prepare(
                "SELECT COUNT(*) AS cnt FROM Scan_Sheets WHERE Session_ID = ?" + (seen.size ? ` AND Student_ID NOT IN (${[...seen].map(() => '?').join(',')})` : '')
            ).bind(sessionId, ...seen).first();
            if (others && others.cnt > 0 && (existing.Num_Questions !== n || existing.Num_Choices !== c || (existing.Layout || null) !== (layout ? JSON.stringify(layout) : null))) {
                return json(corsHeaders, {
                    error: `This assessment already has saved sheets for a ${existing.Num_Questions}-question sheet with ${existing.Num_Choices} choices. Use the same sheet size, or delete the saved scan first.`
                }, 409);
            }
            statements.push(env.DB.prepare(
                `UPDATE Scan_Sessions SET Title = ?, Term = ?, Category = ?, Num_Questions = ?, Num_Choices = ?,
                        Answer_Key = ?, Bonus_Flags = ?, Set_Keys = ?, Layout = ?, Updated_At = CURRENT_TIMESTAMP WHERE Session_ID = ?`
            ).bind(cleanTitle, term || null, category || null, n, c, JSON.stringify(key), JSON.stringify(bonusFlags), JSON.stringify(setKeys), layout ? JSON.stringify(layout) : null, sessionId));
        } else {
            sessionId = crypto.randomUUID();
            statements.push(env.DB.prepare(
                `INSERT INTO Scan_Sessions (Session_ID, Course_ID, Assessment_ID, Title, Term, Category, Num_Questions, Num_Choices, Answer_Key, Bonus_Flags, Set_Keys, Layout)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(sessionId, courseId, assessmentId, cleanTitle, term || null, category || null, n, c, JSON.stringify(key), JSON.stringify(bonusFlags), JSON.stringify(setKeys), layout ? JSON.stringify(layout) : null));
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
                    if (sameList(parseJsonList(before.Answers), sheet.answers) && JSON.stringify(parseMarks(before.Marks)) === JSON.stringify(cleanMarks(sheet.marks))) {
                        unchanged++;
                        continue;
                    }
                    if (sheet.replace !== true) {
                        conflicts.push({
                            studentId: sheet.studentId, scanId: sheet.scanId || null,
                            existingScore: before.Score, existingUpdated: before.Updated_At,
                            newScore: gradeSheetAny(ctx, sheet.answers, sheet.set, cleanMarks(sheet.marks), assessment.Max_Score).score
                        });
                        continue;
                    }
                }
            }
            written.add(sheet.studentId);
            const original = sheet.originalAnswers || sheet.answers;
            const sheetMarks = cleanMarks(sheet.marks);
            const graded = gradeSheetAny(ctx, sheet.answers, sheet.set, sheetMarks, assessment.Max_Score);
            statements.push(env.DB.prepare(
                `INSERT INTO Scan_Sheets (Sheet_ID, Session_ID, Student_ID, Student_No_Read, Original_Answers, Answers, Score, Edited, Scan_ID, Set_No, Marks)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(Session_ID, Student_ID) DO UPDATE SET
                    Student_No_Read = excluded.Student_No_Read, Original_Answers = excluded.Original_Answers,
                    Answers = excluded.Answers, Score = excluded.Score, Edited = excluded.Edited,
                    Photo_File_ID = CASE WHEN Scan_Sheets.Scan_ID IS excluded.Scan_ID THEN Scan_Sheets.Photo_File_ID ELSE NULL END,
                    Photo_Layout = CASE WHEN Scan_Sheets.Scan_ID IS excluded.Scan_ID THEN Scan_Sheets.Photo_Layout ELSE NULL END,
                    Scan_ID = excluded.Scan_ID, Set_No = excluded.Set_No, Marks = excluded.Marks,
                    Updated_At = CURRENT_TIMESTAMP`
            ).bind(
                crypto.randomUUID(), sessionId, sheet.studentId, String(sheet.studentNo || '').slice(0, 20),
                JSON.stringify(original), JSON.stringify(sheet.answers), graded.score, sameList(original, sheet.answers) ? 0 : 1,
                sheet.scanId || null, Number.isInteger(sheet.set) ? sheet.set : 0, JSON.stringify(sheetMarks)
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
            const old = await env.DB.prepare("SELECT Student_ID, Answers, Set_No, Marks FROM Scan_Sheets WHERE Session_ID = ?").bind(sessionId).all();
            for (const row of old.results || []) {
                if (written.has(row.Student_ID) || removedIds.has(row.Student_ID)) continue;
                const answers = parseJsonList(row.Answers);
                if (!isAnswerList(answers, n, c, layout)) continue;
                const graded = gradeSheetAny(ctx, answers, row.Set_No, parseMarks(row.Marks), assessment.Max_Score);
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

    // A student's read-only review of their own scanned paper: every question, the right answer, their answer and the
    // points. Only after the lecturer released the answers (the same switch as for online exams).
    if (method === 'GET' && path === '/api/student-sheet-review') {
        const sheetId = url.searchParams.get('sheetId');
        const studentId = url.searchParams.get('studentId');
        if (!sheetId || !studentId) return json(corsHeaders, { error: 'Missing sheetId or studentId' }, 400);
        const h = await env.DB.prepare(
            `SELECT h.Student_ID, h.Answers, h.Score, h.Set_No, h.Marks, s.Course_ID, s.Assessment_ID, s.Layout, s.Set_Keys, a.Max_Score
             FROM Scan_Sheets h JOIN Scan_Sessions s ON s.Session_ID = h.Session_ID LEFT JOIN Assessments a ON a.Assessment_ID = s.Assessment_ID
             WHERE h.Sheet_ID = ?`
        ).bind(sheetId).first();
        if (!h || h.Student_ID !== studentId) return json(corsHeaders, { error: 'Answer sheet not found.' }, 404);
        await ensureAccessibleExamTables(env);
        const ce = await env.DB.prepare(
            `SELECT ce.Release, ce.Adjustments, e.Title AS Exam_Title, e.ExamData FROM Class_Exams ce JOIN Exams e ON e.Exam_ID = ce.Exam_ID
             WHERE ce.Course_ID = ? AND ce.Assessment_ID = ? ORDER BY ce.Created_At DESC LIMIT 1`
        ).bind(h.Course_ID, h.Assessment_ID).first();
        if (!ce) return json(corsHeaders, { error: 'This paper is not linked to an exam, so there is nothing to review.' }, 404);
        if (ce.Release !== 1) return json(corsHeaders, { error: 'Your lecturer has not released the answers yet.' }, 403);

        const questions = safeJson(ce.ExamData) || [];
        const conv = convertSheet(scanContext(h, questions), h, questions);
        if (!conv) return json(corsHeaders, { error: 'The review is not available for this printed set of the paper.' }, 409);
        const adjustments = safeJson(ce.Adjustments) || {};
        const items = conv.order.map(o => {
            const hand = Object.prototype.hasOwnProperty.call(conv.written, o);
            const item = reviewQuestion(questions[o], o, hand ? '' : conv.answers[o], Object.prototype.hasOwnProperty.call(conv.marks, o) ? conv.marks[o] : null);
            if (hand || item.type === 'essay') {
                item.answer = 'Written on your paper';   // the answer is on the paper, not in the system
                if (hand) { item.earned = conv.written[o] === null ? 0 : conv.written[o]; item.marked = conv.written[o] !== null; }
            }
            item.adjustment = adjustments[o] || null;
            return item;
        });
        return json(corsHeaders, { success: true, examTitle: ce.Exam_Title, finalScore: Number(h.Score) || 0, maxScore: Number(h.Max_Score) || 0, questions: items });
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
        const { sheetId, answers, marks } = await request.json();
        if (!sheetId) return json(corsHeaders, { error: 'Missing sheetId' }, 400);

        const sheet = await env.DB.prepare(
            `SELECT h.Sheet_ID, h.Student_ID, h.Original_Answers, h.Set_No, h.Marks, s.Assessment_ID, s.Num_Questions, s.Num_Choices, s.Answer_Key, s.Bonus_Flags, s.Set_Keys, s.Layout
             FROM Scan_Sheets h JOIN Scan_Sessions s ON s.Session_ID = h.Session_ID
             WHERE h.Sheet_ID = ?`
        ).bind(sheetId).first();
        if (!sheet) return json(corsHeaders, { error: 'Saved sheet not found.' }, 404);

        const assessment = await env.DB.prepare("SELECT Max_Score FROM Assessments WHERE Assessment_ID = ?").bind(sheet.Assessment_ID).first();
        if (!assessment) return json(corsHeaders, { error: 'The assessment of this scan no longer exists.' }, 404);

        const layoutC = sheet.Layout ? cleanLayout(parseJsonList(sheet.Layout)) : null;
        if (!isAnswerList(answers, sheet.Num_Questions, sheet.Num_Choices, layoutC)) {
            return json(corsHeaders, { error: 'Invalid answers.' }, 400);
        }

        const key = parseJsonList(sheet.Answer_Key);
        const bonusFlags = parseJsonList(sheet.Bonus_Flags).map(Boolean);
        const newMarks = marks !== undefined ? cleanMarks(marks) : parseMarks(sheet.Marks);
        const graded = gradeSheetAny({ layout: layoutC, setKeys: parseJsonList(sheet.Set_Keys), key, bonus: bonusFlags }, answers, sheet.Set_No, newMarks, assessment.Max_Score);
        const edited = sameList(parseJsonList(sheet.Original_Answers), answers) && JSON.stringify(newMarks) === JSON.stringify(parseMarks(sheet.Marks)) ? 0 : 1;

        await env.DB.batch([
            env.DB.prepare(
                "UPDATE Scan_Sheets SET Answers = ?, Score = ?, Edited = ?, Marks = ?, Updated_At = CURRENT_TIMESTAMP WHERE Sheet_ID = ?"
            ).bind(JSON.stringify(answers), graded.score, edited, JSON.stringify(newMarks), sheetId),
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

