// js/course-dashboard.js
import { apiFetch, AppState, CONFIG, handleSessionExpired } from './globals.js';
import { CourseExam } from './course-exam.js';
import { UI } from './ui-feedback.js';
import { Skeleton } from './skeletons.js';
import { escapeHtml } from './html-utils.js';
import { formatSchedule } from './schedule-time.js';
import { getLocalDateString } from './date-utils.js';
import { loadTerm } from './current-term.js';
import { joinFormHtml } from './class-invite.js';
import { refreshResetBadge } from './password-requests.js';

// Maximum size of an uploaded submission file.
const DASH_CACHE_PREFIX = 'dash_cache:';
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Large files are sent in pieces. Keep in sync with MAX_UPLOAD_CHUNKS (worker.js) and MAX_CHUNKS (Code.gs).
// A 25 MB file is about 35 million base64 characters, which fits in 10 pieces of 3.6 million.
const CHUNK_CHARS = 3600000;            // must be a multiple of 4 so every piece is valid base64
const MAX_CHUNKS = 10;
const PARALLEL_CHUNKS = 3;
const CHUNK_RETRIES = 3;                // attempts per piece
const CHUNK_TIMEOUT_MS = 120000;        // per piece
const SINGLE_TIMEOUT_MS = 90000;        // small files sent in one request
const FINISH_TIMEOUT_MS = 180000;       // Google joins the pieces and saves the file

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One XMLHttpRequest with a timeout. Errors carry `retryable` so callers know whether to try again.
const xhrPost = (path, { headers = {}, body, timeoutMs, onProgress }) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CONFIG.API_URL}${path}`, true);
    Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));
    if (AppState.token) xhr.setRequestHeader('Authorization', `Bearer ${AppState.token}`);
    xhr.timeout = timeoutMs;

    const fail = (message, retryable) => {
        const err = new Error(message);
        err.retryable = retryable;
        reject(err);
    };

    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };

    xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }

        if (xhr.status >= 200 && xhr.status < 300) {
            if (data) resolve(data);
            else fail("Failed to parse server response", true);
            return;
        }
        if (xhr.status === 401) handleSessionExpired();
        const message = (data && data.error) || `Upload failed with status ${xhr.status}`;
        // Client errors (bad file, not enrolled, too large) will not succeed on a retry.
        const retryable = xhr.status >= 500 || xhr.status === 408 || xhr.status === 429 || xhr.status === 0;
        fail(message, retryable);
    };
    xhr.onerror = () => fail("Network error occurred during upload. Please check your connection.", true);
    xhr.ontimeout = () => fail("The upload timed out. Please check your connection and try again.", true);
    xhr.send(body);
});

// Sends one piece, retrying with a short pause between attempts.
const sendChunk = async (info, body, onProgress) => {
    let lastErr;
    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
        try {
            onProgress(0);
            return await xhrPost('/api/upload-chunk', {
                headers: {
                    'Content-Type': 'text/plain',
                    'X-Chunk-Meta': encodeURIComponent(JSON.stringify(info))
                },
                body,
                timeoutMs: CHUNK_TIMEOUT_MS,
                onProgress
            });
        } catch (err) {
            lastErr = err;
            if (!err.retryable || attempt === CHUNK_RETRIES) break;
            await sleep(attempt * 1000);
        }
    }
    throw lastErr;
};

// Sends all pieces (a few at a time), then asks the Worker to join them and record the submission.
const uploadChunked = async (meta, base64Data, setStatus) => {
    const total = Math.ceil(base64Data.length / CHUNK_CHARS);
    if (total > MAX_CHUNKS) {
        throw new Error(`File is too large. Maximum size is ${MAX_UPLOAD_MB}MB.`);
    }

    const uploadId = crypto.randomUUID();
    const sentChars = new Array(total).fill(0);   // progress per piece
    const sizes = [];
    for (let i = 0; i < total; i++) {
        sizes.push(Math.min(CHUNK_CHARS, base64Data.length - i * CHUNK_CHARS));
    }
    let doneParts = 0;
    let failed = null;
    let next = 0;

    const report = () => {
        const sent = sentChars.reduce((a, b) => a + b, 0);
        const pct = Math.min(99, Math.floor((sent / base64Data.length) * 100));
        setStatus(`Uploading to Portal... ${pct}%`);
    };

    const worker = async () => {
        while (!failed && next < total) {
            const i = next++;
            const piece = base64Data.slice(i * CHUNK_CHARS, i * CHUNK_CHARS + CHUNK_CHARS);
            try {
                await sendChunk(
                    { uploadId, index: i, total, courseId: meta.courseId, studentId: meta.studentId },
                    piece,
                    (loaded) => { sentChars[i] = Math.min(sizes[i], loaded); report(); }
                );
                sentChars[i] = sizes[i];
                doneParts++;
                report();
            } catch (err) {
                failed = failed || err;
            }
        }
    };

    report();
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, total) }, worker));
    if (failed) throw failed;

    setStatus('Finishing upload... please wait.');
    try {
        return await xhrPost('/api/finish-chunked-upload', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...meta, uploadId, total }),
            timeoutMs: FINISH_TIMEOUT_MS
        });
    } catch (err) {
        // The final step is not retried automatically: it may already have been saved.
        if (err.retryable) {
            throw new Error(err.message + " Your file may already have been saved, so check View History before uploading again.");
        }
        throw err;
    }
};


// ---- Dashboard templates (pure functions: data in, HTML out) ----
const DAY_ORDER = { 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7 };

const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 0;
    let [ , h, m, period ] = match;
    h = parseInt(h);
    if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + parseInt(m);
};

// Sorts in place by weekday, then start time.
const sortCoursesBySchedule = (courses) => courses.sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.ScheduleDay] || 8) - (DAY_ORDER[b.ScheduleDay] || 8);
    if (dayDiff !== 0) return dayDiff;
    return parseTimeToMinutes(a.TimePeriod) - parseTimeToMinutes(b.TimePeriod);
});

const loadErrorHtml = (err) =>
    `<div class="p-4 bg-red-50 text-red-600 rounded font-medium border border-red-200">Failed to load data: ${escapeHtml(err && err.message)}</div>`;

// ---- Saved copy of the dashboard data: the screen opens at once from it, then refreshes from the server. ----
// The copy lives only in this browser and is removed on log out (AppState.setUser(null)).
const readSaved = (key) => {
    try { const raw = localStorage.getItem(DASH_CACHE_PREFIX + key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
};
const writeSaved = (key, data) => {
    try { localStorage.setItem(DASH_CACHE_PREFIX + key, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
};

// Repaints without losing what the person typed in the search box or picked in the day chips.
const repaintKeepingFilters = (paint) => {
    const q = document.getElementById('courseSearch')?.value || '';
    const chip = document.querySelector('.day-chip.is-on')?.dataset.dayChip || 'All';
    const y = window.scrollY;
    paint();
    const box = document.getElementById('courseSearch');
    if (box && q) { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
    if (chip !== 'All') document.querySelector(`.day-chip[data-day-chip="${CSS.escape(chip)}"]`)?.click();
    window.scrollTo(0, y);
};

// mode 'open'  : paint the saved copy at once (if any), then the fresh data when it differs.
// mode 'fresh' : skeleton, then fresh data (after the person changed something).
// mode 'quiet' : keep what is on screen, repaint only if the data changed (pull to refresh, back online).
// Returns true when fresh data arrived.
const loadWithSavedCopy = async ({ container, key, mode, paint, fetchFresh }) => {
    const saved = mode === 'fresh' ? null : readSaved(key);
    if (mode === 'open' && saved) paint(saved, false);
    try {
        const fresh = await fetchFresh();
        writeSaved(key, fresh);
        if (!saved || JSON.stringify(fresh) !== JSON.stringify(saved)) {
            if (saved) repaintKeepingFilters(() => paint(fresh, true));
            else paint(fresh, true);
        } else if (mode === 'open') {
            // Same data as the saved copy: nothing to repaint, but the one-time side effects of a fresh paint still apply.
            if (paint.afterSame) paint.afterSame(fresh);
        }
        return true;
    } catch (err) {
        if (saved) {
            if (mode === 'open') UI.warning('Could not refresh. Showing saved data.');
        } else if (mode !== 'quiet') {
            container.innerHTML = loadErrorHtml(err);
        }
        return false;
    }
};

// Search box (and day chips for lecturers). Filtering is done by dash-nav.js.
const searchBarHtml = (days = [], extra = '', showSearch = true) => `
                    <div class="sticky top-16 z-30 bg-gray-50 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-2 pb-3 mb-4" data-course-filter>
                        <div class="flex items-center gap-2">
                            ${showSearch ? `<div class="relative flex-1 min-w-0">
                                <label for="courseSearch" class="sr-only">Search courses</label>
                                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true"></i>
                                <input id="courseSearch" type="search" autocomplete="off" placeholder="Search courses" class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                            </div>` : ''}
                            ${extra}
                        </div>
                        ${days.length ? `<div class="flex gap-2.5 overflow-x-auto mt-3 pb-2 -mx-4 px-4 scroll-px-4" role="group" aria-label="Filter by day">
                            ${['All', 'Today', ...days].map((d, i) => `<button type="button" data-day-chip="${escapeHtml(d)}" aria-pressed="${i === 0}" class="day-chip flex-shrink-0${i === 0 ? ' is-on' : ''}">${escapeHtml(d)}</button>`).join('')}<span class="flex-shrink-0 w-4" aria-hidden="true"></span>
                        </div>` : ''}
                        <p id="courseNoMatch" class="hidden text-center text-sm text-gray-500 font-medium py-6" role="status">No courses match.</p>
                    </div>`;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;
const dayNumber = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS : null;
};

// Nearest exam period that is running now or starts within 14 days: { text, tone } or null.
const examBadge = (c, today) => {
    const t = dayNumber(today);
    if (t === null) return null;
    let best = null;
    [['Midterm', c.Midterm_Start, c.Midterm_End], ['Final', c.Final_Start, c.Final_End]].forEach(([label, from, to]) => {
        const start = dayNumber(from);
        if (start === null) return;
        const end = dayNumber(to) ?? start;
        let cand = null;
        if (t >= start && t <= end) cand = { rank: 0, text: `${label} exams now`, tone: 'amber' };
        else if (start > t && start - t <= 14) cand = { rank: start - t, text: `${label} in ${start - t} day${start - t === 1 ? '' : 's'}`, tone: 'blue' };
        if (cand && (!best || cand.rank < best.rank)) best = cand;
    });
    return best;
};

const CHIP_TONES = {
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200'
};
const chip = (icon, text, tone = 'gray') =>
    `<span class="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${CHIP_TONES[tone]}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${escapeHtml(text)}</span>`;

