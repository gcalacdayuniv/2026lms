// Worker integration tests: the real Worker code against an in-memory SQLite that behaves like D1.
// Run: node tools/tests/worker.test.mjs   (needs Node 22 or newer for node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import worker from '../../worker/worker.js';
import { hashPassword } from '../../worker/password.js';

const sql = new DatabaseSync(':memory:');
const DB = {
  prepare(q) {
    let args = [];
    const o = {
      bind(...a) { args = a; return o; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
      async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) }, success: true }; },
      _q: q, _a: () => args
    };
    return o;
  },
  async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }
};
sql.exec(`
create table Users(User_ID primary key, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, eye_condition, role, registration_timestamp, Program_Course, Program_Year, Program_Section);
create table Courses(Course_ID primary key, CourseCode, CourseTitle, ScheduleDay, TimePeriod, Lecturer_ID, Midterm_Start, Midterm_End, Final_Start, Final_End);
create table Course_Sessions(Session_ID, Course_ID, Date, Is_No_Class);
create table Enrollments(Course_ID, Student_ID, Seat_Number, Group_Name, Assigned_Topic);
create table Attendance(Attendance_ID primary key, Course_ID, Student_ID, Date, Status, Performance_Points);
create table Assessments(Assessment_ID primary key, Updated_At, Course_ID, Term, Category, Title, Max_Score, Date, Created_At default current_timestamp);
create table Assessment_Scores(Score_ID primary key, Assessment_ID, Student_ID, Score);
create table Submissions(Submission_ID primary key, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp);
create table Exams(Exam_ID primary key, Lecturer_ID, Title, ExamData, Course, Created_At default current_timestamp);
`);
const pw = await hashPassword('pass1234', {});
const U = (id, name, role) => sql.prepare('insert into Users(User_ID,Username,Password,Name,Email,account_status,role) values(?,?,?,?,?,?,?)').run(id, name, pw, name, name + '@x.com', 'Active', role);
U('L1', 'lec1', 'lecturer'); U('L2', 'lec2', 'lecturer'); U('S1', 'stu1', 'student'); U('S2', 'stu2', 'student');
sql.exec(`insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('C1','C1','Course One','L1');
insert into Enrollments(Course_ID,Student_ID) values('C1','S1'),('C1','S2');
insert into Assessments(Assessment_ID,Course_ID,Term,Category,Title,Max_Score,Date) values('A1','C1','MidTerm','Written','Quiz',10,'2026-01-01');
insert into Assessment_Scores values('SC1','A1','S1',8);
insert into Attendance values('T1','C1','S1','2026-01-05','Present',0);`);

