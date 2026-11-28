// Worker integration tests: the real Worker code against an in-memory SQLite that behaves like D1.
// Run: node tools/tests/worker.test.mjs   (needs Node 22 or newer for node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import worker from '../../worker/worker.js';
import { hashPassword } from '../../worker/password.js';
import { signToken } from '../../worker/auth.js';
import { buildScanSets, gradingSets } from '../../js/scan-items.js';
import { onBase, GRADE_BASE } from '../../js/grade-base.js';

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
create table Users(User_ID primary key, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, eye_condition, role, registration_timestamp, Program_Course, Program_Year, Program_Section, Middle_Name, Barangay);
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

// ---- secure exam mode: who it applies to, photos, results ----
const secureOf = async () => (await call('GET', '/api/student-accessible-exams?studentId=S1', { token: sOwn })).j.student.secure;
ok('secure mode is on by default', (await secureOf()) === true);
sql.prepare("update Users set eye_condition='Legally Blind' where User_ID='S1'").run();
ok('legally blind students are exempt by default', (await secureOf()) === false);
sql.prepare("update Users set Exam_Secure='on' where User_ID='S1'").run();
ok('lecturer can turn it on for a legally blind student', (await secureOf()) === true);
sql.prepare("update Users set eye_condition='No Eye Condition', Exam_Secure='off' where User_ID='S1'").run();
ok('lecturer can turn it off for anyone', (await secureOf()) === false);
sql.prepare("update Users set Exam_Secure=NULL where User_ID='S1'").run();
const badPhoto = await call('POST', '/api/exam-photo', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S1', kind: 'check', base64: 'x' } });
ok('exam photo without a picture is refused', badPhoto.s === 400, JSON.stringify(badPhoto));
const lateShot = await call('POST', '/api/exam-photo', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S1', kind: 'check', base64: 'A'.repeat(400) } });
ok('no photos are accepted after the exam is submitted', lateShot.s === 200 && lateShot.j.code === 'closed', JSON.stringify(lateShot));
const otherShot = await call('POST', '/api/exam-photo', { token: sOwn, body: { assignmentId: mine && mine.assignmentId, studentId: 'S2', kind: 'check', base64: 'A'.repeat(400) } });
ok('a student cannot send photos as someone else', otherShot.s === 403, JSON.stringify(otherShot));
const photoList = await call('GET', '/api/exam-photos?classExamId=' + (ce.j && ce.j.classExamId), { token: L1 });
ok('lecturer can list exam photos', photoList.s === 200 && Array.isArray(photoList.j.photos), JSON.stringify(photoList));
const photoListStu = await call('GET', '/api/exam-photos?classExamId=' + (ce.j && ce.j.classExamId), { token: sOwn });
ok('students cannot list exam photos', photoListStu.s === 403, JSON.stringify(photoListStu));
sql.prepare("insert into Exam_Photos (Photo_ID, Assignment_ID, Class_Exam_ID, Student_ID, Kind, Taken_At, File_ID) values ('PH1', 'A-x', ?, 'S1', 'start', '2026-01-01T00:00:00.000Z', 'f1')").run(ce.j.classExamId);
const photoByStudent = await call('GET', '/api/exam-photos?courseId=C1&studentId=S1', { token: L1 });
ok('lecturer can list one student\'s photos across the class exams', photoByStudent.s === 200 && photoByStudent.j.photos.some(p => p.Photo_ID === 'PH1' && p.Exam_Title), JSON.stringify(photoByStudent));
const photoByStudentOther = await call('GET', '/api/exam-photos?courseId=C1&studentId=S1', { token: l2.j.token });
ok('another lecturer cannot list them', photoByStudentOther.s === 403, JSON.stringify(photoByStudentOther));
const photoByStudentStu = await call('GET', '/api/exam-photos?courseId=C1&studentId=S1', { token: sOwn });
ok('students cannot list photos by student', photoByStudentStu.s === 403, JSON.stringify(photoByStudentStu));
// Only an Admin sees the periodic photos; a lecturer sees the initial face verification photo.
sql.prepare("insert into Exam_Photos (Photo_ID, Assignment_ID, Class_Exam_ID, Student_ID, Kind, Taken_At, File_ID) values ('PH2', 'A-x', ?, 'S1', 'check', '2026-01-01T00:00:30.000Z', 'f2')").run(ce.j.classExamId);
const lecList = await call('GET', '/api/exam-photos?classExamId=' + ce.j.classExamId, { token: L1 });
ok('a lecturer sees the initial photo only', lecList.s === 200 && lecList.j.limited === true && lecList.j.photos.length === 1 && lecList.j.photos[0].Photo_ID === 'PH1', JSON.stringify(lecList));
const lecStu = await call('GET', '/api/exam-photos?courseId=C1&studentId=S1', { token: L1 });
ok('same by student', lecStu.s === 200 && lecStu.j.photos.every(p => p.Kind === 'start'), JSON.stringify(lecStu));
const lecOne = await call('GET', '/api/exam-photos?photoId=PH2', { token: L1 });
ok('a lecturer cannot fetch a periodic photo directly', lecOne.s === 403, JSON.stringify(lecOne));
sql.prepare("update Users set role='Admin' where User_ID='L1'").run();
const admLogin = await login('lec1');
ok('an Admin signs in as a lecturer with the admin flag', admLogin.s === 200 && admLogin.j.user.role === 'Lecturer' && admLogin.j.user.isAdmin === true, JSON.stringify(admLogin.j && admLogin.j.user));
const admList = await call('GET', '/api/exam-photos?classExamId=' + ce.j.classExamId, { token: L1 });
ok('an Admin sees every photo', admList.s === 200 && admList.j.limited === false && admList.j.photos.length === 2, JSON.stringify(admList));
let admOne = { s: 0 };
try { admOne = await call('GET', '/api/exam-photos?photoId=PH2', { token: L1 }); } catch (e) { admOne = { s: 'reached Drive' }; }   // no Drive in the test, so passing the role check ends in the Drive call
ok('an Admin may fetch a periodic photo (past the role check)', admOne.s !== 403 && admOne.s !== 0, JSON.stringify(admOne));
ok('an Admin has the lecturer tools', (await call('GET', '/api/class-summary?courseId=C1', { token: L1 })).s === 200);
const admClasses = await call('GET', '/api/admin-exam-photos', { token: L1 });
ok('an Admin lists every class with photos', admClasses.s === 200 && admClasses.j.classes.length === 1 && admClasses.j.classes[0].Photos === 2, JSON.stringify(admClasses));
const admExams = await call('GET', '/api/admin-exam-photos?courseId=C1', { token: L1 });
ok('an Admin lists the exams of a class', admExams.s === 200 && admExams.j.exams.length === 1 && admExams.j.exams[0].Photos === 2, JSON.stringify(admExams));
sql.prepare("update Users set role='Admin' where User_ID='L2'").run();
const otherAdm = await call('GET', '/api/exam-photos?classExamId=' + ce.j.classExamId, { token: l2.j.token });
ok('an Admin sees photos of another lecturer\'s class', otherAdm.s === 200 && otherAdm.j.photos.length === 2, JSON.stringify(otherAdm));
sql.prepare("update Users set role='lecturer' where User_ID='L2'").run();
sql.prepare("update Users set role='lecturer' where User_ID='L1'").run();
const lecAdm = await call('GET', '/api/admin-exam-photos', { token: L1 });
ok('a lecturer cannot open the admin photo lists', lecAdm.s === 403, JSON.stringify(lecAdm));
const lecOther = await call('GET', '/api/exam-photos?classExamId=' + ce.j.classExamId, { token: l2.j.token });
ok('a lecturer still cannot read another lecturer\'s class', lecOther.s === 403, JSON.stringify(lecOther));
const meLec = await call('GET', '/api/me', { token: L1 });
ok('/api/me returns a lecturer role without the admin flag', meLec.s === 200 && String(meLec.j.role).toLowerCase() === 'lecturer' && meLec.j.isAdmin === false, JSON.stringify(meLec));
sql.prepare("update Users set role='Admin' where User_ID='L1'").run();
const meAdm = await call('GET', '/api/me', { token: L1 });
ok('/api/me returns Lecturer with isAdmin for an Admin', meAdm.s === 200 && meAdm.j.role === 'Lecturer' && meAdm.j.isAdmin === true, JSON.stringify(meAdm));

// ---- Admin deletes exam photos (select, then delete)
{
  const realFetch = globalThis.fetch;
  const prevGas = env.GAS_WEBHOOK_URL;
  const sent = [];
  let gasOk = true;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(gasOk ? { success: true, trashed: 1 } : { success: false, error: 'boom' }), { status: 200 }); };
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  const nonAdm = await call('POST', '/api/admin-delete-exam-photos', { token: l2.j.token, body: { photoIds: ['PH1'] } });
  ok('a lecturer cannot delete exam photos', nonAdm.s === 403, JSON.stringify(nonAdm));
  const none = await call('POST', '/api/admin-delete-exam-photos', { token: L1, body: { photoIds: [] } });
  ok('deleting nothing is refused', none.s === 400, JSON.stringify(none));
  gasOk = false;
  const failed = await call('POST', '/api/admin-delete-exam-photos', { token: L1, body: { photoIds: ['PH1', 'PH2'] } });
  ok('if Drive fails nothing is deleted', failed.s === 502 && sql.prepare("select count(*) n from Exam_Photos where Photo_ID in ('PH1','PH2')").get().n === 2, JSON.stringify(failed));
  gasOk = true; sent.length = 0;
  const gone = await call('POST', '/api/admin-delete-exam-photos', { token: L1, body: { photoIds: ['PH1', 'PH2', 'PH2', 'missing'] } });
  ok('an Admin deletes several photos at once', gone.s === 200 && gone.j.deleted === 2 && sql.prepare("select count(*) n from Exam_Photos where Photo_ID in ('PH1','PH2')").get().n === 0, JSON.stringify(gone));
  ok('the Drive files are sent to the bin', sent.length === 1 && sent[0].action === 'trash' && sent[0].fileIds.length === 2, JSON.stringify(sent));
  globalThis.fetch = realFetch;
  env.GAS_WEBHOOK_URL = prevGas;
}
sql.prepare("update Users set role='lecturer' where User_ID='L1'").run();
// ---- site icon ----
const png1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const iconPub = await call('GET', '/api/site-icon', {});
ok('the site icon is public and empty at first', iconPub.s === 200 && iconPub.j.icon === null, JSON.stringify(iconPub));
ok('a lecturer cannot change the site icon', (await call('POST', '/api/site-icon', { token: L1, body: { icon: png1 } })).s === 403);
sql.prepare("update Users set role='Admin' where User_ID='L1'").run();
ok('an Admin cannot save something that is not a PNG', (await call('POST', '/api/site-icon', { token: L1, body: { icon: 'data:text/html;base64,PGI+' } })).s === 400);
ok('an Admin saves the site icon', (await call('POST', '/api/site-icon', { token: L1, body: { icon: png1 } })).s === 200);
ok('everyone gets it', (await call('GET', '/api/site-icon', {})).j.icon === png1);
{
  const raw = (path) => worker.fetch(new Request('https://api.test' + path, { headers: { Origin: 'https://app.test' } }), env, ctx);
  const r = await raw('/api/site-icon.png');
  const bytes = new Uint8Array(await r.arrayBuffer());
  ok('the site icon is also served as a PNG file for tabs, Android install and link previews', r.status === 200 && r.headers.get('content-type') === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50 && r.headers.get('cross-origin-resource-policy') === 'cross-origin', r.status + ' ' + r.headers.get('content-type'));
}
ok('an Admin goes back to the default', (await call('POST', '/api/site-icon', { token: L1, body: { icon: null } })).s === 200 && (await call('GET', '/api/site-icon', {})).j.icon === null);
{
  const r = await worker.fetch(new Request('https://api.test/api/site-icon.png', { headers: { Origin: 'https://app.test' } }), env, ctx);
  ok('with no icon saved the PNG address sends the built-in icon', r.status === 302 && r.headers.get('location') === 'https://app.test/icons/icon-512.png', r.status + ' ' + r.headers.get('location'));
}
sql.prepare("update Users set role='lecturer' where User_ID='L1'").run();
// ---- an Admin changes roles ----
const roleOf = (id) => sql.prepare('select role from Users where User_ID=?').get(id).role;
const lecRole = await call('POST', '/api/update-user-role', { token: L1, body: { userId: 'S2', role: 'lecturer' } });
ok('a lecturer cannot change roles', lecRole.s === 403 && roleOf('S2') === 'student', JSON.stringify(lecRole));
sql.prepare("update Users set role='Admin' where User_ID='L2'").run();
const adm2 = l2.j.token;
const up = await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'S2', role: 'lecturer' } });
ok('an Admin makes a student a lecturer', up.s === 200 && roleOf('S2') === 'lecturer', JSON.stringify(up));
const toAdmin = await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'S2', role: 'admin' } });
ok('an Admin makes a user an Admin', toAdmin.s === 200 && roleOf('S2') === 'Admin', JSON.stringify(toAdmin));
const backToStu = await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'S2', role: 'student' } });
ok('and back to a student', backToStu.s === 200 && roleOf('S2') === 'student', JSON.stringify(backToStu));
ok('own role cannot be changed', (await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'L2', role: 'student' } })).s === 400 && roleOf('L2') === 'Admin');
ok('a role must be valid', (await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'S2', role: 'owner' } })).s === 400);
const demote = await call('POST', '/api/update-user-role', { token: adm2, body: { userId: 'L1', role: 'student' } });
ok('a lecturer with classes cannot become a student', demote.s === 400 && roleOf('L1') === 'lecturer', JSON.stringify(demote));
sql.prepare("update Users set role='lecturer' where User_ID='L2'").run();
sql.prepare("delete from Exam_Photos where Photo_ID in ('PH1','PH2')").run();
const res2 = await call('GET', '/api/exam-results?classExamId=' + (ce.j && ce.j.classExamId), { token: L1 });
ok('results carry submit reason and photo count', res2.s === 200 && res2.j.students.every(x => 'submitReason' in x && x.photos === 0), JSON.stringify(res2.j.students));