// Info chips: student count, today's attendance (only on the class day), nearest exam period.
const courseChipsHtml = (c) => {
    const today = getLocalDateString();
    const chips = [];
    const term = [c.AcademicYear, c.Semester && String(c.Semester).replace(' Semester', ' Sem')].filter(Boolean).join(' ');
    if (term) chips.push(chip('fa-graduation-cap', term));
    const count = Number(c.StudentCount);
    if (c.StudentCount !== undefined && c.StudentCount !== null && !Number.isNaN(count)) {
        chips.push(chip('fa-users', `${count} student${count === 1 ? '' : 's'}`));
        if (c.ScheduleDay === DAY_NAMES[new Date().getDay()] && count > 0) {
            const marked = Number(c.TodayMarked) || 0;
            if (marked === 0) chips.push(chip('fa-clipboard-check', 'Attendance not taken', 'amber'));
            else if (marked >= count) chips.push(chip('fa-clipboard-check', 'Attendance done', 'green'));
            else chips.push(chip('fa-clipboard-check', `Attendance ${marked}/${count}`, 'amber'));
        }
    }
    const exam = examBadge(c, today);
    if (exam) chips.push(chip('fa-file-pen', exam.text, exam.tone));
    return chips.length ? `<div class="flex flex-wrap gap-2 mt-3">${chips.join('')}</div>` : '';
};

