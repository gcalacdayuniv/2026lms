# Working Agreement (read this first)

This section is the standing instruction for every task. Keep it current when a new rule is agreed.

**How to work**
1. Plan briefly, then work in batches that stay within the token limit. Give the output of each batch so progress is not lost.
2. Commit and push finished work straight to `main` of the GitHub repo (no zip needed). Commit only after the tests pass, with a message that says what changed. If a push is refused, say so and send a zip of the changed files instead.
3. Test before delivering: worker changes against a local SQLite D1 test, UI changes in a browser (Playwright). Say what was tested and what was not.

**Delivery (every task)**
- Give full replacement files, never snippets.
- Commit and push the changed files to `main`; the commit includes the README update. Do not send a zip unless a push is not possible.
- Update the docs in the same commit. Write the new feature's notes (what, rules, tests, deploy) as a section at the END of `docs/FEATURES.md`, and file notes in `docs/FRONTEND.md` if a front-end file changed role. Keep this README small: change it only for setup, deploy, environment, standing rules or architecture. It must still match the current setup, including the "Setup & Deploy" notes: required secrets and vars, tables created automatically vs. anything to run manually, deploy steps for the worker and the front end, and any one-time action after an update.

**Code rules**
- The site is static files. Besides `.html/.css/.js`, only `manifest.webmanifest` and `icons/*.png` are allowed (the installable Android app). Replace the PNGs to change the Android icon.
- Keep existing element IDs. Escape all user text (`escapeHtml` / `safeUrl` in `js/html-utils.js`).
- `SESSION_SECRET` is a Worker secret; `ALLOWED_ORIGIN` is in vars.
- Routes not listed in `auth.js` RULES are lecturer-only, and `courseId` must belong to the signed-in lecturer.
- New D1 tables and columns are created by the worker (`ensure…` functions); no manual database step.
- Mobile first: usable at phone width, tap targets of at least 44px.

**Privacy and data rules**
- See "Lecturer's Notes: Privacy Rules" and "Exams Tied to a Course Title" below.

**Repo map**
- `CLAUDE.md` in the repo root maps the files, rules and tests so a task can start from it without reading everything. Keep it updated in the same commit when files or standing rules change.

**Reply style**
- Brief and direct, no recap of steps. End with: what changed, what was tested, what to deploy (worker and/or front end), and one next step if there is one.

**Accessibility (standing rule)**
- The app serves legally blind students. Every new form field needs a visible `<label>` (above the field, `a11y.js` pairs it automatically) or an `aria-label`; icon-only buttons need `aria-label`; errors use `role="alert"`; a button's `aria-label` must start with its visible text. Keep text contrast at 4.5:1 (use the 700 shade for green/teal buttons and gray-500 or darker for small text). Before delivering UI changes, run the axe-core audit (login, register, dashboard, class, scores, exams, summary, exam builder, student exam; light and dark) and keep it at 0 violations.

---

# Online Portal - System Architecture & Developer Guidelines

## Role & Persona
You are a Senior Full-Stack Developer acting as the primary maintainer for the "Online Portal." You write clean, robust, secure, and scalable code following a Modular Monolith Architecture. You understand how to physically separate concerns by domain while keeping the deployment and execution context unified.

## Repository & Version Control
This project utilizes **GitHub** as its central repository for version control. We use GitHub to manage all source code and leverage it to streamline our automated deployments for both the frontend (Cloudflare Pages) and the backend API (Cloudflare Workers).

## Architecture & Tech Stack
The project relies on a modular monolith stack running entirely on Cloudflare's edge network, integrated with Google Workspace for file storage.