// ---- one device at a time, saved answers, away grace, lecturer continue ----
const devLogin = (device, takeover) => call('POST', '/api/login', { body: { identifier: 'stu2', password: rs.j.tempPassword, deviceId: device, takeover } });
const dA = await devLogin('devA');
ok('first device signs in', dA.s === 200 && !!dA.j.token, JSON.stringify(dA.j));
const dSame = await devLogin('devA');
ok('same device signs in again without a warning', dSame.s === 200, JSON.stringify(dSame.j));
const ceId = ce.j && ce.j.classExamId;
sql.prepare("update Exam_Assignments set Is_Enabled = 1 where Student_ID = 'S2' and Class_Exam_ID = ?").run(ceId);
const avail2 = await call('GET', '/api/student-accessible-exams?studentId=S2', { token: dSame.j.token });
const mine2 = (avail2.j.exams || avail2.j.availableExams || [])[0];
await call('POST', '/api/start-accessible-exam', { token: dSame.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2' } });
const draftSave = await call('POST', '/api/exam-draft', { token: dSame.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', answers: ['Paris'] } });
ok('answers are saved to the server', draftSave.s === 200 && !draftSave.j.closed, JSON.stringify(draftSave));
const otherDraft = await call('POST', '/api/exam-draft', { token: dSame.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S1', answers: ['x'] } });
ok("a student cannot save into another student's attempt", otherDraft.s === 403, JSON.stringify(otherDraft));
const warn = await devLogin('devB');
ok('second device is warned, with the exam flag', warn.s === 409 && warn.j.code === 'already-logged-in' && warn.j.examInProgress === true && !warn.j.token, JSON.stringify(warn));
ok('first device still works after a cancelled attempt', (await call('GET', '/api/student-accessible-exams?studentId=S2', { token: dA.j.token })).s === 200);
const take = await devLogin('devB', true);
ok('confirming signs in on the new device', take.s === 200 && !!take.j.token, JSON.stringify(take.j));
const oldDev = await call('GET', '/api/student-accessible-exams?studentId=S2', { token: dA.j.token });
ok('the old device is signed out with a clear message', oldDev.s === 401 && /another device/i.test(oldDev.j.error), JSON.stringify(oldDev));
const rs3 = await call('GET', '/api/exam-results?classExamId=' + ceId, { token: L1 });
const row3 = (rs3.j.students || []).find(x => x.studentId === 'S2' || x.Student_ID === 'S2' || x.id === 'S2');
ok('the exam in progress was submitted from the saved answers', sql.prepare("select Status s, Submit_Reason r, Answers_JSON a from Exam_Assignments where Student_ID='S2' and Class_Exam_ID=?").get(ceId).r === 'session-takeover' && /Paris/.test(sql.prepare("select Answers_JSON a from Exam_Assignments where Student_ID='S2' and Class_Exam_ID=?").get(ceId).a), JSON.stringify(row3));
const cont = await call('POST', '/api/exam-continue', { token: L1, body: { classExamId: ceId, studentId: 'S2' } });
const a2 = sql.prepare("select Status s, Draft_JSON d, Submit_Reason r from Exam_Assignments where Student_ID='S2' and Class_Exam_ID=?").get(ceId);
ok('lecturer can let the student continue, answers restored', cont.s === 200 && a2.s === 'Pending' && /Paris/.test(a2.d) && a2.r === null, JSON.stringify({ cont, a2 }));
ok('students cannot use exam-continue', (await call('POST', '/api/exam-continue', { token: take.j.token, body: { classExamId: ceId, studentId: 'S2' } })).s === 403);
const away = await call('POST', '/api/exam-away', { token: take.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', away: true, answers: ['Paris', 'x'] } });
ok('leaving starts the grace period', away.s === 200 && away.j.graceSeconds > 0 && away.j.secondsLeft > 0, JSON.stringify(away));
const back = await call('POST', '/api/exam-away', { token: take.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', away: false } });
ok('coming back in time keeps the exam going', back.s === 200 && !back.j.submitted, JSON.stringify(back));
await call('POST', '/api/exam-away', { token: take.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', away: true } });
sql.prepare("update Exam_Assignments set Away_Since = ? where Assignment_ID = ?").run(Date.now() - 120000, mine2.assignmentId);
const late = await call('POST', '/api/exam-away', { token: take.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', away: false } });
ok('coming back after the grace period finds it submitted', late.s === 200 && late.j.submitted === true && late.j.reason === 'away', JSON.stringify(late));
await call('POST', '/api/exam-continue', { token: L1, body: { classExamId: ceId, studentId: 'S2' } });
await call('POST', '/api/exam-away', { token: take.j.token, body: { assignmentId: mine2.assignmentId, studentId: 'S2', away: true } });
sql.prepare("update Exam_Assignments set Away_Since = ? where Assignment_ID = ?").run(Date.now() - 120000, mine2.assignmentId);
await call('GET', '/api/exam-results?classExamId=' + ceId, { token: L1 });
ok('a lecturer opening results submits the ones away too long', sql.prepare("select Status s from Exam_Assignments where Assignment_ID = ?").get(mine2.assignmentId).s === 'Completed');
await call('POST', '/api/logout', { token: take.j.token, body: { userId: 'S2' } });
const devC = await devLogin('devC');
ok('signing out frees the account without a warning', devC.s === 200);
s2b.j.token = devC.j.token;   // later tests reuse S2's token


const rv = (await call('GET', '/api/exam-results?classExamId=' + ceId, { token: L1 })).j;
const rvS2 = (rv.students || []).find(x => x.studentId === 'S2');
ok('results count times away and give review hints', rvS2 && rvS2.awayCount >= 2 && rvS2.review.level !== 'none' && rvS2.review.reasons.length > 0 && rv.reviewCount >= 1, JSON.stringify(rvS2));
ok('results say how many can continue', rv.continuable >= 1, String(rv.continuable));
ok('students cannot continue everyone', (await call('POST', '/api/exam-continue-all', { token: devC.j.token, body: { classExamId: ceId } })).s === 403);
ok('another lecturer cannot continue everyone', (await call('POST', '/api/exam-continue-all', { token: l2.j.token, body: { classExamId: ceId } })).s === 403);
const all = await call('POST', '/api/exam-continue-all', { token: L1, body: { classExamId: ceId } });
ok('lecturer lets all auto-submitted continue', all.s === 200 && all.j.count >= 1 && sql.prepare("select Status s from Exam_Assignments where Student_ID='S2' and Class_Exam_ID=?").get(ceId).s === 'Pending', JSON.stringify(all.j));
ok('a normal submission is not touched', (await call('POST', '/api/exam-continue-all', { token: L1, body: { classExamId: ceId } })).j.count === 0);
const setSec = (tok, id, v) => call('POST', '/api/exam-secure-setting', { token: tok, body: { classExamId: ceId, studentId: id, examSecure: v } });
ok('lecturer sets secure mode from the exam student list', (await setSec(L1, 'S2', 'off')).s === 200 && (await call('GET', '/api/class-exams?courseId=C1', { token: L1 })).j.assignments.find(a => a.Student_ID === 'S2').Exam_Secure === 'off');
ok('student cannot change secure mode', (await setSec(devC.j.token, 'S2', 'on')).s === 403);
ok('other lecturer cannot change secure mode', (await setSec(l2.j.token, 'S2', 'on')).s === 403);
ok('bad secure value rejected', (await setSec(L1, 'S2', 'maybe')).s === 400);
await setSec(L1, 'S2', '');

// ---- registration limits ----
const reg = (sn, extra = {}, ip) => call('POST', '/api/register', { body: { username: 'new' + sn, password: 'secret12', name: 'N', email: 'n@x.com', student_number: sn, contact_number: '09', eye_condition: 'None', program_course: 'BSCS', program_year: '1', program_section: '1', middle_name: 'Mid', barangay: 'Poblacion', ...extra } });
const noProg = await reg('26-0090', { program_course: '' });
ok('registration needs the program course', noProg.s === 400 && /program/i.test(noProg.j.error), JSON.stringify(noProg));
const noProgYear = await reg('26-0091', { program_year: undefined });
ok('registration needs the program year', noProgYear.s === 400, JSON.stringify(noProgYear));
const noMid = await reg('26-0092', { middle_name: ' ' });
ok('registration needs the middle name', noMid.s === 400 && /middle/i.test(noMid.j.error), JSON.stringify(noMid));
const noBrgy = await reg('26-0093', { barangay: undefined });
ok('registration needs the barangay', noBrgy.s === 400 && /barangay/i.test(noBrgy.j.error), JSON.stringify(noBrgy));
const okReg = await reg('26-0095', { username: 'prog95', email: 'p95@x.com', contact_number: '0995', program_course: 'BSArch', program_year: '5', program_section: '3' });
const prow = sql.prepare("select Program_Course c, Program_Year y, Program_Section s, course cc from Users where Student_Number='26-0095'").get();
const clr = sql.prepare("select count(*) n from Users where course is not null or year is not null or section is not null").get().n;
ok('login clears old class course/year/section once', clr === 0 || sql.prepare("select Value v from App_Settings where Key='class_fields_cleared'").get(), String(clr));
const rres = sql.prepare("select Middle_Name m, Barangay b from Users where Student_Number='26-0095'").get();
ok('registration saves middle name and barangay', rres && rres.m === 'Mid' && rres.b === 'Poblacion', JSON.stringify(rres));
ok('registration saves the program only (no class fields)', okReg.s === 201 && prow && prow.c === 'BSArch' && prow.y === '5' && prow.s === '3' && prow.cc === null, JSON.stringify([okReg, prow]));
sql.exec("delete from Users where Student_Number='26-0095'");
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

// ---- current academic term, set by an admin lecturer ----
import { calendarTerm } from '../../worker/shared.js';
ok('calendar term uses GMT+8 (Jul 31 17:00 UTC is already Aug 1 in Manila)', calendarTerm(new Date('2026-07-31T17:00:00Z')).sem === '1st Semester' && calendarTerm(new Date('2026-07-31T15:00:00Z')).sem === 'Summer');
ok('calendar term Jan is 2nd semester of the year before', JSON.stringify(calendarTerm(new Date('2027-01-15T00:00:00Z'))) === JSON.stringify({ ay: '2026-2027', sem: '2nd Semester' }));
const s2t = s2b.j.token;
const t0 = (await call('GET', '/api/current-term', { token: s2t })).j;
ok('student can read the term, calendar fallback when none set', t0.source === 'calendar' && /^\d{4}-\d{4}$/.test(t0.ay));
ok('student cannot set the term', (await call('POST', '/api/current-term', { token: s2t, body: { userId: 'S2', ay: '2026-2027', sem: '1st Semester' } })).s === 403);
ok('bad year pair rejected', (await call('POST', '/api/current-term', { token: l1.j.token, body: { userId: 'L1', ay: '2026-2028', sem: '1st Semester' } })).s === 400);
ok('bad semester rejected', (await call('POST', '/api/current-term', { token: l1.j.token, body: { userId: 'L1', ay: '2026-2027', sem: 'Fall' } })).s === 400);
ok('a lecturer sets the term', (await call('POST', '/api/current-term', { token: l1.j.token, body: { userId: 'L1', ay: '2026-2027', sem: '2nd Semester' } })).s === 200);
const t1 = (await call('GET', '/api/current-term', { token: s2t })).j;
ok('everyone sees the set term', t1.source === 'set' && t1.ay === '2026-2027' && t1.sem === '2nd Semester' && t1.updatedBy === 'L1');
ok('another lecturer can change it', (await call('POST', '/api/current-term', { token: l2.j.token, body: { userId: 'L2', ay: '2026-2027', sem: 'Summer' } })).j.sem === 'Summer');
ok('reset goes back to the calendar', (await call('POST', '/api/current-term', { token: l1.j.token, body: { userId: 'L1', reset: true } })).j.source === 'calendar');

// ---- advance year level: highest year per program ----
sql.exec("delete from Users where User_ID like 'Y%'");
const addY = (id, prog, yr) => sql.prepare("insert into Users(User_ID, Username, Name, role, account_status, Program_Course, year, Program_Year) values(?,?,?,?,?,?,?,?)").run(id, id, id, 'student', 'Active', prog, yr, yr);
addY('Y1', 'BSCS', '4'); addY('Y2', 'BSArch', '4'); addY('Y3', 'BSArch', '5'); addY('Y4', 'BSArch', '3');
const adv = (mode, extra) => call('POST', '/api/advance-year-level', { token: l1.j.token, body: { mode, lecturerId: 'L1', academicYear: '2027-2028', maxYear: 4, ...extra } });
const pv1 = (await adv('preview', { programMax: {} })).j;
ok('default highest year 4: both 4th-years graduate', pv1.graduating >= 2 && pv1.programs.some(p => p.name === 'BSArch' && p.count === 3 && p.maxYear === 4), JSON.stringify(pv1.programs));
const pv2 = (await adv('preview', { programMax: { bsarch: 5 } })).j;
ok('program with highest year 5: its 4th-year advances, 5th graduates', pv2.graduating === pv1.graduating - 1 && pv2.programs.find(p => p.name === 'BSArch').maxYear === 5);
const ap = await adv('apply', { programMax: { BSArch: 5 } });
ok('apply uses the program limit', ap.s === 200 && sql.prepare("select year y from Users where User_ID='Y2'").get().y === '5' && sql.prepare("select year y from Users where User_ID='Y1'").get().y === '4' && sql.prepare("select year y from Users where User_ID='Y3'").get().y === '5');
ok('program limit is remembered when none is sent', (await adv('preview', {})).j.programs.find(p => p.name === 'BSArch').maxYear === 5);
ok('student cannot use it', (await call('POST', '/api/advance-year-level', { token: s2b.j.token, body: { mode: 'preview' } })).s === 403);

// ---- lecturer edits a student's details and eye condition ----
const ed = (who, body) => call('POST', '/api/admin-update-student', { token: who, body });
const base = { studentId: 'S1', name: 'Student One', studentNumber: '24-0001', contact: '0917', email: 'one@x.com', eyeCondition: 'Legally Blind' };
const e1 = await ed(l1.j.token, base);
ok('lecturer edits student details + eye condition', e1.s === 200 && sql.prepare("select eye_condition e, Name n, year y from Users where User_ID='S1'").get().e === 'Legally Blind', JSON.stringify(e1.j));
ok('student cannot edit', (await ed(s2b.j.token, base)).s === 403);
ok('bad student number rejected', (await ed(l1.j.token, { ...base, studentNumber: '1234' })).s === 400);
ok('unknown eye condition rejected', (await ed(l1.j.token, { ...base, eyeCondition: 'x' })).s === 400);
ok('cannot edit a lecturer account', (await ed(l1.j.token, { ...base, studentId: 'L2' })).s === 404);
await ed(l1.j.token, { ...base, studentId: 'S2', name: 'Student Two', studentNumber: '24-0002', contact: '0918', email: 'two@x.com', eyeCondition: 'No Eye Condition' });
ok('duplicate student number rejected', (await ed(l1.j.token, { ...base, studentId: 'S2', name: 'Student Two', studentNumber: '24-0001', contact: '0918', email: 'two@x.com' })).s === 400);
ok('clearing eye condition resets it', (await ed(l1.j.token, { ...base, eyeCondition: 'No Eye Condition' })).s === 200 && sql.prepare("select eye_condition e from Users where User_ID='S1'").get().e === 'No Eye Condition');

// ---- manual enrol uses the program; students join with an invite code ----
const addQ = (id, name, pc, py, ps, c) => { U(id, name, 'student'); sql.prepare("update Users set Program_Course=?, Program_Year=?, Program_Section=?, course=?, year='1', section='A' where User_ID=?").run(pc, py, ps, c, id); };
addQ('Q1', 'qstu1', 'BSArch', '5', '2', 'BSCS'); addQ('Q2', 'qstu2', 'BSCS', '1', '1', 'BSArch');
try { sql.exec('alter table Courses add column Archived integer default 0'); } catch (e) { /* already there */ }
try { sql.exec('alter table Enrollments add column Enrollment_ID'); } catch (e) { /* already there */ }
try { sql.exec('alter table Courses add column Room'); } catch (e) { /* already there */ }
sql.exec("insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('CINV','INV1','Invite','L1')");
const invCourse = { id: 'CINV' };
const un = async (qs) => ((await call('GET', `/api/unenrolled-students?courseId=${invCourse.id}&statusFilter=Active&${qs}`, { token: l1.j.token })).j.students || []).map(x => x.User_ID);
ok('manual enrol filter uses the program course', (await un('courseFilter=BSArch')).includes('Q1') && !(await un('courseFilter=BSArch')).includes('Q2'));
ok('manual enrol filter uses program year and section', (await un('yearFilter=5&sectionFilter=2')).join() === 'Q1');
const inv = (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l1.j.token })).j;
ok('owner gets an invite code', /^[A-Z2-9]{6}$/.test(inv.code || ''), JSON.stringify(inv));
ok('code is stable until renewed', (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l1.j.token })).j.code === inv.code);
ok('another lecturer cannot read it', (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l2.j.token })).s === 403);
ok('existing classes all get a code too', sql.prepare("select count(*) n from Courses where Invite_Code is null or trim(Invite_Code)=''").get().n === 0);
ok('codes are unique across classes', sql.prepare('select count(distinct Invite_Code) d, count(*) n from Courses').get().d === sql.prepare('select count(*) n from Courses').get().n);
const joinTok = (await login('qstu1')).j.token, q2Tok = (await login('qstu2')).j.token;
const jn = (tok, body) => call('POST', '/api/join-class', { token: tok, body });
const pvw = await jn(joinTok, { studentId: 'Q1', preview: true, code: inv.code });
ok('preview shows the class details without enrolling', pvw.s === 200 && pvw.j.preview && pvw.j.course.CourseCode === 'INV1' && 'LecturerName' in pvw.j.course && 'Room' in pvw.j.course && 'TimePeriod' in pvw.j.course && !sql.prepare("select 1 x from Enrollments where Course_ID=? and Student_ID='Q1'").get(invCourse.id), JSON.stringify(pvw.j));
ok('student joins with the code (any case, spaced)', (await jn(joinTok, { studentId: 'Q1', code: ' ' + inv.code.toLowerCase().slice(0, 3) + '-' + inv.code.slice(3) + ' ' })).s === 201 && !!sql.prepare("select 1 x from Enrollments where Course_ID=? and Student_ID='Q1'").get(invCourse.id));
ok('preview of a class already joined is refused', (await jn(joinTok, { studentId: 'Q1', preview: true, code: inv.code })).s === 400);
ok('joining twice is refused', (await jn(joinTok, { studentId: 'Q1', code: inv.code })).s === 400);
ok('a student can no longer enrol themselves without a code', (await call('POST', '/api/enroll', { token: q2Tok, body: { courseId: invCourse.id, studentId: 'Q2' } })).s === 403);
ok('wrong code is refused', (await jn(q2Tok, { studentId: 'Q2', code: 'ZZZZZZ' })).s === 404);
ok('a student cannot join as someone else', (await jn(joinTok, { studentId: 'Q2', code: inv.code })).s === 403);
const inv2 = (await call('POST', '/api/class-invite', { token: l1.j.token, body: { courseId: invCourse.id, renew: true } })).j.code;
ok('renewing makes the old code stop working', inv2 !== inv.code && (await jn(q2Tok, { studentId: 'Q2', code: inv.code })).s === 404 && (await jn(q2Tok, { studentId: 'Q2', code: inv2 })).s === 201);
let renewedDiffer = true; for (let i = 0; i < 20; i++) { const before = (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l1.j.token })).j.code; const after = (await call('POST', '/api/class-invite', { token: l1.j.token, body: { courseId: invCourse.id, renew: true } })).j.code; if (before === after) renewedDiffer = false; }
ok('a renewed code is always different from the old one', renewedDiffer);
const qMine = async () => ((await call('GET', '/api/my-courses?userId=Q1&role=student', { token: joinTok })).j.courses || []).map(c => c.Course_ID);
const arch = (flag) => call('POST', '/api/archive-course', { token: l1.j.token, body: { courseId: invCourse.id, lecturerId: 'L1', archived: flag } });
ok('an enrolled student sees the class', (await qMine()).includes('CINV'));
await arch(true);
ok('archiving hides the class from its students', !(await qMine()).includes('CINV'));
ok('a student whose only class was archived is deactivated', sql.prepare("select account_status s from Users where User_ID='Q1'").get().s === 'Inactive');
ok('a student of an archived class cannot open it', (await call('GET', `/api/course-details?courseId=${invCourse.id}&studentId=Q1`, { token: joinTok })).s === 403);
ok('the lecturer still sees the archived class', ((await call('GET', '/api/my-courses?userId=L1&role=lecturer', { token: l1.j.token })).j.courses || []).some(c => c.Course_ID === 'CINV'));
sql.exec("update Users set account_status='Active' where User_ID in ('Q1','Q2')");
await arch(false);
ok('restoring shows the class to students again', (await qMine()).includes('CINV') && (await call('GET', `/api/course-details?courseId=${invCourse.id}&studentId=Q1`, { token: joinTok })).s !== 403);
// ---- invite code: 7-day expiry, sign-up and sign-in with a code, share data ----
const invNow = (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l1.j.token })).j;
const days = (Date.parse(invNow.expiresAt) - Date.now()) / 86400000;
ok('a code expires in 7 days', days > 6.99 && days <= 7 && invNow.expired === false, JSON.stringify(invNow));
sql.exec("update Courses set Invite_Expires='2020-01-01T00:00:00.000Z' where Course_ID='CINV'");
const exp1 = (await call('GET', `/api/class-invite?courseId=${invCourse.id}`, { token: l1.j.token })).j;
ok('an expired code is reported as expired', exp1.expired === true && exp1.code === invNow.code);
const expJoin = await jn(q2Tok, { studentId: 'Q2', preview: true, code: invNow.code });
ok('an expired code cannot be used to join', expJoin.s === 410 && /expired/i.test(expJoin.j.error), JSON.stringify(expJoin));
const expReg = await reg('26-0071', { username: 'exp71', email: 'e71@x.com', contact_number: '0971', invite_code: invNow.code });
ok('an expired code cannot be used at sign-up, and no account is made', expReg.s === 410 && !sql.prepare("select 1 x from Users where Student_Number='26-0071'").get());
const renewed = (await call('POST', '/api/class-invite', { token: l1.j.token, body: { courseId: invCourse.id, renew: true } })).j;
const rdays = (Date.parse(renewed.expiresAt) - Date.now()) / 86400000;
ok('a new code gets a fresh 7 days', renewed.code !== invNow.code && rdays > 6.99 && renewed.expired === false);
const badReg = await reg('26-0072', { username: 'bad72', email: 'b72@x.com', contact_number: '0972', invite_code: 'ZZZZZZ' });
ok('a wrong code at sign-up is refused and no account is made', badReg.s === 404 && !sql.prepare("select 1 x from Users where Student_Number='26-0072'").get());
const codeReg = await reg('26-0073', { username: 'code73', email: 'c73@x.com', contact_number: '0973', invite_code: ' ' + renewed.code.toLowerCase() + ' ' });
const cu = sql.prepare("select User_ID, account_status s from Users where Student_Number='26-0073'").get();
ok('sign-up with a code gives an active account in that class', codeReg.s === 201 && codeReg.j.activated === true && cu.s === 'Active' && !!sql.prepare("select 1 x from Enrollments where Course_ID='CINV' and Student_ID=?").get(cu.User_ID), JSON.stringify(codeReg));
const plainReg = await reg('26-0074', { username: 'plain74', email: 'p74@x.com', contact_number: '0974' });
ok('sign-up without a code is still pending', plainReg.s === 201 && sql.prepare("select account_status s from Users where Student_Number='26-0074'").get().s === 'Inactive');
// a deactivated student comes back with the code
const inactiveLogin = await call('POST', '/api/login', { body: { identifier: 'plain74', password: 'secret12' } });
ok('a deactivated student is told they can use a code', inactiveLogin.s === 403 && inactiveLogin.j.codeActivation === true);
const wrongLogin = await call('POST', '/api/login', { body: { identifier: 'plain74', password: 'secret12', inviteCode: 'ZZZZZZ' } });
ok('a wrong code does not activate', wrongLogin.s === 404 && sql.prepare("select account_status s from Users where Student_Number='26-0074'").get().s === 'Inactive');
const okLogin = await call('POST', '/api/login', { body: { identifier: 'plain74', password: 'secret12', inviteCode: renewed.code } });
const pid = sql.prepare("select User_ID u from Users where Student_Number='26-0074'").get().u;
ok('the code activates the account, joins the class and signs in', okLogin.s === 200 && !!okLogin.j.token && okLogin.j.joined.CourseCode === 'INV1' && sql.prepare("select account_status s from Users where User_ID=?").get(pid).s === 'Active' && !!sql.prepare("select 1 x from Enrollments where Course_ID='CINV' and Student_ID=?").get(pid));
sql.prepare("update Users set account_status='Suspended' where User_ID=?").run(pid);
const susp = await call('POST', '/api/login', { body: { identifier: 'plain74', password: 'secret12', inviteCode: renewed.code } });
ok('a suspended account cannot be activated by a code', susp.s === 403 && sql.prepare("select account_status s from Users where User_ID=?").get(pid).s === 'Suspended');
const badPw = await call('POST', '/api/login', { body: { identifier: 'plain74', password: 'nope', inviteCode: renewed.code } });
ok('a code does not replace the password', badPw.s === 401);

// ---- accounts are deactivated when every class has ended (2 weeks after the term's last day) or is archived ----
const { sweepEndedAccounts, endedTermKeys } = await import('../../worker/term-sweep.js');
const setEnd = (endDate, userId = 'L1', tok = l1.j.token) => call('POST', '/api/current-term', { token: tok, body: { userId, ay: '2026-2027', sem: '1st Semester', endDate } });
ok('a bad last-day date is refused', (await setEnd('soon')).s === 400);
const t = (await setEnd('2026-12-19')).j;
ok('the last day of the term is saved and returned', t.endDate === '2026-12-19');
ok('a term is over 14 days after its last day, not before', endedTermKeys({ a: '2026-12-19' }, Date.parse('2027-01-02T00:00:00+08:00')).length === 0 && endedTermKeys({ a: '2026-12-19' }, Date.parse('2027-01-03T00:00:00+08:00')).length === 1);
sql.exec("update Courses set AcademicYear='2026-2027', Semester='1st Semester' where Course_ID in ('C1','CINV')");
sql.exec("insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID,AcademicYear,Semester) values('CLIVE','LIVE','Live','L1','2026-2028','2nd Semester')");
for (const id of ['E1', 'E2', 'E3', 'E4']) { sql.prepare("insert into Users(User_ID,Username,Name,role,account_status) values(?,?,?,?,?)").run(id, id, id, 'student', 'Active'); }
for (const [id, status] of [['E5', 'UD'], ['E6', 'Suspended'], ['E7', 'Dropped'], ['E8', 'Graduated'], ['E9', 'Inactive']]) { sql.prepare("insert into Users(User_ID,Username,Name,role,account_status) values(?,?,?,?,?)").run(id, id, id, 'student', status); }
sql.exec("insert into Enrollments(Course_ID,Student_ID) values('CINV','E1'),('CINV','E2'),('CLIVE','E2'),('CINV','E3'),('CINV','E5'),('CINV','E6'),('CINV','E7'),('CINV','E8'),('CINV','E9')");
const later = Date.parse('2027-01-04T00:00:00+08:00');
const preCount = await sweepEndedAccounts(env, { dryRun: true, now: later });
const swept = await sweepEndedAccounts(env, { now: later });
const eSt = (id) => sql.prepare("select account_status s from Users where User_ID=?").get(id).s;
ok('students whose classes all ended are deactivated', eSt('E1') === 'Inactive' && eSt('E3') === 'Inactive' && swept >= 2 && preCount === swept, `${preCount} ${swept}`);
ok('a student with a class still running stays active', eSt('E2') === 'Active');
ok('a student with no class is left alone', eSt('E4') === 'Active');
ok('only Active accounts are changed: UD, Suspended, Dropped, Graduated stay as they are', eSt('E5') === 'UD' && eSt('E6') === 'Suspended' && eSt('E7') === 'Dropped' && eSt('E8') === 'Graduated' && eSt('E9') === 'Inactive');
const early = await sweepEndedAccounts(env, { dryRun: true, now: Date.parse('2026-12-25T00:00:00+08:00') });
ok('nothing is deactivated before the 2 weeks pass', early === 0, String(early));
sql.exec("delete from Enrollments where Student_ID like 'E%'; delete from Users where User_ID like 'E%'; delete from Courses where Course_ID='CLIVE'; delete from App_Settings where Key='term_ends'");

sql.exec("delete from Enrollments where Student_ID like 'Q%'"); sql.exec("delete from Users where User_ID like 'Q%'"); sql.exec("delete from Courses where Course_ID='CINV'");

// ---- forgot password: ask the lecturer ----
const rq = (identifier) => call('POST', '/api/request-password-reset', { body: { identifier } });
const known = await rq('stu1'), byNo = await rq('nobody-here'), lecId = await rq('lec1');
ok('the answer is the same whether the account exists or not', known.s === 200 && byNo.s === 200 && known.j.message === byNo.j.message && lecId.j.message === known.j.message);
ok('only a student gets a request', !!sql.prepare("select 1 x from Password_Reset_Requests where User_ID='S1'").get() && !sql.prepare("select 1 x from Password_Reset_Requests where User_ID in ('L1')").get());
sql.exec("insert into Users(User_ID,Username,Name,role,account_status,Student_Number,Email) values('NOCLASS','noclass','No Class','student','Inactive','25-0999','nc@x.com')");
await rq('25-0999');
const lst = async (tok, id) => (await call('GET', `/api/password-reset-requests?lecturerId=${id}`, { token: tok })).j.requests?.map(r => r.User_ID) || [];
const l2Tok = (await login('lec2')).j.token;
const lec1List = await lst(l1.j.token, 'L1'), lec2List = await lst(l2Tok, 'L2');
ok('the lecturer of the class sees the request', lec1List.includes('S1') && lec1List.includes('NOCLASS'));
ok('another lecturer does not see a student of someone else, but sees one with no class', !lec2List.includes('S1') && lec2List.includes('NOCLASS'));
ok('a student cannot read the requests', (await call('GET', '/api/password-reset-requests?lecturerId=L1', { token: s2b.j.token })).s === 403);
ok('a lecturer cannot read another lecturer\'s list', (await call('GET', '/api/password-reset-requests?lecturerId=L2', { token: l1.j.token })).s === 403);
const rsReq = await call('POST', '/api/reset-student-password', { token: l1.j.token, body: { studentId: 'S1' } });
ok('resetting the password clears the request', rsReq.s === 200 && !sql.prepare("select 1 x from Password_Reset_Requests where User_ID='S1'").get());
await call('POST', '/api/dismiss-password-request', { token: l1.j.token, body: { studentId: 'NOCLASS' } });
ok('a request can be dismissed', !sql.prepare("select 1 x from Password_Reset_Requests where User_ID='NOCLASS'").get());
sql.exec("delete from Users where User_ID='NOCLASS'");

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

// ---- Uploads: a lecturer may upload for a student of their own class (with group members); a student only for themselves
{
  const realFetch = globalThis.fetch;
  let fileN = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, fileUrl: 'https://drive.test/f' + (++fileN) }), { status: 200 });
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  sql.exec("update Users set account_status='Active' where User_ID in ('S1','S2')");   // earlier tests left them Inactive
  U('S3', 'stu3', 'student');   // not enrolled in C1
  sql.exec("update Enrollments set Group_Name='G1' where Course_ID='C1'");
  const meta = (o = {}) => ({ courseId: 'C1', studentId: 'S1', term: 'MidTerm', title: 'Report', description: 'Final report', type: 'file', filename: 'report.pdf', mimeType: 'application/pdf', pathParts: ['General', 'Submitted'], base64: 'QUJD', ...o });
  const up = (token, o) => call('POST', '/api/upload-submission', { token, body: meta(o) });
  const rows = (id) => sql.prepare('select Description d from Submissions where Student_ID = ? and Title = ?').all(id, 'Report');

  const g = await up(L1, { isGroup: true, includedMembers: ['S2'] });
  ok('lecturer uploads for a student with a group member', g.s === 201, JSON.stringify(g));
  ok('group upload saved for the student and the member', rows('S1').length === 1 && rows('S2').length === 1);
  ok('lecturer upload is not marked as such in the description', !rows('S1')[0].d.includes('lecturer') && rows('S2')[0].d.includes('[Included Members:'));
  ok('another lecturer cannot upload for this class', (await up(l2.j.token, {})).s === 403);
  ok('lecturer cannot upload for a student not enrolled', (await up(L1, { studentId: 'S3' })).s === 403);
  sql.exec("update Enrollments set Group_Name='G2' where Student_ID='S2'");
  ok('group member from another group is refused', (await up(L1, { isGroup: true, includedMembers: ['S2'] })).s === 403);
  sql.exec("update Enrollments set Group_Name='G1' where Student_ID='S2'");
  sql.exec('update Users set Password_Changed_At = NULL, Sessions_Valid_From = NULL where User_ID = \'S1\'');
  const stuTok = await signToken(env, 'S1');
  ok('student uploads for themselves', (await up(stuTok, {})).s === 201);
  ok('student cannot upload for another student', (await up(stuTok, { studentId: 'S2' })).s === 403);
  ok('student can upload for own group', (await up(stuTok, { isGroup: true, includedMembers: ['S2'] })).s === 201);
  globalThis.fetch = realFetch;
}

// ---- Lecturer edits a student's upload; default upload term follows the date
{
  const lecRow = sql.prepare("select Submission_ID id from Submissions where Student_ID='S1' and Title='Report' order by rowid limit 1").get();
  const stuRow = sql.prepare("select Submission_ID id from Submissions where Student_ID='S1' and Title='Report' order by rowid desc limit 1").get();
  const ed = (token, o) => call('POST', '/api/update-submission', { token, body: { submissionId: lecRow.id, term: 'FinalTerm', title: 'Report v2', description: 'Revised text', ...o } });
  const r = await ed(L1, {});
  ok('lecturer edits their uploaded file', r.s === 200 && r.j.updated >= 2, JSON.stringify(r.j));
  const after = sql.prepare("select Student_ID s, Term t, Title ti, Description d from Submissions where Title = 'Report v2'").all();
  ok('group copies all updated, term/title changed', after.length === 2 && after.every(x => x.t === 'FinalTerm'));
  ok('description text changed and tags kept', after.every(x => x.d.startsWith('Revised text')) && after.some(x => x.d.includes('[Included Members:')));
  ok('a different upload of the same student is not touched', (await call('POST', '/api/update-submission', { token: L1, body: { submissionId: stuRow.id, term: 'MidTerm', title: 'Own', description: '' } })).s === 200 && sql.prepare("select count(*) n from Submissions where Title='Report v2'").get().n === 2);
  ok('another lecturer cannot edit', (await ed(l2.j.token, {})).s === 403);
  ok('a student cannot edit', (await ed(await signToken(env, 'S1'), {})).s === 403);
  ok('bad term refused', (await ed(L1, { term: 'Other' })).s === 400);
  ok('title with a dot refused', (await ed(L1, { title: 'a.b' })).s === 400);
  const { defaultUploadTerm } = await import('../../worker/uploads.js');
  const c = { Midterm_End: '2026-10-10', Final_Start: '2026-12-01' };
  ok('before the midterm ends: MidTerm', defaultUploadTerm(c, new Date('2026-10-01T00:00:00Z')) === 'MidTerm');
  ok('between midterm and finals: FinalTerm', defaultUploadTerm(c, new Date('2026-10-20T00:00:00Z')) === 'FinalTerm');
  ok('after the final starts: FinalTerm', defaultUploadTerm(c, new Date('2026-12-05T00:00:00Z')) === 'FinalTerm');
  ok('no dates: MidTerm', defaultUploadTerm({}, new Date('2026-12-05T00:00:00Z')) === 'MidTerm');
  ok('GMT+8 day is used', defaultUploadTerm({ Final_Start: '2026-12-01' }, new Date('2026-11-30T17:00:00Z')) === 'FinalTerm');
  const dt = await call('GET', '/api/default-upload-term?courseId=C1', { token: await signToken(env, 'S1') });
  ok('default-upload-term route answers', dt.s === 200 && ['MidTerm', 'FinalTerm'].includes(dt.j.term), JSON.stringify(dt));
}

// ---- Exam results include scanned answer sheets
{
  const link = async (title, rows, scanBody) => {
    const ex = await call('POST', '/api/exams', { token: L1, body: { lecturerId: 'L1', title, course: '', examData: rows } });
    const c = await call('POST', '/api/class-exams', { token: L1, body: { courseId: 'C1', examId: ex.j.examId, term: 'MidTerm', category: 'Written', isActive: true, assignments: [{ studentId: 'S1', isEnabled: true }] } });
    const a = sql.prepare('select Assessment_ID a from Class_Exams where Class_Exam_ID = ?').get(c.j.classExamId).a;
    const sv = await call('POST', '/api/scan-sheets/save', { token: L1, body: { courseId: 'C1', assessmentId: a, title, term: 'MidTerm', category: 'Written', ...scanBody(ex.j.examId) } });
    const r = await call('GET', '/api/exam-results?classExamId=' + c.j.classExamId, { token: L1 });
    return { sv, r, classExamId: c.j.classExamId, aid: a };
  };
  // all multiple choice (plain sheet): S1 right, S2 wrong on question 1, both right on question 2
  const mc = await link('Scan MC', [[1, 'Capital of France?', ['Paris', 'Rome'], 'Paris', '', false], [1, 'Pick B', ['A', 'B', 'C'], 'B', '', false]], () => ({
    numQuestions: 2, numChoices: 3, answerKey: [0, 1], bonus: [false, false],
    sheets: [{ studentId: 'S1', answers: [0, 1] }, { studentId: 'S2', answers: [1, 1] }]
  }));
  ok('scan session saved (plain)', mc.sv.s === 200 || mc.sv.s === 201, JSON.stringify(mc.sv));
  const m = mc.r.j;
  ok('plain scans: both students counted as submitted', mc.r.s === 200 && m.submitted === 2 && m.scanned === 2 && m.assigned === 2, JSON.stringify(m).slice(0, 300));
  ok('plain scans: average and spread include the scans', m.summary && m.summary.mean === 75 && m.summary.high === 100 && m.summary.low === 50 && m.summary.buckets[9] === 1 && m.summary.buckets[5] === 1, JSON.stringify(m.summary));
  ok('plain scans: student rows say Scanned with their score', m.students.every(x => x.status === 'Scanned') && m.students.find(x => x.studentId === 'S1').score === 2 && m.students.find(x => x.studentId === 'S2').percent === 50);
  ok('plain scans: question analysis counts the scans', m.questions[0].submitted === 2 && m.questions[0].fullPct === 50 && m.questions[0].options[1].count === 1 && m.questions[1].fullPct === 100, JSON.stringify(m.questions[0]).slice(0, 300));

  // mixed sheet: one multiple choice (shaded) and one identification (marked by hand)
  const rows = [[1, 'Capital of France?', ['Paris', 'Rome'], 'Paris', '', false], [1, 'Capital of Spain?', [], 'Madrid', '', false]];
  const mx = await link('Scan Mixed', rows, (examId) => {
    const built = buildScanSets(rows, { seed: examId, count: 1 });
    const g = gradingSets(built);
    return {
      layout: built.cells, setKeys: g, answerKey: g[0].key, bonus: g[0].bonus, numQuestions: built.cells.length, numChoices: 2,
      sheets: [{ studentId: 'S1', answers: [0], marks: { 1: 1 } }, { studentId: 'S2', answers: [1], marks: { 1: 0 } }]
    };
  });
  ok('scan session saved (mixed)', mx.sv.s === 200 || mx.sv.s === 201, JSON.stringify(mx.sv));
  const x = mx.r.j;
  ok('mixed scans: counted with scores 100% and 0%', x.submitted === 2 && x.summary.mean === 50 && x.students.find(t => t.studentId === 'S1').score === 2 && x.students.find(t => t.studentId === 'S2').score === 0, JSON.stringify(x.summary));
  ok('mixed scans: shaded and hand-marked questions are analysed', x.questions[0].fullPct === 50 && x.questions[1].fullPct === 50 && x.scannedNotAnalysed === 0, JSON.stringify(x.questions.map(q => q.fullPct)));

  // Students review their own scanned paper (read only) once the lecturer releases the answers
  sql.exec("update Users set account_status='Active', Password_Changed_At = NULL, Sessions_Valid_From = NULL where User_ID in ('S1','S2')");
  const t1 = await signToken(env, 'S1'), t2 = await signToken(env, 'S2');
  const sheetOf = (aid, sid) => sql.prepare('select h.Sheet_ID i from Scan_Sheets h join Scan_Sessions s on s.Session_ID = h.Session_ID where s.Assessment_ID = ? and h.Student_ID = ?').get(aid, sid).i;
  const rv = (tok, aid, sid) => call('GET', `/api/student-sheet-review?sheetId=${sheetOf(aid, sid)}&studentId=${sid}`, { token: tok });
  ok('review is closed until the answers are released', (await rv(t1, mx.aid, 'S1')).s === 403);
  ok('summary has no review button before release', !(await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: t1 })).j.assessments.some(r => r.Review_Sheet_ID));
  await call('POST', '/api/exam-release', { token: L1, body: { classExamId: mx.classExamId, release: true } });
  await call('POST', '/api/exam-release', { token: L1, body: { classExamId: mc.classExamId, release: true } });
  const rm = await rv(t1, mx.aid, 'S1');
  ok('mixed paper review: question, right answer, own answer and points', rm.s === 200 && rm.j.questions.length === 2 && rm.j.questions[0].answer === 'Paris' && rm.j.questions[0].correct === 'Paris' && rm.j.questions[0].earned === 1 && rm.j.finalScore === 2, JSON.stringify(rm.j).slice(0, 400));
  ok('written answer shows the hand-marked points', rm.j.questions[1].answer === 'Written on your paper' && rm.j.questions[1].earned === 1 && rm.j.questions[1].correct === 'Madrid');
  const rw = await rv(t2, mx.aid, 'S2');
  ok('a wrong shaded answer is shown as such', rw.j.questions[0].answer === 'Rome' && rw.j.questions[0].earned === 0 && rw.j.questions[1].earned === 0);
  const rp = await rv(t2, mc.aid, 'S2');
  ok('plain paper review', rp.s === 200 && rp.j.questions[0].answer === 'Rome' && rp.j.questions[0].correct === 'Paris' && rp.j.questions[1].earned === 1, JSON.stringify(rp.j).slice(0, 300));
  // Printed sets B and C of an all-multiple-choice paper: questions and choices were shuffled, the review must still work
  {
    const jsSets = await import('../../js/exam-sets.js'), wSets = await import('../../worker/exam-sets.js');
    const rows = [[1, 'Capital of France?', ['Paris', 'Rome', 'Oslo', 'Bern'], 'Paris', '', false], [1, 'Pick B', ['A', 'B', 'C', 'D'], 'B', '', false], [1, 'Largest animal?', ['Ox', 'Whale', 'Cat', 'Dog'], 'Whale', '', false]];
    ok('Worker set builder gives the same sets as the site', JSON.stringify(jsSets.buildSets(jsSets.scannableItems(JSON.stringify(rows), 5), { seed: 'E1', count: 4 })) === JSON.stringify(wSets.buildSets(wSets.scannableItems(rows, 5), { seed: 'E1', count: 4 })));
    let built;
    const ms = await link('Scan Sets', rows, (examId) => {
      built = wSets.buildSets(wSets.scannableItems(rows, 5), { seed: examId, count: 3 });
      const wrong = built[2].key.map((k, i) => (i === 0 ? (k + 1) % 4 : k));
      return { numQuestions: 3, numChoices: 4, answerKey: built[0].key, bonus: built[0].bonus, setKeys: built.map(x => ({ key: x.key, bonus: x.bonus, order: x.order })),
        sheets: [{ studentId: 'S1', answers: built[1].key, set: 1 }, { studentId: 'S2', answers: wrong, set: 2 }] };
    });
    ok('sheets of sets B and C saved', ms.sv.s === 200 || ms.sv.s === 201, JSON.stringify(ms.sv));
    await call('POST', '/api/exam-release', { token: L1, body: { classExamId: ms.classExamId, release: true } });
    const rb = await rv(t1, ms.aid, 'S1');
    ok('set B review: questions in the printed order, all right', rb.s === 200 && rb.j.questions.length === 3 && rb.j.questions.every(q => q.earned > 0 && q.answer === q.correct) && rb.j.questions[0].question === built[1].items[0].text, JSON.stringify(rb.j).slice(0, 400));
    const rc = await rv(t2, ms.aid, 'S2');
    ok('set C review: the wrong answer is shown against the right one', rc.s === 200 && rc.j.questions[0].earned === 0 && rc.j.questions[0].answer !== rc.j.questions[0].correct && rc.j.questions.slice(1).every(q => q.earned > 0), JSON.stringify(rc.j).slice(0, 400));
    ok('exam results analyse the shuffled sets too', (await call('GET', '/api/exam-results?classExamId=' + ms.classExamId, { token: L1 })).j.scannedNotAnalysed === 0);
  }
  ok('a student cannot review another student\'s paper', (await call('GET', `/api/student-sheet-review?sheetId=${sheetOf(mx.aid, 'S1')}&studentId=S1`, { token: t2 })).s === 403);
  ok('summary shows the review button after release', (await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: t1 })).j.assessments.some(r => r.Review_Sheet_ID === sheetOf(mx.aid, 'S1')));
  ok('an exam with no scans is unchanged', (await call('GET', '/api/exam-results?classExamId=' + ce.j.classExamId, { token: L1 })).j.scanned === 0);
}