// Card = link to the class plus a row of shortcuts (Invite code, Scan, Summary, More = the class's Course Actions menu). A shortcut opens the class and then that page (data-intent).
const lecturerCourseCardHtml = (c) => `
                <div data-course-card data-day="${escapeHtml(c.ScheduleDay)}" data-search="${escapeHtml([c.CourseCode, c.CourseTitle, c.ScheduleDay, c.Target_Course, c.Target_Year, c.Target_Section].filter(Boolean).join(' ').toLowerCase())}" class="border rounded-xl shadow-sm bg-white transition hover:shadow-md hover:border-blue-300 overflow-hidden">
                    <a href="#class-${c.Course_ID}" class="block px-5 pt-4 pb-3">
                        <div class="flex justify-between items-center gap-2">
                            <div class="font-bold text-xl text-blue-700 truncate">${escapeHtml(c.CourseCode)}</div>
                            ${(c.Target_Course || c.Target_Year || c.Target_Section) ?
                                `<span class="shrink-0 bg-blue-50 text-blue-700 text-sm font-extrabold px-3 py-1 rounded-lg border border-blue-200 uppercase">${escapeHtml([c.Target_Course, [c.Target_Year, c.Target_Section].filter(Boolean).join('-')].filter(Boolean).join(' '))}</span>` : ''}
                        </div>
                        <div class="text-gray-800 font-semibold text-base leading-snug truncate mt-0.5">${escapeHtml(c.CourseTitle)}</div>
                        <div class="mt-2 text-sm text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span><i class="fa-regular fa-calendar mr-1" aria-hidden="true"></i>${escapeHtml(String(c.ScheduleDay || '').slice(0, 3))}</span>
                            <span><i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>${escapeHtml(c.TimePeriod)}</span>
                            ${c.Room ? `<span><i class="fa-solid fa-door-open mr-1" aria-hidden="true"></i>${escapeHtml(c.Room)}</span>` : ''}
                        </div>
                        ${courseChipsHtml(c)}
                    </a>
                    <div class="grid grid-cols-4 border-t border-gray-100 text-xs font-bold text-gray-600">
                        <button type="button" class="card-action stacked open-invite-btn" data-course-id="${c.Course_ID}" aria-label="Invite code: ${escapeHtml(c.CourseCode)}"><i class="fa-solid fa-key" aria-hidden="true"></i>Invite code</button>
                        <a href="#class-${c.Course_ID}" class="card-action stacked" data-intent="openScannerBtn"><i class="fa-solid fa-camera" aria-hidden="true"></i>Scan</a>
                        <a href="#class-${c.Course_ID}" class="card-action stacked" data-intent="openClassSummaryBtn"><i class="fa-solid fa-table-list" aria-hidden="true"></i>Summary</a>
                        <button type="button" class="card-action stacked card-more" data-course-id="${c.Course_ID}" data-code="${escapeHtml(c.CourseCode)}" data-term="${escapeHtml([c.AcademicYear, c.Semester].filter(Boolean).join('|'))}" data-archived="${Number(c.Archived) === 1 ? '1' : '0'}" aria-label="More actions: ${escapeHtml(c.CourseCode)}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i>More</button>
                    </div>
                </div>
            `;

// Student card chips: attendance counts so far (when the server sends them) and the nearest exam period.
const studentChipsHtml = (c) => {
    const chips = [];
    if (c.Att_Present !== undefined && c.Att_Present !== null) {
        const present = (Number(c.Att_Present) || 0) + (Number(c.Att_Late) || 0);
        const absent = Number(c.Att_Absent) || 0;
        if (present + absent + (Number(c.Att_Excused) || 0) > 0) {
            chips.push(chip('fa-circle-check', `${present} present`, 'green'));
            if (absent > 0) chips.push(chip('fa-circle-xmark', `${absent} absent`, 'amber'));
        }
    }
    const exam = examBadge(c, getLocalDateString());
    if (exam) chips.push(chip('fa-file-pen', exam.text, exam.tone));
    return chips.length ? `<div class="flex flex-wrap gap-1.5 mt-3">${chips.join('')}</div>` : '';
};