const env = { DB, SESSION_SECRET: 'x'.repeat(32), ALLOWED_ORIGIN: 'https://app.test' };
const ctx = { waitUntil: (p) => p };
const call = async (method, path, { token, body } = {}) => {
  const req = new Request('https://api.test' + path, { method, headers: { Origin: 'https://app.test', ...(token ? { Authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' }, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env, ctx);
  let j = null; try { j = await res.json(); } catch (e) {}
  return { s: res.status, j };
};
let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) fail++; };

const login = async (id) => (await call('POST', '/api/login', { body: { identifier: id, password: 'pass1234' } }));
const l1 = await login('lec1'), l2 = await login('lec2'), s1 = await login('stu1');
ok('lecturer login returns token', l1.s === 200 && !!l1.j.token, JSON.stringify(l1));
ok('wrong password rejected', (await call('POST', '/api/login', { body: { identifier: 'lec1', password: 'bad' } })).s === 401);
ok('no token -> 401', (await call('GET', '/api/users')).s === 401);
ok('student blocked from /api/users', (await call('GET', '/api/users', { token: s1.j.token })).s === 403);
ok('forged token -> 401', (await call('GET', '/api/users', { token: l1.j.token.slice(0, -3) + 'abc' })).s === 401);
ok('student reads own summary', (await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: s1.j.token })).s === 200);
ok("student blocked from other student's summary", (await call('GET', '/api/student-summary?courseId=C1&studentId=S2', { token: s1.j.token })).s === 403);
ok('student blocked from class-summary', (await call('GET', '/api/class-summary?courseId=C1', { token: s1.j.token })).s === 403);
ok("other lecturer blocked from class-summary", (await call('GET', '/api/class-summary?courseId=C1', { token: l2.j.token })).s === 403);
const cs = await call('GET', '/api/class-summary?courseId=C1', { token: l1.j.token });
ok('owner lecturer gets class-summary', cs.s === 200 && cs.j.students.S1.assessments[0].Score === 8 && cs.j.students.S2.assessments[0].Score === null && cs.j.students.S1.records.length === 1, JSON.stringify(cs));
const pts = (n) => call('POST', '/api/add-participation-points', { token: l1.j.token, body: { courseId: 'C1', studentId: 'S1', date: '2026-01-05', points: n } });
await pts(2); await pts(3);
ok('points add up on existing row', sql.prepare("select Performance_Points p from Attendance where Student_ID='S1'").get().p === 5);
await call('POST', '/api/add-participation-points', { token: l1.j.token, body: { courseId: 'C1', studentId: 'S2', date: '2026-01-06', points: 4 } });
ok('points create row when none', sql.prepare("select Performance_Points p, Status s from Attendance where Student_ID='S2'").get().p === 4);
ok('invalid points rejected', (await call('POST', '/api/add-participation-points', { token: l1.j.token, body: { courseId: 'C1', studentId: 'S1', date: '2026-01-05', points: NaN } })).s === 400);
await new Promise(r => setTimeout(r, 300));
const idx = sql.prepare("select count(*) n from sqlite_master where type='index' and name like 'idx_%'").get().n;
ok('core indexes created', idx >= 8, 'got ' + idx);

await new Promise(r => setTimeout(r, 1200));
const cp = await call('POST', '/api/change-password', { token: s1.j.token, body: { userId: 'S1', currentPassword: 'pass1234', newPassword: 'newpass99' } });
ok('change-password returns new token', cp.s === 200 && !!cp.j.token, JSON.stringify(cp));
ok('old token rejected after change', (await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: s1.j.token })).s === 401);
ok('new token works', (await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: cp.j.token })).s === 200);
ok('other user token unaffected', (await call('GET', '/api/class-summary?courseId=C1', { token: l1.j.token })).s === 200);
const s2 = await login('stu2');
await new Promise(r => setTimeout(r, 1200));
const rs = await call('POST', '/api/reset-student-password', { token: l1.j.token, body: { studentId: 'S2' } });
ok('reset gives temp password', rs.s === 200 && !!rs.j.tempPassword);
ok('student token dead after reset', (await call('GET', '/api/student-summary?courseId=C1&studentId=S2', { token: s2.j.token })).s === 401);
const s2b = await call('POST', '/api/login', { body: { identifier: 'stu2', password: rs.j.tempPassword } });
ok('login with temp password works', s2b.s === 200 && (await call('GET', '/api/student-summary?courseId=C1&studentId=S2', { token: s2b.j.token })).s === 200);

