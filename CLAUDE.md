# CLAUDE.md - map of this repo (read this first, then only the files a task needs)

Cloudflare LMS: vanilla JS front end (`js/`, ES modules, Tailwind built to `tailwind.css`) + Cloudflare Worker + D1 (SQLite) in `worker/`, Google Apps Script (`gas/Code.gs`) for Drive files and email. No framework, no bundler.

## Rules for every task (full text: README.md lines 1-35, "Working Agreement")
- README.md is small (~28 KB: rules, architecture, deploy checklist, env vars); read lines 1-35 and only other parts you need. Feature history lives in `docs/FEATURES.md` (~105 KB) and per-file front-end notes in `docs/FRONTEND.md`: never read them whole, `grep -n "^## " docs/FEATURES.md` and read the sections for the feature you touch.
- Give full replacement files, brief direct explanations. Plan briefly, work in batches.
- Test first: `sh tools/tests/run-tests.sh` (syntax, eslint, Worker tests on node:sqlite, tailwind check). Add `node tools/tests/phone-check.cjs` for UI changes (Playwright, phone width).
- If a new class was used in JS or HTML: `sh tools/build-css.sh`, commit `tailwind.css`.
- Bump the cache name in `sw.js` (`portal-shell-vNN`) on every front-end change.
- Update docs in the same commit: add a section for the feature at the END of `docs/FEATURES.md` (what, rules, tests, deploy: Worker / site files / Apps Script / secrets); README only for setup, deploy, env, architecture or standing rules. New standing rule agreed => add it to README Working Agreement.
- Commit and push to `main` after tests pass (`git pull --rebase origin main` first). If push is refused: zip of only changed files, named for the change, with README updated. Commit messages end with the attribution lines the harness gives.
- Reply: what changed, what was tested, what to deploy, one next step.

## Code rules
- Keep existing element IDs. Escape user text: `escapeHtml`, `safeUrl` (`js/html-utils.js`). No `alert/confirm`: use `UI.toast/success/error/confirm` (`js/ui-feedback.js`).
- API calls: `apiFetch` (`js/globals.js`, throws Error with the server message). Session state: `AppState`.
- Modals are full-screen "app pages" on phones: copy `sheet-panel app-page` + `app-page-header` markup from an existing modal. Tap targets >= 44px. Dark mode via `dark.css`.
- Worker route files export `handleX(request, env, path, url, corsHeaders[, user])` and return a Response or `null`; registered in `worker/worker.js` (order matters).
- Auth: `worker/auth.js` `RULES` (`who`, `self`, `mine`, `enrolled`). A route NOT listed is lecturer-only and every id in query/body (`courseId`, `assessmentId`, `submissionId` ...) must belong to the signed-in lecturer (`OWNER_SQL`). New id types need an `OWNER_SQL` entry.
- Tables/columns are created lazily by `ensure*` functions in `worker/schema.js` (never a manual DB step). D1 binds: no `undefined` (use null).
- Names are stored "Last, Given". Dates are GMT+8 for term/exam logic. Terms are `MidTerm` / `FinalTerm` in Submissions, `midterm` / `finalterm` in the UI.
- Privacy: README "Lecturer's Notes: Privacy Rules" and "Exams Tied to a Course Title" must keep holding.
- Secrets: `SESSION_SECRET`, `GAS_SECRET` (Worker secrets); vars `ALLOWED_ORIGIN`, `GAS_WEBHOOK_URL`.

## Worker map (`worker/`)
| File | Owns |
|---|---|
| worker.js | CORS, auth check, order of route files, cron sweep |
| auth.js | token sign/verify, `RULES`, `OWNER_SQL`, ownership checks |
| accounts.js | register, login/logout, password change + reset (emails temp password via GAS), prefs, current term, profile/admin edit, user list/status, year-level advance |
| courses.js | programs, courses CRUD/duplicate/archive, enroll/join/invite, roster, student details, notes, `/api/group-members` |
| groups.js | group sets: `/api/group-sets`, `group-set(-create/-rename/-delete/-save)`, `student-groups`; `groupNameIn()` used by uploads |
| attendance.js | attendance dates, no-class days, attendance records, participation points |
| scores.js | assessments, scores (capped at max, extra credit), `/api/student-summary`, `/api/class-summary` |
| uploads.js | submissions: upload (single + chunked), grade, `update-submission`, `default-upload-term`, uploader checks |
| exams.js, exam-session.js, exam-photos.js, exam-scan-results.js, exam-sets.js (Worker copy of js/exam-sets.js; keep in sync) | exams, class exams, attempts, secure mode, photos, scan results merged into exam results |
| scan-sheets.js, scan-grade.js, grading.js | scanned answer sheets, sessions, grading, student sheet review |
| gas.js | `callGas` / `gasUrl` (Drive upload/read, `action:"email"`) |
| schema.js | all `ensure*` table creation; shared.js: helpers (term, lockouts, `runInChunks`); join.js, roles.js, password.js, http.js, constants.js, site-settings.js, term-sweep.js |

