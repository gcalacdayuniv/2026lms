// worker/schema.js
// Every table, column and index the Worker creates for itself, in one place. Each function runs its SQL once per
// Worker start (a flag remembers it) and is called from worker.js before the routes that need that table.
// The tables that already exist in D1 (Users, Courses, Enrollments, Attendance, Assessments and so on) are not created here.

let scanTablesReady = false;
export async function ensureScanTables(env) {
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
    scanTablesReady = true;
}

let loginTableReady = false;
export async function ensureLoginTable(env) {
    if (loginTableReady) return;
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Login_Attempts (Attempt_Key TEXT PRIMARY KEY, Fails INTEGER NOT NULL, First_At INTEGER NOT NULL)").run();
    loginTableReady = true;
}

// Per-user settings that follow the person to any device (for now: the preferred paper size).
export async function ensureUserPrefs(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS User_Prefs (User_ID TEXT PRIMARY KEY, Paper TEXT, Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
}

// Settings an admin lecturer sets for the whole school (for example the current academic term).
export async function ensureAppSettings(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS App_Settings (Key TEXT PRIMARY KEY, Value TEXT, Updated_By TEXT, Updated_At DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
}

// An exam its owner shares with other lecturers (they can see, print, copy and assign it, but not change it).
export async function ensureExamShares(env) {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Exam_Shares (Exam_ID TEXT NOT NULL, Lecturer_ID TEXT NOT NULL, Shared_At DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (Exam_ID, Lecturer_ID))").run();
}

export async function ensureAccessibleExamTables(env) {
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
let yearAdvanceReady = false;
export async function ensureYearAdvanceTables(env) {
    if (yearAdvanceReady) return;
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Year_Advance_Batches (Batch_ID TEXT PRIMARY KEY, Academic_Year TEXT, Max_Year INTEGER, Lecturer_ID TEXT, Advanced INTEGER, Applied_At TEXT, Undone INTEGER DEFAULT 0)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Year_Advance_Log (Log_ID TEXT PRIMARY KEY, Batch_ID TEXT NOT NULL, User_ID TEXT NOT NULL, Old_Year TEXT, New_Year TEXT, Old_Program_Year TEXT, New_Program_Year TEXT)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_year_log_batch ON Year_Advance_Log (Batch_ID)").run();
    for (const col of ["Old_Status TEXT", "New_Status TEXT"]) {
        try { await env.DB.prepare(`ALTER TABLE Year_Advance_Log ADD COLUMN ${col}`).run(); } catch (e) { /* already there */ }
    }
    yearAdvanceReady = true;
}

// Lecturer's private notes per student per class. Never returned by any student-facing route.
let lecturerNotesReady = false;
export async function ensureLecturerNotes(env) {
    if (lecturerNotesReady) return;
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS Lecturer_Notes (Note_ID TEXT PRIMARY KEY, Course_ID TEXT NOT NULL, Student_ID TEXT NOT NULL, Lecturer_ID TEXT, Body TEXT NOT NULL, Created_At TEXT DEFAULT CURRENT_TIMESTAMP, Updated_At TEXT DEFAULT CURRENT_TIMESTAMP)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lnotes_course_student ON Lecturer_Notes (Course_ID, Student_ID)").run();
    lecturerNotesReady = true;
}

// Students moved up by Advance Year Level are set Inactive until reactivated. These Users columns track that:
//   Advanced_Term: the academic year they were advanced into; Reactivation_Until: last day they may request reactivation (optional);
//   Reactivation_Requested: when they asked at the login screen. Only "Active" accounts can sign in.
let reactivationReady = false;
export async function ensureReactivationColumns(env) {
    if (reactivationReady) return;
    for (const col of ["Advanced_Term TEXT", "Reactivation_Until TEXT", "Reactivation_Requested TEXT"]) {
        try { await env.DB.prepare(`ALTER TABLE Users ADD COLUMN ${col}`).run(); } catch (e) { /* already there */ }
    }
    reactivationReady = true;
}

// Invite code a lecturer gives students so they can join a class themselves.
// Letters and digits that are hard to mix up (no 0/O, 1/I).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newInviteCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
};

// Sets a fresh unique code on one class and returns it ('' if it could not).
export async function setInviteCode(env, courseId) {
    for (let i = 0; i < 8; i++) {
        const c = newInviteCode();
        try { await env.DB.prepare("UPDATE Courses SET Invite_Code = ? WHERE Course_ID = ?").bind(c, courseId).run(); return c; } catch (e) { /* clashed with another class: try again */ }
    }
    return "";
}

// Adds the column once and gives EVERY class that has no code one (existing classes included).
let inviteReady = false;
export async function ensureInviteCode(env) {
    if (inviteReady) return;
    try { await env.DB.prepare("ALTER TABLE Courses ADD COLUMN Invite_Code TEXT").run(); } catch (e) { /* already there */ }
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_invite ON Courses (Invite_Code)").run();
    const missing = (await env.DB.prepare("SELECT Course_ID FROM Courses WHERE Invite_Code IS NULL OR TRIM(Invite_Code) = ''").all()).results || [];
    for (const r of missing) await setInviteCode(env, r.Course_ID);
    inviteReady = true;
}

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
let courseRoomReady = false;
export async function ensureCourseRoom(env) {
    if (courseRoomReady) return;
    // Archived = 1: the lecturer put the class away (hidden from the main list, nothing deleted).
    for (const col of ["Room TEXT", "Archived INTEGER", "AcademicYear TEXT", "Semester TEXT"]) {
        try {
            await env.DB.prepare(`ALTER TABLE Courses ADD COLUMN ${col}`).run();
        } catch (err) {
            if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
    }
    courseRoomReady = true;
}