### 2. Backend API (Cloudflare Workers)
* **Worker files:** `worker/worker.js` imports `auth.js`, `password.js`, `scan-grade.js`, `grading.js`, `schema.js`, `attendance.js`, `scores.js`, `exams.js`, `uploads.js`, `accounts.js`, `courses.js`, `scan-sheets.js`, `gas.js`, `shared.js`, `constants.js` and `http.js`, so all of these files must be present when the Worker is deployed (a missing one stops it from starting).
* **Worker split (route files):** `worker.js` now only handles CORS, the sign-in check and the order of the route files; the routes live in `uploads.js` (`handleUploads`: submissions, chunked uploads, grading a submission, plus the upload checks), `accounts.js` (`handleAccounts`: register, login, password, profile details, year-level advance, user list and status), `courses.js` (`handleCourses`: programs, classes, enrollment, rosters, student details, lecturer notes, recitation pool, groups) and `scan-sheets.js` (`handleScanSheets`), next to the earlier `attendance.js`, `scores.js` and `exams.js`. Each has the same shape: `export async function handleX(request, env, path, url, corsHeaders)` returns a Response when it owns the route, otherwise `null`. `gas.js` holds the Apps Script calls (`gasUrl`, `callGas`) used by uploads, scan photos and sign-up avatars; `CLEAR_REACTIVATION_SQL` and `currentTermNow` moved to `shared.js` because accounts and courses both use them. The code was moved line by line (a check confirmed every original line is still present); the lint and the Worker tests pass. **To add a route:** put it in the file of its group, or create a new `handleX` file and add one `const xResponse = await handleX(...)` pair in `worker.js`.
* **`worker/exams.js`:** the exam bank (`/api/exams*`), class exams (`/api/class-exams`), student access and attempts (`/api/student-accessible-exams`, `/api/start-accessible-exam`, `/api/submit-accessible-exam`, `/api/reset-exam-attempt`), results, adjustments, release, essay review and grading (`/api/exam-results`, `/api/exam-adjust`, `/api/exam-release`, `/api/student-exam-review`, `/api/exam-essays`, `/api/grade-essay`), through `handleExams()`. Exam-only helpers live in it (date window, time limit, grace period, course-title match). `worker/shared.js` holds helpers used by more than one file: the visitor's local date, `safeJson`, the sign-in lookup and lockout, and batching (`runInChunks`, `SCAN_BATCH_SIZE`). Bug fixed while moving it: the lookup in `/api/submit-accessible-exam` had a missing `?` (`ea.Student_ID =  AND`), so the database rejected it with a syntax error and exam submissions failed.
* **`worker/scores.js`:** `GET/POST/DELETE /api/assessments`, `GET/POST /api/assessment-scores`, `GET /api/student-summary` and `GET /api/class-summary`, called from `worker.js` through `handleScores()` in the same way as attendance. `worker/constants.js` holds the lists shared by route files (`ASSESSMENT_TERMS`, `ASSESSMENT_CATEGORIES`). Next groups to move: scan sheets, users and courses.
* **`worker/attendance.js`:** all attendance routes: `GET/POST /api/attendance`, `POST /api/attendance/single`, `POST /api/add-participation-points`, `/api/no-class` and the `/api/attendance-dates` tools (list, change, delete, merge). `worker.js` calls `handleAttendance()` after the permission check; it returns a Response for its own paths and `null` otherwise. First step of splitting `worker.js` into route files: move the next group (assessments, exams, scan sheets, users) the same way, one group per change, and add the new file to the list above. `worker/http.js` holds the shared `json()` response helper. The attendance-dates handlers are no longer inside `worker.js`.
* **`worker/worker.js`:** The centralized edge controller. It implements strict CORS headers locked to the frontend domain (`https://plv.workers.dev` and its variants). It acts as a secure proxy to Google Apps Script and directly manages the database relationships for User accounts, Course generation, Target Restrictions, Program Management, Student Enrollments, Student Disability Tagging, Batch Attendance inserting (with performance points), Assessment and per-student score management, Submission grading, Profile detail updates, Password modification logic, global User Status updates, weighted Recitation Pool queries, Lecturer Exam Management, Class Exam Linking & Scheduling, Accessible Exam Auto-Grading, and explicit Student Attempt Resets.

### 3. Database Layer (Cloudflare D1 - Serverless SQLite)
The database uses Universally Unique Identifiers (UUIDs) for all primary keys, generated on the edge via `crypto.randomUUID()`. 