const enrolledCourseCardHtml = (c) => `
                <div data-course-card data-search="${escapeHtml([c.CourseCode, c.CourseTitle, c.LecturerName].filter(Boolean).join(' ').toLowerCase())}" class="cursor-pointer student-active-course p-5 border-2 border-green-200 rounded-xl shadow-sm bg-green-50 relative overflow-hidden transition hover:shadow-md hover:border-green-400 transform hover:-translate-y-1" data-course-id="${c.Course_ID}" data-course-title="${escapeHtml(c.CourseCode)} | ${escapeHtml(c.CourseTitle)}">
                    <div class="absolute top-0 right-0 bg-green-500 text-white text-[10px] px-3 py-1 rounded-bl-xl font-bold shadow-sm tracking-widest uppercase">Enrolled</div>
                    <div class="font-black text-xl text-green-800 pr-16">${escapeHtml(c.CourseCode)}</div>
                    <div class="text-gray-800 font-bold mb-2">${escapeHtml(c.CourseTitle)}</div>
                    <div class="text-sm text-gray-700 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${escapeHtml(c.LecturerName)}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${escapeHtml(c.ScheduleDay)} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${escapeHtml(c.TimePeriod)}</div>
                    ${c.Room ? `<div class="text-sm text-gray-700 mt-1"><i class="fa-solid fa-door-open w-5 text-gray-400"></i> Room: <span class="font-bold">${escapeHtml(c.Room)}</span></div>` : ''}
                    ${c.Seat_Number
                        ? `<button type="button" class="seat-map-trigger mt-3 w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-lg border border-green-300 bg-green-100 text-green-800 text-sm font-black hover:bg-green-200" data-course-id="${escapeHtml(c.Course_ID)}" aria-label="Seat ${escapeHtml(c.Seat_Number)}, view seating arrangement"><span><i class="fa-solid fa-chair mr-2" aria-hidden="true"></i>Seat ${escapeHtml(c.Seat_Number)}</span><span class="text-xs font-bold">View seating arrangement <i class="fa-solid fa-chevron-right text-[10px]" aria-hidden="true"></i></span></button>`
                        : `<div class="text-sm text-gray-700 mt-1"><i class="fa-solid fa-chair w-5 text-gray-400"></i> Seat: <span class="font-bold">Unassigned</span></div>`}
                    ${studentChipsHtml(c)}
                </div>
            `;

const buildAssignedExamsSection = (assignedExams, isBlind) => {
    if (!(assignedExams.length > 0 || isBlind)) return '';
    let assignedExamsSectionHtml = '';
                const examCardsHtml = assignedExams.length > 0
                    ? assignedExams.map(ex => {
                        const isDone = ex.status === 'Completed';
                        return `
                            <div class="dash-exam-card p-5 rounded-xl border-2 ${isDone ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-300'} flex flex-col justify-between gap-4 shadow-md transition hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300 cursor-pointer" tabindex="0">
                                <div>
                                    <div class="flex justify-between items-start gap-2">
                                        <span class="px-2.5 py-0.5 bg-blue-600 text-white font-black text-[10px] rounded uppercase tracking-wider">${escapeHtml(ex.courseCode)} &bull; ${escapeHtml(ex.term)}</span>
                                        ${ex.toDate ? `<span class="text-[10px] text-gray-500 font-mono">Open until: ${escapeHtml(formatSchedule(ex.toDate, true))} (GMT+8)</span>` : ''}
                                    </div>
                                    <h3 class="text-lg sm:text-xl font-black text-gray-900 mt-2">${escapeHtml(ex.examTitle)}</h3>
                                    <p class="text-xs text-gray-600 font-medium mt-0.5">${escapeHtml(ex.courseTitle)}</p>
                                    <div class="text-xs text-blue-800 font-bold mt-2">
                                        Questions: ${ex.regularCount}${ex.bonusCount > 0 ? ` + ${ex.bonusCount} Bonus` : ''} &nbsp;|&nbsp; Max Score: ${ex.maxScore}${ex.timeLimit ? ` &nbsp;|&nbsp; <i class="fa-regular fa-clock" aria-hidden="true"></i> ${ex.timeLimit} min${ex.startedAt && !isDone ? ' (started)' : ''}` : ''}
                                    </div>
                                </div>
                                ${isDone ? `
                                    <div class="w-full py-3 px-4 bg-green-100 text-green-800 font-black text-sm rounded-lg text-center border border-green-300">
                                        <i class="fa-solid fa-circle-check mr-1.5"></i> Completed - Score: ${ex.finalScore} /${ex.maxScore}${ex.essayPending ? '<div class="text-xs font-bold text-green-700 mt-1">Essay answers are waiting for your lecturer. Your score may go up.</div>' : ''}
                                    </div>
                                    ${ex.release ? `<button type="button" class="review-exam-btn w-full py-2.5 px-4 bg-white hover:bg-blue-50 text-blue-800 font-black text-sm rounded-lg border border-blue-300 transition focus:outline-none focus:ring-4 focus:ring-blue-300" data-assignment-id="${ex.assignmentId}"><i class="fa-solid fa-magnifying-glass mr-1.5" aria-hidden="true"></i> Review my answers</button>` : ''}
                                ` : `
                                    <button type="button" class="start-accessible-exam-btn w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-sm sm:text-base rounded-lg shadow-md transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-blue-300" data-assignment-id="${ex.assignmentId}">
                                        <i class="fa-solid ${isBlind ? 'fa-headphones' : 'fa-pen-to-square'} mr-2 text-lg"></i> Enter Exam: ${escapeHtml(ex.examTitle)}
                                    </button>
                                `}
                            </div>
                        `;
                    }).join('')
                    : `<div class="col-span-full p-6 text-center text-gray-500 border-2 border-dashed border-gray-300 rounded-xl font-bold text-sm">You have no active assigned exams at this moment.</div>`;

                const readAloudBtnHtml = isBlind ? `
                            <button type="button" id="readDashboardExamsBtn" class="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs sm:text-sm rounded-lg shadow transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-blue-300">
                                <i class="fa-solid fa-volume-high mr-2"></i> Read Aloud Assigned Exams
                            </button>` : '';

                assignedExamsSectionHtml = `
                    <section id="studentExamsSection" class="bg-white text-gray-900 p-5 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200 scroll-mt-20">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 pb-3 border-b border-gray-200">
                            <div class="flex items-center">
                                <div class="bg-blue-600 text-white p-2.5 rounded-xl mr-3">
                                    <i class="fa-solid ${isBlind ? 'fa-universal-access' : 'fa-file-pen'} text-xl"></i>
                                </div>
                                <div>
                                    <h2 class="text-xl sm:text-2xl font-black text-gray-900">${isBlind ? 'Assigned Accessible Exams' : 'Assigned Exams'}</h2>
                                    <p class="text-xs text-gray-500">${isBlind ? 'Full-screen exam mode with voice read-aloud and automatic score recording' : 'Full-screen exam mode with automatic score recording'}</p>
                                </div>
                            </div>
                            ${readAloudBtnHtml}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            ${examCardsHtml}
                        </div>
                    </section>
                `;
    return assignedExamsSectionHtml;
};

