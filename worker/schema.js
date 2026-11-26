import { ensureExamSecurity } from './exam-photos.js';
// worker/schema.js
// Every table, column and index the Worker creates for itself, in one place. Each function runs its SQL once per
// Worker start (a flag remembers it) and is called from worker.js before the routes that need that table.
// The tables that already exist in D1 (Users, Courses, Enrollments, Attendance, Assessments and so on) are not created here.

// Runs a table setup once per Worker instance: concurrent callers share one run, and a failed run is tried again next time.
function once(setup) {
    let done = false, running = null;
    return async (env) => {
        if (done) return;
        if (!running) running = Promise.resolve(setup(env)).then(() => { done = true; }).finally(() => { running = null; });
        await running;
    };
}

export const ensureScanTables = once(async (env) => {
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
    // Set_Keys = key and bonus flags of every printed exam set (index 0 = Set A), used to grade each sheet by its set.
    try {
        await env.DB.prepare("ALTER TABLE Scan_Sessions ADD COLUMN Set_Keys TEXT").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    // Set_No = which printed set the student shaded on the sheet (0 = A, 1 = B ...).
    try {
        await env.DB.prepare("ALTER TABLE Scan_Sheets ADD COLUMN Set_No INTEGER DEFAULT 0").run();
    } catch (err) {
        if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
    // Layout = answer cells of a mixed-question-type sheet (null for a plain multiple-choice sheet);
    // Marks = points the lecturer typed for questions marked by hand on one sheet.
    for (const [table, col] of [["Scan_Sessions", "Layout"], ["Scan_Sheets", "Marks"]]) {
        try {
            await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`).run();
        } catch (err) {
            if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
    }
});

export const ensureLoginTable = once(async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Login_Attempts (Attempt_Key TEXT PRIMARY KEY, Fails INTEGER NOT NULL, First_At INTEGER NOT NULL)").run();
});

// Per-user settings that follow the person to any device (for now: the preferred paper size).
export async function ensureUserPrefs(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS User_Prefs (User_ID TEXT PRIMARY KEY, Paper TEXT, Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
}

// A student who forgot their password asks their lecturer for a reset (one open request per student).
export async function ensurePasswordResetRequests(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Password_Reset_Requests (User_ID TEXT PRIMARY KEY, Requested_At TEXT)").run();
}

// Settings an admin lecturer sets for the whole school (for example the current academic term).
export async function ensureAppSettings(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS App_Settings (Key TEXT PRIMARY KEY, Value TEXT, Updated_By TEXT, Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
}

// One time: students no longer have a separate class course/year/section (the class carries it).
// Any program value still blank is filled from the old class value first, so nothing is lost.
export async function clearStudentClassFields(env) {
    await ensureAppSettings(env);
    const done = await env.DB.prepare("SELECT Value FROM App_Settings WHERE Key = 'class_fields_cleared'").first();
    if (done) return;
    await env.DB.batch([
        env.DB.prepare("UPDATE Users SET Program_Course = course WHERE (Program_Course IS NULL OR Program_Course = '') AND course IS NOT NULL AND course != ''"),
        env.DB.prepare("UPDATE Users SET Program_Year = year WHERE (Program_Year IS NULL OR Program_Year = '') AND year IS NOT NULL AND year != ''"),
        env.DB.prepare("UPDATE Users SET Program_Section = section WHERE (Program_Section IS NULL OR Program_Section = '') AND section IS NOT NULL AND section != ''"),
        env.DB.prepare("UPDATE Users SET course = NULL, year = NULL, section = NULL"),
        env.DB.prepare("INSERT OR REPLACE INTO App_Settings (Key, Value, Updated_By) VALUES ('class_fields_cleared', '1', 'system')")
    ]);
}

// An exam its owner shares with other lecturers (they can see, print, copy and assign it, but not change it).
export async function ensureExamShares(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Exam_Shares (Exam_ID TEXT NOT NULL, Lecturer_ID TEXT NOT NULL, Shared_At DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (Exam_ID, Lecturer_ID))").run();
}

export async function ensureAccessibleExamTables(env) {
    await ensureCourseRoom(env);   // exam queries check Courses.Archived
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
    await ensureExamSecurity(env);   // Exam_Photos, Users.Exam_Secure, Exam_Assignments.Submit_Reason
}

// Columns added after the first release. Each is added once to an existing database.
//   Manual_Marks: essay marks given by the lecturer, JSON { "<question index>": points }
//   Time_Limit:   minutes allowed for the exam (empty = no limit)
//   Started_At:   when the student opened the exam (ISO time), used for the countdown
const EXTRA_COLUMNS = [
    ["Exam_Assignments", "Manual_Marks", "TEXT"],
    ["Exam_Assignments", "Started_At", "TEXT"],
    ["Class_Exams", "Time_Limit", "INTEGER"],
    ["Class_Exams", "Adjustments", "TEXT"],   // JSON { "<question index>": "credit" | "drop" }
    ["Class_Exams", "Release", "INTEGER"],    // 1 = students may review their answers and the right answers
    ["Exams", "Archived", "INTEGER"],         // 1 = hidden from the lecturer's exam list (kept, can be restored)
    ["Exams", "Course", "TEXT"]               // course line printed on the question paper, answer key and answer sheet
];
let extraColumnsChecked = false;
export async function ensureManualMarksColumn(env) {
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

// Year-level advance: moves every student up one year level (Users.year, which drives class targeting, and
// Program_Year). Each run is logged per student so the latest run can be undone.
export const ensureYearAdvanceTables = once(async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Year_Advance_Batches (Batch_ID TEXT PRIMARY KEY, Academic_Year TEXT, Max_Year INTEGER, Lecturer_ID TEXT, Advanced INTEGER, Applied_At TEXT, Undone INTEGER DEFAULT 0)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Year_Advance_Log (Log_ID TEXT PRIMARY KEY, Batch_ID TEXT NOT NULL, User_ID TEXT NOT NULL, Old_Year TEXT, New_Year TEXT, Old_Program_Year TEXT, New_Program_Year TEXT)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_year_log_batch ON Year_Advance_Log (Batch_ID)").run();
    for (const col of ["Old_Status TEXT", "New_Status TEXT"]) {
        try { await env.DB.prepare(`ALTER TABLE Year_Advance_Log ADD COLUMN ${col}`).run(); } catch (e) { /* already there */ }
    }
});

// Lecturer's private notes per student per class. Never returned by any student-facing route.
export const ensureLecturerNotes = once(async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Lecturer_Notes (Note_ID TEXT PRIMARY KEY, Course_ID TEXT NOT NULL, Student_ID TEXT NOT NULL, Lecturer_ID TEXT, Body TEXT NOT NULL, Created_At TEXT DEFAULT CURRENT_TIMESTAMP, Updated_At TEXT DEFAULT CURRENT_TIMESTAMP)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lnotes_course_student ON Lecturer_Notes (Course_ID, Student_ID)").run();
});

// Students moved up by Advance Year Level are set Inactive until reactivated. These Users columns track that:
//   Advanced_Term: the academic year they were advanced into; Reactivation_Until: last day they may request reactivation (optional);
//   Reactivation_Requested: when they asked at the login screen. Only "Active" accounts can sign in.
export const ensureReactivationColumns = once(async (env) => {
    for (const col of ["Advanced_Term TEXT", "Reactivation_Until TEXT", "Reactivation_Requested TEXT"]) {
        try { await env.DB.prepare(`ALTER TABLE Users ADD COLUMN ${col}`).run(); } catch (e) { /* already there */ }
    }
});

// Invite code a lecturer gives students so they can join a class themselves.
// Letters and digits that are hard to mix up (no 0/O, 1/I).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newInviteCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
};

// Sets a fresh unique code on one class and returns it ('' if it could not).
// An invite code works for 7 days; then the lecturer must make a new one.
export const INVITE_DAYS = 7;
export const inviteExpiryIso = (now = Date.now()) => new Date(now + INVITE_DAYS * 86400000).toISOString();

export async function setInviteCode(env, courseId, avoid = "") {
    for (let i = 0; i < 8; i++) {
        const c = newInviteCode();
        if (c === avoid) continue;   // a renewed code is always different from the one it replaces
        try { await env.DB.prepare("UPDATE Courses SET Invite_Code = ?, Invite_Expires = ? WHERE Course_ID = ?").bind(c, inviteExpiryIso(), courseId).run(); return c; } catch (e) { /* clashed with another class: try again */ }
    }
    return "";
}

// Adds the column once and gives EVERY class that has no code one (existing classes included).
export const ensureInviteCode = once(async (env) => {
    try { await env.DB.prepare("ALTER TABLE Courses ADD COLUMN Invite_Code TEXT").run(); } catch (e) { /* already there */ }
    try { await env.DB.prepare("ALTER TABLE Courses ADD COLUMN Invite_Expires TEXT").run(); } catch (e) { /* already there */ }
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_invite ON Courses (Invite_Code)").run();
    // Codes made before expiry existed get 7 days from now.
    await env.DB.prepare("UPDATE Courses SET Invite_Expires = ? WHERE Invite_Code IS NOT NULL AND Invite_Expires IS NULL").bind(inviteExpiryIso()).run();
    const missing = (await env.DB.prepare("SELECT Course_ID FROM Courses WHERE Invite_Code IS NULL OR TRIM(Invite_Code) = ''").all()).results || [];
    for (const r of missing) await setInviteCode(env, r.Course_ID);
});

// Indexes for the tables every class screen reads. Created once per Worker start; a table that does not exist yet
// (some are created on first use) is skipped and tried again on the next start. Plain indexes only, so existing data is never rejected.
let coreIndexesReady = false;
export async function ensureCoreIndexes(env) {
    if (coreIndexesReady) return;
    const list = [
        "CREATE INDEX IF NOT EXISTS idx_att_course_student_date ON Attendance (Course_ID, Student_ID, Date)",
        "CREATE INDEX IF NOT EXISTS idx_att_course_date ON Attendance (Course_ID, Date)",
        "CREATE INDEX IF NOT EXISTS idx_enr_course ON Enrollments (Course_ID, Student_ID)",
        "CREATE INDEX IF NOT EXISTS idx_enr_student ON Enrollments (Student_ID)",
        "CREATE INDEX IF NOT EXISTS idx_assess_course ON Assessments (Course_ID, Date)",
        "CREATE INDEX IF NOT EXISTS idx_ascore_assess ON Assessment_Scores (Assessment_ID, Student_ID)",
        "CREATE INDEX IF NOT EXISTS idx_sub_course_student ON Submissions (Course_ID, Student_ID)",
        "CREATE INDEX IF NOT EXISTS idx_sess_course ON Course_Sessions (Course_ID, Date)",
        "CREATE INDEX IF NOT EXISTS idx_courses_lecturer ON Courses (Lecturer_ID)",
        // Sign-in looks an account up by username, email, phone or student number (case-insensitive); without these every login scans the whole Users table.
        "CREATE INDEX IF NOT EXISTS idx_users_username ON Users (Username COLLATE NOCASE)",
        "CREATE INDEX IF NOT EXISTS idx_users_email ON Users (Email COLLATE NOCASE)",
        "CREATE INDEX IF NOT EXISTS idx_users_contact ON Users (Contact_Number)",
        "CREATE INDEX IF NOT EXISTS idx_users_studno ON Users (Student_Number COLLATE NOCASE)"
    ];
    let all = true;
    for (const sql of list) {
        try { await env.DB.prepare(sql).run(); } catch (e) { all = false; }
    }
    coreIndexesReady = all;
}

// Room = the classroom the class meets in. Added to an existing Courses table the first time it is needed.
export const ensureCourseRoom = once(async (env) => {
    // Archived = 1: the lecturer put the class away (hidden from the main list, nothing deleted).
    for (const col of ["Room TEXT", "Archived INTEGER", "AcademicYear TEXT", "Semester TEXT"]) {
        try {
            await env.DB.prepare(`ALTER TABLE Courses ADD COLUMN ${col}`).run();
        } catch (err) {
            if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
    }
});

// Group sets: several named sets of groups per class (for different activities). The "Reporting" set is not stored here;
// it is the existing Enrollments.Group_Name / Assigned_Topic. Every other set keeps one row per student in Group_Members.
export const ensureGroupTables = once(async (env) => {
    await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS Group_Sets (Set_ID TEXT PRIMARY KEY, Course_ID TEXT NOT NULL, Name TEXT NOT NULL, Created_At DATETIME DEFAULT CURRENT_TIMESTAMP)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_group_sets_course ON Group_Sets (Course_ID)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS Group_Members (Set_ID TEXT NOT NULL, Student_ID TEXT NOT NULL, Group_Name TEXT NOT NULL, Topic TEXT, PRIMARY KEY (Set_ID, Student_ID))")
    ]);
});

// A locked seat is skipped by auto-assignment (Seat Plan).
export const ensureSeatLock = once(async (env) => {
    try { await env.DB.prepare("ALTER TABLE Enrollments ADD COLUMN Seat_Locked INTEGER DEFAULT 0").run(); } catch (e) { /* already there */ }
});

// Online class days (the default is Onsite, no row): one row per course and date, with an optional proof picture kept in Google Drive.
export const ensureClassModes = once(async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Class_Modes (Course_ID TEXT NOT NULL, Date TEXT NOT NULL, Mode TEXT NOT NULL, Proof_File_ID TEXT, Updated_At TEXT, PRIMARY KEY (Course_ID, Date))").run();
});

// Course syllabus file (kept in Google Drive), learning plan topics and the date -> topic links (many to many).
export const ensureCoursePlan = once(async (env) => {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Course_Syllabus (Course_ID TEXT PRIMARY KEY, File_ID TEXT, File_Name TEXT, Mime_Type TEXT, Updated_At TEXT)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Plan_Topics (Topic_ID TEXT PRIMARY KEY, Course_ID TEXT NOT NULL, Sort_Order INTEGER, Time_Allot TEXT, Contents TEXT, Questions TEXT, Outcomes TEXT, Activities TEXT, Assessments TEXT, Refs TEXT, Updated_At TEXT)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_plan_topics_course ON Plan_Topics (Course_ID, Sort_Order)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Plan_Day_Links (Course_ID TEXT NOT NULL, Date TEXT NOT NULL, Topic_ID TEXT NOT NULL, PRIMARY KEY (Course_ID, Date, Topic_ID))").run();
});