**Note: Ensure the following tables are created and updated for the system to function correctly:**
* **`Programs`:** Program_ID (UUID), ProgramCode (e.g., BSCS, BSIT).
* **`Users`:** User_ID (UUID), Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, Program_Course, Program_Year, Program_Section (lecturer-assigned program details, separate from the class `course`/`year`/`section`; added by `migrations/001_program_fields.sql`), eye_condition (`No Eye Condition`, `Near Sighted`, `Far Sighted`, `Legally Blind`), role (Default: 'Student'), registration_timestamp (DATETIME).
* **`Courses`:** Course_ID (UUID), CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID (FK mapped to Users.User_ID), Target_Course, Target_Year, Target_Section, Room, Archived, AcademicYear (e.g. `2026-2027`), Semester (`1st Semester`, `2nd Semester`, `Summer`), Midterm_Start, Midterm_End, Final_Start, Final_End.
* **`Enrollments`:** Enrollment_ID (UUID), Course_ID (FK), Student_ID (FK), Seat_Number, Group_Name, Assigned_Topic.
* **`Course_Sessions`:** Session_ID (UUID), Course_ID (FK), Date (TEXT), Is_No_Class (INTEGER).
* **`Attendance`:** Attendance_ID (UUID), Course_ID (FK mapped to Courses.Course_ID), Student_ID (FK mapped to Users.User_ID), Date, Status (Present, Late, Absent, Excused), Performance_Points (Integer).
* **`Submissions`:** Submission_ID (UUID), Course_ID (FK), Student_ID (FK), Term, Title, Description, Type, File_URL, Timestamp (DATETIME), Grade_Narrative, Grade_Individual, Grade_Report (REAL, nullable).
* **`Assessments`:** Assessment_ID (UUID), Course_ID (FK), Term (`MidTerm` or `FinalTerm`), Category (`Written`, `Narrative`, `Individual`, `Performance`, `Report` or `MajorExam`), Title, Max_Score (REAL), Date (TEXT), Created_At (DATETIME, default `CURRENT_TIMESTAMP`). If the table has a CHECK constraint on `Category`, it must allow all six values.
* **`Assessment_Scores`:** Score_ID (UUID), Assessment_ID (FK), Student_ID (FK), Score (REAL). Scores are validated server-side to be between 0 and the assessment's Max_Score.
* **`Exams`:** Exam_ID (UUID), Lecturer_ID (FK mapped to Users.User_ID), Title (TEXT), ExamData (TEXT, JSON array of `[part, question, choices, answer, explanation, isBonus, type, ordered, meta]`. type is `mc`, `multi`, `tf`, `id`, `num`, `enum`, `order`, `match` or `essay`; rows saved before types existed have only the first six values and the type is worked out from the choices. answer is text, or an array of choice texts (multi), items (enum, order) or `[left, right]` pairs (match). meta is `{points, mode:'all', tol, extra:[]}` and may be missing: points defaults to 1 (enum: item count, match: pair count, essay: 5), `mode:'all'` makes multi/order all-or-nothing, `tol` is the numeric tolerance, `extra` holds wrong matching choices. Partial credit is a share of the points rounded to 2 decimals)), Created_At (DATETIME).
* **`Class_Exams`:** Class_Exam_ID (UUID), Course_ID (FK mapped to Courses.Course_ID), Exam_ID (FK mapped to Exams.Exam_ID), Assessment_ID (FK mapped to Assessments.Assessment_ID), Term (`MidTerm` or `FinalTerm`), Category (`Written`, `Narrative`, `Individual`, `Performance`, `Report` or `MajorExam`), Is_Active (INTEGER, 1 or 0), From_Date (TEXT), To_Date (TEXT), Created_At (DATETIME, default `CURRENT_TIMESTAMP`).
* **`Exam_Assignments`:** Assignment_ID (UUID), Class_Exam_ID (FK mapped to Class_Exams.Class_Exam_ID), Student_ID (FK mapped to Users.User_ID), Is_Enabled (INTEGER, 1 or 0), Status (`Pending` or `Completed`), Raw_Score (REAL), Bonus_Score (REAL), Final_Score (REAL), Max_Score (REAL), Answers_JSON (TEXT), Submitted_At (DATETIME).

