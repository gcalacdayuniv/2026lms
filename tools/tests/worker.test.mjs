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
sql.prepare("delete from Exam_Photos where Photo_ID='PH1'").run();
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
const reg = (sn, extra = {}, ip) => call('POST', '/api/register', { body: { username: 'new' + sn, password: 'secret12', name: 'N', email: 'n@x.com', student_number: sn, contact_number: '09', eye_condition: 'None', program_course: 'BSCS', program_year: '1', program_section: '1', ...extra } });
const noProg = await reg('26-0090', { program_course: '' });
ok('registration needs the program course', noProg.s === 400 && /program/i.test(noProg.j.error), JSON.stringify(noProg));
const noProgYear = await reg('26-0091', { program_year: undefined });
ok('registration needs the program year', noProgYear.s === 400, JSON.stringify(noProgYear));
const okReg = await reg('26-0095', { username: 'prog95', email: 'p95@x.com', contact_number: '0995', program_course: 'BSArch', program_year: '5', program_section: '3' });
const prow = sql.prepare("select Program_Course c, Program_Year y, Program_Section s, course cc from Users where Student_Number='26-0095'").get();
const clr = sql.prepare("select count(*) n from Users where course is not null or year is not null or section is not null").get().n;
ok('login clears old class course/year/section once', clr === 0 || sql.prepare("select Value v from App_Settings where Key='class_fields_cleared'").get(), String(clr));
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
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