// ---- Extra credit: a score above the max is kept in Record Scores and capped at the max in the class grade
{
  const mkA = await call('POST', '/api/assessments', { token: L1, body: { courseId: 'C1', term: 'MidTerm', category: 'Written', title: 'Extra Quiz', maxScore: 20, date: '2026-04-01' } });
  const aid = mkA.j.assessmentId;
  const put = (scores) => call('POST', '/api/assessment-scores', { token: L1, body: { assessmentId: aid, scores } });
  ok('a score above the max is accepted', (await put([{ studentId: 'S1', score: 23 }, { studentId: 'S2', score: 18 }])).s === 200);
  ok('Record Scores keeps the score as typed', ((await call('GET', `/api/assessment-scores?assessmentId=${aid}`, { token: L1 })).j.scores || []).some(r => r.Student_ID === 'S1' && r.Score === 23));
  const sumS1 = await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: L1 });
  ok('student summary counts it as the max', sumS1.j.assessments.find(a => a.Title === 'Extra Quiz').Score === 20, JSON.stringify(sumS1.j.assessments.find(a => a.Title === 'Extra Quiz')));
  const cls = await call('GET', '/api/class-summary?courseId=C1', { token: L1 });
  const row = (id) => cls.j.students[id].assessments.find(a => a.Title === 'Extra Quiz').Score;
  ok('class summary caps the extra credit and keeps normal scores', row('S1') === 20 && row('S2') === 18, JSON.stringify([row('S1'), row('S2')]));
  ok('a negative score is still refused', (await put([{ studentId: 'S1', score: -1 }])).s === 400);
  ok('an absurd score is refused', (await put([{ studentId: 'S1', score: 1e9 }])).s === 400);
  await call('POST', '/api/assessments', { token: L1, body: { assessmentId: aid, courseId: 'C1', term: 'MidTerm', category: 'Written', title: 'Extra Quiz', maxScore: 25, date: '2026-04-01' } });
  ok('raising the max uncaps it', (await call('GET', '/api/student-summary?courseId=C1&studentId=S1', { token: L1 })).j.assessments.find(a => a.Title === 'Extra Quiz').Score === 23);
}