### 4. External Integrations (Google Apps Script)
* **`gas/Code.gs`:** A deployed Web App webhook that catches payloads from the Cloudflare Worker, decodes Base64 image data, dynamically creates or traverses nested folder structures, and saves files directly to a designated root Google Drive folder.

## Dialog Layout Conventions (Phones)
All dialogs keep their element IDs and close-button IDs (`close...Btn`, `close...Bg`), because `a11y.js` and the click handlers depend on them. Only layout classes differ by dialog type:

| Type | Use for | Wrapper | Panel |
|---|---|---|---|
| Full screen | Wide tables and long lists: Class Summary, Record Scores, Attendance Dates, Manage Exams, Scan Answer Sheets, Manage Users | `p-0 sm:p-4` | `rounded-none sm:rounded-lg h-full sm:h-auto sheet-panel max-h-full sm:max-h-[...]` |
| Bottom sheet | Short actions: Course Actions, Manage Student, Add Student, No Class Days, Details, Group Members, Submit Document, Submission History | `items-end sm:items-center p-0 sm:p-4` | `rounded-t-2xl sm:rounded-lg sheet-panel max-h-[85-92vh]` plus a drag handle (`<div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300">`) as the first child |
| Centered modal | Quick confirmations and small forms: Confirm, Change Password, Update Details, Create Course, Add Program, image preview, Student Caller | `items-center p-4` | `rounded-lg scale-up` |

On screens 640px and wider, every type except Class Summary shows as a normal centered modal. The `sheet-panel` class slides up on phones and scales in on larger screens. Sheets add bottom padding for the iPhone home bar through `env(safe-area-inset-bottom)`.

## Known Gaps & Planned Work
None open. New templates must pass every user-supplied value through `escapeHtml()` (`js/html-utils.js`) and every link through `safeUrl()`; text set with `textContent`, `UI.*` messages and CSV cells are not HTML and are left unescaped.

## Testing and Deploy Checklist

**Before uploading (on your computer, Node 22 or newer):** `sh tools/tests/run-tests.sh` runs, in order: a syntax check of every JavaScript file, a Worker lint for undefined names (catches a missing import after a file is split), the Worker tests (`tools/tests/worker.test.mjs`: the real Worker code against an in-memory SQLite that behaves like D1: login and lockout, roles and ownership, attendance, scores, exams, sign-up limits; plus a check that every route written in the source still answers, so a route lost in a file split fails the test), and a check that `tailwind.css` is up to date. Add `--phone` to also open the app in a phone-sized Chromium with fake data and the real Content-Security-Policy (`tools/tests/phone-check.cjs`; first time only: `npm i playwright` then `npx playwright install chromium`); it reports policy violations, Tailwind classes missing from `tailwind.css`, sideways scrolling and script errors. When a bug is fixed, add a check for it to `worker.test.mjs`.

**Deploy order:**
1. Upload the whole zip with the folder layout kept (`worker/` files all go together; the Worker will not start with some of them missing).
2. If `tailwind.css` is in the zip, upload it too. After any change to a Tailwind class run `sh tools/build-css.sh` first.
3. Worker: deploy `worker/` (`wrangler deploy`, or the Git integration). `keep_vars = true` keeps the dashboard secrets.
4. Pages deploys the site files (`index.html`, `js/`, `*.css`, `_headers`, `sw.js`). Open the site once and reload so the service worker picks up the new version (cache name in `sw.js`).
5. If `gas/Code.gs` changed, paste it into the Apps Script project and deploy a **new version** of the web app.

**Settings that must exist (Cloudflare dashboard, Worker > Settings > Variables and Secrets):** secrets `SESSION_SECRET` (16+ characters) and `GAS_SECRET` (same value as the `SECRET` script property in Apps Script); variable `ALLOWED_ORIGIN` (your site, comma-separated if several). Optional: `REGISTER_MAX_PER_IP` (sign-up attempts per address per hour, default 60) and `PBKDF2_ITERATIONS` (paid plan).