// Terms: a class has an optional Academic Year + Semester. The lecturer list shows the current term by default.
const SEM_RANK = { '1st Semester': 1, '2nd Semester': 2, 'Summer': 3 };
const termKey = (c) => [c.AcademicYear, c.Semester].filter(Boolean).join('|');
const termLabel = (c) => [c.AcademicYear && `AY ${c.AcademicYear}`, c.Semester].filter(Boolean).join(' · ') || 'No term set';
// The current term is set by an admin (Admin tools); until then it follows the calendar in GMT+8.
// Newest academic year first; inside a year, later semesters first.
const compareTerms = (a, b) => {
    const [ay1, s1] = a.split('|'), [ay2, s2] = b.split('|');
    if ((ay1 || '') !== (ay2 || '')) return (ay2 || '').localeCompare(ay1 || '');
    return (SEM_RANK[s2] || 0) - (SEM_RANK[s1] || 0);
};

document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'groupUploadSet') CourseDashboard.loadUploadSetMembers().catch(() => {});
    if (!e.target || e.target.id !== 'courseTermFilter') return;
    CourseDashboard.view = e.target.value === 'archived' ? 'archived' : 'active';   // My classes / Archived classes
    if (CourseDashboard.repaintLecturer) CourseDashboard.repaintLecturer();
});

// Archive / restore a class (lecturer). Archived classes leave the main list; nothing is deleted.
document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('.archive-course-btn');
    if (!btn) return;
    const archive = btn.dataset.archive === '1';
    try {
        await apiFetch('/api/archive-course', { method: 'POST', body: JSON.stringify({ courseId: btn.dataset.courseId, lecturerId: AppState.user.User_ID, archived: archive }) });
        const course = CourseDashboard.lecturerData && CourseDashboard.lecturerData.courses.find(c => c.Course_ID === btn.dataset.courseId);
        if (course) course.Archived = archive ? 1 : 0;
        UI.success(archive ? 'Class archived' : 'Class restored');
        if (document.getElementById('classTabBar')) { window.location.hash = 'dashboard'; }
        if (CourseDashboard.repaintLecturer) CourseDashboard.repaintLecturer();
    } catch (err) {
        UI.error(err.message || 'Could not update the class.');
    }
});

