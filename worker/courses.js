// worker/courses.js
// Programs, classes (create, copy, edit, archive), enrollment, rosters, student details, lecturer notes and groups.

import { ensureLecturerNotes, ensureReactivationColumns, ensureInviteCode, setInviteCode } from './schema.js';
import { CLEAR_REACTIVATION_SQL, getCurrentTerm } from './shared.js';

// Academic year ("2026-2027", second year = first + 1) and semester are both optional.
const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"];
function cleanTerm(ay, sem) {
    const a = ay === undefined || ay === null ? "" : String(ay).trim().replace(/\s+/g, "");
    const s = sem === undefined || sem === null ? "" : String(sem).trim();
    if (a) {
        const m = /^(\d{4})-(\d{4})$/.exec(a);
        if (!m || Number(m[2]) !== Number(m[1]) + 1) return { error: "Academic year must look like 2026-2027." };
    }
    if (s && !SEMESTERS.includes(s)) return { error: "Choose a valid semester." };
    return { academicYear: a, semester: s };
}

// Returns a Response when the request is handled here, otherwise null.
// Enrol one student in one class; shared by lecturer enrol, class catalog and invite code.
async function enrollStudent(env, courseId, studentId) {
    const existing = await env.DB.prepare(
        `SELECT Enrollment_ID FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?`
    ).bind(courseId, studentId).first();
    if (existing) return { error: "You are already enrolled in this course." };

    await env.DB.prepare(
        `INSERT INTO Enrollments (Enrollment_ID, Course_ID, Student_ID) VALUES (?, ?, ?)`
    ).bind(crypto.randomUUID(), courseId, studentId).run();

    // A student set Inactive by Advance Year Level is reactivated when enrolled in a class of the term they were
    // advanced into, or of the current term.
    let reactivated = false;
    try {
        await ensureReactivationColumns(env);
        const stu = await env.DB.prepare("SELECT account_status, Advanced_Term FROM Users WHERE User_ID = ?").bind(studentId).first();
        if (stu && stu.Advanced_Term && String(stu.account_status || "").toLowerCase() === "inactive") {
            const crs = await env.DB.prepare("SELECT AcademicYear, Semester FROM Courses WHERE Course_ID = ?").bind(courseId).first();
            const now = await getCurrentTerm(env);
            const thisYear = crs && crs.AcademicYear && crs.AcademicYear === stu.Advanced_Term;
            const thisTerm = crs && crs.AcademicYear === now.ay && (!crs.Semester || crs.Semester === now.sem);
            if (thisYear || thisTerm) {
                await env.DB.prepare(`UPDATE Users SET account_status = 'Active', ${CLEAR_REACTIVATION_SQL} WHERE User_ID = ?`).bind(studentId).run();
                reactivated = true;
            }
        }
    } catch (e) { /* enrollment is saved; reactivation can be done by hand */ }
    return { reactivated };
}

