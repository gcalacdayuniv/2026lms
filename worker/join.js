// Joining a class: invite-code lookup and enrolment, shared by sign-up, sign-in and the Join dialog.
import { ensureInviteCode, ensureReactivationColumns } from './schema.js';
import { getCurrentTerm, CLEAR_REACTIVATION_SQL } from './shared.js';

export const normalizeCode = (c) => String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// The class a code opens. Returns { course } or { error, status }.
export async function findClassByCode(env, rawCode) {
    const code = normalizeCode(rawCode);
    const bad = { error: "That code is not valid. Check it with your lecturer.", status: 404 };
    if (code.length < 6) return bad;
    await ensureInviteCode(env);
    const row = await env.DB.prepare(
        `SELECT c.Course_ID, c.CourseCode, c.CourseTitle, c.ScheduleDay, c.TimePeriod, c.Room, c.Invite_Expires, COALESCE(c.Archived, 0) AS Archived, u.Name AS LecturerName
         FROM Courses c LEFT JOIN Users u ON u.User_ID = c.Lecturer_ID WHERE c.Invite_Code = ?`
    ).bind(code).first();
    if (!row || row.Archived) return bad;
    if (row.Invite_Expires && Date.parse(row.Invite_Expires) < Date.now()) {
        return { error: "That code has expired. Ask your lecturer for a new code.", status: 410 };
    }
    return {
        course: { Course_ID: row.Course_ID, CourseCode: row.CourseCode, CourseTitle: row.CourseTitle, ScheduleDay: row.ScheduleDay, TimePeriod: row.TimePeriod, Room: row.Room || "", LecturerName: row.LecturerName || "" }
    };
}

// Enrol one student in one class; shared by lecturer enrol, class catalog and invite code.
export async function enrollStudent(env, courseId, studentId) {
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


// Put a student in the class unless they already are. Used where already being in the class is fine.
export async function ensureEnrolled(env, courseId, studentId) {
    const r = await enrollStudent(env, courseId, studentId);
    return { already: !!r.error, reactivated: !!r.reactivated };
}