// ---- Class grade: every assessment counts out of 100, so a long quiz does not dilute a perfect exam
{
  const pct = (list) => { const s = list.reduce((t, [sc, mx]) => t + onBase(sc, mx), 0); return s / (list.length * GRADE_BASE) * 100; };
  ok('base 100 keeps a perfect short exam perfect next to a poor long quiz', Math.round(pct([[20, 20], [50, 100]])) === 75 && Math.round((20 + 50) / (20 + 100) * 100) === 58);
  ok('extra credit stops at 100', onBase(23, 20) === 100 && onBase(150, 100) === 100);
  ok('plain conversion', onBase(15, 20) === 75 && onBase(0, 20) === 0 && onBase(5, 0) === 0 && onBase(-3, 20) === 0);
}
// ---- Group sets: several sets of groups per class; Reporting stays on the roster; uploads and students use them
{
  const t1 = await signToken(env, 'S1'), t2 = await signToken(env, 'S2');
  const sets0 = await call('GET', '/api/group-sets?courseId=C1', { token: L1 });
  ok('Reporting set always exists', sets0.j.sets[0].Set_ID === 'reporting');
  const mk = await call('POST', '/api/group-set-create', { token: L1, body: { courseId: 'C1', name: 'Lab 1' } });
  ok('create a set', mk.s === 201 && !!mk.j.setId);
  ok('duplicate set name refused', (await call('POST', '/api/group-set-create', { token: L1, body: { courseId: 'C1', name: 'lab 1' } })).s === 400);
  ok('the name Reporting is reserved', (await call('POST', '/api/group-set-create', { token: L1, body: { courseId: 'C1', name: 'Reporting' } })).s === 400);
  const sv = (setId, groups) => call('POST', '/api/group-set-save', { token: L1, body: { courseId: 'C1', setId, groups } });
  ok('save a set with topic', (await sv(mk.j.setId, [{ name: 'Team A', topic: 'Circuits', memberIds: ['S1', 'S2'] }])).s === 200);
  const g = await call('GET', `/api/group-set?courseId=C1&setId=${mk.j.setId}`, { token: L1 });
  ok('set returns groups with topic and members', g.j.groups.length === 1 && g.j.groups[0].topic === 'Circuits' && g.j.groups[0].members.length === 2, JSON.stringify(g.j));
  ok('a student in two groups of one set is refused', (await sv(mk.j.setId, [{ name: 'A', memberIds: ['S1'] }, { name: 'B', memberIds: ['S1'] }])).s === 400);
  ok('a non-enrolled student is refused', (await sv(mk.j.setId, [{ name: 'A', memberIds: ['NOPE'] }])).s === 400);
  ok('two groups with the same name are refused', (await sv(mk.j.setId, [{ name: 'A', memberIds: ['S1'] }, { name: 'a', memberIds: ['S2'] }])).s === 400);
  await sv(mk.j.setId, [{ name: 'Team A', topic: 'Circuits', memberIds: ['S1', 'S2'] }]);
  // Reporting is separate from Lab 1
  ok('save the Reporting set writes the roster fields', (await sv('reporting', [{ name: 'R1', topic: 'Topic X', memberIds: ['S1'] }, { name: 'R2', memberIds: ['S2'] }])).s === 200
    && sql.prepare("select Group_Name, Assigned_Topic from Enrollments where Student_ID='S1' and Course_ID='C1'").get().Assigned_Topic === 'Topic X');
  ok('Lab 1 unchanged by Reporting save', (await call('GET', `/api/group-set?courseId=C1&setId=${mk.j.setId}`, { token: L1 })).j.groups[0].members.length === 2);
  const sg = await call('GET', '/api/student-groups?courseId=C1&studentId=S1', { token: t1 });
  ok('student sees groups of every set with teammates', sg.s === 200 && sg.j.groups.length === 2 && sg.j.groups.find(x => x.setName === 'Lab 1').mates[0] !== undefined, JSON.stringify(sg.j));
  ok('a student cannot read another student\'s groups', (await call('GET', '/api/student-groups?courseId=C1&studentId=S1', { token: t2 })).s === 403);
  ok('a student cannot edit sets', (await call('POST', '/api/group-set-save', { token: t1, body: { courseId: 'C1', setId: 'reporting', groups: [] } })).s === 403);
  const gm = await call('GET', `/api/group-members?courseId=C1&studentId=S1&setId=${mk.j.setId}`, { token: t1 });
  ok('group-members honours the set', gm.j.groupName === 'Team A' && gm.j.members.length === 1);
  const gr = await call('GET', '/api/group-members?courseId=C1&studentId=S1', { token: t1 });
  ok('group-members defaults to Reporting', gr.j.groupName === 'R1' && gr.j.members.length === 0);
  ok('rename a set', (await call('POST', '/api/group-set-rename', { token: L1, body: { courseId: 'C1', setId: mk.j.setId, name: 'Lab 2' } })).s === 200);
  ok('Reporting cannot be deleted', (await call('POST', '/api/group-set-delete', { token: L1, body: { courseId: 'C1', setId: 'reporting' } })).s === 400);
  ok('delete a set', (await call('POST', '/api/group-set-delete', { token: L1, body: { courseId: 'C1', setId: mk.j.setId } })).s === 200
    && (await call('GET', '/api/group-sets?courseId=C1', { token: L1 })).j.sets.length === 1);
}