export async function handleCourses(request, env, path, url, corsHeaders) {
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
        const term = cleanTerm(body.academicYear, body.semester);
        if (term.error) {
            return new Response(JSON.stringify({ error: term.error }), { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare(
            `INSERT INTO Courses (Course_ID, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Target_Course, Target_Year, Target_Section, Room, AcademicYear, Semester) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(courseId, body.courseCode, body.courseTitle, body.scheduleDay, body.timePeriod, body.lecturerId, targetCourse, targetYear, targetSection, room, term.academicYear, term.semester).run();

        try { await ensureInviteCode(env); await setInviteCode(env, courseId); } catch (e) { /* the code is made when the lecturer first opens it */ }

        return new Response(JSON.stringify({ success: true, message: "Course created successfully" }), { status: 201, headers: corsHeaders });
    }

    // Copies a class into another term: details, schedule, room and target, plus its exams (switched off, dates cleared).
    // Students, attendance, scores and exam answers are not copied.
    if (request.method === "POST" && path === "/api/duplicate-course") {
        const body = await request.json();
        const src = await env.DB.prepare("SELECT * FROM Courses WHERE Course_ID = ?").bind(body.courseId).first();
        if (!src) return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
        if (src.Lecturer_ID !== body.lecturerId) {
            return new Response(JSON.stringify({ error: "Only the lecturer of this class can copy it." }), { status: 403, headers: corsHeaders });
        }
        const term = cleanTerm(body.academicYear, body.semester);
        if (term.error) return new Response(JSON.stringify({ error: term.error }), { status: 400, headers: corsHeaders });
        if (!term.academicYear || !term.semester) {
            return new Response(JSON.stringify({ error: "Choose the academic year and semester for the copy." }), { status: 400, headers: corsHeaders });
        }
        const newId = crypto.randomUUID();
        const stmts = [env.DB.prepare(
            `INSERT INTO Courses (Course_ID, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Target_Course, Target_Year, Target_Section, Room, AcademicYear, Semester) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(newId, src.CourseCode, src.CourseTitle, src.ScheduleDay, src.TimePeriod, src.Lecturer_ID, src.Target_Course || "", src.Target_Year || "", src.Target_Section || "", src.Room || "", term.academicYear, term.semester)];
        const links = (await env.DB.prepare(
            `SELECT ce.Exam_ID, ce.Term, ce.Category, ce.Time_Limit, a.Title, a.Max_Score
             FROM Class_Exams ce LEFT JOIN Assessments a ON a.Assessment_ID = ce.Assessment_ID WHERE ce.Course_ID = ?`
        ).bind(src.Course_ID).all()).results || [];
        const today = new Date().toISOString().slice(0, 10);
        for (const l of links) {
            const aId = crypto.randomUUID();
            stmts.push(env.DB.prepare(
                `INSERT INTO Assessments (Assessment_ID, Course_ID, Term, Category, Title, Max_Score, Date) VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(aId, newId, l.Term || "MidTerm", l.Category || "MajorExam", l.Title || "Exam", l.Max_Score || 0, today));
            stmts.push(env.DB.prepare(
                `INSERT INTO Class_Exams (Class_Exam_ID, Course_ID, Exam_ID, Assessment_ID, Term, Category, Is_Active, From_Date, To_Date, Time_Limit) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)`
            ).bind(crypto.randomUUID(), newId, l.Exam_ID, aId, l.Term || "MidTerm", l.Category || "MajorExam", l.Time_Limit || null));
        }
        for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
        try { await ensureInviteCode(env); await setInviteCode(env, newId); } catch (e) { /* made when first opened */ }
        return new Response(JSON.stringify({ success: true, courseId: newId, exams: links.length }), { status: 201, headers: corsHeaders });
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

    // Lecturer edits the details of a class: code, title, schedule, room and target audience.
    if (request.method === "POST" && path === "/api/update-course") {
        const body = await request.json();
        const course = await env.DB.prepare("SELECT Lecturer_ID, Target_Course, Target_Year, Target_Section FROM Courses WHERE Course_ID = ?").bind(body.courseId).first();
        if (!course) {
            return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
        }
        if (course.Lecturer_ID !== body.lecturerId) {
            return new Response(JSON.stringify({ error: "Only the lecturer of this class can change its details." }), { status: 403, headers: corsHeaders });
        }
        const clean = (v, max) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const d = {
            code: clean(body.courseCode, 40), title: clean(body.courseTitle, 200),
            day: clean(body.scheduleDay, 20), time: clean(body.timePeriod, 60), room: clean(body.room, 60),
            // The target audience is no longer edited (students join with a code); an old value is kept as it is.
            tc: body.targetCourse === undefined ? (course.Target_Course || "") : clean(body.targetCourse, 60),
            ty: body.targetYear === undefined ? (course.Target_Year || "") : clean(body.targetYear, 20),
            ts: body.targetSection === undefined ? (course.Target_Section || "") : clean(body.targetSection, 20)
        };
        if (!d.code || !d.title || !d.time) {
            return new Response(JSON.stringify({ error: "Course code, title and time are required." }), { status: 400, headers: corsHeaders });
        }
        if (!days.includes(d.day)) {
            return new Response(JSON.stringify({ error: "Choose a valid schedule day." }), { status: 400, headers: corsHeaders });
        }
        const term = cleanTerm(body.academicYear, body.semester);
        if (term.error) {
            return new Response(JSON.stringify({ error: term.error }), { status: 400, headers: corsHeaders });
        }
        await env.DB.prepare(
            `UPDATE Courses SET CourseCode = ?, CourseTitle = ?, ScheduleDay = ?, TimePeriod = ?, Room = ?,
                Target_Course = ?, Target_Year = ?, Target_Section = ?, AcademicYear = ?, Semester = ? WHERE Course_ID = ?`
        ).bind(d.code, d.title, d.day, d.time, d.room, d.tc, d.ty, d.ts, term.academicYear, term.semester, body.courseId).run();
        return new Response(JSON.stringify({ success: true, course: {
            CourseCode: d.code, CourseTitle: d.title, ScheduleDay: d.day, TimePeriod: d.time, Room: d.room,
            Target_Course: d.tc, Target_Year: d.ty, Target_Section: d.ts,
            AcademicYear: term.academicYear, Semester: term.semester
        } }), { status: 200, headers: corsHeaders });
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

    if (request.method === "POST" && path === "/api/archive-course") {
        const body = await request.json();
        const course = await env.DB.prepare("SELECT Lecturer_ID FROM Courses WHERE Course_ID = ?").bind(body.courseId).first();
        if (!course) {
            return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
        }
        if (course.Lecturer_ID !== body.lecturerId) {
            return new Response(JSON.stringify({ error: "Only the lecturer of this class can archive it." }), { status: 403, headers: corsHeaders });
        }
        await env.DB.prepare("UPDATE Courses SET Archived = ? WHERE Course_ID = ?").bind(body.archived ? 1 : 0, body.courseId).run();
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
                 WHERE COALESCE(c.Archived, 0) = 0
                   AND (c.Target_Course IS NULL OR TRIM(c.Target_Course) = '' OR TRIM(c.Target_Course) COLLATE NOCASE = ?)
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
        const r = await enrollStudent(env, body.courseId, body.studentId);
        if (r.error) return new Response(JSON.stringify({ error: r.error }), { status: 400, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, reactivated: r.reactivated }), { status: 201, headers: corsHeaders });
    }

    // A student joins a class with the invite code the lecturer gave them.
    if (request.method === "POST" && path === "/api/join-class") {
        const body = await request.json();
        const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const me = await env.DB.prepare("SELECT role FROM Users WHERE User_ID = ?").bind(body.studentId || "").first();
        if (!me || String(me.role).toLowerCase() !== "student") {
            return new Response(JSON.stringify({ error: "Only students can join with a code." }), { status: 403, headers: corsHeaders });
        }
        await ensureInviteCode(env);
        const crs = code.length >= 6 ? await env.DB.prepare("SELECT Course_ID, CourseCode, CourseTitle FROM Courses WHERE Invite_Code = ? AND COALESCE(Archived, 0) = 0").bind(code).first() : null;
        if (!crs) return new Response(JSON.stringify({ error: "That code is not valid. Check it with your lecturer." }), { status: 404, headers: corsHeaders });
        const r = await enrollStudent(env, crs.Course_ID, body.studentId);
        if (r.error) return new Response(JSON.stringify({ error: r.error }), { status: 400, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, reactivated: r.reactivated, course: { Course_ID: crs.Course_ID, CourseCode: crs.CourseCode, CourseTitle: crs.CourseTitle } }), { status: 201, headers: corsHeaders });
    }

    // The class owner reads (or renews) the invite code.
    if (path === "/api/class-invite" && (request.method === "GET" || request.method === "POST")) {
        const body = request.method === "POST" ? await request.json() : {};
        const courseId = request.method === "POST" ? body.courseId : url.searchParams.get("courseId");
        await ensureInviteCode(env);
        const crs = await env.DB.prepare("SELECT Course_ID, Invite_Code FROM Courses WHERE Course_ID = ?").bind(courseId || "").first();
        if (!crs) return new Response(JSON.stringify({ error: "Class not found." }), { status: 404, headers: corsHeaders });
        let code = crs.Invite_Code;
        if (!code || body.renew) code = (await setInviteCode(env, crs.Course_ID)) || code;
        return new Response(JSON.stringify({ success: true, code }), { status: 200, headers: corsHeaders });
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
        await ensureReactivationColumns(env);
        const courseId = url.searchParams.get("courseId");
        if (!courseId) {
            return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers: corsHeaders });
        }

        const course = await env.DB.prepare("SELECT * FROM Courses WHERE Course_ID = ?").bind(courseId).first();
        if (!course) {
            return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: corsHeaders });
        }

        const students = await env.DB.prepare(
            `SELECT u.User_ID, u.Name, u.Avatar, u.Student_Number, u.course, u.year, u.section, u.Program_Course, u.Program_Year, u.Program_Section, u.Email, u.Contact_Number, u.eye_condition, u.account_status, u.Reactivation_Requested, e.Seat_Number, e.Group_Name, e.Assigned_Topic
             FROM Enrollments e
             JOIN Users u ON e.Student_ID = u.User_ID
             WHERE e.Course_ID = ?`
        ).bind(courseId).all();

        return new Response(JSON.stringify({ success: true, course: course, students: students.results }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "GET" && path === "/api/unenrolled-students") {
        const courseId = url.searchParams.get("courseId");
        // Manual enrolment by a lecturer works on the student's PROGRAM (course, year, section).
        const courseFilter = (url.searchParams.get("courseFilter") || "").trim();
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
            query += ` AND TRIM(COALESCE(Program_Course, '')) COLLATE NOCASE = ?`;
            params.push(courseFilter);
        }
        if (yearFilter) {
            query += ` AND TRIM(COALESCE(Program_Year, '')) COLLATE NOCASE = ?`;
            params.push(yearFilter);
        }
        if (sectionFilter) {
            query += ` AND TRIM(COALESCE(Program_Section, '')) COLLATE NOCASE = ?`;
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

    if (path === "/api/lecturer-notes") {
        // Lecturer-only (not listed in auth RULES) and courseId is checked against the lecturer's own classes.
        await ensureLecturerNotes(env);
        const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: corsHeaders });
        if (request.method === "GET") {
            const courseId = url.searchParams.get("courseId");
            const studentId = url.searchParams.get("studentId");
            if (!courseId) return out({ error: "Missing courseId" }, 400);
            if (!studentId) {
                const counts = await env.DB.prepare("SELECT Student_ID, COUNT(*) AS Total FROM Lecturer_Notes WHERE Course_ID = ? GROUP BY Student_ID").bind(courseId).all();
                return out({ success: true, counts: counts.results });
            }
            const notes = await env.DB.prepare("SELECT Note_ID, Body, Created_At, Updated_At FROM Lecturer_Notes WHERE Course_ID = ? AND Student_ID = ? ORDER BY Created_At DESC, rowid DESC").bind(courseId, studentId).all();
            return out({ success: true, notes: notes.results });
        }
        if (request.method === "POST" || request.method === "DELETE") {
            const b = await request.json().catch(() => ({}));
            const { courseId, studentId, noteId } = b;
            if (!courseId) return out({ error: "Missing courseId" }, 400);
            if (request.method === "DELETE") {
                if (!noteId) return out({ error: "Missing noteId" }, 400);
                await env.DB.prepare("DELETE FROM Lecturer_Notes WHERE Note_ID = ? AND Course_ID = ?").bind(noteId, courseId).run();
                return out({ success: true });
            }
            const text = String(b.body || '').trim().slice(0, 4000);
            if (!text) return out({ error: "Write something first." }, 400);
            if (noteId) {
                await env.DB.prepare("UPDATE Lecturer_Notes SET Body = ?, Updated_At = CURRENT_TIMESTAMP WHERE Note_ID = ? AND Course_ID = ?").bind(text, noteId, courseId).run();
                return out({ success: true, noteId });
            }
            if (!studentId) return out({ error: "Missing studentId" }, 400);
            const enrolled = await env.DB.prepare("SELECT 1 AS ok FROM Enrollments WHERE Course_ID = ? AND Student_ID = ?").bind(courseId, studentId).first();
            if (!enrolled) return out({ error: "That student is not in this class." }, 400);
            const course = await env.DB.prepare("SELECT Lecturer_ID FROM Courses WHERE Course_ID = ?").bind(courseId).first();
            const id = crypto.randomUUID();
            await env.DB.prepare("INSERT INTO Lecturer_Notes (Note_ID, Course_ID, Student_ID, Lecturer_ID, Body) VALUES (?, ?, ?, ?, ?)").bind(id, courseId, studentId, course ? course.Lecturer_ID : null, text).run();
            return out({ success: true, noteId: id }, 201);
        }
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

    return null;
}

