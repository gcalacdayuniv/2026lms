// worker/exam-session.js
// One device per student, answers kept on the server, and automatic submission:
//  - A student signed in on one device is warned before signing in on another; confirming signs the first device out
//    and submits any exam that is in progress from the answers saved on the server (Draft_JSON).
//  - The app saves the answers every 30 seconds when they changed (POST /api/exam-draft).
//  - Leaving the exam screen starts a grace period (AWAY_GRACE_SECONDS) for a call, a pulled notification or a screen
//    that turned off. Phones freeze the page in the background, so the server enforces the grace period:
//    an attempt that stayed away longer is submitted from its saved answers the next time anyone asks.
//  - A lecturer can let a student continue an auto-submitted exam (POST /api/exam-continue).
import { getRequestDate } from './shared.js';
import { ensureExamSecurity } from './exam-photos.js';
import { scoreExam, examMaxPoints, finalScoreOf } from './grading.js';

export const AWAY_GRACE_SECONDS = 5; 
export const ONLINE_WINDOW_MS = 30 * 60 * 1000;   // a student seen this recently counts as signed in
const DRAFT_MAX_CHARS = 300000;
export const SUBMIT_REASONS = ['focus-lost', 'time', 'camera-off', 'away', 'session-takeover'];

let ready = false;
export async function ensureSessions(env) {
    if (ready) return;
    try {
        for (const [table, column, type] of [
            ['Users', 'Sessions_Valid_From', 'INTEGER'], ['Users', 'Last_Seen_At', 'INTEGER'], ['Users', 'Session_Device', 'TEXT'],
            ['Exam_Assignments', 'Draft_JSON', 'TEXT'], ['Exam_Assignments', 'Draft_At', 'TEXT'], ['Exam_Assignments', 'Away_Since', 'INTEGER']
        ]) {
            const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            if (!(info.results || []).some(c => c.name === column)) {
                await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
            }
        }
        ready = true;
    } catch (e) { ready = false; }
}

const safeParse = (t, fallback) => { try { const v = JSON.parse(t); return v ?? fallback; } catch (e) { return fallback; } };

export const ATTEMPT_SQL = `SELECT ea.*, ce.Course_ID, ce.Exam_ID, ce.Assessment_ID, ce.Term, ce.Category, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit, ce.Adjustments,
        e.Title as Exam_Title, e.ExamData
     FROM Exam_Assignments ea
     JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
     JOIN Exams e ON ce.Exam_ID = e.Exam_ID`;