**Smoke test after every deploy (5 minutes, on a phone):**
1. `./tools/security-check.sh https://<worker-url> https://<your-site>`: all PASS.
2. Sign in as a lecturer: course list appears; open a class; mark one student Present (swipe or tap); reload: the mark is still there.
3. Open Scores, Exams and Class Summary: each opens and shows data. Export the Class Grade (on a phone the Share / Save button appears).
4. Scan one sheet (camera opens, a result appears).
5. Sign in as a student: courses and the exam list show; sign out.
6. Browser console: no "Refused to load" (Content-Security-Policy) and no red errors.

**Rolling back:** the previous Worker version can be restored in the Cloudflare dashboard (Worker > Deployments > Rollback); for the site, redeploy the previous commit in Pages. If only the Content-Security-Policy causes trouble, restore the previous `_headers`. Database changes in this project are additive (lazy `ensure*` functions add tables, columns and indexes), so a rollback does not need a database rollback.

## Environment Variables
We use the following environment variables strictly within the API (`worker/wrangler.toml` and `worker/worker.js`):
* **`ALLOWED_ORIGIN`**: Secures CORS by strictly defining the permitted frontend origin (e.g., `https://plv.workers.dev`).
* **`GAS_WEBHOOK_URL`**: The proxy endpoint used to transmit base64 payloads to Google Apps Script.
* **`SESSION_SECRET`** (Secret, set in the Cloudflare dashboard, never in `wrangler.toml`): signs login tokens; 16+ random characters. `wrangler.toml` has `keep_vars = true`, so a deploy keeps variables and secrets that exist only in the dashboard (without it a deploy can remove dashboard-only plain variables).
* **`PBKDF2_ITERATIONS`** (optional): password hashing rounds, up to 100000 (paid plan).
* **`REGISTER_MAX_PER_IP`** (optional): sign-up attempts allowed per address per hour (default 60; each student number is also limited to 5 per hour).

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
12. **Aligned form controls:** Every input, dropdown and date field uses the shared `.ctl` class (`styles.css`: fixed 2.5rem height, date fields left-aligned) so mixed controls in a row have the same height and alignment on iOS. Put labels above controls, keep controls in a row the same width class, and check new forms on a phone-width screenshot. Boxes in a row also share padding and border radius.


## Lecturer's Notes (private, per student per class)
- In a class, open a student's **Performance Summary**; the **Lecturer's Notes** panel at the bottom lets the lecturer add, edit and delete dated notes (behaviour, participation, other written observations). Max 4000 characters each.
- Stored in the `Lecturer_Notes` D1 table (created automatically): `Note_ID, Course_ID, Student_ID, Lecturer_ID, Body, Created_At, Updated_At`. Notes belong to one student in one class.
- API `/api/lecturer-notes` (GET list for a student, GET with only `courseId` for per-student counts, POST add/edit, DELETE). It is not in the student rules in `auth.js`, so it is lecturer-only and `courseId` must be one of the lecturer's own classes. No student-facing route returns notes, and the student's own summary page has no notes panel.
- Code: `js/lecturer-notes.js`; hooks in `js/course.js` (opens it with the summary) and `js/components-class.js` (`#lnPanel`).

### Lecturer's Notes: Privacy Rules (must hold for every future change)
- Notes are visible and editable **only by the lecturer who owns that specific course class**. Never by students, other lecturers, or in another class of the same lecturer.
- Every notes query must filter by both `Course_ID` and `Student_ID`, and the `courseId` must be checked against the signed-in lecturer's own classes (`auth.js` ownership check; keep `/api/lecturer-notes` out of the student rules in `RULES`).
- Never add notes to student-facing responses (`/api/student-summary`, `/api/my-courses`, exports, reports, copied or duplicated classes, year advance, roster caches in `localStorage`) or to the student's own summary page.
- Do not copy notes when a class is duplicated to another term. Keep notes out of any shared or student-visible export.
- After any change to these routes, re-test as a student and as a different lecturer: both must be refused.

## Exams Tied to a Course Title
- An exam's **Course** line (`Exams.Course`, set in the exam builder) ties it to a course title. Such an exam can only be shown and used by classes whose Course Title is the same (ignoring capital letters and extra spaces). An exam with "No course line" can be used by any class.
- Worker: `EXAM_FITS_CLASS_SQL` / `examFitsTitle` in `worker/worker.js`.
  - `POST /api/class-exams` refuses a class with a different course title (400).
  - `GET /api/exams?lecturerId=…&courseId=…` returns only the exams that fit that class. Without `courseId` (the exam library) it returns all of the lecturer's exams.
  - `GET /api/class-exams`, the student's exam list, loading, starting and submitting an exam all skip an exam whose course title does not match the class.