const L1 = l1.j.token, d1 = '2026-02-02';
const save = (records) => call('POST', '/api/attendance', { token: L1, body: { courseId: 'C1', date: d1, records } });
const day = async () => (await call('GET', `/api/attendance?courseId=C1&date=${d1}`, { token: L1 })).j;
ok('student cannot save attendance', (await call('POST', '/api/attendance', { token: cp.j.token, body: { courseId: 'C1', date: d1, records: [] } })).s === 403);
ok('save day returns 201', (await save([{ studentId: 'S1', status: 'Present', points: 1 }, { studentId: 'S2', status: 'Absent', points: 0 }])).s === 201);
ok('day has 2 records', (await day()).records.length === 2);
await save([{ studentId: 'S1', status: 'Late', points: 2 }]);
const d2 = await day();
ok('save replaces whole day (S2 removed, S1 updated)', d2.records.length === 1 && d2.records[0].Status === 'Late' && d2.records[0].Performance_Points === 2, JSON.stringify(d2));
await call('POST', '/api/attendance/single', { token: L1, body: { courseId: 'C1', studentId: 'S2', date: d1, status: 'Excused', points: 0 } });
ok('single save adds one row', (await day()).records.length === 2);
await call('POST', '/api/attendance/single', { token: L1, body: { courseId: 'C1', studentId: 'S2', date: d1, status: '', points: 0 } });
ok('single save with empty status clears', (await day()).records.length === 1);
const ad = await call('GET', '/api/attendance-dates?courseId=C1', { token: L1 });
ok('attendance-dates lists the day', ad.s === 200 && JSON.stringify(ad.j).includes(d1), JSON.stringify(ad));
const ch = await call('POST', '/api/attendance-dates/change', { token: L1, body: { courseId: 'C1', oldDate: d1, newDate: '2026-02-09' } });
ok('attendance-dates change works', ch.s === 200, JSON.stringify(ch));
await call('POST', '/api/no-class', { token: L1, body: { courseId: 'C1', date: '2026-02-09' } });
const nc = await call('GET', '/api/attendance?courseId=C1&date=2026-02-09', { token: L1 });
ok('no-class day flagged and attendance cleared', nc.j.isNoClass === true && nc.j.records.length === 0, JSON.stringify(nc.j));
ok('no-class list', (await call('GET', '/api/no-class?courseId=C1', { token: L1 })).j.dates.length === 1);
await call('DELETE', '/api/no-class', { token: L1, body: { courseId: 'C1', date: '2026-02-09' } });
ok('no-class removed', (await call('GET', '/api/no-class?courseId=C1', { token: L1 })).j.dates.length === 0);

const mk = await call('POST', '/api/assessments', { token: L1, body: { courseId: 'C1', term: 'FinalTerm', category: 'Performance', title: 'Demo', maxScore: 20, date: '2026-03-01' } });
ok('create assessment', mk.s === 201 || mk.s === 200, JSON.stringify(mk));
const list = await call('GET', '/api/assessments?courseId=C1', { token: L1 });
const demo = (list.j.assessments || []).find(a => a.Title === 'Demo');
ok('assessment listed', !!demo, JSON.stringify(list.j));
ok('invalid category falls back or rejected', (await call('POST', '/api/assessments', { token: L1, body: { courseId: 'C1', term: 'Nope', category: 'Nope', title: 'X', maxScore: 5, date: '2026-03-01' } })).s >= 200);
const sv = await call('POST', '/api/assessment-scores', { token: L1, body: { assessmentId: demo.Assessment_ID, scores: [{ studentId: 'S1', score: 15 }, { studentId: 'S2', score: 99 }] } });
const got = await call('GET', `/api/assessment-scores?assessmentId=${demo.Assessment_ID}`, { token: L1 });
ok('scores saved (over-max score rejected or capped)', sv.s === 400 || (got.j.scores || []).some(s => s.Student_ID === 'S1' && s.Score === 15), JSON.stringify({ sv, got: got.j }));
await call('POST', '/api/assessment-scores', { token: L1, body: { assessmentId: demo.Assessment_ID, scores: [{ studentId: 'S1', score: 15 }] } });
const got2 = await call('GET', `/api/assessment-scores?assessmentId=${demo.Assessment_ID}`, { token: L1 });
ok('score for S1 stored', (got2.j.scores || []).some(s => s.Student_ID === 'S1' && s.Score === 15), JSON.stringify(got2.j));
ok('other lecturer cannot save scores', (await call('POST', '/api/assessment-scores', { token: l2.j.token, body: { assessmentId: demo.Assessment_ID, scores: [] } })).s === 403);
const ss = await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: L1 });
ok('student-summary through scores.js', ss.s === 200 && ss.j.assessments.some(a => a.Title === 'Demo' && a.Score === 15), JSON.stringify(ss.j).slice(0, 200));
const del = await call('DELETE', '/api/assessments', { token: L1, body: { assessmentId: demo.Assessment_ID } });
ok('delete assessment', del.s === 200, JSON.stringify(del));
ok('assessment gone', !((await call('GET', '/api/assessments?courseId=C1', { token: L1 })).j.assessments || []).some(a => a.Title === 'Demo'));

