// Opens the real app in a phone-sized Chromium with fake data and the real Content-Security-Policy, then reports:
// policy violations, Tailwind classes missing from tailwind.css, sideways scrolling, and script errors.
// Run: node tools/tests/phone-check.cjs   (needs: npm i playwright; npx playwright install chromium)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8799;
const CSP = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').match(/Content-Security-Policy: (.*)/)[1];
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
const srv = http.createServer((q, s) => {
    let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'content-security-policy': CSP }); s.end(fs.readFileSync(f));
}).listen(PORT);
const students = Array.from({ length: 8 }, (_, i) => ({ User_ID: 'S' + i, Name: 'Student Number ' + i, Student_Number: '26-' + (1000 + i), Seat_Number: i + 1, account_status: 'Active', Program_Course: 'BSIT', Program_Year: '2', Program_Section: 'A', eye_condition: 'None', Email: 's' + i + '@x.com' }));
const courses = [1, 2].map(i => ({ Course_ID: 'C' + i, CourseCode: 'IT10' + i, CourseTitle: 'IT Fundamentals ' + i, ScheduleDay: 'Monday', TimePeriod: '8:00 AM - 10:00 AM', Lecturer_ID: 'L1', LecturerName: 'Prof. Cruz', StudentCount: 8, Room: 'Rm 2' }));
const api = (url) => { const p = new URL(url).pathname;
    if (p === '/api/my-courses' || p === '/api/courses') return { success: true, courses };
    if (p === '/api/course-details') return { success: true, course: courses[0], students, enrolledCount: 8 };
    if (p === '/api/assessments') return { success: true, assessments: [{ Assessment_ID: 'A0', Course_ID: 'C1', Term: 'MidTerm', Category: 'Written', Title: 'Quiz 1', Max_Score: 20, Date: '2026-10-01' }] };
    if (p === '/api/exams') return { success: true, exams: [{ Exam_ID: 'E1', Title: 'Exam 1', Course: 'C1', questionCount: 10 }] };
    return { success: true }; };
const UTILITY = /^((sm|md|lg|xl|hover|focus|dark|disabled|group-hover|active):)*-?(bg|text|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|border|rounded|shadow|gap|space-x|space-y|items|justify|font|overflow|z|top|left|right|bottom|inset|grid|col|row|opacity|flex|translate|scale|tracking|leading|ring|object|cursor|transition|duration)(-|$)/;
(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
        try { localStorage.setItem('portal_token', 't'); localStorage.setItem('portal_user', JSON.stringify({ User_ID: 'L1', Name: 'Prof Cruz', role: 'lecturer', Username: 'l', Email: 'a@b.c', account_status: 'Active' })); } catch (e) { /* storage blocked */ }
    });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => {
        const u = r.request().url();
        if (u.startsWith('http://localhost:' + PORT)) return r.continue();
        if (u.includes('workers.dev')) return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(api(u)) });
        if (u.includes('fontawesome')) return r.fulfill({ contentType: 'text/css', body: '' });   // icons are not what is tested here
        return r.abort();
    });
    const seen = new Set(), overflow = [];
    const look = async (name) => {
        (await page.evaluate(() => [...new Set([...document.querySelectorAll('[class]')].flatMap(e => String(e.getAttribute('class')).split(/\s+/)).filter(Boolean))])).forEach(c => seen.add(c));
        const ox = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (ox > 1) overflow.push(name + ' (' + ox + ' px)');
    };
    await page.goto(`http://localhost:${PORT}/#dashboard`); await page.waitForTimeout(1500); await look('dashboard');
    await page.evaluate(() => { location.hash = '#class-C1'; }); await page.waitForTimeout(2000); await look('class');
    for (const id of ['openScoresModalBtn', 'openExamManagerBtn', 'openClassSummaryBtn', 'openCourseMenuBtn', 'openScannerBtn', 'openAddStudentModalBtn']) {
        await page.evaluate((i) => document.getElementById(i)?.click(), id); await page.waitForTimeout(900); await look(id);
        await page.evaluate(() => history.back()); await page.waitForTimeout(300);
    }
    // Lecturer uploads a document on behalf of a student (Manage Student > Upload document for student).
    let sentMeta = null;
    page.on('request', rq => { if (rq.method() === 'POST' && rq.url().includes('/api/upload-submission')) sentMeta = rq.headers()['x-submission-meta']; });
    await page.evaluate(() => location.hash = '#class-C1'); await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.manage-student-btn')?.click()); await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('manageUploadDocBtn')?.click()); await page.waitForTimeout(500); await look('lecturer upload form');
    const banner = await page.evaluate(() => { const m = document.getElementById('submitDocModal'); const b = document.getElementById('submitDocForStudent'); return m && !m.classList.contains('hidden') && b ? b.textContent : ''; });
    if (!banner.includes('Student Number 0')) errors.push('lecturer upload form did not open for the student (banner: "' + banner + '")');
    await page.selectOption('#submitTerm', 'MidTerm'); await page.fill('#submitTitle', 'Report'); await page.fill('#submitDesc', 'Group report');
    await page.selectOption('#submissionType', 'url'); await page.fill('#submitUrlInput', 'https://example.com/report');
    await page.click('#submitDocBtn'); await page.waitForTimeout(1200);
    let sent = null; try { sent = JSON.parse(decodeURIComponent(sentMeta || '')); } catch (e) { /* not sent */ }
    if (!sent || sent.studentId !== 'S0' || sent.courseId !== 'C1') errors.push('lecturer upload was not sent for the selected student: ' + JSON.stringify(sent));
    await page.evaluate(async () => { const { ExamBuilder } = await import('/js/exam-builder.js'); await ExamBuilder.open({ title: 'T', course: 'IT101' }); }); await page.waitForTimeout(600); await look('exam builder');
    const violations = await page.evaluate(() => window.__csp);
    const missing = await page.evaluate((classes) => { const css = [...document.styleSheets].map(ss => { try { return [...ss.cssRules].map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n'); return classes.filter(c => !css.includes('.' + CSS.escape(c))); }, [...seen]);
    const NO_RULE_EVER = ['scale-up', 'sm:scale-up'];   // used in index.html but never had a style (not even with the old CDN)
    const missingTw = missing.filter(c => UTILITY.test(c) && !NO_RULE_EVER.includes(c));
    console.log(`screens checked, ${seen.size} classes seen`);
    console.log(violations.length ? 'CSP violations:\n  ' + [...new Set(violations)].join('\n  ') : 'CSP violations: none');
    console.log(missingTw.length ? 'Tailwind classes missing from tailwind.css (run sh tools/build-css.sh):\n  ' + missingTw.join('\n  ') : 'Tailwind classes missing: none');
    console.log(overflow.length ? 'Sideways scrolling: ' + overflow.join(', ') : 'Sideways scrolling: none');
    console.log(errors.length ? 'Script errors:\n  ' + [...new Set(errors)].join('\n  ') : 'Script errors: none');
    await browser.close(); srv.close();
    process.exit(violations.length || missingTw.length || overflow.length || errors.length ? 1 : 0);
})();