- The class Exam tab and the Scanner (`js/course-exam.js`, `js/course-scanner.js`) request exams for their class only.
- If a class's Course Title is changed so it no longer matches an exam already assigned, that exam is hidden from the class and its students until the titles match again. Its scores stay recorded.

- **Front-end lint:** `sh tools/tests/run-tests.sh` now also checks `js/` for undefined names (the check that would have caught the `displayCourse` crash on the class screen).

- **Student summary layout:** the score details page has a white header with an amber top line (it used to be the same blue as the summary header, so the two blended). The score details page sits between the summary header and the History / Upload bar, so the bar stays tappable. Tapping History or Upload opens that page over the same area from the summary header down to the bottom of the screen (covering the bar; Back returns). The summary header's back arrow and term tabs stay tappable in all of these (`js/student-summary-ui.js`).

- **Lecturer dashboard (phones):** the page heading is "My Classes". The term picker is a compact select beside the search box (Current term / All terms / a term), and the page has no extra New Course button (use the bottom bar's New). The header, search box, term picker and day chips stay fixed while the list scrolls (`searchBarHtml` is sticky; the header no longer slides away on this page).
- **Class card buttons:** Invite code, Scan, Summary, More. Invite code and Copy / Archive open straight from the dashboard. Everything that needs the class (Scan, Summary, enroll, scores, exams, dates...) opens the class in *intent mode*: the roster stays hidden (`body.intent-mode`), the action opens over it, and closing the action returns to the dashboard instead of showing the student list (`CourseFab.goWith`).

- **Lecturer's notes:** each student row on the class roster has a note button beside the gear (Notes on wide screens). It opens the notes in their own full-height dialog from the top of the screen: the note box stays fixed at the top and only the previous notes scroll beneath it (add, edit, delete); the notes are no longer inside the performance summary. They remain private to the lecturer (`js/lecturer-notes.js`).

- **Participation rule (`js/participation.js`):** a Present or Late student gets 2 points for the day by default; points the lecturer adds count on top, but one day is worth at most 4; Absent days give 0; and the term total is capped at 4 points for each scheduled class day (no-class days left out). The same rule feeds the class summary, the student's performance summary, the CSV, the class grade export (Participation perfect score = 4 x class days) and the per-date log. Stored points are not changed; the cap is applied when they are shown.

- **Class grade Excel header:** cell BR2 shows the class course, year and section (from Create Course / Edit Class, e.g. `BSIT 3-A`) instead of the template's fixed "BSP 1-4", and BR3 keeps the subject code (`SUBJECTCODE: ...`).

- **Class grade file name:** `Course code_class course year-section_term_Class Grade.xlsx`, for example `FINMAN 7_FM 3-7_2026-2027 1st Sem_Class Grade.xlsx`. Parts that are not set are left out.

- **Share / Save prompt (phones):** after an export (Class Grade, CSVs) a centered dialog says "Your file is ready" with the file name and a large **Share / Save** button, because the share sheet only opens from a fresh tap (`js/download-utils.js`). Desktop browsers still download straight away.

- **Lecturer dashboard look:** the header reads "My Classes" (students still see "Dashboard"), so the page has no separate heading. Day chips have room at both ends when scrolled sideways, the class badge (course year-section) is larger, and class cards are roomier (bigger code, title, schedule, chips and a taller button row).

## Feature notes (moved out to keep this file small)
- `docs/FRONTEND.md`: file-by-file notes on the front end (what each `js/` file does).
- `docs/FEATURES.md`: one section per feature and update (scanner, exams, enrollment, invites, uploads, groups, grade base, password reset by email ...), newest last. Find one with `grep -n "^## " docs/FEATURES.md`.
- Rules that must always hold stay here: Working Agreement, Development Directives, Lecturer's Notes privacy rules, Exams tied to a course title.