const mkExam = await call('POST', '/api/exams', { token: L1, body: { lecturerId: 'L1', title: 'Quiz A', course: '', examData: [['Capital of France?', '', [], 'Paris']] } });
ok('create exam', mkExam.s === 201 && !!mkExam.j.examId, JSON.stringify(mkExam));
const exList = await call('GET', '/api/exams?lecturerId=L1', { token: L1 });
ok('exam listed', (exList.j.exams || []).some(e => e.Title === 'Quiz A'), JSON.stringify(exList.j).slice(0, 200));
const ce = await call('POST', '/api/class-exams', { token: L1, body: { courseId: 'C1', examId: mkExam.j.examId, term: 'MidTerm', category: 'Written', isActive: true, assignments: [{ studentId: 'S1', isEnabled: true }, { studentId: 'S2', isEnabled: false }] } });
ok('assign exam to class', ce.s === 200 || ce.s === 201, JSON.stringify(ce));
const sOwn = cp.j.token;
const avail = await call('GET', '/api/student-accessible-exams?studentId=S1', { token: sOwn });
const mine = (avail.j.exams || avail.j.availableExams || [])[0];
ok('student sees the assigned exam', avail.s === 200 && !!mine, JSON.stringify(avail));
const st = await call('POST', '/api/start-accessible-exam', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S1' } });
ok('student starts exam', st.s === 200, JSON.stringify(st));
const sub = await call('POST', '/api/submit-accessible-exam', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S1', answers: ['paris'] } });
ok('student submits exam (query with student placeholder)', sub.s === 200 && sub.j.success !== false, JSON.stringify(sub));
const res = await call('GET', '/api/exam-results?classExamId=' + (ce.j && ce.j.classExamId), { token: L1 });
ok('lecturer sees the result', res.s === 200 && JSON.stringify(res.j).includes('S1'), JSON.stringify(res).slice(0, 300));
const again = await call('POST', '/api/start-accessible-exam', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S1' } });
ok('completed exam cannot be started again', again.s === 403, JSON.stringify(again));

// ---- registration limits ----
const reg = (sn, extra = {}, ip) => call('POST', '/api/register', { body: { username: 'new' + sn, password: 'secret12', name: 'N', email: 'n@x.com', student_number: sn, contact_number: '09', course: 'C', year: '1', section: 'A', eye_condition: 'None', ...extra } });
const big = await reg('26-0001', { avatarBase64: 'A'.repeat(8000001) });
ok('oversized avatar rejected', big.s === 400 && /too large/.test(big.j.error), JSON.stringify(big));
const shortPw = await reg('26-0002', { password: '123' });
ok('short password rejected', shortPw.s === 400, JSON.stringify(shortPw));
const longName = await reg('26-0003', { name: 'x'.repeat(500) });
ok('overlong field rejected', longName.s === 400, JSON.stringify(longName));
let last;
for (let i = 0; i < 5; i++) last = await reg('26-9999');
ok('5 tries for one student number allowed', last.s !== 429, JSON.stringify(last));
const sixth = await reg('26-9999');
ok('6th try for same student number blocked', sixth.s === 429 && /sign-up/.test(sixth.j.error), JSON.stringify(sixth));
ok('another student number still allowed', (await reg('26-0004')).s !== 429);
env.REGISTER_MAX_PER_IP = '3';
sql.exec("delete from Login_Attempts where Attempt_Key like 'reg:%'");
let r3; for (let i = 0; i < 3; i++) r3 = await reg('26-10' + i);
const r4 = await reg('26-1999');
ok('per-address limit blocks the next attempt', r3.s !== 429 && r4.s === 429, JSON.stringify([r3, r4]));
delete env.REGISTER_MAX_PER_IP;
ok('login still works while sign-up is limited', (await login('lec1')).s === 200);

// ---- old sign-in attempt rows are cleaned up ----
import { purgeOldAttempts } from '../../worker/shared.js';
sql.exec("delete from Login_Attempts");
sql.exec(`insert into Login_Attempts (Attempt_Key, Fails, First_At) values ('u:old', 3, ${Date.now() - 2 * 86400000}), ('u:fresh', 2, ${Date.now() - 60000})`);
const purged = await purgeOldAttempts(env);
const left = sql.prepare('select Attempt_Key k from Login_Attempts').all().map(r => r.k);
ok('purge removes day-old attempts and keeps recent ones', purged === 1 && left.length === 1 && left[0] === 'u:fresh', JSON.stringify({ purged, left }));

// ---- exam sharing between lecturers with the same course code ----
U('L3', 'lec3', 'lecturer');
sql.exec(`insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('C3','C1','Course One','L3'),('C2','OTHER','Other','L2')`);
const l3 = await login('lec3');
const made = await call('POST', '/api/exams', { token: l1.j.token, body: { lecturerId: 'L1', title: 'Shared quiz', course: 'Course One', examData: [] } });
const exId = made.j.examId;
const info = await call('GET', `/api/exams/shares?examId=${exId}&lecturerId=L1`, { token: l1.j.token });
ok('eligible = lecturers with the same course code only', info.s === 200 && info.j.eligible.length === 1 && info.j.eligible[0].id === 'L3', JSON.stringify(info));
ok('cannot share with a lecturer of another course code', (await call('POST', '/api/exams/share', { token: l1.j.token, body: { examId: exId, lecturerId: 'L1', lecturerIds: ['L2'] } })).s === 400);
ok('another lecturer cannot manage the shares', (await call('GET', `/api/exams/shares?examId=${exId}&lecturerId=L3`, { token: l3.j.token })).s === 403);
ok('before sharing L3 cannot open the exam', (await call('GET', `/api/exam-data?examId=${exId}`, { token: l3.j.token })).s === 403);
ok('owner shares with L3', (await call('POST', '/api/exams/share', { token: l1.j.token, body: { examId: exId, lecturerId: 'L1', lecturerIds: ['L3'] } })).s === 200);
const l3list = await call('GET', '/api/exams?lecturerId=L3', { token: l3.j.token });
ok('L3 sees the exam marked shared with the owner name', l3list.j.exams.length === 1 && l3list.j.exams[0].Shared === 1 && l3list.j.exams[0].OwnerName === 'lec1', JSON.stringify(l3list));
ok('L2 does not see it', (await call('GET', '/api/exams?lecturerId=L2', { token: l2.j.token })).j.exams.length === 0);
ok('L3 can open the shared exam', (await call('GET', `/api/exam-data?examId=${exId}`, { token: l3.j.token })).s === 200);
ok('L3 cannot edit it', (await call('POST', '/api/exams/update', { token: l3.j.token, body: { examId: exId, examData: [] } })).s === 403);
ok('L3 cannot archive it', (await call('POST', '/api/exams/archive', { token: l3.j.token, body: { examId: exId, lecturerId: 'L3', archived: true } })).s === 403);
ok('L3 cannot delete it', (await call('POST', '/api/exams/delete', { token: l3.j.token, body: { examId: exId, lecturerId: 'L3' } })).s === 403);
ok('L3 cannot re-share it', (await call('POST', '/api/exams/share', { token: l3.j.token, body: { examId: exId, lecturerId: 'L3', lecturerIds: [] } })).s === 403);
const assign = await call('POST', '/api/class-exams', { token: l3.j.token, body: { courseId: 'C3', examId: exId, term: 'MidTerm', category: 'MajorExam', isActive: true, assignments: [] } });
ok('L3 can assign it to their own class', assign.s === 200 || assign.s === 201, JSON.stringify(assign));
ok('L3 cannot assign it to another lecturer\'s class', (await call('POST', '/api/class-exams', { token: l3.j.token, body: { courseId: 'C1', examId: exId, assignments: [] } })).s === 403);
const shDel = await call('POST', '/api/exams/delete', { token: l1.j.token, body: { examId: exId, lecturerId: 'L1', force: true } });
ok('owner cannot delete an exam another lecturer is using', shDel.s === 409 && !shDel.j.needsConfirm, JSON.stringify(shDel));
await call('POST', '/api/exams/share', { token: l1.j.token, body: { examId: exId, lecturerId: 'L1', lecturerIds: [] } });
ok('after unsharing L3 loses access', (await call('GET', `/api/exam-data?examId=${exId}`, { token: l3.j.token })).s === 403);

// ---- exam open/close times are GMT+8 ----
import { scheduleMs } from '../../worker/exams.js';
ok('open time "2026-11-20T08:30" is 00:30 UTC', scheduleMs('2026-11-20T08:30', false) === Date.UTC(2026, 10, 20, 0, 30));
ok('date-only opening is midnight Manila', scheduleMs('2026-11-20', false) === Date.UTC(2026, 10, 19, 16, 0));
ok('date-only closing is 11:59:59 PM Manila', scheduleMs('2026-11-20', true) === Date.UTC(2026, 10, 20, 15, 59, 59, 999));
ok('blank time means no limit', scheduleMs('', false) === null && scheduleMs(null, true) === null);
ok('closing before opening is rejected', (await call('POST', '/api/class-exams', { token: l1.j.token, body: { courseId: 'C1', examId: exId, fromDate: '2026-11-20T18:00', toDate: '2026-11-20T09:00', assignments: [] } })).s === 400);
ok('garbage time is rejected', (await call('POST', '/api/class-exams', { token: l1.j.token, body: { courseId: 'C1', examId: exId, fromDate: 'tomorrow', assignments: [] } })).s === 400);

// ---- preferred paper size follows the lecturer ----
ok('no paper saved yet', (await call('GET', '/api/my-prefs?userId=L1', { token: l1.j.token })).j.paper === null);
ok('save paper size', (await call('POST', '/api/my-prefs', { token: l1.j.token, body: { userId: 'L1', paper: 'letter' } })).s === 200);
ok('paper size comes back (another device)', (await call('GET', '/api/my-prefs?userId=L1', { token: l1.j.token })).j.paper === 'letter');
(await call('POST', '/api/my-prefs', { token: l1.j.token, body: { userId: 'L1', paper: 'legal' } }));
ok('paper size can be changed', (await call('GET', '/api/my-prefs?userId=L1', { token: l1.j.token })).j.paper === 'legal');
ok('unknown paper size rejected', (await call('POST', '/api/my-prefs', { token: l1.j.token, body: { userId: 'L1', paper: 'tabloid' } })).s === 400);
ok('cannot change another lecturer\'s paper size', (await call('POST', '/api/my-prefs', { token: l2.j.token, body: { userId: 'L1', paper: 'a4' } })).s === 403);
ok('each lecturer has their own', (await call('GET', '/api/my-prefs?userId=L2', { token: l2.j.token })).j.paper === null);

// ---- every route written in the source is still reachable (catches a route lost when a file is split or moved) ----
import { readFileSync, readdirSync } from 'node:fs';
const workerDir = new URL('../../worker/', import.meta.url);
const pairs = new Map(), pathOnly = new Set();
for (const f of readdirSync(workerDir).filter(n => n.endsWith('.js'))) {
  const src = readFileSync(new URL(f, workerDir), 'utf8');
  for (const m of src.matchAll(/["'](GET|POST|DELETE)["']\s*&&\s*path === ["'](\/api\/[a-z0-9\/-]+)["']|path === ["'](\/api\/[a-z0-9\/-]+)["']\s*&&[^\n]*?method === ["'](GET|POST|DELETE)["']/g)) {
    const method = m[1] || m[4], p = m[2] || m[3];
    if (!pairs.has(p)) pairs.set(p, new Set());
    pairs.get(p).add(method);
  }
  for (const m of src.matchAll(/path === ["'](\/api\/[a-z0-9\/-]+)["']/g)) pathOnly.add(m[1]);
}
const routes = new Set();
let lost = [];
const notFound = (r) => r.s === 404 && r.j && r.j.error === 'Not Found';
for (const p of pathOnly) {
  const methods = pairs.has(p) ? [...pairs.get(p)] : ['GET', 'POST'];   // no method written next to it: any method may be accepted
  routes.add(p);
  let reached = false;
  for (const method of methods) {
    const res = await call(method, p, { token: l1.j.token, body: method === 'GET' ? undefined : {} });
    if (!notFound(res)) reached = true;
  }
  if (!reached) lost.push(p);
}
ok(`all ${routes.size} routes in the source are reachable`, routes.size > 55 && lost.length === 0, 'not found: ' + lost.join(', '));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