## Front-end map (`js/`; `app.js` initialises modules, `router.js` hash routes, `components*.js` = HTML templates)
- Auth/profile: auth.js, components-auth.js, forgot-password.js, password-requests.js, profile-edit.js, edit-student.js, terms-consent.js.
- Dashboard / class list: course-dashboard.js (course cards, **upload form logic**), components-dashboard.js (dashboard + student summary + submit/history/My Groups modals), dash-nav.js, card-more.js (menu shortcuts), duplicate-course.js, year-advance.js, current-term.js.
- Class screen (lecturer): course.js (main click handlers, student summary open), course-class.js (roster, **submission history cards**), components-class.js (class template, Course Actions menu tiles, Record Scores/Groups/Edit-upload modals), course-attendance*.js, course-recitation.js, course-roster-tools.js, lecturer-notes.js, class-invite.js.
- Scores/grades: course-scores.js (Record Scores, group fill), course-summary.js (Class Summary), grade-base.js (`onBase`, used only by the export), class-grade-export.js + class-grade-template.js (ExcelJS), participation.js.
- Groups/uploads: course-groups.js (lecturer Groups screen), my-groups.js (student screen), submission-edit.js (lecturer edits an upload).
- Exams: exam-builder*.js, course-exam.js, components-exam.js, exam-secure.js, exam-sets.js, exam-share.js, exam-print.js, exam-review.js, exam-photo-review.js.
- Scanner/OMR: course-scanner*.js, course-scan-*.js, omr-*.js, scan-*.js, sheet-print.js, student-sheet-viewer.js, components-scanner.js.
- Shared: globals.js, html-utils.js, ui-feedback.js, date-utils.js, a11y.js, theme.js, skeletons.js, pwa.js (+ `sw.js`).

## Where to look for a feature (section of `docs/FEATURES.md` to read, then the files)
- Group sets, Upload form/term default/edit uploads, Lecturer uploads, Password reset by email, Grade base 100, Extra credit, Scanned sheets in results, Student review of scan: the last sections of `docs/FEATURES.md`.
- Roster/enrollment/invites: "Enrolling...", "Invite codes...", "Class roster tools". Terms: "Academic Year and Semester", "Current Academic Term". Exams: "Exam question types...", "Exam time limit...", "Secure exam mode...". Scanner: "Scanner: ...", "Review screen". Setup/deploy (in README.md): "Testing and Deploy Checklist", "Environment Variables".
- Use `grep -n "^## " docs/FEATURES.md` to find the rest; read with an offset/limit. Staying in README.md: Development Directives, Lecturer's Notes privacy rules, Exams Tied to a Course Title.

## Tests (`tools/tests/`)
- `worker.test.mjs`: one file, blocks per feature (`// ---- Name`), harness helpers `call(method, path, {token, body})`, `ok(name, cond, detail)`, `sql` (node:sqlite), `signToken(env, userId)`, tokens `L1` (lecturer of C1), `l2.j.token` (other lecturer). Test tables are declared at the top of the file: add new columns there. Mock Drive/GAS by replacing `globalThis.fetch` and setting `env.GAS_WEBHOOK_URL`; restore afterwards.
- `phone-check.cjs`: Playwright at phone width, checks CSP, missing Tailwind classes, sideways scroll, script errors. `omr-check.cjs` for the scanner (`--omr`).

## Recent changes (newest last; details in docs/FEATURES.md)
Lecturer uploads for a student + group members; scanned sheets in Exam Results; extra credit; student review of scanned paper; grade base 100 (Class Grade .xlsx export only; dashboards show raw scores) + no-activity full credit; group sets (Reporting set = Enrollments.Group_Name, others in Group_Sets/Group_Members) with topics, random split, sortable list, per-set uploads, group score fill, student My Groups screen; password reset emails temp password through GAS (lecturer reset + self-service Forgot password with last name/student number/email/contact); upload term default by date, Upload as Individual/Group, lecturer edits any student upload (lecturer uploads are not marked); live scan: one sheet then review with a Capture next sheet button (duplicate student replaces the earlier sheet); students can review scanned papers of every printed set.

## Keeping this file useful
Update this map in the same commit when a file is added, renamed or changes responsibility, or when a standing rule changes. Keep it under ~120 lines: it is an index, not documentation.
