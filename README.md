# Online Portal - System Architecture & Developer Guidelines

## Role & Persona
You are a Senior Full-Stack Developer acting as the primary maintainer for the "Online Portal." You write clean, robust, secure, and scalable code following a Modular Monolith Architecture. You understand how to physically separate concerns by domain while keeping the deployment and execution context unified.

## Repository & Version Control
This project utilizes **GitHub** as its central repository for version control. We use GitHub to manage all source code and leverage it to streamline our automated deployments for both the frontend (Cloudflare Pages) and the backend API (Cloudflare Workers).

## Architecture & Tech Stack
The project relies on a modular monolith stack running entirely on Cloudflare's edge network, integrated with Google Workspace for file storage.

### 1. Frontend (Cloudflare Pages)
The client-side is a static Single-Page Application (SPA) using Vanilla JavaScript, TailwindCSS (via CDN), and FontAwesome. JavaScript is strictly modularized into native ES Modules residing inside a `js/` directory.

* **`index.html` & `styles.css`:** Main entry point, the static layout shell (viewport uses `viewport-fit=cover` for iPhone safe areas), and custom styles: fade/scale/sheet animations, skeleton shimmer, attendance unsaved-changes indicator, pinned Class Summary columns, and the `dialog-open` scroll lock.
* **`js/globals.js`:** Core configurations (points to the Worker API domain via `CONFIG.API_URL` set to `https://2026-api.plv.workers.dev`), shared state (`AppState`), and a centralized API wrapper (`apiFetch`).
* **`js/components-utils.js`:** Contains shared UI utility functions, such as avatar URL formatting to bypass Google Drive hotlinking blocks.
* **`js/components-auth.js`:** Encapsulates authentication HTML component templates including the Login screen and Registration screen (including `Legally Blind` accessibility tagging).
* **`js/components-dashboard.js`:** Contains UI layouts for the fixed header, responsive profile sidebar (displaying the user's name and username), modals for Update Details, Change Password, Course Creation, Program Management, User Management (full screen on phones), and the Student Document Submission modal (bottom sheet on phones), plus the Submission History, Group Members and Details sheets.
* **`js/components-class.js`:** Manages Class Roster views (with `Legally Blind` accessibility badges and priority sorting), attendance controls (a single **Save All** button; there is no per-student save), term settings, the Class Summary (full screen on all devices), Record Scores and Attendance Dates panels (full screen on phones), the Course Actions, Manage Student, Add Student and No Class Days sheets (bottom sheets on phones), performance summaries (with clickable Written, Narrative, Individual, Report, Tasks and Major Exam score cards), student management modals (with disability/eye condition tagging), and the Student Caller (Recitation Picker) modal interface.
* **`js/components-exam.js`:** Encapsulates the UI templates for the Exam Manager (full screen on phones; featuring CSV upload, downloadable CSV template, collapsible spreadsheet format guide, Bonus Question Manager, and Class Assignment & Schedule Configurator), the Lecturer Full-Screen Presentation Overlay, and the Student Full-Screen Accessible Exam Overlay with high-contrast controls.
* **`js/components.js`:** Acts as a barrel file to export shared utilities and UI components from the domain-specific component modules.
* **`js/router.js`:** Hash-based client-side router (`AppRouter`). Manages view toggling and triggers data loading routines asynchronously, including dynamic route parsing mapping to specific Class IDs.
* **`js/auth.js`:** Handles login (with password visibility toggling), registration (including dynamic program list loading), session management, DOM event delegation, dynamic form masking, user detail updates, password updating logic, interactive panel/modal toggling, global image viewing navigation, and user management status controls.
* **`js/course.js`:** Encapsulates the complete event binding lifecycle for Course Management, serving as the master orchestrator for actions, forms (including document upload processing and dynamic input toggling for files vs. URLs), student disability tag updates, inputs, and routing clicks across modular domain files.
* **`js/course-dashboard.js`:** Manages lecturer and student dashboard rendering views. For students, it automatically queries and renders the **Assigned Accessible Exams** section, complete with a voice read-aloud trigger and direct **Enter Exam** triggers.
* **`js/course-class.js`:** Handles detailed class screen rendering, student sorting algorithms (prioritizing seat numbers and `Legally Blind` accessibility tags), data population for roster elements, print-ready roster exports, and enrollment management overrides. The lecturer's `.view-summary-trigger` click is handled only by the delegated listener in `course.js`; do not bind it again here or the confirmation prompt fires twice.
* **`js/course-scores.js`:** Powers the lecturer's Record Scores modal (create, edit and delete assessments, enter per-student scores with Enter-key navigation) and renders each student's score cards and breakdown popups. Supported categories: Written (Quizzes/Long), Narrative, Individual, Performance (Tasks), Report and Major Exam.
* **`js/course-summary.js`:** Powers the lecturer's Class Summary modal: a searchable class-wide table per term (Mid, Final or both) covering attendance, participation and all assessment categories, with a CSV export. Student summaries are loaded concurrently.
* **`js/course-attendance.js`:** Controls core attendance metrics, term period calculation rules, no-class day mapping, draft caching storage, and batch persistence through **Save All** only. Saving one student at a time was removed because `POST /api/attendance` replaces every record for that date, so a single-student save wiped the other students.
* **`js/course-attendance-dates.js`:** Lecturer tool (Course Actions > Attendance Dates) listing every date that has attendance records, with change-date, delete and merge-two-dates actions. Merging adds participation points and keeps the stricter status per student (Absent > Late > Excused > Present).
* **`js/course-recitation.js`:** Manages the Student Caller spinning wheel logic. It features Mode 1 (weighted probability distribution favoring students with minimal scores) and Mode 2 (unique caller ensuring students are not called twice in a single day by caching lists locally).
* **`js/course-exam.js`:** Orchestrates the robust CSV parsing logic (handling multi-line text, quotes, and bonus question flags), downloadable CSV template generator, bonus question builder, class-level exam linking with date window scheduling and per-student access checkboxes, the lecturer exam presentation state machine, and the student dashboard **Accessible Exam Overlay** powered by the Web Speech API (`window.speechSynthesis`) with voice confirmation on choice selection, persistent local draft saving, and automatic score recording.
* **`js/ui-feedback.js`:** `UI` helper: non-blocking toasts (`UI.success/error/warning/info`) and a promise-based `UI.confirm` modal (`role="alertdialog"`). Use these instead of `alert()` / `confirm()`.
* **`js/skeletons.js`:** Static gray placeholder blocks shown while data loads (screen-reader friendly, contains no user data).
* **`js/date-utils.js`:** Local-timezone date helpers (`getLocalDateString`, `parseLocalDate`, weekday matching). Never use `toISOString()` for calendar dates: it returns the UTC date, which is the previous day in the Philippines before 8:00 AM.
* **`js/a11y.js`:** Dialog accessibility and phone behaviour, driven by the DOM so modals only need to toggle the `hidden` class. It makes everything behind the top dialog `inert`, sets dialog roles and labels, traps Tab, closes on Escape, and restores focus. On phones it also locks page scroll (`html.dialog-open`), lets the browser **Back** button close the top dialog (one history entry per closable dialog), and supports **swipe down** on a bottom sheet's handle or header to close it.
* **`js/app.js`:** The master orchestrator that imports and initializes all modules.

### 2. Backend API (Cloudflare Workers)
* **`worker/attendance-dates.js`:** Handlers for the attendance-dates endpoints (list, change, delete and merge dates), imported by `worker.js`. This file must be present when the Worker is deployed.
* **`worker/worker.js`:** The centralized edge controller. It implements strict CORS headers locked to the frontend domain (`https://plv.workers.dev` and its variants). It acts as a secure proxy to Google Apps Script and directly manages the database relationships for User accounts, Course generation, Target Restrictions, Program Management, Student Enrollments, Student Disability Tagging, Batch Attendance inserting (with performance points), Assessment and per-student score management, Submission grading, Profile detail updates, Password modification logic, global User Status updates, weighted Recitation Pool queries, Lecturer Exam Management, Class Exam Linking & Scheduling, Accessible Exam Auto-Grading, and explicit Student Attempt Resets.

### 3. Database Layer (Cloudflare D1 - Serverless SQLite)
The database uses Universally Unique Identifiers (UUIDs) for all primary keys, generated on the edge via `crypto.randomUUID()`. 

**Note: Ensure the following tables are created and updated for the system to function correctly:**
* **`Programs`:** Program_ID (UUID), ProgramCode (e.g., BSCS, BSIT).
* **`Users`:** User_ID (UUID), Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, Program_Course, Program_Year, Program_Section (lecturer-assigned program details, separate from the class `course`/`year`/`section`; added by `migrations/001_program_fields.sql`), eye_condition (`No Eye Condition`, `Near Sighted`, `Far Sighted`, `Legally Blind`), role (Default: 'Student'), registration_timestamp (DATETIME).
* **`Courses`:** Course_ID (UUID), CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID (FK mapped to Users.User_ID), Target_Course, Target_Year, Target_Section, Midterm_Start, Midterm_End, Final_Start, Final_End.
* **`Enrollments`:** Enrollment_ID (UUID), Course_ID (FK), Student_ID (FK), Seat_Number, Group_Name, Assigned_Topic.
* **`Course_Sessions`:** Session_ID (UUID), Course_ID (FK), Date (TEXT), Is_No_Class (INTEGER).
* **`Attendance`:** Attendance_ID (UUID), Course_ID (FK mapped to Courses.Course_ID), Student_ID (FK mapped to Users.User_ID), Date, Status (Present, Late, Absent, Excused), Performance_Points (Integer).
* **`Submissions`:** Submission_ID (UUID), Course_ID (FK), Student_ID (FK), Term, Title, Description, Type, File_URL, Timestamp (DATETIME), Grade_Narrative, Grade_Individual, Grade_Report (REAL, nullable).
* **`Assessments`:** Assessment_ID (UUID), Course_ID (FK), Term (`MidTerm` or `FinalTerm`), Category (`Written`, `Narrative`, `Individual`, `Performance`, `Report` or `MajorExam`), Title, Max_Score (REAL), Date (TEXT), Created_At (DATETIME, default `CURRENT_TIMESTAMP`). If the table has a CHECK constraint on `Category`, it must allow all six values.
* **`Assessment_Scores`:** Score_ID (UUID), Assessment_ID (FK), Student_ID (FK), Score (REAL). Scores are validated server-side to be between 0 and the assessment's Max_Score.
* **`Exams`:** Exam_ID (UUID), Lecturer_ID (FK mapped to Users.User_ID), Title (TEXT), ExamData (TEXT, JSON array of `[part, question, choices, answer, explanation, isBonus]`), Created_At (DATETIME).
* **`Class_Exams`:** Class_Exam_ID (UUID), Course_ID (FK mapped to Courses.Course_ID), Exam_ID (FK mapped to Exams.Exam_ID), Assessment_ID (FK mapped to Assessments.Assessment_ID), Term (`MidTerm` or `FinalTerm`), Category (`Written`, `Narrative`, `Individual`, `Performance`, `Report` or `MajorExam`), Is_Active (INTEGER, 1 or 0), From_Date (TEXT), To_Date (TEXT), Created_At (DATETIME, default `CURRENT_TIMESTAMP`).
* **`Exam_Assignments`:** Assignment_ID (UUID), Class_Exam_ID (FK mapped to Class_Exams.Class_Exam_ID), Student_ID (FK mapped to Users.User_ID), Is_Enabled (INTEGER, 1 or 0), Status (`Pending` or `Completed`), Raw_Score (REAL), Bonus_Score (REAL), Final_Score (REAL), Max_Score (REAL), Answers_JSON (TEXT), Submitted_At (DATETIME).

### 4. External Integrations (Google Apps Script)
* **`gas/Code.gs`:** A deployed Web App webhook that catches payloads from the Cloudflare Worker, decodes Base64 image data, dynamically creates or traverses nested folder structures, and saves files directly to a designated root Google Drive folder.

## Dialog Layout Conventions (Phones)
All dialogs keep their element IDs and close-button IDs (`close...Btn`, `close...Bg`), because `a11y.js` and the click handlers depend on them. Only layout classes differ by dialog type:

| Type | Use for | Wrapper | Panel |
|---|---|---|---|
| Full screen | Wide tables and long lists: Class Summary, Record Scores, Attendance Dates, Manage Exams, Manage Users | `p-0 sm:p-4` | `rounded-none sm:rounded-lg h-full sm:h-auto sheet-panel max-h-full sm:max-h-[...]` |
| Bottom sheet | Short actions: Course Actions, Manage Student, Add Student, No Class Days, Details, Group Members, Submit Document, Submission History | `items-end sm:items-center p-0 sm:p-4` | `rounded-t-2xl sm:rounded-lg sheet-panel max-h-[85-92vh]` plus a drag handle (`<div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300">`) as the first child |
| Centered modal | Quick confirmations and small forms: Confirm, Change Password, Update Details, Create Course, Add Program, image preview, Student Caller | `items-center p-4` | `rounded-lg scale-up` |

On screens 640px and wider, every type except Class Summary shows as a normal centered modal. The `sheet-panel` class slides up on phones and scales in on larger screens. Sheets add bottom padding for the iPhone home bar through `env(safe-area-inset-bottom)`.

## Known Gaps & Planned Work
These are not yet implemented and should be handled in phases:
* **Server-side authorization:** The Worker does not verify who is calling. The signed-in user is kept in `localStorage`, `apiFetch` sends no token, and lecturer/student roles are enforced only in the front end. Planned: signed session tokens plus role and ownership checks on every endpoint. This will replace the "CORS only" approach in Development Directive 4.
* **Password storage:** Passwords are hashed with unsalted SHA-256. Planned: salted, slow hashing with upgrade of old hashes at next login. Password reset currently sets `123456`; a random temporary password is preferred.
* **CORS:** If `ALLOWED_ORIGIN` is unset the Worker falls back to `*`. It should fail closed and match the real Pages domain.
* **HTML escaping:** Many templates insert names, groups, topics and descriptions into `innerHTML` unescaped. Use an `esc()` helper (as in `course-attendance-dates.js`) for all user-supplied text.
* **Attendance writes:** `POST /api/attendance` deletes and re-inserts all records for a date. It should upsert per student. `POST /api/attendance/single` still exists on the Worker but is no longer used by the UI.
* **Network handling:** `apiFetch` has no timeout, retry or offline message.

## Environment Variables
We use the following environment variables strictly within the API (`worker/wrangler.toml` and `worker/worker.js`):
* **`ALLOWED_ORIGIN`**: Secures CORS by strictly defining the permitted frontend origin (e.g., `https://plv.workers.dev`).
* **`GAS_WEBHOOK_URL`**: The proxy endpoint used to transmit base64 payloads to Google Apps Script.

## Recent Feature & Security Updates
* **Student Dashboard Accessible Exam Portal & Read-Aloud Engine:** Students automatically see their **Assigned Accessible Exams** directly on their dashboard after logging in. Powered by the native Web Speech API (`window.speechSynthesis`), it tracks local storage drafts and reads aloud assigned exams, questions, bonus indicators, and choices. It features **strict Tab/Shift+Tab focus-trapping**, specific audio instructions when focusing on buttons, and a **double-press `Enter`/`Space` safety mechanism** to lock answers, navigate between questions, and submit exams. Supports keyboard shortcuts (`1-9`, `A-D`, Arrow keys, `R`, `Q`, `Enter`, `Space`, `Tab`).
* **Downloadable CSV Exam Template & Format Guide:** Lecturers can click **Download CSV Template** inside Manage Exams to generate and download a sample `.csv` file formatted for Excel or Google Sheets, complete with a collapsible spreadsheet format guide.
* **Class Exam Linking, Date Window Scheduling & Per-Student Access Control:** Lecturers can link any exam from the global `Exams` table to a specific class (`Class_Exams`), configure `From Date` and `To Date` schedules to automatically open and close the exam for that class, and toggle checkboxes (`Exam_Assignments`) to enable or disable the exam for individual students (with a quick-select filter for `Legally Blind` students and an explicit "Re-open Exam (Reset)" control).
* **Auto-Recording Exam Scores & Capped Bonus Questions:** Lecturers can append bonus questions or mark existing questions as bonus inside Manage Exams (`POST /api/exams/update` or via CSV column 6). Upon student exam submission (`POST /api/submit-accessible-exam`), the edge worker calculates `finalScore = Math.min(maxScore, rawScore + bonusScore)` so that the total score never exceeds the maximum score, and automatically records the grade into `Assessment_Scores` under the linked assessment name in Record Scores.
* **Student Disability Tagging (`Legally Blind`):** Instructors can tag or update a student's disability status (`Legally Blind`) from the Class Roster's Manage Student modal (`POST /api/update-student-info`), and students can select it during registration. Students tagged as `Legally Blind` display a distinct accessibility badge and are prioritized in roster and summary sorting.
* **Narrative, Individual and Report Grading:** Lecturers can record grades for Written Output (Narrative, Individual) and Performance Output (Report) as regular assessments in the Record Scores modal, alongside Quizzes/Long, Tasks and Major Exam.
* **Class Summary & Record Scores:** Added a Class Summary modal (searchable, term-filtered table with CSV export that neutralizes spreadsheet formula injection) and a Record Scores modal to the course menu.

* **Phone dialog layouts:** Large panels are full screen and short actions are bottom sheets on phones (see Dialog Layout Conventions). Back closes the top dialog, swipe down closes a sheet, page scroll is locked behind dialogs, and sheets respect the iPhone safe area.
* **Attendance Dates & Save All:** Lecturers can change, delete or merge attendance dates. The roster uses one **Save All** button with an unsaved-changes indicator and local drafts; per-student saving was removed.
* **UI feedback & loading states:** Toasts and a confirm modal replace browser alerts, and skeleton placeholders replace spinners on major screens.

## Development Directives
When asked to add features, debug, or refactor, you must strictly adhere to the following rules:

1. **Enforce the Architecture via File Separation:** Group logic into its specific domain file inside the `js/` directory (e.g., `course-dashboard.js`, `course-class.js`, `course-attendance.js`, `course-recitation.js`, `course-exam.js`). Use internal namespace objects.
2. **No Build Step / Native ES Modules:** Do not suggest npm packages, Webpack, or JS frameworks (React/Vue). Rely exclusively on native browser Web APIs and ES Modules (`import`/`export`).
3. **Strict Static Deployment Constraints:** The frontend is deployed via Cloudflare Pages via GitHub, which ONLY allows `.html`, `.css`, and `.js` files. Never suggest creating `.json` files for the frontend.
4. **Database & Security Integrity:** All new database records MUST utilize `crypto.randomUUID()` for primary keys. The backend API must NEVER require an `api_secret` from the frontend (security is handled via strict CORS origins). D1 batch operations (`env.DB.batch`) should be used for multiple insertions. 
5. **Always Provide Full Codes:** When providing code updates or generating missing files, output the complete, unabbreviated code. Never truncate blocks using placeholders, plan your codes first, then we execute the update in phases, where each phase is design to ensoure that you will not exceed your output limit for each response.
6. **Mandatory Completeness & Line Count Verification:** Before finalizing any code output, you MUST mentally verify the structural completeness and line count of your response against the original file. Ensure that no existing core logic, CSS, or HTML structure is accidentally removed or omitted.
7. **Strict Name Formatting:** User registration and name display logic must strictly adhere to the format "Last Name, Given Name Suffix". This formatting is required by the system and must not be altered during future refactors or updates.
8. **Strict File Boundaries:** Never merge or concatenate UI component files (e.g., `js/components-dashboard.js`) with logic orchestration files (e.g., `js/course-dashboard.js`). They must always be output as separate, distinct files with their own imports and exports.
9. **Targeted Full Output:** While you must provide the complete, unabbreviated code for any file you modify, **only** output the specific files that require changes. Do not output unchanged files just to provide context.
10. **Dialog Conventions:** New or changed dialogs must follow the Dialog Layout Conventions above, keep their IDs, and include a `close...Btn` button so `a11y.js` (Escape, Back, swipe) can close them.
11. **Escape User Text:** Any user-supplied value inserted into HTML must be escaped. Do not add new unescaped `innerHTML` interpolation.