// Grades the answers and records the attempt as Completed. record = one row of ATTEMPT_SQL.
export async function finishAttempt(env, request, record, answers, reason) {
    const quizData = (() => { const q = safeParse(record.ExamData || '[]', []); return Array.isArray(q) ? q : []; })();
    const given = Array.isArray(answers) ? answers : [];
    // keep stored answers small: one entry per question, essays up to 10,000 characters
    const cleanAnswers = quizData.map((q, idx) => {
        const a = given[idx];
        if (Array.isArray(a)) return a.slice(0, 40).map(x => String(x ?? '').slice(0, 500));
        return String(a ?? '').slice(0, 10000);
    });
    const scored = scoreExam(quizData, cleanAnswers, null, safeParse(record.Adjustments, null));
    let maxScore = examMaxPoints(quizData);

    let assessment = null;
    if (record.Assessment_ID) {
        assessment = await env.DB.prepare('SELECT * FROM Assessments WHERE Assessment_ID = ?').bind(record.Assessment_ID).first();
    }
    const today = request ? getRequestDate(request) : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    let targetAssessmentId = record.Assessment_ID;
    if (!assessment) {
        targetAssessmentId = crypto.randomUUID();
        await env.DB.prepare(
            `INSERT INTO Assessments (Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(targetAssessmentId, record.Course_ID, record.Term || 'MidTerm', record.Category || 'MajorExam', String(record.Exam_Title || '').trim(), maxScore, today).run();
        await env.DB.prepare('UPDATE Class_Exams SET Assessment_ID = ? WHERE Class_Exam_ID = ?').bind(targetAssessmentId, record.Class_Exam_ID).run();
    } else {
        maxScore = assessment.Max_Score > 0 ? assessment.Max_Score : maxScore;
    }
    const finalScore = finalScoreOf(scored, maxScore);

    await env.DB.batch([
        env.DB.prepare(
            `UPDATE Exam_Assignments
             SET Status = 'Completed', Raw_Score = ?, Bonus_Score = ?, Final_Score = ?, Max_Score = ?, Answers_JSON = ?, Submitted_At = CURRENT_TIMESTAMP, Submit_Reason = ?, Away_Since = NULL
             WHERE Assignment_ID = ?`
        ).bind(scored.raw, scored.bonus, finalScore, maxScore, JSON.stringify(cleanAnswers), reason, record.Assignment_ID),
        env.DB.prepare('DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?').bind(targetAssessmentId, record.Student_ID),
        env.DB.prepare('INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)')
            .bind(crypto.randomUUID(), targetAssessmentId, record.Student_ID, finalScore)
    ]);
    return { success: true, rawScore: scored.raw, bonusScore: scored.bonus, finalScore, maxScore, essayPending: scored.pending, examTitle: record.Exam_Title };
}

// Submits an in-progress attempt from the answers saved on the server.
async function submitFromDraft(env, record, reason) {
    await finishAttempt(env, null, record, safeParse(record.Draft_JSON, []), reason);
}

// Attempts that have been started and not submitted, optionally only the ones away longer than the grace period.
async function openAttempts(env, where, binds) {
    await ensureSessions(env);
    return ((await env.DB.prepare(
        `${ATTEMPT_SQL} WHERE ea.Status != 'Completed' AND ea.Started_At IS NOT NULL AND ${where}`
    ).bind(...binds).all()).results || []);
}

// Submits every exam this student has in progress (used when they sign in on another device).
export async function submitOpenAttempts(env, studentId, reason) {
    const rows = await openAttempts(env, 'ea.Student_ID = ?', [studentId]);
    for (const r of rows) { try { await submitFromDraft(env, r, reason); } catch (e) { /* the sweep tries again */ } }
    return rows.length;
}

export const hasOpenAttempt = async (env, studentId) => (await openAttempts(env, 'ea.Student_ID = ?', [studentId])).length > 0;

// Submits attempts whose student stayed away past the grace period. Scope: one student, one class exam, or all.
export async function sweepAway(env, { studentId, classExamId } = {}) {
    await ensureSessions(env);
    const cutoff = Date.now() - AWAY_GRACE_SECONDS * 1000;
    let where = 'ea.Away_Since IS NOT NULL AND ea.Away_Since < ?';
    const binds = [cutoff];
    if (studentId) { where += ' AND ea.Student_ID = ?'; binds.push(studentId); }
    if (classExamId) { where += ' AND ea.Class_Exam_ID = ?'; binds.push(classExamId); }
    const rows = await openAttempts(env, where, binds);
    for (const r of rows) { try { await submitFromDraft(env, r, 'away'); } catch (e) { /* next sweep */ } }
    return rows.length;
}

const reply = (corsHeaders, status, obj) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });

export async function handleExamSession(request, env, path, url, corsHeaders) {
    if (request.method === 'POST' && path === '/api/exam-draft') {
        const { assignmentId, studentId, answers } = await request.json();
        if (!assignmentId || !studentId || !Array.isArray(answers)) return reply(corsHeaders, 400, { error: 'Invalid draft.' });
        await ensureSessions(env);
        const text = JSON.stringify(answers);
        if (text.length > DRAFT_MAX_CHARS) return reply(corsHeaders, 413, { error: 'Draft too large.' });
        const r = await env.DB.prepare(
            "UPDATE Exam_Assignments SET Draft_JSON = ?, Draft_At = CURRENT_TIMESTAMP WHERE Assignment_ID = ? AND Student_ID = ? AND Status != 'Completed' AND Started_At IS NOT NULL"
        ).bind(text, assignmentId, studentId).run();
        const changed = r && r.meta ? r.meta.changes : 1;
        if (!changed) return reply(corsHeaders, 200, { success: true, closed: true });
        return reply(corsHeaders, 200, { success: true });
    }

    // The student left (away: true) or came back (away: false). Back after the grace period = already submitted.
    if (request.method === 'POST' && path === '/api/exam-away') {
        const { assignmentId, studentId, away, answers } = await request.json();
        if (!assignmentId || !studentId) return reply(corsHeaders, 400, { error: 'Invalid request.' });
        await ensureSessions(env);
        const rec = await env.DB.prepare(`${ATTEMPT_SQL} WHERE ea.Assignment_ID = ? AND ea.Student_ID = ?`).bind(assignmentId, studentId).first();
        if (!rec) return reply(corsHeaders, 404, { error: 'Exam assignment not found.' });
        if (rec.Status === 'Completed') return reply(corsHeaders, 200, { success: true, submitted: true, reason: rec.Submit_Reason || null });
        if (away) {
            if (Array.isArray(answers) && JSON.stringify(answers).length <= DRAFT_MAX_CHARS) {
                await env.DB.prepare('UPDATE Exam_Assignments SET Draft_JSON = ?, Draft_At = CURRENT_TIMESTAMP WHERE Assignment_ID = ?').bind(JSON.stringify(answers), assignmentId).run();
            }
            const since = rec.Away_Since || Date.now();
            if (!rec.Away_Since) await env.DB.prepare('UPDATE Exam_Assignments SET Away_Since = ? WHERE Assignment_ID = ?').bind(since, assignmentId).run();
            return reply(corsHeaders, 200, { success: true, graceSeconds: AWAY_GRACE_SECONDS, secondsLeft: Math.max(0, Math.round((since + AWAY_GRACE_SECONDS * 1000 - Date.now()) / 1000)) });
        }
        if (rec.Away_Since && Date.now() - rec.Away_Since > AWAY_GRACE_SECONDS * 1000) {
            await submitFromDraft(env, rec, 'away');
            return reply(corsHeaders, 200, { success: true, submitted: true, reason: 'away' });
        }
        await env.DB.prepare('UPDATE Exam_Assignments SET Away_Since = NULL WHERE Assignment_ID = ?').bind(assignmentId).run();
        return reply(corsHeaders, 200, { success: true });
    }

    // Lecturer: secure exam mode for one student, from the class exam's student list ('' = default, 'on', 'off').
    if (request.method === 'POST' && path === '/api/exam-secure-setting') {
        const { classExamId, studentId, examSecure } = await request.json();
        if (!classExamId || !studentId || !['', 'on', 'off'].includes(examSecure ?? '')) return reply(corsHeaders, 400, { error: 'Invalid request.' });
        await ensureExamSecurity(env);
        const has = await env.DB.prepare('SELECT 1 AS ok FROM Exam_Assignments WHERE Class_Exam_ID = ? AND Student_ID = ?').bind(classExamId, studentId).first();
        if (!has) return reply(corsHeaders, 404, { error: 'This student is not assigned to the exam.' });
        await env.DB.prepare('UPDATE Users SET Exam_Secure = ? WHERE User_ID = ?').bind(examSecure || null, studentId).run();
        return reply(corsHeaders, 200, { success: true });
    }

    // Lecturer: let a student carry on an exam that was submitted automatically. Answers are restored and the time
    // already used stays used, so the student continues with what was left.
    if (request.method === 'POST' && path === '/api/exam-continue') {
        const { classExamId, studentId } = await request.json();
        if (!classExamId || !studentId) return reply(corsHeaders, 400, { error: 'Missing classExamId or studentId.' });
        await ensureSessions(env);
        const rec = await env.DB.prepare(`${ATTEMPT_SQL} WHERE ea.Class_Exam_ID = ? AND ea.Student_ID = ?`).bind(classExamId, studentId).first();
        if (!rec) return reply(corsHeaders, 404, { error: 'Exam assignment not found.' });
        if (rec.Status !== 'Completed') return reply(corsHeaders, 400, { error: 'This exam is not submitted.' });
        const parseMs = (t) => { if (!t) return null; const s = String(t); const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return Number.isFinite(ms) ? ms : null; };
        const began = parseMs(rec.Started_At), ended = parseMs(rec.Submitted_At);
        const used = began !== null && ended !== null ? Math.max(0, ended - began) : 0;
        const newStart = new Date(Date.now() - used).toISOString();
        const stmts = [env.DB.prepare(
            `UPDATE Exam_Assignments SET Status = 'Pending', Raw_Score = NULL, Bonus_Score = NULL, Final_Score = NULL, Manual_Marks = NULL,
                    Draft_JSON = COALESCE(Answers_JSON, Draft_JSON), Answers_JSON = NULL, Started_At = ?, Submitted_At = NULL, Submit_Reason = NULL, Away_Since = NULL
             WHERE Assignment_ID = ?`
        ).bind(rec.Time_Limit ? newStart : (rec.Started_At || newStart), rec.Assignment_ID)];
        if (rec.Assessment_ID) stmts.push(env.DB.prepare('DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?').bind(rec.Assessment_ID, studentId));
        await env.DB.batch(stmts);
        return reply(corsHeaders, 200, { success: true });
    }
    return null;
}
