// worker/exams.js
// Exam routes: the exam bank, assigning exams to classes, student access and attempts, results, essay grading and release.
// worker.js calls handleExams() after the permission check; it returns a Response for its own paths and null otherwise.

import { safeJson, getRequestDate, findUserByCredentials, loginKeys, loginLockedFor, loginFailed, loginCleared, tooManyTries, runInChunks } from './shared.js';
import { ensureAccessibleExamTables, ensureManualMarksColumn } from './schema.js';
import { ASSESSMENT_TERMS, ASSESSMENT_CATEGORIES } from './constants.js';
import { DATE_RE } from './attendance.js';
import { questionPoints, examMaxPoints, essayIndexes, scoreExam, studentQuestion, questionStats, scoreSummary, itemAnalysis, finalScoreOf, reviewQuestion } from './grading.js';

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

// A date-only window (YYYY-MM-DD, what the app saves) is compared with today's date in the visitor's
// timezone (Asia/Manila by default), so "from" opens at local midnight and "to" closes at the end of that local day.
function isWithinScheduleWindow(fromDate, toDate, request) {
    const today = getRequestDate(request);
    const now = new Date();
    const dateOnly = (v) => typeof v === 'string' && DATE_RE.test(v);
    if (fromDate) {
        if (dateOnly(fromDate)) {
            if (today < fromDate) return false;
        } else {
            const start = new Date(fromDate);
            if (!isNaN(start.getTime()) && now < start) return false;
        }
    }
    if (toDate) {
        if (dateOnly(toDate)) {
            if (today > toDate) return false;
        } else {
            const end = new Date(toDate);
            if (!isNaN(end.getTime()) && now > end) return false;
        }
    }
    return true;
}

async function getStudentAccessibleExamsList(env, studentId, request) {
    await ensureAccessibleExamTables(env);

    const rows = await env.DB.prepare(
        `SELECT ea.Assignment_ID, ea.Class_Exam_ID, ea.Is_Enabled, ea.Status, ea.Final_Score, ea.Max_Score as Recorded_Max, ea.Manual_Marks,
                ce.Course_ID, ce.Exam_ID, ce.Assessment_ID, ce.Term, ce.Category, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit, ea.Started_At, ce.Adjustments, ce.Release,
                e.Title as Exam_Title, e.ExamData,
                c.CourseCode, c.CourseTitle
         FROM Exam_Assignments ea
         JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
         JOIN Exams e ON ce.Exam_ID = e.Exam_ID
         JOIN Courses c ON ce.Course_ID = c.Course_ID
         WHERE ea.Student_ID = ? AND ea.Is_Enabled = 1 AND ce.Is_Active = 1 AND ${EXAM_FITS_CLASS_SQL}
         ORDER BY ce.Created_At DESC`
    ).bind(studentId).all();

    const availableExams = [];

    for (const r of (rows.results || [])) {
        if (!isWithinScheduleWindow(r.From_Date, r.To_Date, request)) {
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
            essayPending: r.Status === 'Completed' && essayIndexes(parsed).length > 0 && scoreExam(parsed, [], safeJson(r.Manual_Marks), safeJson(r.Adjustments)).pending > 0,
            release: r.Release === 1,
            questions
        });
    }

    return availableExams;
}

// An exam tied to a course title (Exams.Course) may only be shown and used by classes with that same Course Title (ignoring case and spaces).
// An exam with no course line can be used by any class. Aliases: e = Exams, ce = Class_Exams.
const EXAM_FITS_CLASS_SQL = "(TRIM(COALESCE(e.Course, '')) = '' OR LOWER(TRIM(e.Course)) = LOWER(TRIM(COALESCE((SELECT CourseTitle FROM Courses WHERE Course_ID = ce.Course_ID), ''))))";

const examFitsTitle = (examCourse, courseTitle) => {
    const a = String(examCourse || '').trim().toLowerCase();
    return !a || a === String(courseTitle || '').trim().toLowerCase();
};

