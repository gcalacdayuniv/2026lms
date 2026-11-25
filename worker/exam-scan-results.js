// worker/exam-scan-results.js
// Scanned answer sheets of a class exam, for Manage Exams > Results. A scan session belongs to an assessment
// (Scan_Sessions.Assessment_ID); the class exam is linked to the same assessment (Class_Exams.Assessment_ID).
// Every sheet is turned back into the answers an online student would have given, so the same score summary,
// score spread and question analysis (grading.js) count scanned and online students together.

import { ensureScanTables } from './schema.js';
import { safeJson } from './shared.js';
import { decodeItem, setMaxPoints } from './scan-grade.js';
import { questionPoints, questionType } from './grading.js';
import { scannableItems, buildSets, indexesOf } from './exam-sets.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const list = (text) => { const v = safeJson(text); return Array.isArray(v) ? v : []; };

// Exam rows an all-multiple-choice sheet holds, in sheet order (the same rule the scanner uses to build its key).
const plainRows = (questions) => {
    const out = [];
    questions.forEach((q, i) => {
        const choices = Array.isArray(q[2]) ? q[2] : [];
        if (choices.length >= 2 && choices.length <= 5 && choices.findIndex(c => norm(c) === norm(q[3])) >= 0) out.push(i);
    });
    return out;
};

// What is needed to read the sheets of one session (see convertSheet).
// examId rebuilds the printed sets B-F of a plain (all multiple-choice) paper: their questions and choices were shuffled from it.
export const scanContext = (session, questions, examId = '') => {
    const mixed = Boolean(session.Layout);
    return { mixed, setKeys: list(session.Set_Keys), plain: mixed ? null : plainRows(questions), examId, questions };
};

// The printed set number setNo (1 = B ...) of a plain paper, rebuilt from the exam, or null when it does not match what was
// scanned (for example the exam was edited after the sheets were scanned).
const rebuildPlainSet = (ctx, setNo) => {
    const saved = ctx.setKeys[setNo];
    if (!ctx.examId || !saved || !Array.isArray(saved.key)) return null;
    const sets = buildSets(scannableItems(ctx.questions), { seed: ctx.examId, count: ctx.setKeys.length });
    const set = sets[setNo];
    if (!set || JSON.stringify(set.key) !== JSON.stringify(saved.key)) return null;
    return set;
};

// One saved sheet as the answers an online student would have given. Returns
//   { answers: [one per exam question], marks: { essay question: points }, written: { question: points | null },
//     order: [exam question numbers in the order of the student's printed paper] }
// or null when the sheet cannot be matched to the exam's questions (a plain sheet of another printed set).
// `written` lists the hand-marked written answers that are not essays (points, or null while unmarked).
export function convertSheet(ctx, h, questions) {
    const given = list(h.Answers);
    const setNo = Number.isInteger(h.Set_No) ? h.Set_No : 0;
    const exam = new Array(questions.length).fill('');
    if (ctx.mixed) {
        const set = setNo > 0 && ctx.setKeys[setNo] ? ctx.setKeys[setNo] : ctx.setKeys[0];
        if (!set || !Array.isArray(set.items)) return null;
        const handMarks = safeJson(h.Marks) || {};
        const marks = {};
        const written = {};
        const order = [];
        set.items.forEach((it, idx) => {
            const o = it.o;
            if (!Number.isInteger(o) || o < 0 || o >= questions.length) return;
            order.push(o);
            const q = questions[o];
            if (it.t === 'manual') {
                // Written answers are marked by hand. An essay keeps its points; any other written answer counts as right
                // only with full points (partial points are in the score but not in the question analysis).
                const m = handMarks[idx];
                const hasMark = !(m === undefined || m === null || m === '' || !Number.isFinite(Number(m)));
                if (questionType(q) === 'essay') { if (hasMark) marks[o] = Number(m); }
                else {
                    written[o] = hasMark ? Number(m) : null;
                    if (hasMark && Number(m) >= questionPoints(q) - 1e-9) exam[o] = q[3];
                }
                return;
            }
            exam[o] = decodeItem(it, given.slice(it.s, it.s + it.n));
        });
        return { answers: exam, marks, written, order };
    }
    const plain = ctx.plain;
    // A plain paper of printed set B-F: question order and choices are rebuilt from the exam, then each answer is read from them.
    if (plain && plain.length === questions.length && plain.length === given.length && setNo > 0 && ctx.setKeys[setNo]) {
        const set = rebuildPlainSet(ctx, setNo);
        if (!set || set.items.length !== given.length) return null;
        const order = [];
        set.items.forEach((it, j) => {
            const code = given[j];
            order.push(it.orig);
            if (it.multi) exam[it.orig] = Number.isInteger(code) && code >= 1000 ? indexesOf(code).filter(k => k < it.choices.length).map(k => it.choices[k]) : [];
            else exam[it.orig] = Number.isInteger(code) && code >= 0 && code < it.choices.length ? it.choices[code] : '';
        });
        return { answers: exam, marks: {}, written: {}, order };
    }
    if (plain && plain.length === questions.length && plain.length === given.length && (setNo <= 0 || !ctx.setKeys[setNo])) {
        plain.forEach((o, j) => {
            const choices = questions[o][2];
            exam[o] = Number.isInteger(given[j]) && given[j] >= 0 && given[j] < choices.length ? choices[given[j]] : '';
        });
        return { answers: exam, marks: {}, written: {}, order: plain.slice() };
    }
    return null;
}

// -> [{ studentId, name, studentNumber, score, max, answers, marks }]
// answers (one per exam question) and marks ({ question index: points }) are null when the sheet cannot be
// matched to the exam's questions (a plain sheet of another printed set): the score still counts, the question
// analysis leaves that sheet out.
export async function scannedResults(env, courseId, assessmentId, questions, examId = '') {
    if (!courseId || !assessmentId) return [];
    await ensureScanTables(env);
    const session = await env.DB.prepare(
        "SELECT Session_ID, Bonus_Flags, Set_Keys, Layout FROM Scan_Sessions WHERE Course_ID = ? AND Assessment_ID = ?"
    ).bind(courseId, assessmentId).first();
    if (!session) return [];

    const assessment = await env.DB.prepare("SELECT Max_Score FROM Assessments WHERE Assessment_ID = ?").bind(assessmentId).first();
    const setKeys = list(session.Set_Keys);
    const mixed = Boolean(session.Layout);
    let max = Number(assessment && assessment.Max_Score);
    if (!(max > 0)) max = mixed && setKeys[0] ? setMaxPoints(setKeys[0]) : Math.max(1, list(session.Bonus_Flags).filter(b => !b).length);
    const ctx = scanContext(session, questions, examId);

    const rows = (await env.DB.prepare(
        `SELECT h.Student_ID, h.Answers, h.Score, h.Set_No, h.Marks, u.Name, u.Student_Number
         FROM Scan_Sheets h LEFT JOIN Users u ON u.User_ID = h.Student_ID
         WHERE h.Session_ID = ? ORDER BY u.Name`
    ).bind(session.Session_ID).all()).results || [];

    return rows.map(h => {
        const conv = convertSheet(ctx, h, questions);
        return { studentId: h.Student_ID, name: h.Name || h.Student_ID, studentNumber: h.Student_Number || '', score: Number(h.Score) || 0, max,
            answers: conv ? conv.answers : null, marks: conv ? conv.marks : null };
    });
}