export const CourseDashboard = {
    view: 'active',   // 'active' = My classes, 'archived' = Archived classes (a separate list, grouped by academic year and term)

    // Set while a lecturer uploads on behalf of a student: { courseId, student }. Null for a student's own upload.
    uploadTarget: null,

    // Lecturer: opens the Submit Document form for one student of the class.
    openUploadForStudent: (courseId, student) => {
        CourseDashboard.uploadTarget = { courseId, student };
        const form = document.getElementById('submitDocForm');
        if (form) form.reset();
        const type = document.getElementById('submissionType');
        if (type) type.dispatchEvent(new Event('change', { bubbles: true }));
        ['submitDocError', 'submitDocSuccess', 'submitDocProgress'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        const banner = document.getElementById('submitDocForStudent');
        if (banner) {
            banner.textContent = `Uploading for: ${student.Name}${student.Student_Number ? ' (' + student.Student_Number + ')' : ''}`;
            banner.classList.remove('hidden');
        }
        const title = document.getElementById('submitDocTitle');
        if (title) title.textContent = 'Upload for Student';
        const label = document.getElementById('groupUploadLabel');
        if (label) label.textContent = 'Upload for this student as';
        document.getElementById('submitDocModal').classList.remove('hidden');
        CourseDashboard.loadGroupMembersForUpload(courseId, student.User_ID);
    },

    // Back to the student's own form (titles and banner restored).
    resetUploadTarget: () => {
        CourseDashboard.uploadTarget = null;
        document.getElementById('submitDocForStudent')?.classList.add('hidden');
        const title = document.getElementById('submitDocTitle');
        if (title) title.textContent = 'Submit Document';
        const label = document.getElementById('groupUploadLabel');
        if (label) label.textContent = 'Upload as';
    },

    // Fills the term (Mid/Final by today's date) and the "Upload as" choices (Individual, or one of the student's groups).
    loadGroupMembersForUpload: async (courseId, studentId = AppState.user.User_ID) => {
        const section = document.getElementById('groupUploadSection');
        const list = document.getElementById('groupMembersList');
        const picker = document.getElementById('groupUploadSet');

        // Term follows the date: the form always opens on the current term.
        const termSel = document.getElementById('submitTerm');
        if (termSel) {
            termSel.value = 'MidTerm';
            apiFetch(`/api/default-upload-term?courseId=${courseId}`).then(r => { if (r && r.term) termSel.value = r.term; }).catch(() => {});
        }

        if (!section || !list) return;
        section.classList.add('hidden');
        list.classList.add('hidden');
        list.innerHTML = '';
        if (picker) picker.innerHTML = '<option value="">Individual</option>';

        try {
            const mine = await apiFetch(`/api/student-groups?courseId=${courseId}&studentId=${studentId}`);
            const groups = mine.groups || [];
            if (!groups.length) return;
            CourseDashboard.uploadGroupCtx = { courseId, studentId };
            picker.innerHTML = '<option value="">Individual</option>' + groups.map(g => `<option value="${escapeHtml(g.setId)}">Group - ${escapeHtml(g.setName)}: ${escapeHtml(g.groupName)}</option>`).join('');
            picker.value = '';
            section.classList.remove('hidden');
        } catch (err) {
            console.error("Failed to load groups", err);
        }
    },

    // Members of the student's group in the chosen set (nothing when "Individual" is chosen).
    loadUploadSetMembers: async () => {
        const ctx = CourseDashboard.uploadGroupCtx;
        const list = document.getElementById('groupMembersList');
        const picker = document.getElementById('groupUploadSet');
        if (!ctx || !list || !picker) return;
        list.innerHTML = '';
        if (!picker.value) { list.classList.add('hidden'); return; }
        const data = await apiFetch(`/api/group-members?courseId=${ctx.courseId}&studentId=${ctx.studentId}&setId=${encodeURIComponent(picker.value)}`);
        if (data.groupName && data.members && data.members.length > 0) {
            list.innerHTML = '<div class="text-[10px] font-bold text-purple-800 uppercase tracking-wider">Also for these members</div>' + data.members.map(m => `
                <label class="flex items-center space-x-2 text-[10px] font-medium text-gray-700 cursor-pointer">
                    <input type="checkbox" class="group-member-checkbox rounded text-purple-600 focus:ring-purple-500" value="${m.User_ID}" checked>
                    <span>${escapeHtml(m.Name)} (${escapeHtml(m.Student_Number || 'N/A')})</span>
                </label>
            `).join('');
        } else {
            list.innerHTML = '<div class="text-[10px] text-gray-500 italic">No other members in this group.</div>';
        }
        list.classList.remove('hidden');
    },

    submitDocument: async () => {
        const btn = document.getElementById('submitDocBtn');
        const errorDiv = document.getElementById('submitDocError');
        const successDiv = document.getElementById('submitDocSuccess');
        const progressDiv = document.getElementById('submitDocProgress');
        const progressText = document.getElementById('submitDocProgressText');

        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        progressDiv.classList.remove('hidden');
        btn.disabled = true;

        try {
            // A lecturer uploads on behalf of a student; otherwise the signed-in student uploads for themselves.
            const target = CourseDashboard.uploadTarget;
            const courseId = target ? target.courseId : document.getElementById('openSubmitDocModalBtn').dataset.courseId;
            if (!courseId) throw new Error("Could not identify the active course.");

            const term = document.getElementById('submitTerm').value;
            const titleInput = document.getElementById('submitTitle').value.trim();

            if (/[.\/\\:*?"<>|]/.test(titleInput)) {
                throw new Error("Title cannot contain special characters like dots (.) or slashes (/).");
            }

            const title = titleInput;
            const desc = document.getElementById('submitDesc').value.trim();
            const type = document.getElementById('submissionType').value;

            const uploadAs = document.getElementById('groupUploadSet');
            const groupSection = document.getElementById('groupUploadSection');
            const isGroup = !!(uploadAs && uploadAs.value && groupSection && !groupSection.classList.contains('hidden'));

            const includedMembers = [];
            if (isGroup) {
                document.querySelectorAll('.group-member-checkbox:checked').forEach(cb => {
                    includedMembers.push(cb.value);
                });
            }

            const user = target ? target.student : AppState.user;
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            const timestamp = `${yyyy}${mm}${dd}${hh}${ss}`;

            const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, ' ');
            const studentName = String(user.Name || '').replace(/[^a-zA-Z0-9_-]/g, ' ');
            const baseFilename = `${term}_${timestamp}_${user.Student_Number || ''}_${studentName}_${safeTitle}`;

            const courseYearSection = [user.Program_Course, user.Program_Year, user.Program_Section].filter(Boolean).join(" ") || "General";

            let base64Data = "";
            let mimeType = "";
            let finalFilename = "";

            if (type === 'file') {
                const fileInput = document.getElementById('submitFileInput');
                if (!fileInput.files || fileInput.files.length === 0) throw new Error("Please select a file.");
                const file = fileInput.files[0];

                if (file.size > MAX_UPLOAD_BYTES) {
                    throw new Error(`File size exceeds ${MAX_UPLOAD_MB}MB. Please upload your document to Google Drive, set the sharing access to 'Anyone with the link', and submit it here as a URL Link instead.`);
                }

                mimeType = file.type;
                const ext = file.name.split('.').pop();
                finalFilename = `${baseFilename}.${ext}`;

                base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(file);
                });
            } else {
                const urlLink = document.getElementById('submitUrlInput').value.trim();
                if (!urlLink) throw new Error("Please enter a URL link.");

                const content = `Title: ${title}\nTerm: ${term}\nDescription: ${desc}\nLink: ${urlLink}`;
                base64Data = btoa(unescape(encodeURIComponent(content)));
                mimeType = "text/plain";
                finalFilename = `${baseFilename}.txt`;
            }

            // Details travel in a header; the raw base64 file is the request body.
            // The Worker streams the body straight to Google Drive without parsing it,
            // which is what allows large files.
            const meta = {
                courseId: courseId,
                studentId: user.User_ID,
                term: term,
                title: title,
                description: desc,
                type: type,
                filename: finalFilename,
                mimeType: mimeType,
                pathParts: [courseYearSection, "Submitted"],
                isGroup: isGroup,
                groupSetId: isGroup ? uploadAs.value : undefined,
                includedMembers: includedMembers
            };

            progressText.textContent = 'Starting upload...';

            let dbData;
            if (base64Data.length <= CHUNK_CHARS) {
                // Small file or link: one request.
                dbData = await xhrPost('/api/upload-submission', {
                    headers: {
                        'Content-Type': 'text/plain',
                        'X-Submission-Meta': encodeURIComponent(JSON.stringify(meta))
                    },
                    body: base64Data,
                    timeoutMs: SINGLE_TIMEOUT_MS,
                    onProgress: (loaded) => {
                        const pct = Math.min(99, Math.floor((loaded / base64Data.length) * 100));
                        progressText.textContent = `Uploading to Portal... ${pct}%`;
                    }
                });
            } else {
                // Large file: pieces with retries.
                dbData = await uploadChunked(meta, base64Data, (text) => { progressText.textContent = text; });
            }

            if (!dbData.success) {
                throw new Error("Server Error: " + (dbData.error || "Unknown error occurred"));
            }

            progressDiv.classList.add('hidden');
            UI.success('Submission uploaded');
            successDiv.textContent = "Submission uploaded successfully!";
            successDiv.classList.remove('hidden');
            document.getElementById('submitDocForm').reset();

            setTimeout(() => {
                document.getElementById('submitDocModal').classList.add('hidden');
                successDiv.classList.add('hidden');
                CourseDashboard.resetUploadTarget();

                const summaryModal = document.getElementById('studentSummaryModal');
                if (summaryModal && !summaryModal.classList.contains('hidden')) {
                    const activeCard = document.querySelector(`.student-active-course[data-course-id="${courseId}"]`);
                    if (activeCard) activeCard.click();
                }
            }, 2000);
        } catch (error) {
            progressDiv.classList.add('hidden');
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
        }
    },

    createProgram: async () => {
        const btn = document.getElementById('addProgramBtn');
        const errorDiv = document.getElementById('programError');
        const successDiv = document.getElementById('programSuccess');
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        const payload = {
            programCode: document.getElementById('programCode').value.trim()
        };

        try {
            await apiFetch('/api/programs', { method: 'POST', body: JSON.stringify(payload) });
            UI.success('Added to registration list');
            successDiv.textContent = "Added to Registration List successfully!";
            successDiv.classList.remove('hidden');
            document.getElementById('addProgramForm').reset();

            setTimeout(() => {
                successDiv.classList.add('hidden');
                document.getElementById('apModal').classList.add('hidden');
            }, 1500);
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Add to Registration List';
        }
    },

    createCourse: async () => {
        const btn = document.getElementById('addCourseBtn');
        const errorDiv = document.getElementById('courseError');
        errorDiv.classList.add('hidden');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        const payload = {
            courseCode: document.getElementById('courseCode').value.trim(),
            courseTitle: document.getElementById('courseTitle').value.trim(),
            scheduleDay: document.getElementById('scheduleDay').value,
            targetCourse: document.getElementById('targetCourse').value.trim(),
            targetYear: document.getElementById('targetYear').value.trim(),
            targetSection: document.getElementById('targetSection').value.trim(),
            timePeriod: document.getElementById('timePeriod').value.trim(),
            room: document.getElementById('courseRoom').value.trim(),
            academicYear: document.getElementById('courseAY').value.trim(),
            semester: document.getElementById('courseSemester').value,
            lecturerId: AppState.user.User_ID
        };

        try {
            await apiFetch('/api/courses', { method: 'POST', body: JSON.stringify(payload) });
            document.getElementById('addCourseForm').reset();
            document.getElementById('ccModal').classList.add('hidden');
            UI.success('Course created');
            await CourseDashboard.loadDashboardData('fresh');
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Create Course';
        }
    },

    renderLecturerDashboard: async (container, mode = 'open') => {
        const paint = (data) => {
            sortCoursesBySchedule(data.courses);

            CourseDashboard.lecturerData = data;
            CourseDashboard.repaintLecturer = () => paint(CourseDashboard.lecturerData);
            const archivedCourses = data.courses.filter(c => Number(c.Archived) === 1);
            const activeCourses = data.courses.filter(c => Number(c.Archived) !== 1);
            // Two lists: My classes (everything not archived) and Archived classes, which are not drawn at all until chosen.
            if (!archivedCourses.length) CourseDashboard.view = 'active';
            const archivedView = CourseDashboard.view === 'archived';
            let coursesHtml;
            if (archivedView) {
                // Headings per academic year and term, newest first; classes without a term go last.
                const terms = [...new Set(archivedCourses.filter(c => c.AcademicYear || c.Semester).map(termKey))].sort(compareTerms);
                const groups = [...terms, ''].map(k => [k, archivedCourses.filter(c => termKey(c) === k)]).filter(([, list]) => list.length);
                coursesHtml = groups.map(([k, list]) => `<h3 class="col-span-full text-xs font-black uppercase tracking-wider text-gray-500 ${k ? '' : 'mt-2'} -mb-2">${escapeHtml(k ? termLabel(list[0]) : 'No term set')} <span class="ml-1 font-semibold normal-case text-gray-400">${list.length} class${list.length === 1 ? '' : 'es'}</span></h3>${list.map(lecturerCourseCardHtml).join('')}`).join('');
            } else {
                coursesHtml = activeCourses.map(lecturerCourseCardHtml).join('');
            }
            const viewSelectHtml = archivedCourses.length ? `<select id="courseTermFilter" aria-label="Show" class="shrink-0 max-w-[11rem] sm:max-w-none px-3 py-2.5 border border-gray-300 rounded-full text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="active"${archivedView ? '' : ' selected'}>My classes (${activeCourses.length})</option>
                    <option value="archived"${archivedView ? ' selected' : ''}>Archived classes (${archivedCourses.length})</option>
                </select>` : '';
            const days7 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const filterBar = data.courses.length >= 3 ? searchBarHtml(archivedView ? [] : days7, viewSelectHtml) : (viewSelectHtml ? searchBarHtml([], viewSelectHtml, false) : '');

            if (!coursesHtml && archivedCourses.length) {
                coursesHtml = '<div class="col-span-full p-6 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">All your classes are archived. Create a new class, or open Archived classes to restore one.</div>';
            } else if (!coursesHtml) {
                coursesHtml = `<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium"><div class="mx-auto mb-3 w-14 h-14 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl"><i class="fa-solid fa-chalkboard-user" aria-hidden="true"></i></div><p class="mb-1 font-bold text-gray-700">No courses yet</p><p class="mb-4 text-sm">Create your first course to start taking attendance.</p><button type="button" id="emptyNewCourseBtn" class="open-create-course-btn flex-shrink-0 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"><i class="fa-solid fa-plus mr-2"></i> New Course</button></div>`;
            }

            container.innerHTML = `
                <div class="fade-in max-w-5xl mx-auto">
                    ${filterBar}
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        ${coursesHtml}
                    </div>
                </div>
            `;
        };
        return loadWithSavedCopy({
            container, mode, paint,
            key: `${AppState.user.User_ID}:lecturer`,
            fetchFresh: async () => {
                const ts = new Date().getTime();
                const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer&today=${getLocalDateString()}&_t=${ts}`);
                return data;
            }
        });
    },

    renderStudentDashboard: async (container, mode = 'open') => {
        const paint = ({ myCoursesRes, examsRes }, isFresh = true) => {
            const assignedExams = examsRes.exams || [];
            CourseExam.studentAssignedExams = assignedExams;
            if (examsRes.student) {
                AppState.user.eye_condition = examsRes.student.eye_condition;
                AppState.user.secure = examsRes.student.secure;
                AppState.user.Program_Course = examsRes.student.Program_Course;
                AppState.user.Program_Year = examsRes.student.Program_Year;
                AppState.user.Program_Section = examsRes.student.Program_Section;
                const progEl = document.getElementById('profileProgramText');
                if (progEl) progEl.textContent = [examsRes.student.Program_Course, examsRes.student.Program_Year, examsRes.student.Program_Section].filter(Boolean).join(' ') || 'Not assigned';
            }

            const isBlind = AppState.user.eye_condition === 'Legally Blind';

            const assignedExamsSectionHtml = buildAssignedExamsSection(assignedExams, isBlind);

            const enrolledIds = myCoursesRes.courses.map(c => c.Course_ID);

            let enrolledHtml = myCoursesRes.courses.map(enrolledCourseCardHtml).join('');

            if (!enrolledHtml) {
                enrolledHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium"><div class="mx-auto mb-3 w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-2xl"><i class="fa-solid fa-book-open" aria-hidden="true"></i></div><p class="font-bold text-gray-700">Not enrolled yet</p><p class="text-sm mt-1">Pick a course from Available Courses below.</p></div>';
            }

            container.innerHTML = `
                <div class="space-y-12 fade-in">
                    ${joinFormHtml()}
                    ${assignedExamsSectionHtml}
                    ${myCoursesRes.courses.length >= 4 ? searchBarHtml() : ''}
                    <section id="studentCoursesSection" class="scroll-mt-20">
                        <h2 class="text-2xl font-black mb-6 text-gray-800 flex items-center"><div class="bg-green-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-check-double text-green-600"></i></div>My Active Courses</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            ${enrolledHtml}
                        </div>
                    </section>
                </div>
            `;

            if (isFresh && isBlind && assignedExams.some(e => e.status !== 'Completed') && CourseExam.announceDashboardExams) {
                CourseExam.announceDashboardExams();
            }
        };
        return loadWithSavedCopy({
            container, mode, paint,
            key: `${AppState.user.User_ID}:student`,
            fetchFresh: async () => {
                const ts = new Date().getTime();
                const [myCoursesRes, examsRes] = await Promise.all([
                    apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=student&_t=${ts}`),
                    apiFetch(`/api/student-accessible-exams?studentId=${AppState.user.User_ID}&_t=${ts}`).catch(() => ({ exams: [] }))
                ]);
                return { myCoursesRes, examsRes };
            }
        });
    },

    // mode: 'open' (default, saved copy first), 'fresh' (skeleton, after a change) or 'quiet' (no flicker).
    // Returns true when fresh data arrived.
    loadDashboardData: async (mode = 'open') => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return false;

        const isLecturer = AppState.user.role.toLowerCase() === 'lecturer';
        const key = `${AppState.user.User_ID}:${isLecturer ? 'lecturer' : 'student'}`;
        // With no saved copy to show, the first paint still needs the skeleton.
        if (mode === 'fresh' || (mode === 'open' && !readSaved(key))) {
            container.innerHTML = Skeleton.dashboard(AppState.user.role);
        }

        // Refresh the shared current term in the background; the list repaints if it changed.
        if (isLecturer) { loadTerm(); refreshResetBadge(); }

        return isLecturer
            ? CourseDashboard.renderLecturerDashboard(container, mode)
            : CourseDashboard.renderStudentDashboard(container, mode);
    }
};