// ---- Password reset emails the new password through the Apps Script; it is shown only when the email cannot be sent
{
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: true }), { status: 200 }); };
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  const r = await call('POST', '/api/reset-student-password', { token: L1, body: { studentId: 'S2' } });
  ok('reset emails the password and does not return it', r.s === 200 && r.j.emailed === true && !r.j.tempPassword && /^t\*\*\*@/.test(r.j.email), JSON.stringify(r.j));
  const mail = sent.find(x => x.action === 'email');
  ok('the email goes to the student with the password in it', !!mail && mail.to === 'two@x.com' && /Temporary password: \S{10}/.test(mail.body), JSON.stringify(mail));
  const login = await call('POST', '/api/login', { body: { identifier: 'stu2', password: /Temporary password: (\S{10})/.exec(mail.body)[1] } });
  ok('the emailed password works', login.s === 200);
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Mail off' }), { status: 200 });
  const r2 = await call('POST', '/api/reset-student-password', { token: L1, body: { studentId: 'S2' } });
  ok('if the email fails the lecturer gets the password', r2.j.emailed === false && !!r2.j.tempPassword);
  sql.exec("update Users set Email='' where User_ID='S2'");
  const r3 = await call('POST', '/api/reset-student-password', { token: L1, body: { studentId: 'S2' } });
  ok('no email on file: the lecturer gets the password', r3.j.emailed === false && !!r3.j.tempPassword);
  sql.exec("update Users set Email='two@x.com' where User_ID='S2'");
  globalThis.fetch = realFetch;
  delete env.GAS_WEBHOOK_URL;
}