export async function handleExams(request, env, path, url, corsHeaders) {
    if (request.method === "GET" && path === "/api/exams") {
        const lecturerId = url.searchParams.get("lecturerId");
        const forCourseId = url.searchParams.get("courseId");
        await ensureAccessibleExamTables(env);
        // Uses = how many times the exam was assigned to a class. An exam that was never assigned can be deleted.
        await ensureManualMarksColumn(env);
        const exams = await env.DB.prepare(
            `SELECT e.Exam_ID, e.Title, e.Course, e.ExamData, e.Created_At, COALESCE(e.Archived, 0) AS Archived,
                    (SELECT COUNT(*) FROM Class_Exams ce WHERE ce.Exam_ID = e.Exam_ID) AS Uses
             FROM Exams e WHERE e.Lecturer_ID = ?
               ${forCourseId ? "AND (TRIM(COALESCE(e.Course, '')) = '' OR LOWER(TRIM(e.Course)) = LOWER(TRIM(COALESCE((SELECT CourseTitle FROM Courses WHERE Course_ID = ?), ''))))" : ""}
             ORDER BY e.Created_At DESC`
        ).bind(...(forCourseId ? [lecturerId, forCourseId] : [lecturerId])).all();
        return new Response(JSON.stringify({ success: true, exams: exams.results }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && (path === "/api/exams/archive" || path === "/api/exams/delete")) {
        const body = await request.json();
        await ensureAccessibleExamTables(env);
        const exam = await env.DB.prepare("SELECT Lecturer_ID FROM Exams WHERE Exam_ID = ?").bind(body.examId).first();
        if (!exam) {
            return new Response(JSON.stringify({ error: "Exam not found." }), { status: 404, headers: corsHeaders });
        }
        if (exam.Lecturer_ID !== body.lecturerId) {
            return new Response(JSON.stringify({ error: "Only the lecturer who owns this exam can change it." }), { status: 403, headers: corsHeaders });
        }
        if (path === "/api/exams/archive") {
            await env.DB.prepare("UPDATE Exams SET Archived = ? WHERE Exam_ID = ?").bind(body.archived ? 1 : 0, body.examId).run();
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }
        const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM Class_Exams WHERE Exam_ID = ?").bind(body.examId).first();
        if (used && used.n > 0) {
            if (!body.force) {
                return new Response(JSON.stringify({ error: "This exam has class records.", used: used.n, needsConfirm: true }), { status: 409, headers: corsHeaders });
            }
            // Delete the exam, its class links and the students' answer records, but keep every score: any exam
            // score not yet in the class record is copied there first, and Assessment_Scores / scanned sheets stay.
            await env.DB.batch([
                env.DB.prepare(
                    `INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score)
                     SELECT lower(hex(randomblob(16))), ce.Assessment_ID, ea.Student_ID, ea.Final_Score
                     FROM Exam_Assignments ea JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
                     WHERE ce.Exam_ID = ? AND ea.Final_Score IS NOT NULL AND COALESCE(ce.Assessment_ID, '') <> ''
                       AND NOT EXISTS (SELECT 1 FROM Assessment_Scores s WHERE s.Assessment_ID = ce.Assessment_ID AND s.Student_ID = ea.Student_ID)`
                ).bind(body.examId),
                env.DB.prepare("DELETE FROM Exam_Assignments WHERE Class_Exam_ID IN (SELECT Class_Exam_ID FROM Class_Exams WHERE Exam_ID = ?)").bind(body.examId),
                env.DB.prepare("DELETE FROM Class_Exams WHERE Exam_ID = ?").bind(body.examId)
            ]);
        }
        await env.DB.prepare("DELETE FROM Exams WHERE Exam_ID = ?").bind(body.examId).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "GET" && path === "/api/exam-data") {
        const examId = url.searchParams.get("examId");
        const exam = await env.DB.prepare("SELECT * FROM Exams WHERE Exam_ID = ?").bind(examId).first();
        return new Response(JSON.stringify({ success: true, exam }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/exams") {
        const body = await request.json();
        const id = crypto.randomUUID();
        await ensureManualMarksColumn(env);
        await env.DB.prepare("INSERT INTO Exams (Exam_ID, Lecturer_ID, Title, ExamData, Course) VALUES (?, ?, ?, ?, ?)").bind(id, body.lecturerId, body.title, JSON.stringify(body.examData), String(body.course || '').trim().slice(0, 120)).run();
        return new Response(JSON.stringify({ success: true, examId: id }), { status: 201, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/exams/update") {
        const body = await request.json();
        const { examId, title, examData } = body;
        if (!examId || !Array.isArray(examData)) {
            return new Response(JSON.stringify({ error: "Missing examId or examData." }), { status: 400, headers: corsHeaders });
        }
        if (typeof body.course === "string") {
            await ensureManualMarksColumn(env);
            await env.DB.prepare("UPDATE Exams SET Course = ? WHERE Exam_ID = ?").bind(body.course.trim().slice(0, 120), examId).run();
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
             WHERE ce.Course_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
        ).bind(courseId).all();

        const assignments = await env.DB.prepare(
            `SELECT ea.*
             FROM Exam_Assignments ea
             JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
             JOIN Exams e ON ce.Exam_ID = e.Exam_ID
             WHERE ce.Course_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
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
        const targetClass = await env.DB.prepare("SELECT CourseTitle FROM Courses WHERE Course_ID = ?").bind(courseId).first();
        if (!examFitsTitle(exam.Course, targetClass && targetClass.CourseTitle)) {
            return new Response(JSON.stringify({ error: `This exam is for the course "${String(exam.Course).trim()}" and can only be used by classes with that course title.` }), { status: 400, headers: corsHeaders });
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

        const availableExams = await getStudentAccessibleExamsList(env, user.User_ID, request);

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

        const lk = loginKeys(request, id);
        const locked = await loginLockedFor(env, lk);
        if (locked) return tooManyTries(corsHeaders, locked);

        const user = await findUserByCredentials(env, id, body.password,
            "User_ID, Username, Name, Student_Number, account_status, role, course, year, section, eye_condition");

        if (!user) {
            await loginFailed(env, lk);
            return new Response(JSON.stringify({ error: "Invalid credentials." }), { status: 401, headers: corsHeaders });
        }
        await loginCleared(env, lk);

        if (user.account_status.toLowerCase() !== 'active') {
            return new Response(JSON.stringify({ error: `Account is ${user.account_status}.` }), { status: 403, headers: corsHeaders });
        }

        const availableExams = await getStudentAccessibleExamsList(env, user.User_ID, request);

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
             FROM Exam_Assignments ea JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID JOIN Exams e ON ce.Exam_ID = e.Exam_ID
             WHERE ea.Assignment_ID = ? AND ea.Student_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
        ).bind(assignmentId, studentId).first();
        if (!record) {
            return new Response(JSON.stringify({ error: "Exam assignment not found." }), { status: 404, headers: corsHeaders });
        }
        if (!record.Is_Enabled || !record.Is_Active || record.Status === "Completed" || !isWithinScheduleWindow(record.From_Date, record.To_Date, request)) {
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
            `SELECT ce.Class_Exam_ID, ce.Time_Limit, ce.Adjustments, ce.Release, e.Title as Exam_Title, e.ExamData
             FROM Class_Exams ce JOIN Exams e ON ce.Exam_ID = e.Exam_ID WHERE ce.Class_Exam_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
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

        const analysis = itemAnalysis(questions, answerSets, markSets);
        const adjustments = safeJson(ce.Adjustments) || {};
        stats.forEach((s, i) => { Object.assign(s, analysis[i]); s.adjustment = adjustments[i] || null; });

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
            release: ce.Release === 1,
            students
        }), { status: 200, headers: corsHeaders });
    }

    // Gives everyone credit for a question, drops it from the exam, or undoes that. Every submitted exam of
    // the class exam is scored again and the assessment scores follow.
    if (request.method === "POST" && path === "/api/exam-adjust") {
        const { classExamId, index, action } = await request.json();
        const idx = Number(index);
        if (!classExamId || !Number.isInteger(idx) || !["credit", "drop", "none"].includes(action)) {
            return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers: corsHeaders });
        }
        await ensureAccessibleExamTables(env);
        const ce = await env.DB.prepare(
            `SELECT ce.Class_Exam_ID, ce.Assessment_ID, ce.Adjustments, e.ExamData
             FROM Class_Exams ce JOIN Exams e ON ce.Exam_ID = e.Exam_ID WHERE ce.Class_Exam_ID = ?`
        ).bind(classExamId).first();
        if (!ce) return new Response(JSON.stringify({ error: "Class exam not found." }), { status: 404, headers: corsHeaders });
        const questions = safeJson(ce.ExamData) || [];
        if (idx < 0 || idx >= questions.length) {
            return new Response(JSON.stringify({ error: "No such question." }), { status: 400, headers: corsHeaders });
        }
        const adjustments = safeJson(ce.Adjustments) || {};
        if (action === "none") delete adjustments[idx]; else adjustments[idx] = action;

        const done = await env.DB.prepare(
            "SELECT Assignment_ID, Student_ID, Max_Score, Answers_JSON, Manual_Marks FROM Exam_Assignments WHERE Class_Exam_ID = ? AND Status = 'Completed'"
        ).bind(classExamId).all();
        const statements = [
            env.DB.prepare("UPDATE Class_Exams SET Adjustments = ? WHERE Class_Exam_ID = ?").bind(JSON.stringify(adjustments), classExamId)
        ];
        let changed = 0;
        for (const r of done.results || []) {
            const scored = scoreExam(questions, safeJson(r.Answers_JSON) || [], safeJson(r.Manual_Marks), adjustments);
            const maxScore = r.Max_Score > 0 ? r.Max_Score : examMaxPoints(questions);
            const finalScore = finalScoreOf(scored, maxScore);
            statements.push(env.DB.prepare(
                "UPDATE Exam_Assignments SET Raw_Score = ?, Bonus_Score = ?, Final_Score = ? WHERE Assignment_ID = ?"
            ).bind(scored.raw, scored.bonus, finalScore, r.Assignment_ID));
            if (ce.Assessment_ID) {
                statements.push(
                    env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(ce.Assessment_ID, r.Student_ID),
                    env.DB.prepare("INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)")
                        .bind(crypto.randomUUID(), ce.Assessment_ID, r.Student_ID, finalScore)
                );
            }
            changed++;
        }
        await runInChunks(env, statements);
        return new Response(JSON.stringify({ success: true, regraded: changed, adjustments }), { status: 200, headers: corsHeaders });
    }

    // Lets students review their answers and the right answers (or hides them again).
    if (request.method === "POST" && path === "/api/exam-release") {
        const { classExamId, release } = await request.json();
        if (!classExamId) return new Response(JSON.stringify({ error: "Missing classExamId" }), { status: 400, headers: corsHeaders });
        await ensureAccessibleExamTables(env);
        await env.DB.prepare("UPDATE Class_Exams SET Release = ? WHERE Class_Exam_ID = ?").bind(release ? 1 : 0, classExamId).run();
        return new Response(JSON.stringify({ success: true, release: Boolean(release) }), { status: 200, headers: corsHeaders });
    }

    // A student's own review of a submitted exam. Only after the lecturer released the answers.
    if (request.method === "GET" && path === "/api/student-exam-review") {
        const assignmentId = url.searchParams.get("assignmentId");
        const studentId = url.searchParams.get("studentId");
        if (!assignmentId || !studentId) {
            return new Response(JSON.stringify({ error: "Missing assignmentId or studentId" }), { status: 400, headers: corsHeaders });
        }
        await ensureAccessibleExamTables(env);
        const rec = await env.DB.prepare(
            `SELECT ea.Status, ea.Final_Score, ea.Max_Score, ea.Answers_JSON, ea.Manual_Marks, ce.Release, ce.Adjustments, e.Title as Exam_Title, e.ExamData
             FROM Exam_Assignments ea JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID JOIN Exams e ON ce.Exam_ID = e.Exam_ID
             WHERE ea.Assignment_ID = ? AND ea.Student_ID = ?`
        ).bind(assignmentId, studentId).first();
        if (!rec) return new Response(JSON.stringify({ error: "Exam not found." }), { status: 404, headers: corsHeaders });
        if (rec.Status !== "Completed") return new Response(JSON.stringify({ error: "Submit the exam first." }), { status: 400, headers: corsHeaders });
        if (rec.Release !== 1) return new Response(JSON.stringify({ error: "Your lecturer has not released the answers yet." }), { status: 403, headers: corsHeaders });
        const questions = safeJson(rec.ExamData) || [];
        const answers = safeJson(rec.Answers_JSON) || [];
        const marks = safeJson(rec.Manual_Marks) || {};
        const adjustments = safeJson(rec.Adjustments) || {};
        const items = questions.map((q, i) => ({
            ...reviewQuestion(q, i, answers[i], Object.prototype.hasOwnProperty.call(marks, i) ? marks[i] : null),
            adjustment: adjustments[i] || null
        }));
        return new Response(JSON.stringify({ success: true, examTitle: rec.Exam_Title, finalScore: rec.Final_Score, maxScore: rec.Max_Score, questions: items }), { status: 200, headers: corsHeaders });
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
            `SELECT ea.Assignment_ID, ea.Status, ea.Max_Score, ea.Answers_JSON, ea.Manual_Marks, ce.Assessment_ID, ce.Adjustments, e.ExamData
             FROM Exam_Assignments ea
             JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
             JOIN Exams e ON ce.Exam_ID = e.Exam_ID
             WHERE ea.Class_Exam_ID = ? AND ea.Student_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
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
        const scored = scoreExam(questions, answers, marks, safeJson(record.Adjustments));
        const maxScore = record.Max_Score > 0 ? record.Max_Score : examMaxPoints(questions);
        const finalScore = finalScoreOf(scored, maxScore);

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
            `SELECT ea.*, ce.Course_ID, ce.Exam_ID, ce.Assessment_ID, ce.Term, ce.Category, ce.Is_Active, ce.From_Date, ce.To_Date, ce.Time_Limit, ce.Adjustments,
                    e.Title as Exam_Title, e.ExamData
             FROM Exam_Assignments ea
             JOIN Class_Exams ce ON ea.Class_Exam_ID = ce.Class_Exam_ID
             JOIN Exams e ON ce.Exam_ID = e.Exam_ID
             WHERE ea.Assignment_ID = ? AND ea.Student_ID = ? AND ${EXAM_FITS_CLASS_SQL}`
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

        if (!isWithinScheduleWindow(record.From_Date, record.To_Date, request)) {
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
        const scored = scoreExam(quizData, cleanAnswers, null, safeJson(record.Adjustments));
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

        const finalScore = finalScoreOf(scored, maxScore);

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

    return null;
}
