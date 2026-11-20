// worker/scores.js
// Assessment and score routes: the list of assessments for a class, saving scores, and the per-student and
// whole-class summaries that the Class Summary screen and the Class Grade export read.
// worker.js calls handleScores() after the permission check; it returns a Response for its own paths and null otherwise.

import { ensureScanTables } from './schema.js';
import { ASSESSMENT_TERMS, ASSESSMENT_CATEGORIES } from './constants.js';

export async function handleScores(request, env, path, url, corsHeaders) {
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
        const { assessmentId, scores, clear, partial } = body;

        if (!assessmentId || !Array.isArray(scores)) {
            return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: corsHeaders });
        }

        const assessment = await env.DB.prepare(
            "SELECT Max_Score FROM Assessments WHERE Assessment_ID = ?"
        ).bind(assessmentId).first();
        if (!assessment) {
            return new Response(JSON.stringify({ error: "Assessment not found." }), { status: 404, headers: corsHeaders });
        }

        // partial: only the listed students change; everyone else (e.g. scan corrections) is kept.
        const statements = partial ? [] : [
            env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ?").bind(assessmentId)
        ];
        if (partial) {
            for (const sid of (Array.isArray(clear) ? clear : [])) {
                statements.push(env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(assessmentId, sid));
            }
        }

        for (const entry of scores) {
            const value = parseFloat(entry.score);
            if (!entry.studentId || isNaN(value) || value < 0 || value > assessment.Max_Score) {
                return new Response(JSON.stringify({ error: `Invalid score. Scores must be between 0 and ${assessment.Max_Score}.` }), { status: 400, headers: corsHeaders });
            }
            if (partial) statements.push(env.DB.prepare("DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?").bind(assessmentId, entry.studentId));
            statements.push(
                env.DB.prepare(
                    "INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)"
                ).bind(crypto.randomUUID(), assessmentId, entry.studentId, value)
            );
        }

        if (statements.length) await env.DB.batch(statements);

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

    // One call for the whole class (lecturer only): replaces one /api/student-summary call per student.
    if (request.method === "GET" && path === "/api/class-summary") {
        const courseId = url.searchParams.get("courseId");
        if (!courseId) {
            return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
        }

        const course = await env.DB.prepare("SELECT Midterm_Start, Midterm_End, Final_Start, Final_End, ScheduleDay FROM Courses WHERE Course_ID = ?").bind(courseId).first();
        if (!course) {
            return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
        }

        const sessions = await env.DB.prepare("SELECT Date, Is_No_Class FROM Course_Sessions WHERE Course_ID = ?").bind(courseId).all();
        const enrolled = await env.DB.prepare("SELECT Student_ID FROM Enrollments WHERE Course_ID = ?").bind(courseId).all();
        const attendance = await env.DB.prepare(
            "SELECT Student_ID, Date, Status, Performance_Points FROM Attendance WHERE Course_ID = ? ORDER BY Date ASC"
        ).bind(courseId).all();
        const assessmentRows = await env.DB.prepare(
            "SELECT Assessment_ID, Term, Category, Title, Max_Score, Date FROM Assessments WHERE Course_ID = ? ORDER BY Date ASC, Created_At ASC"
        ).bind(courseId).all();
        const scoreRows = await env.DB.prepare(
            `SELECT s.Assessment_ID, s.Student_ID, s.Score
             FROM Assessment_Scores s JOIN Assessments a ON a.Assessment_ID = s.Assessment_ID
             WHERE a.Course_ID = ?`
        ).bind(courseId).all();

        const scoreOf = new Map();
        for (const s of (scoreRows.results || [])) scoreOf.set(`${s.Assessment_ID}|${s.Student_ID}`, s.Score);

        const recordsOf = new Map();
        for (const r of (attendance.results || [])) {
            if (!recordsOf.has(r.Student_ID)) recordsOf.set(r.Student_ID, []);
            recordsOf.get(r.Student_ID).push({ Date: r.Date, Status: r.Status, Performance_Points: r.Performance_Points });
        }

        const students = {};
        for (const e of (enrolled.results || [])) {
            students[e.Student_ID] = {
                records: recordsOf.get(e.Student_ID) || [],
                assessments: (assessmentRows.results || []).map(a => ({
                    ...a,
                    Score: scoreOf.has(`${a.Assessment_ID}|${e.Student_ID}`) ? scoreOf.get(`${a.Assessment_ID}|${e.Student_ID}`) : null
                }))
            };
        }

        return new Response(JSON.stringify({ success: true, course, sessions: sessions.results, students }), { status: 200, headers: corsHeaders });
    }

    return null;
}