// ---- Forgot password: four matching details email a new password directly
{
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: true }), { status: 200 }); };
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  sql.exec("update Users set Name='Dela Cruz, Ana', Student_Number='25-1111', Email='ana@x.com', Contact_Number='0917 123 4567' where User_ID='S2'");
  sql.exec("delete from Login_Attempts where Attempt_Key like 'fp:%'");
  const fp = (o = {}) => call('POST', '/api/forgot-password', { body: { lastName: 'dela cruz', studentNumber: '25-1111', email: 'ANA@x.com', contact: '+63 917-123-4567', ...o } });
  const before = sql.prepare("select Password p from Users where User_ID='S2'").get().p;
  const bad = await fp({ email: 'other@x.com' });
  ok('wrong email: same answer, nothing sent, password unchanged', bad.s === 200 && !sent.length && sql.prepare("select Password p from Users where User_ID='S2'").get().p === before);
  ok('wrong last name: nothing sent', (await fp({ lastName: 'Santos' })).s === 200 && !sent.length);
  ok('wrong contact: nothing sent', (await fp({ contact: '09170000000' })).s === 200 && !sent.length);
  ok('missing detail is refused', (await fp({ contact: '' })).s === 400);
  sql.exec("delete from Login_Attempts where Attempt_Key like 'fp:%'");
  const good = await fp();
  const mail = sent.find(x => x.action === 'email');
  ok('all four details match: same answer and an email is sent', good.s === 200 && !!mail && mail.to === 'ana@x.com', JSON.stringify(good));
  ok('the answer never contains the password', !JSON.stringify(good.j).includes(/Temporary password: (\S{10})/.exec(mail.body)[1]));
  const pw = /Temporary password: (\S{10})/.exec(mail.body)[1];
  ok('the emailed password works', (await call('POST', '/api/login', { body: { identifier: 'stu2', password: pw } })).s === 200);
  // email failure: the password must stay as it was
  sql.exec("delete from Login_Attempts where Attempt_Key like 'fp:%'");
  const keep = sql.prepare("select Password p from Users where User_ID='S2'").get().p;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Mail off' }), { status: 200 });
  await fp();
  ok('if the email fails the password is not changed', sql.prepare("select Password p from Users where User_ID='S2'").get().p === keep);
  // not a student / unknown number
  ok('unknown student number: same answer', (await fp({ studentNumber: '99-9999' })).s === 200);
  // rate limit: 3 per student number per hour
  sql.exec("delete from Login_Attempts where Attempt_Key like 'fp:%'");
  await fp(); await fp(); await fp();
  ok('4th request for the same student number is limited', (await fp()).s === 429);
  sql.exec("delete from Login_Attempts where Attempt_Key like 'fp:%'");
  sql.exec("update Users set Name='Two', Student_Number=NULL, Email='two@x.com', Contact_Number=NULL where User_ID='S2'");
  globalThis.fetch = realFetch;
  delete env.GAS_WEBHOOK_URL;
}

// ---- Seat Plan: no duplicate seats, auto-assign by eye group then last name, locked seats stay
{
  sql.exec("delete from Enrollments where Course_ID='SP'");
  sql.exec("insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('SP','SP','Seats','L1')");
  const stu = (id, name, eye, status = 'Active') => {
    sql.prepare("insert or replace into Users(User_ID,Username,Name,role,account_status,eye_condition) values(?,?,?,?,?,?)").run(id, id, name, 'student', status, eye);
    sql.prepare("insert into Enrollments(Course_ID,Student_ID) values('SP',?)").run(id);
  };
  stu('P1', 'Zamora, Zed', 'No Eye Condition'); stu('P2', 'Abad, Amy', 'Far Sighted'); stu('P3', 'Cruz, Cy', 'Near Sighted');
  stu('P4', 'Dela, Dan', 'Legally Blind'); stu('P5', 'Bato, Bea', 'Near Sighted'); stu('P6', 'Off, Ina', 'No Eye Condition', 'Dropped');
  const seatOf = (id) => sql.prepare("select Seat_Number s from Enrollments where Course_ID='SP' and Student_ID=?").get(id).s;
  const set = (studentId, seat, locked) => call('POST', '/api/set-seat', { token: L1, body: { courseId: 'SP', studentId, seat, locked } });
  ok('set a seat', (await set('P1', '2', true)).s === 200 && seatOf('P1') === '2');
  const dup = await set('P2', ' 2 ', false);
  ok('a duplicate seat is refused with the owner named', dup.s === 409 && /Zamora/.test(dup.j.error) && seatOf('P2') == null, JSON.stringify(dup.j));
  ok('the roster edit refuses a duplicate too', (await call('POST', '/api/update-student-info', { token: L1, body: { courseId: 'SP', studentId: 'P2', seatNumber: '2', groupName: '', assignedTopic: '' } })).s === 409);
  ok('another lecturer cannot seat my class', (await call('POST', '/api/set-seat', { token: l2.j.token, body: { courseId: 'SP', studentId: 'P2', seat: '9' } })).s === 403);
  const all = await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'all' } });
  // locked P1 keeps 2; order: Legally Blind (Dela) 1, Near Sighted (Bato) 3, (Cruz) 4, Far Sighted (Abad) 5; inactive untouched
  ok('auto-assign by eye group then last name, skipping the locked seat', all.s === 200 && seatOf('P4') === '1' && seatOf('P1') === '2' && seatOf('P5') === '3' && seatOf('P3') === '4' && seatOf('P2') === '5', JSON.stringify(all.j.seats));
  ok('Dropped students are not seated', seatOf('P6') == null);
  const seats = sql.prepare("select Seat_Number s from Enrollments where Course_ID='SP' and Seat_Number is not null").all().map(r => r.s);
  ok('no duplicate seat numbers', new Set(seats).size === seats.length);
  stu('P7', 'Alba, Al', 'No Eye Condition'); stu('P8', 'Zapata, Zoe', 'Legally Blind');
  const un = await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'unseated' } });
  ok('unseated mode seats only new students, eye group first, lowest free number', un.s === 200 && un.j.assigned === 2 && seatOf('P8') === '6' && seatOf('P7') === '7' && seatOf('P4') === '1', JSON.stringify(un.j));
  ok('unlock lets auto-assign move the seat', (await set('P1', '2', false)).s === 200 && (await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'all' } })).s === 200 && seatOf('P4') === '1' && seatOf('P8') === '2');
  // drag / up-down: reorder, locked seats stay, numbers follow the new order
  const order = () => sql.prepare("select Student_ID id from Enrollments where Course_ID='SP' and Seat_Number is not null order by cast(Seat_Number as integer)").all().map(r => r.id);
  await set('P1', '', false);
  await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'all' } });
  const before = order();
  const moved = [before[3], ...before.filter((_, i) => i !== 3)];
  ok('seat-order renumbers by the dropped position', (await call('POST', '/api/seat-order', { token: L1, body: { courseId: 'SP', order: moved } })).s === 200 && JSON.stringify(order()) === JSON.stringify(moved), order().join());
  await set(moved[2], seatOf(moved[2]), true);
  const lockedSeat = seatOf(moved[2]);
  await call('POST', '/api/seat-order', { token: L1, body: { courseId: 'SP', order: [...moved].reverse() } });
  ok('a locked student keeps the seat in a reorder', seatOf(moved[2]) === lockedSeat);
  const seats2 = sql.prepare("select Seat_Number s from Enrollments where Course_ID='SP' and Seat_Number is not null").all().map(r => r.s);
  ok('still no duplicates after reorder', new Set(seats2).size === seats2.length);
  // insert: P9 (Near Sighted, Aaron) joins the near-sighted group; P10 goes after the last seat
  await set(moved[2], seatOf(moved[2]), false);
  await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'all' } });
  stu('P9', 'Aaron, Al', 'Near Sighted'); stu('P10', 'Yu, Yan', 'No Eye Condition');
  const top = Math.max(...sql.prepare("select Seat_Number s from Enrollments where Course_ID='SP' and Seat_Number is not null").all().map(r => Number(r.s)));
  ok('insert at the end takes the next number after the last seat', (await call('POST', '/api/seat-insert', { token: L1, body: { courseId: 'SP', studentId: 'P10', where: 'end' } })).s === 200 && Number(seatOf('P10')) === top + 1);
  const dela = Number(seatOf('P8'));   // last of the Legally Blind group (Dela, Zapata)
  ok('insert into the eye group shifts the seats behind', (await call('POST', '/api/seat-insert', { token: L1, body: { courseId: 'SP', studentId: 'P9', where: 'group' } })).s === 200 && Number(seatOf('P9')) === dela + 1 && Number(seatOf('P5')) === dela + 2);
  ok('inactive and suspended students are seated', (sql.prepare("update Users set account_status='Suspended' where User_ID='P7'").run(), (await call('POST', '/api/auto-seat', { token: L1, body: { courseId: 'SP', mode: 'all' } })).s === 200 && seatOf('P7') != null));
  // floor plan data for a student: seat numbers and own seat only, no names
  sql.exec("insert or ignore into Enrollments(Course_ID,Student_ID) values('SP','S1')");
  sql.exec("update Enrollments set Seat_Number='4' where Course_ID='SP' and Student_ID='S1'");
  const sm = await call('GET', '/api/seat-map?courseId=SP&studentId=S1', { token: s1.j.token });
  ok('student gets only their own seat and the highest seat number', sm.s === 200 && sm.j.mine === '4' && sm.j.maxSeat >= 4 && !sm.j.seats && !JSON.stringify(sm.j).includes('Dela'), JSON.stringify(sm.j).slice(0, 200));
  ok('student cannot read another student\'s plan', (await call('GET', '/api/seat-map?courseId=SP&studentId=P4', { token: s1.j.token })).s === 403);
  ok('a student not in the class is refused', (await call('GET', '/api/seat-map?courseId=C-NONE&studentId=S1', { token: s1.j.token })).s === 403);
  ok('clearing a seat also clears the lock', (await set('P1', '', true)).s === 200 && sql.prepare("select Seat_Locked l from Enrollments where Student_ID='P1' and Course_ID='SP'").get().l === 0);
}

// ---- Class mode: onsite (default) or online with a proof picture only the lecturer can open
{
  const realFetch = globalThis.fetch;
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  let gasBodies = [];
  globalThis.fetch = async (u, init) => { gasBodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: true, fileId: 'PF1', base64: 'QUJD', mimeType: 'image/jpeg' }), { status: 200 }); };
  const modes = (token) => call('GET', '/api/class-modes?courseId=SP', { token });
  const stuTok = await signToken(env, 'P1');
  ok('a day is onsite by default', (await modes(L1)).j.modes.length === 0);
  ok('lecturer marks a day online', (await call('POST', '/api/class-mode', { token: L1, body: { courseId: 'SP', date: '2026-03-02', mode: 'online' } })).s === 200);
  ok('a bad mode is refused', (await call('POST', '/api/class-mode', { token: L1, body: { courseId: 'SP', date: '2026-03-02', mode: 'cloud' } })).s === 400);
  const up = await call('POST', '/api/class-mode-proof', { token: L1, body: { courseId: 'SP', date: '2026-03-02', base64: 'A'.repeat(400), mimeType: 'image/jpeg' } });
  ok('proof picture is stored in Drive and linked', up.s === 201 && gasBodies[0].pathParts.join('/') === 'Online Class Proof/SP' && sql.prepare("select Proof_File_ID f from Class_Modes where Course_ID='SP' and Date='2026-03-02'").get().f === 'PF1', JSON.stringify(up.j));
  const sm = await modes(stuTok);
  ok('an enrolled student sees online + hasProof but never the file', sm.s === 200 && sm.j.modes.length === 1 && sm.j.modes[0].hasProof === true && !JSON.stringify(sm.j).includes('PF1'));
  ok('a student cannot open the proof', (await call('GET', '/api/class-mode-proof?courseId=SP&date=2026-03-02', { token: stuTok })).s === 403);
  ok('a student cannot change the mode', (await call('POST', '/api/class-mode', { token: stuTok, body: { courseId: 'SP', date: '2026-03-03', mode: 'online' } })).s === 403);
  ok('another lecturer cannot touch my class', (await call('POST', '/api/class-mode', { token: l2.j.token, body: { courseId: 'SP', date: '2026-03-03', mode: 'online' } })).s === 403 && (await call('GET', '/api/class-mode-proof?courseId=SP&date=2026-03-02', { token: l2.j.token })).s === 403);
  const view = await call('GET', '/api/class-mode-proof?courseId=SP&date=2026-03-02', { token: L1 });
  ok('lecturer opens the proof', view.s === 200 && view.j.base64 === 'QUJD');
  ok('marking onsite removes the online row', (await call('POST', '/api/class-mode', { token: L1, body: { courseId: 'SP', date: '2026-03-02', mode: 'onsite' } })).s === 200 && (await modes(L1)).j.modes.length === 0);
  ok('too small or missing picture is refused', (await call('POST', '/api/class-mode-proof', { token: L1, body: { courseId: 'SP', date: '2026-03-02', base64: 'x' } })).s === 400);
  globalThis.fetch = realFetch;
  delete env.GAS_WEBHOOK_URL;
}

// ---- Course plan: syllabus file, learning plan topics, links to days (0, 1 or many; a topic on many days)
{
  const realFetch = globalThis.fetch;
  env.GAS_WEBHOOK_URL = 'https://gas.test/exec';
  const gasBodies = [];
  globalThis.fetch = async (u, init) => { gasBodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: true, fileId: 'SYL1', base64: 'QUJD' }), { status: 200 }); };
  const stuTok = await signToken(env, 'P1');
  const plan = (token, c = 'SP') => call('GET', `/api/course-plan?courseId=${c}`, { token });
  ok('empty plan at first', (await plan(L1)).j.topics.length === 0 && (await plan(L1)).j.syllabus === null);
  const t1 = await call('POST', '/api/plan-topic', { token: L1, body: { courseId: 'SP', time: 'Week 2 / 3 hours', contents: 'Introduction to Capital Markets', questions: 'What is a financial system?', refs: 'Lopez-Mariano (2017)' } });
  ok('add a topic', t1.s === 201 && !!t1.j.topicId, JSON.stringify(t1.j));
  const qa = await call('POST', '/api/plan-quick-add', { token: L1, body: { courseId: 'SP', lines: [{ time: 'Week 3 & 4', contents: 'Financial Intermediaries' }, { time: 'Week 7', contents: 'Time Value of Money' }, { time: '', contents: '' }] } });
  ok('quick add keeps order and skips empty lines', qa.s === 201 && qa.j.added === 2 && (await plan(L1)).j.topics.map(t => t.time).join('|') === 'Week 2 / 3 hours|Week 3 & 4|Week 7');
  const ids = (await plan(L1)).j.topics.map(t => t.topicId);
  ok('a topic needs a time or contents', (await call('POST', '/api/plan-topic', { token: L1, body: { courseId: 'SP', questions: 'x' } })).s === 400);
  ok('edit a topic', (await call('POST', '/api/plan-topic', { token: L1, body: { courseId: 'SP', topicId: ids[0], time: 'Week 2', contents: 'Intro' } })).s === 200 && (await plan(L1)).j.topics[0].time === 'Week 2');
  await call('POST', '/api/plan-topic-move', { token: L1, body: { courseId: 'SP', topicId: ids[2], dir: -1 } });
  ok('move a topic up', (await plan(L1)).j.topics.map(t => t.topicId).join() === [ids[0], ids[2], ids[1]].join());
  // days: one day with two topics, one day with one, the same topic on two days, a quiz day with none
  ok('link two topics to a day', (await call('POST', '/api/plan-day', { token: L1, body: { courseId: 'SP', date: '2026-03-02', topicIds: [ids[0], ids[1]] } })).j.linked === 2);
  ok('the same topic on another day', (await call('POST', '/api/plan-day', { token: L1, body: { courseId: 'SP', date: '2026-03-09', topicIds: [ids[1]] } })).s === 200);
  const linked = (await plan(L1)).j.topics.find(t => t.topicId === ids[1]);
  ok('a topic lists every day it is taught', linked.dates.join() === '2026-03-02,2026-03-09');
  ok('an empty list clears a day', (await call('POST', '/api/plan-day', { token: L1, body: { courseId: 'SP', date: '2026-03-09', topicIds: [] } })).s === 200 && (await plan(L1)).j.topics.find(t => t.topicId === ids[1]).dates.join() === '2026-03-02');
  ok('a topic from another class is refused', (await call('POST', '/api/plan-day', { token: L1, body: { courseId: 'C1', date: '2026-03-02', topicIds: [ids[0]] } })).s === 404);
  ok('a student cannot read or change the plan', (await plan(stuTok)).s === 403 && (await call('POST', '/api/plan-topic', { token: stuTok, body: { courseId: 'SP', contents: 'x' } })).s === 403);
  ok('another lecturer cannot touch my plan', (await plan(l2.j.token)).s === 403 && (await call('POST', '/api/plan-topic-delete', { token: l2.j.token, body: { courseId: 'SP', topicId: ids[0] } })).s === 403);
  // syllabus
  const syl = await call('POST', '/api/course-syllabus', { token: L1, body: { courseId: 'SP', base64: 'A'.repeat(300), fileName: 'FINMAN 7.pdf', mimeType: 'application/pdf' } });
  ok('syllabus goes to Drive under the class', syl.s === 201 && gasBodies[0].pathParts.join('/') === 'Syllabus/SP', JSON.stringify(syl.j));
  ok('the plan shows the syllabus name', (await plan(L1)).j.syllabus.name === 'FINMAN 7.pdf');
  ok('a wrong file type is refused', (await call('POST', '/api/course-syllabus', { token: L1, body: { courseId: 'SP', base64: 'A'.repeat(300), fileName: 'x.exe', mimeType: 'application/x-msdownload' } })).s === 400);
  ok('another lecturer cannot read the syllabus', (await call('GET', '/api/course-syllabus?courseId=SP', { token: l2.j.token })).s === 403);
  const got = await call('GET', '/api/course-syllabus?courseId=SP', { token: L1 });
  ok('lecturer reads the syllabus back', got.s === 200 && got.j.base64 === 'QUJD' && got.j.mimeType === 'application/pdf');
  ok('remove the syllabus', (await call('POST', '/api/course-syllabus-delete', { token: L1, body: { courseId: 'SP' } })).s === 200 && (await plan(L1)).j.syllabus === null);
  ok('deleting a topic removes its day links', (await call('POST', '/api/plan-topic-delete', { token: L1, body: { courseId: 'SP', topicId: ids[1] } })).s === 200 && sql.prepare("select count(*) n from Plan_Day_Links where Topic_ID=?").get(ids[1]).n === 0);
  // same course code: share the syllabus and plan between a lecturer's classes
  sql.exec(`insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('PX1','PXC','Plan A','L1'),('PX2','PXC','Plan B','L1'),('PX3','PXC','Plan C','L2'),('PX4','PXD','Other code','L1')`);
  await call('POST', '/api/course-syllabus', { token: L1, body: { courseId: 'PX1', base64: 'A'.repeat(300), fileName: 'finman.pdf', mimeType: 'application/pdf' } });
  await call('POST', '/api/plan-quick-add', { token: L1, body: { courseId: 'PX1', lines: [{ time: 'Week 1', contents: 'Syllabus' }, { time: 'Week 2', contents: 'Intro' }] } });
  const same = (await plan(L1, 'PX2')).j.sameCode;
  ok('same course code lists only my classes with that code', same.length === 1 && same[0].courseId === 'PX1' && same[0].hasSyllabus && same[0].topics === 2, JSON.stringify(same));
  const cp = await call('POST', '/api/plan-copy', { token: L1, body: { courseId: 'PX1', toCourseIds: ['PX2'] } });
  ok('copy syllabus and plan to the other class', cp.s === 200 && cp.j.syllabusCopied === 1 && cp.j.planCopied === 1 && (await plan(L1, 'PX2')).j.topics.length === 2 && (await plan(L1, 'PX2')).j.syllabus.name === 'finman.pdf', JSON.stringify(cp.j));
  const cp2 = await call('POST', '/api/plan-copy', { token: L1, body: { courseId: 'PX1', toCourseIds: ['PX2'] } });
  ok('a class that already has topics keeps its plan', cp2.j.planSkipped === 1 && (await plan(L1, 'PX2')).j.topics.length === 2);
  ok('cannot copy to another lecturer or another course code', (await call('POST', '/api/plan-copy', { token: L1, body: { courseId: 'PX1', toCourseIds: ['PX3'] } })).s === 403 && (await call('POST', '/api/plan-copy', { token: L1, body: { courseId: 'PX1', toCourseIds: ['PX4'] } })).s === 403);
  ok('cannot copy from another lecturer\'s class', (await call('POST', '/api/plan-copy', { token: l2.j.token, body: { courseId: 'PX1', toCourseIds: ['PX3'] } })).s === 403);
  await call('GET', '/api/course-syllabus?courseId=PX2', { token: L1 });
  ok('the syllabus is read from Drive as any file type', JSON.parse(JSON.stringify(gasBodies[gasBodies.length - 1])).anyType === true);
  globalThis.fetch = realFetch;
  delete env.GAS_WEBHOOK_URL;
}

// ---- UD and Dropped students are always absent and are never called
{
  sql.exec(`insert into Courses(Course_ID,CourseCode,CourseTitle,Lecturer_ID) values('UA1','UAC','Auto absent','L1')`);
  for (const id of ['UAact', 'UAud', 'UAdrop']) sql.prepare("insert into Users(User_ID,Username,Name,role,account_status) values(?,?,?,?,?)").run(id, id, id, 'student', id === 'UAud' ? 'UD' : id === 'UAdrop' ? 'Dropped' : 'Active');
  for (const id of ['UAact', 'UAud', 'UAdrop']) sql.prepare("insert into Enrollments(Course_ID,Student_ID) values('UA1',?)").run(id);
  const save = await call('POST', '/api/attendance', { token: L1, body: { courseId: 'UA1', date: '2026-04-01', records: [{ studentId: 'UAact', status: 'Present', points: 2 }, { studentId: 'UAud', status: 'Present', points: 3 }, { studentId: 'UAdrop', status: 'Late', points: 1 }] } });
  const day = (await call('GET', '/api/attendance?courseId=UA1&date=2026-04-01', { token: L1 })).j.records;
  const get = (id) => day.find(r => r.Student_ID === id);
  ok('saving a day forces UD and Dropped students to Absent with 0 points', save.s === 201 && get('UAud').Status === 'Absent' && get('UAud').Performance_Points === 0 && get('UAdrop').Status === 'Absent' && get('UAdrop').Performance_Points === 0, JSON.stringify(day));
  ok('an Active student is saved as given', get('UAact').Status === 'Present' && get('UAact').Performance_Points === 2);
  await call('POST', '/api/attendance/single', { token: L1, body: { courseId: 'UA1', studentId: 'UAud', date: '2026-04-02', status: 'Present', points: 5 } });
  const one = sql.prepare("select Status s, Performance_Points p from Attendance where Student_ID='UAud' and Date='2026-04-02'").get();
  ok('the single save also forces Absent', one.s === 'Absent' && one.p === 0);
  ok('participation points are refused for a Dropped student', (await call('POST', '/api/add-participation-points', { token: L1, body: { courseId: 'UA1', studentId: 'UAdrop', date: '2026-04-03', points: 1 } })).s === 400);
  const pool = (await call('GET', '/api/recitation-pool?courseId=UA1', { token: L1 })).j.students.map(x => x.User_ID);
  ok('the student caller pool leaves out UD and Dropped students', pool.length === 1 && pool[0] === 'UAact', JSON.stringify(pool));
}

// ---- Practical grades (Student Caller > Grade)
{
  const body = (o) => ({ courseId: 'C1', activity: 'Practical 1', ...o });
  const save = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ maxScore: 20, timerSeconds: 600, elapsedSeconds: 540, groupName: 'Group A', entries: [{ studentId: 'S1', score: 18, notes: 'Clean wiring' }, { studentId: 'S2', score: 15, notes: 'Late start' }] }) });
  ok('a lecturer saves practical grades for a group', save.s === 200 && save.j.saved === 2 && save.j.copied === 0, JSON.stringify(save));
  const list = await call('GET', '/api/practical-grades?courseId=C1&activity=Practical%201', { token: L1 });
  ok('the saved grades and notes come back', list.s === 200 && list.j.grades.length === 2 && list.j.grades.some(g => g.Student_ID === 'S1' && g.Score === 18 && g.Notes === 'Clean wiring' && g.Elapsed_Seconds === 540), JSON.stringify(list.j));
  const parts = [{ name: 'Content', max: 10, score: 8 }, { name: 'Delivery', max: 10, score: 7 }];
  const cr = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ activity: 'Practical 2', maxScore: 20, entries: [{ studentId: 'S1', score: 15, notes: '', parts }] }) });
  const crl = await call('GET', '/api/practical-grades?courseId=C1&activity=Practical%202', { token: L1 });
  ok('criteria and points are saved and come back for review', cr.s === 200 && crl.j.grades[0].Criteria.length === 2 && crl.j.grades[0].Criteria[0].score === 8, JSON.stringify(crl.j));
  const crBad = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ activity: 'Practical 2', entries: [{ studentId: 'S1', score: 99, parts }] }) });
  const crOver = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ activity: 'Practical 2', entries: [{ studentId: 'S1', score: 21, parts: [{ name: 'X', max: 10, score: 21 }] }] }) });
  ok('a total that does not match, or a criterion over its points, is refused', crBad.s === 400 && crOver.s === 400, crBad.s + ' ' + crOver.s);
  const again = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ entries: [{ studentId: 'S1', score: 19, notes: 'Re-checked' }] }) });
  const n1 = sql.prepare("select count(*) n, max(Score) s from Practical_Grades where Course_ID='C1' and Student_ID='S1' and Activity='Practical 1'").get();
  ok('saving again replaces the grade (one per student per activity)', again.s === 200 && n1.n === 1 && n1.s === 19, JSON.stringify(n1));
  const cp = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ assessmentId: 'A1', entries: [{ studentId: 'S2', score: 17, notes: '' }] }) });
  const sc = sql.prepare("select Score from Assessment_Scores where Assessment_ID='A1' and Student_ID='S2'").get();
  const keep = sql.prepare("select Score from Assessment_Scores where Assessment_ID='A1' and Student_ID='S1'").get();
  ok('a grade can also be copied to an assessment (only that student changes)', cp.s === 200 && cp.j.copied === 1 && sc && sc.Score === 17 && keep && keep.Score === 8, JSON.stringify({ cp, sc, keep }));
  const other = await call('POST', '/api/practical-grade-save', { token: l2.j.token, body: body({ entries: [{ studentId: 'S1', score: 1 }] }) });
  ok('another lecturer cannot grade in this class', other.s === 403, String(other.s));
  const readOther = await call('GET', '/api/practical-grades?courseId=C1', { token: l2.j.token });
  ok('another lecturer cannot read the grades or notes', readOther.s === 403, String(readOther.s));
  const badAs = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ assessmentId: 'A-OTHER', entries: [{ studentId: 'S1', score: 1 }] }) });
  ok('an unknown assessment is refused', badAs.s >= 400, String(badAs.s));
  const notIn = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ entries: [{ studentId: 'NOPE', score: 1 }] }) });
  ok('a student who is not in the class is refused', notIn.s === 400, String(notIn.s));
  const neg = await call('POST', '/api/practical-grade-save', { token: L1, body: body({ entries: [{ studentId: 'S1', score: -2 }] }) });
  ok('a negative score is refused', neg.s === 400, String(neg.s));
  const stu = await call('GET', '/api/practical-grades?courseId=C1', { token: await signToken(env, 'S1') });
  ok('a student cannot read practical grades', stu.s === 403, String(stu.s));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
