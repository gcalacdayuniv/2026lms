// js/course-scanner.js
// Lecturer tool (Course Actions > Scan Answer Sheets): prints the bubble answer sheet, reads photos of
// the shaded sheets (omr-scan.js), matches each sheet to a student by the shaded student number, and
// saves the scores into an assessment (Record Scores). Layout lives in components-scanner.js.
import { apiFetch, AppState } from './globals.js';
import { CourseSummary } from './course-summary.js';
import { UI } from './ui-feedback.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml as esc } from './html-utils.js';
import { CourseScanRecords } from './course-scan-records.js';
import { ScanQueue } from './course-scan-queue.js';
import { ScanPhotos } from './course-scan-photos.js';
import { buildSheetHtml, MAX_QUESTIONS, MAX_CHOICES } from './omr-sheet.js';
import { scanImage, scanSource, detectMarkers, meanBrightness, toGray, drawOverlay, BLANK, MULTIPLE } from './omr-scan.js';

// Live camera settings
const LIVE_TICK_MS = 250;      // how often a frame is checked
const LIVE_DETECT_SIDE = 640;  // frames are shrunk to this size for the quick check
const AUTO_SAVE_MS = 3000;         // a sheet is uploaded this long after the last edit
const LIVE_REVIEW_HOLD_MS = 20000; // while a live review is open the lecturer gets longer to check it
const RETRY_MS = 15000;
const MAX_ATTEMPTS = 6;
const UPLOAD_CHUNK = 100;
const REARM_MOVE = 0.06;       // after a capture, the sheet must move this much (or leave) before the next one
const MIN_SPAN = 0.5;          // the sheet must fill at least this share of the frame
const MIN_BRIGHT = 70;         // average brightness (0-255) below this is "too dark"

const LETTERS = 'ABCDE';
const TERM_LABELS = { MidTerm: 'Mid Term', FinalTerm: 'Final Term' };
const CATEGORY_LABELS = {
    Written: 'Written (Quiz/Long)',
    Narrative: 'Written (Narrative)',
    Individual: 'Written (Individual)',
    Performance: 'Performance (Task)',
    Report: 'Performance (Report)',
    MajorExam: 'Major Exam'
};

const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value : '');
const norm = (s) => String(s ?? '').trim().toLowerCase();
const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');
const fmt = (n) => Number(Number(n).toFixed(2));
const pause = (ms = 0) => new Promise(r => setTimeout(r, ms));

const toUrl = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not keep the photo.'))), 'image/jpeg', 0.75);
});

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not show the photo.'));
    img.src = url;
});

export const CourseScanner = {
    courseId: '',
    course: null,
    students: [],
    exams: [],
    assessments: [],
    classExams: [],
    mode: 'exam',
    typed: { n: 20, c: 4, key: Array(20).fill(-1) },
    cfg: null,
    signature: '',
    rows: [],
    nextRowId: 1,
    createdExamId: null,
    busy: false,
    saving: false,
    flushing: false,
    flushAgain: false,
    flushTimer: null,
    lastChange: 0,
    targets: new Map(),     // assessment already resolved for a setup, so it is looked up or created once
    examsMade: new Set(),
    live: { stream: null, timer: null, canvas: null, prev: null, shot: null, steady: 0, steadySince: 0, armed: true, lost: 0, capturing: false, replacing: null, vw: 0, vh: 0 },

    init: () => {
        document.addEventListener('click', CourseScanner.handleClicks);
        document.addEventListener('change', CourseScanner.handleChanges);
        document.addEventListener('input', CourseScanner.handleInputs);
        // Sheets that could not be uploaded stay in the cache and are sent again when the connection is back.
        window.addEventListener('online', () => { if (AppState.user) { CourseScanner.flush(true); ScanPhotos.send(); } });
        setInterval(() => {
            if (!AppState.user) return;
            if (ScanQueue.all().length) CourseScanner.flush();
            ScanPhotos.send();
            ScanPhotos.purge(id => ScanQueue.all().some(e => e.scanId === id));
        }, 20000);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) CourseScanner.stopLive();
        });
    },

    // ---------- Small helpers ----------

    setAlert: (msg, ok = true) => {
        const el = $('scnAlert');
        if (!el) return;
        if (!msg) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        el.textContent = msg;
        el.className = `mb-3 p-2 rounded text-xs font-bold ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`;
    },

    revokeRow: (row) => {
        if (row.photoUrl) URL.revokeObjectURL(row.photoUrl);
        if (row.overlayUrl) URL.revokeObjectURL(row.overlayUrl);
        row.photoUrl = '';
        row.overlayUrl = '';
    },

    clearRows: () => {
        CourseScanner.rows.forEach(CourseScanner.revokeRow);
        CourseScanner.rows = [];
    },

    reset: (courseId) => {
        CourseScanner.clearRows();
        CourseScanner.courseId = courseId;
        CourseScanner.course = null;
        CourseScanner.students = [];
        CourseScanner.exams = [];
        CourseScanner.assessments = [];
        CourseScanner.classExams = [];
        CourseScanner.cfg = null;
        CourseScanner.signature = '';
        CourseScanner.createdExamId = null;
        CourseScanner.mode = 'exam';
        CourseScanner.typed = { n: 20, c: 4, key: Array(20).fill(-1) };
    },

    view: 'setup',
    lastWork: 'setup',   // 'setup' or 'scan': where the Scan tab returns to

    showView: (name) => {
        CourseScanner.view = name;
        if (name !== 'saved') CourseScanner.lastWork = name;
        $('scnSetupView')?.classList.toggle('hidden', name !== 'setup');
        $('scnScanView')?.classList.toggle('hidden', name !== 'scan');
        $('scnSavedView')?.classList.toggle('hidden', name !== 'saved');
        [['scnTabScan', name !== 'saved'], ['scnTabSaved', name === 'saved']].forEach(([id, active]) => {
            const tab = $(id);
            if (!tab) return;
            tab.setAttribute('aria-selected', String(active));
            tab.className = 'px-4 py-2 text-sm font-bold border-b-2 -mb-px ' + (active
                ? 'border-rose-600 text-rose-700'
                : 'border-transparent text-gray-500 hover:text-gray-800');
        });
    },

    courseLabel: () => {
        const c = CourseScanner.course;
        return c ? [c.CourseCode, c.CourseTitle].filter(Boolean).join(' - ') : '';
    },

    // ---------- Opening and loading ----------

    open: async () => {
        document.getElementById('courseMenuModal')?.classList.add('hidden');
        $('scannerModal')?.classList.remove('hidden');

        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        if (courseId !== CourseScanner.courseId) CourseScanner.reset(courseId);

        CourseScanner.setAlert('');
        if (!val('scnDate')) $('scnDate').value = getLocalDateString();
        CourseScanner.showView('setup');
        CourseScanner.flush();
        await CourseScanner.load();
    },

    close: () => {
        CourseScanner.stopLive();
        $('scannerModal')?.classList.add('hidden');
    },

    load: async () => {
        const select = $('scnExamSelect');
        if (select) select.innerHTML = '<option value="">Loading exams...</option>';
        try {
            const ts = new Date().getTime();
            const [details, examRes, assessRes, classExamRes] = await Promise.all([
                apiFetch(`/api/course-details?courseId=${CourseScanner.courseId}&_t=${ts}`),
                apiFetch(`/api/exams?lecturerId=${AppState.user.User_ID}&_t=${ts}`),
                apiFetch(`/api/assessments?courseId=${CourseScanner.courseId}&_t=${ts}`),
                apiFetch(`/api/class-exams?courseId=${CourseScanner.courseId}&_t=${ts}`)
            ]);
            CourseScanner.course = details.course || null;
            CourseScanner.students = CourseSummary.sortStudents(details.students || []);
            CourseScanner.exams = examRes.exams || [];
            CourseScanner.assessments = assessRes.assessments || [];
            CourseScanner.classExams = classExamRes.classExams || [];
        } catch (err) {
            CourseScanner.setAlert(err.message || 'Failed to load.', false);
        }
        CourseScanner.renderExamSelect();
        CourseScanner.renderKeyGrid();
        CourseScanner.refreshSetup();
    },

    // ---------- Answer key ----------

    // Turns a stored exam into a scannable key. Only multiple-choice questions (2-5 choices) whose
    // answer text matches one of the choices can be shaded on the sheet; the rest are skipped.
    analyzeExam: (exam) => {
        let questions = [];
        try { questions = JSON.parse(exam.ExamData || '[]'); } catch (e) { questions = []; }
        const items = [];
        let skipped = 0;
        questions.forEach(q => {
            const choices = Array.isArray(q[2]) ? q[2] : [];
            const idx = choices.findIndex(c => norm(c) === norm(q[3]));
            if (choices.length < 2 || choices.length > MAX_CHOICES || idx < 0) {
                skipped++;
                return;
            }
            items.push({ idx, bonus: Boolean(q[5]), c: choices.length, part: Math.max(0, parseInt(q[0], 10) || 0) });
        });
        return {
            n: items.length,
            c: Math.max(2, ...items.map(i => i.c)),
            key: items.map(i => i.idx),
            bonus: items.map(i => i.bonus),
            parts: items.map(i => i.part),
            skipped
        };
    },

    ensureTypedKey: () => {
        const t = CourseScanner.typed;
        while (t.key.length < t.n) t.key.push(-1);
        t.key.length = t.n;
        t.key = t.key.map(k => (k >= 0 && k < t.c ? k : -1));
    },

    // The existing assessment the scores would go into, or null when a new one is needed.
    findAssessment: (cfg, assessments = CourseScanner.assessments, classExams = CourseScanner.classExams) => {
        if (cfg.mode === 'exam') {
            const link = classExams.find(ce => ce.Exam_ID === cfg.examId && ce.Assessment_ID);
            const linked = link ? assessments.find(a => a.Assessment_ID === link.Assessment_ID) : null;
            if (linked) return linked;
        }
        return assessments.find(a => norm(a.Title) === norm(cfg.title) && a.Term === cfg.term) || null;
    },

    // Validates the setup form and returns the scanning settings, or { ok: false, error }.
    getConfig: () => {
        const term = val('scnTerm') || 'MidTerm';
        const category = val('scnCategory') || 'Written';
        const date = val('scnDate') || getLocalDateString();
        let cfg;

        if (CourseScanner.mode === 'exam') {
            const exam = CourseScanner.exams.find(e => e.Exam_ID === val('scnExamSelect'));
            if (!exam) return { ok: false, error: 'Choose an exam.' };
            const a = CourseScanner.analyzeExam(exam);
            if (a.n < 1) return { ok: false, error: 'This exam has no multiple-choice question that can be scanned.' };
            if (a.n > MAX_QUESTIONS) return { ok: false, error: `The sheet holds up to ${MAX_QUESTIONS} questions; this exam has ${a.n}.` };
            const maxRegular = a.bonus.filter(b => !b).length;
            if (maxRegular < 1) return { ok: false, error: 'Every question in this exam is a bonus question.' };
            cfg = { mode: 'exam', examId: exam.Exam_ID, title: String(exam.Title || '').trim(), n: a.n, c: a.c, key: a.key, bonus: a.bonus, parts: a.parts, maxRegular, skipped: a.skipped };
        } else {
            const t = CourseScanner.typed;
            const title = val('scnTypedTitle').trim();
            if (!title) return { ok: false, error: 'Enter a title for the exam.' };
            if (!(t.n >= 1 && t.n <= MAX_QUESTIONS)) return { ok: false, error: `Questions must be 1 to ${MAX_QUESTIONS}.` };
            const missing = t.key.findIndex(k => k < 0 || k >= t.c);
            if (missing >= 0) return { ok: false, error: `Set the answer for question ${missing + 1}.` };
            cfg = { mode: 'typed', examId: '', title, n: t.n, c: t.c, key: t.key.slice(), bonus: Array(t.n).fill(false), maxRegular: t.n, skipped: 0 };
        }

        cfg.term = term;
        cfg.category = category;
        cfg.date = date;
        const existing = CourseScanner.findAssessment(cfg);
        cfg.existing = existing;
        cfg.cap = existing ? Number(existing.Max_Score) : cfg.maxRegular;
        cfg.ok = true;
        return cfg;
    },

    // ---------- Setup view ----------

    renderExamSelect: () => {
        const select = $('scnExamSelect');
        if (!select) return;
        const keep = select.value;
        const options = ['<option value="">Select an exam...</option>'].concat(
            CourseScanner.exams.map(ex => {
                const a = CourseScanner.analyzeExam(ex);
                return `<option value="${esc(ex.Exam_ID)}">${esc(ex.Title)} (${a.n} scannable)</option>`;
            })
        );
        select.innerHTML = options.join('');
        if (keep && CourseScanner.exams.some(e => e.Exam_ID === keep)) select.value = keep;
    },

    renderKeyGrid: () => {
        const grid = $('scnKeyGrid');
        if (!grid) return;
        CourseScanner.ensureTypedKey();
        const { n, c, key } = CourseScanner.typed;
        grid.innerHTML = Array.from({ length: n }, (_, i) => `
            <div class="flex items-center gap-1.5 py-0.5" role="group" aria-label="Question ${i + 1}">
                <span class="w-7 text-right text-[11px] font-bold text-gray-500">${i + 1}</span>
                ${Array.from({ length: c }, (_, k) => `
                    <button type="button" class="scn-key-btn w-8 h-8 rounded-full border text-xs font-bold ${key[i] === k ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}" data-q="${i}" data-k="${k}" aria-pressed="${key[i] === k}" aria-label="Question ${i + 1}, answer ${LETTERS[k]}">${LETTERS[k]}</button>
                `).join('')}
            </div>
        `).join('');
    },

    setKey: (q, k) => {
        const t = CourseScanner.typed;
        t.key[q] = t.key[q] === k ? -1 : k;
        document.querySelectorAll(`.scn-key-btn[data-q="${q}"]`).forEach(btn => {
            const on = Number(btn.dataset.k) === t.key[q];
            btn.setAttribute('aria-pressed', String(on));
            btn.className = `scn-key-btn w-8 h-8 rounded-full border text-xs font-bold ${on ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`;
        });
        CourseScanner.refreshSetup();
    },

    applyQuickKey: () => {
        const t = CourseScanner.typed;
        const letters = (val('scnKeyQuick').toUpperCase().match(/[A-E]/g) || []);
        if (letters.length === 0) {
            CourseScanner.setAlert('Type the answer letters first, for example ABCDDACB.', false);
            return;
        }
        let outOfRange = 0;
        for (let i = 0; i < t.n; i++) {
            const k = letters[i] ? LETTERS.indexOf(letters[i]) : -1;
            if (k >= t.c) outOfRange++;
            t.key[i] = k >= 0 && k < t.c ? k : -1;
        }
        CourseScanner.renderKeyGrid();
        CourseScanner.refreshSetup();
        const extra = Math.max(0, letters.length - t.n);
        const notes = [];
        if (extra) notes.push(`${extra} extra letter(s) ignored`);
        if (outOfRange) notes.push(`${outOfRange} letter(s) are beyond the choices per question`);
        CourseScanner.setAlert(notes.length ? `Key applied. ${notes.join('; ')}.` : 'Key applied.', notes.length === 0);
    },

    refreshSetup: () => {
        const isExam = CourseScanner.mode === 'exam';
        $('scnExamPanel')?.classList.toggle('hidden', !isExam);
        $('scnTypedPanel')?.classList.toggle('hidden', isExam);

        const info = $('scnExamInfo');
        if (info) {
            const exam = CourseScanner.exams.find(e => e.Exam_ID === val('scnExamSelect'));
            if (!exam) {
                info.textContent = '';
            } else {
                const a = CourseScanner.analyzeExam(exam);
                const bonusNos = a.bonus.map((b, i) => (b ? i + 1 : null)).filter(Boolean);
                const parts = [`${a.n} scannable question${a.n === 1 ? '' : 's'}, choices A-${LETTERS[a.c - 1]}.`];
                if (bonusNos.length) parts.push(`Bonus: number${bonusNos.length === 1 ? '' : 's'} ${bonusNos.join(', ')}.`);
                if (a.skipped) parts.push(`${a.skipped} question${a.skipped === 1 ? '' : 's'} skipped (identification, over ${MAX_CHOICES} choices, or the answer is not one of the choices).`);
                info.textContent = parts.join(' ');
            }
        }

        const summary = $('scnSetupSummary');
        if (summary) {
            const cfg = CourseScanner.getConfig();
            if (!cfg.ok) {
                summary.textContent = cfg.error;
            } else {
                const bonusCount = cfg.bonus.filter(Boolean).length;
                const target = cfg.existing
                    ? `Scores will be added to the existing assessment "${cfg.existing.Title}" (${TERM_LABELS[cfg.existing.Term] || cfg.existing.Term}, max ${fmt(cfg.cap)}).`
                    : `A new assessment "${cfg.title}" will be created (${TERM_LABELS[cfg.term]}, ${CATEGORY_LABELS[cfg.category]}, max ${fmt(cfg.cap)}).`;
                const saveExam = cfg.mode === 'typed' ? ' The exam will also be saved in Manage Exams.' : '';
                summary.textContent = `${cfg.n} questions, choices A-${LETTERS[cfg.c - 1]}, max ${fmt(cfg.maxRegular)}${bonusCount ? ` (+${bonusCount} bonus, total capped at the max)` : ''}. ${target}${saveExam}`;
            }
        }
    },

    // Small dialog asking what to print at the top of the sheet. Resolves with the text ('' = no header)
    // or null when cancelled. The last header used is remembered on this device.
    askHeader: () => new Promise((resolve) => {
        let remembered = '';
        try { remembered = localStorage.getItem('omr_sheet_header') || ''; } catch (e) { /* storage unavailable */ }
        const previousFocus = document.activeElement;

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[310] flex items-center justify-center p-4 fade-in';
        overlay.style.zIndex = '310';   // inline: see UI.confirm
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Answer sheet header');
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-5 relative z-10">
                <h4 class="text-base font-bold text-gray-800 mb-1">Answer sheet header</h4>
                <p class="text-xs text-gray-500 mb-3">What should be printed at the top of the sheet? Leave it blank for no header.</p>
                <input type="text" id="scnHeaderInput" maxlength="80" value="${esc(remembered)}" placeholder="e.g. Midterm Examination - Prof. Dela Cruz" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" aria-label="Header text">
                <div class="mt-4 flex gap-2 justify-end">
                    <button type="button" id="closeScnHeaderBtn" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-bold transition">Cancel</button>
                    <button type="button" id="scnHeaderOkBtn" class="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-md text-sm font-bold transition"><i class="fa-solid fa-print mr-2"></i>Print</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('#scnHeaderInput');
        let finished = false;
        const finish = (value) => {
            if (finished) return;
            finished = true;
            overlay.remove();
            if (previousFocus && previousFocus.focus) previousFocus.focus();
            resolve(value);
        };
        overlay.querySelector('#scnHeaderOkBtn').addEventListener('click', () => finish(input.value.trim()));
        overlay.querySelector('#closeScnHeaderBtn').addEventListener('click', () => finish(null));
        overlay.firstElementChild.addEventListener('click', () => finish(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); }
            if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        });
        input.focus();
        input.select();
    }),

    printSheet: async () => {
        const cfg = CourseScanner.getConfig();
        if (!cfg.ok) {
            CourseScanner.setAlert(cfg.error, false);
            return;
        }
        CourseScanner.setAlert('');

        const header = await CourseScanner.askHeader();
        if (header === null) return;
        try { localStorage.setItem('omr_sheet_header', header); } catch (e) { /* storage unavailable */ }

        const html = buildSheetHtml({
            title: header,
            n: cfg.n,
            c: cfg.c,
            paper: val('scnPaper') || 'letter',
            parts: cfg.parts || null
        });
        const w = window.open('', '_blank');
        if (!w) {
            UI.warning('The pop-up was blocked. Allow pop-ups for this site, then try again.');
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
    },

    startScanning: async () => {
        const cfg = CourseScanner.getConfig();
        if (!cfg.ok) {
            CourseScanner.setAlert(cfg.error, false);
            return;
        }
        const signature = JSON.stringify([cfg.mode, cfg.examId, cfg.title, cfg.n, cfg.c, cfg.key, cfg.bonus, cfg.term, cfg.category]);
        if (CourseScanner.rows.length && signature !== CourseScanner.signature) {
            const ok = await UI.confirm({
                title: 'Clear scanned sheets?',
                message: 'The answer key or assessment changed, so the sheets already scanned must be cleared and scanned again.',
                confirmText: 'Clear and continue',
                danger: true
            });
            if (!ok) return;
            CourseScanner.clearRows();
        }
        if (signature !== CourseScanner.signature) CourseScanner.createdExamId = null;
        CourseScanner.signature = signature;
        CourseScanner.cfg = cfg;

        CourseScanner.setAlert('');
        $('scnScanTitle').textContent = cfg.title;
        $('scnScanMeta').textContent = `${cfg.n} questions | max ${fmt(cfg.cap)} | ${TERM_LABELS[cfg.term]} | ${CATEGORY_LABELS[cfg.category]}`;
        CourseScanner.showView('scan');
        CourseScanner.renderRows();
    },

    // ---------- Reading photos ----------

    processFiles: async (fileList) => {
        const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
        if (!files.length || CourseScanner.busy || !CourseScanner.cfg) return;
        CourseScanner.busy = true;
        const progress = $('scnProgress');

        for (let i = 0; i < files.length; i++) {
            progress.classList.remove('hidden');
            progress.textContent = `Reading photo ${i + 1} of ${files.length}...`;
            await pause(30);
            let row;
            try {
                row = await CourseScanner.buildRow(files[i]);
            } catch (err) {
                row = { id: CourseScanner.nextRowId++, fileName: files[i].name, ok: false, error: 'This photo could not be opened. Try a JPG or PNG.', photoUrl: '', overlayUrl: '' };
            }
            CourseScanner.rows.push(row);
            CourseScanner.renderRows();
            CourseScanner.markChange();
        }

        progress.classList.add('hidden');
        CourseScanner.busy = false;
    },

    buildRow: async (file) => {
        const cfg = CourseScanner.cfg;
        const result = await scanImage(file, cfg.n, cfg.c);
        return CourseScanner.rowFromResult(file.name || 'Photo', result);
    },

    // Turns a reading (from a photo or a live frame) into a review row.
    rowFromResult: async (name, result) => {
        const row = {
            id: CourseScanner.nextRowId++,
            fileName: name,
            ok: result.ok,
            error: result.error || '',
            saveState: '',     // '' | pending | saving | saved | dirty | conflict | key | error
            scanId: '',
            savedStudentId: '',
            answers: [],
            original: [],
            studentText: '',
            studentId: '',
            photoUrl: '',
            overlayUrl: '',
            result: null
        };
        row.photoUrl = await toUrl(result.canvas);
        if (!result.ok) {
            result.canvas.width = 0;
            return row;
        }
        row.answers = result.answers.slice();
        row.original = result.answers.slice();
        row.studentText = result.studentNo;
        row.studentId = CourseScanner.matchStudent(row.studentText);
        row.result = { H: result.H, markers: result.markers, fills: result.fills, studentDigits: result.studentDigits };
        result.canvas.width = 0;
        await CourseScanner.renderPreview(row);
        return row;
    },

    // Student whose number (digits only) equals the shaded number; '' when none or ambiguous.
    matchStudent: (text) => {
        if (String(text).includes('?')) return '';
        const d = digitsOnly(text);
        if (!d) return '';
        const found = CourseScanner.students.filter(s => digitsOnly(s.Student_Number) === d);
        return found.length === 1 ? found[0].User_ID : '';
    },

    // Draws the reading (green = right, red = wrong, blue = the correct choice) over the stored photo.
    renderPreview: async (row) => {
        const cfg = CourseScanner.cfg;
        const img = await loadImage(row.photoUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        drawOverlay({ canvas, ok: true, ...row.result }, row.answers, cfg.key, row.result.studentDigits);
        const url = await toUrl(canvas);
        canvas.width = 0;
        if (row.overlayUrl) URL.revokeObjectURL(row.overlayUrl);
        row.overlayUrl = url;
    },

    // ---------- Live camera ----------
    // Every 250 ms a small copy of the video frame is checked for the 4 corner squares. When the sheet
    // fills the frame, is bright enough and has stayed still for about a second, the frame is read
    // and added to the review list. The sheet must then leave or move before the next capture.

    setLiveStatus: (text, tone = 'gray', progress = 0) => {
        const el = $('scnLiveStatus');
        if (!el) return;
        const tones = {
            gray: 'bg-gray-700 text-white',
            amber: 'bg-amber-500 text-white',
            green: 'bg-green-600 text-white',
            red: 'bg-red-600 text-white'
        };
        el.className = `text-center text-sm font-bold rounded px-3 py-2 ${tones[tone] || tones.gray}`;
        el.textContent = text;
        const bar = $('scnLiveBar');
        if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    },

    startLive: async () => {
        const live = CourseScanner.live;
        if (!CourseScanner.cfg || live.stream) return;
        const devices = navigator.mediaDevices;
        if (!devices || !devices.getUserMedia) {
            CourseScanner.setAlert('The live camera needs a secure (https) connection and a browser that supports it. Use Take Photo instead.', false);
            return;
        }

        let stream;
        try {
            stream = await devices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
        } catch (err) {
            const messages = {
                NotAllowedError: 'Camera permission was denied. Allow camera access for this site, then try again.',
                NotFoundError: 'No camera was found on this device.',
                NotReadableError: 'The camera is being used by another app.'
            };
            CourseScanner.setAlert(messages[err.name] || 'The camera could not be started. Use Take Photo instead.', false);
            return;
        }

        const video = $('scnLiveVideo');
        video.srcObject = stream;
        try { await video.play(); } catch (e) { /* autoplay is already on */ }

        Object.assign(live, { stream, prev: null, shot: null, steady: 0, steadySince: 0, armed: true, lost: 0, capturing: false, replacing: null, vw: 0, vh: 0 });
        CourseScanner.setAlert('');
        CourseScanner.liveMode('camera');
        $('scnLivePanel').classList.remove('hidden');
        CourseScanner.setLiveStatus('Starting camera...', 'gray', 0);
        live.timer = setTimeout(CourseScanner.liveTick, LIVE_TICK_MS);
    },

    stopLive: (keepPanel = false) => {
        const live = CourseScanner.live;
        clearTimeout(live.timer);
        live.timer = null;
        if (live.stream) live.stream.getTracks().forEach(t => t.stop());
        live.stream = null;
        const video = $('scnLiveVideo');
        if (video) video.srcObject = null;
        if (keepPanel === true) return;
        $('scnLivePanel')?.classList.add('hidden');
        if (CourseScanner.liveReviewRow) {
            CourseScanner.liveReviewRow = null;
            CourseScanner.renderRows();   // the list shows any edit made in the full-screen review
            CourseScanner.markChange();
            CourseScanner.flush();
        }
    },

    liveReviewRow: null,

    // Removes a captured sheet (used when a recapture replaces it).
    dropRow: (row) => {
        if (!row) return;
        if (row.scanId && row.saveState !== 'saved') ScanQueue.remove([row.scanId]);
        CourseScanner.revokeRow(row);
        CourseScanner.rows = CourseScanner.rows.filter(r => r !== row);
    },

    // 'camera' = camera view with its controls; 'review' = the captured sheet with Capture again / Back.
    liveMode: (mode) => {
        const review = mode === 'review';
        $('scnLiveStage')?.classList.toggle('hidden', review);
        $('scnLiveReview')?.classList.toggle('hidden', !review);
        $('scnLiveLiveControls')?.classList.toggle('hidden', review);
        $('scnLiveDone')?.classList.toggle('hidden', !review);
        $('scnLiveStopBtn')?.classList.toggle('hidden', review);
        const title = $('scnLiveTitle');
        if (title) title.innerHTML = review
            ? '<i class="fa-solid fa-circle-check mr-1 text-green-400"></i> Sheet captured - check it'
            : '<i class="fa-solid fa-video mr-1"></i> Live Scan';
        if (!review) {
            const box = $('scnLiveReview');
            if (box) box.innerHTML = '';
            CourseScanner.liveReviewRow = null;
        }
    },

    // Shows the sheet that was just read, right away, inside the full-screen view.
    showLiveReview: (row) => {
        CourseScanner.liveReviewRow = row;
        const box = $('scnLiveReview');
        box.innerHTML = `<div class="mb-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold px-3 py-2"><i class="fa-solid fa-circle-question mr-1"></i> Captured the moment all 4 corners were seen. If the sheet looks off or a corner was missed, tap Recapture to replace it.</div>`
            + CourseScanner.rowHtml(row, CourseScanner.duplicateIds(), 'scnLv');
        box.querySelector('details')?.setAttribute('open', '');
        CourseScanner.liveMode('review');
        box.scrollTop = 0;
    },

    // Sizes the preview box to the camera's real shape so the green outline lines up with the video.
    fitLiveBox: (vw, vh) => {
        const box = $('scnLiveBox');
        const stage = $('scnLiveStage');
        if (!box || !stage) return;
        const aw = stage.clientWidth - 16;
        const ah = stage.clientHeight;
        if (aw <= 0 || ah <= 0) return;
        const ratio = vw / vh;
        let w = aw;
        let h = w / ratio;
        if (h > ah) {
            h = ah;
            w = h * ratio;
        }
        box.style.aspectRatio = `${vw} / ${vh}`;
        box.style.width = `${Math.floor(w)}px`;
        box.style.height = `${Math.floor(h)}px`;
    },

    liveTick: async () => {
        const live = CourseScanner.live;
        if (!live.stream) return;
        try {
            if (!live.capturing) await CourseScanner.liveFrame();
        } catch (err) {
            console.error(err);
        }
        if (live.stream) live.timer = setTimeout(CourseScanner.liveTick, LIVE_TICK_MS);
    },

    liveFrame: async () => {
        const live = CourseScanner.live;
        const video = $('scnLiveVideo');
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;
        if (live.vw !== vw || live.vh !== vh) {
            live.vw = vw;
            live.vh = vh;
            CourseScanner.fitLiveBox(vw, vh);
        }

        const scale = Math.min(1, LIVE_DETECT_SIDE / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        if (!live.canvas) live.canvas = document.createElement('canvas');
        if (live.canvas.width !== w || live.canvas.height !== h) {
            live.canvas.width = w;
            live.canvas.height = h;
        }
        const ctx = live.canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const gray = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
        const bright = meanBrightness(gray);
        const markers = detectMarkers(gray, w, h);

        const overlay = $('scnLiveOverlay');
        overlay.width = w;
        overlay.height = h;
        const octx = overlay.getContext('2d');
        const outline = (color) => {
            octx.lineWidth = Math.max(3, w / 160);
            octx.strokeStyle = color;
            octx.beginPath();
            markers.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
            octx.closePath();
            octx.stroke();
        };

        if (!markers) {
            live.lost++;
            live.steady = 0;
            live.prev = null;
            if (live.lost >= 2) live.armed = true;
            CourseScanner.setLiveStatus(
                bright < MIN_BRIGHT ? 'Too dark - add more light' : 'Looking for the sheet - show all 4 black corner squares',
                'amber', 0
            );
            return;
        }
        live.lost = 0;

        const norm = markers.map(([x, y]) => [x / w, y / h]);
        const xs = norm.map(m => m[0]);
        const ys = norm.map(m => m[1]);
        const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const dist = (a, b) => Math.max(...a.map((p, i) => Math.max(Math.abs(p[0] - b[i][0]), Math.abs(p[1] - b[i][1]))));
        live.prev = norm;

        if (!live.armed) {
            if (live.shot && live.shot.length === 4 && dist(norm, live.shot) > REARM_MOVE) {
                live.armed = true;
            } else {
                outline('#22c55e');
                CourseScanner.setLiveStatus('Captured. Remove the sheet or show the next one.', 'green', 1);
                return;
            }
        }

        if (bright < MIN_BRIGHT) {
            live.steady = 0;
            outline('#f59e0b');
            CourseScanner.setLiveStatus('Too dark - add more light', 'amber', 0);
            return;
        }
        if (span < MIN_SPAN) {
            live.steady = 0;
            outline('#f59e0b');
            CourseScanner.setLiveStatus('Move closer - fill the screen with the sheet', 'amber', 0);
            return;
        }

        // All 4 corners found: capture right away. The lecturer can recapture from the review if it is off.
        outline('#22c55e');
        await CourseScanner.liveCapture(norm);
    },

    liveCapture: async (norm) => {
        const live = CourseScanner.live;
        const cfg = CourseScanner.cfg;
        if (!live.stream || live.capturing || !cfg) return;
        live.capturing = true;
        CourseScanner.setLiveStatus('Reading the sheet...', 'gray', 1);

        const flash = $('scnLiveFlash');
        if (flash) {
            flash.style.opacity = '0.8';
            setTimeout(() => { flash.style.opacity = '0'; }, 120);
        }

        try {
            const video = $('scnLiveVideo');
            const result = scanSource(video, video.videoWidth, video.videoHeight, cfg.n, cfg.c);
            if (!result.ok) {
                result.canvas.width = 0;
                live.steady = 0;
                CourseScanner.setLiveStatus('Could not read the sheet - hold steady and keep all 4 corners visible', 'amber', 0);
                return;
            }

            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const row = await CourseScanner.rowFromResult(`Live scan ${time}`, result);
            // A recapture replaces the earlier capture it was started from.
            if (live.replacing) CourseScanner.dropRow(live.replacing);
            live.replacing = null;
            CourseScanner.rows.push(row);
            CourseScanner.renderRows();
            CourseScanner.markChange();

            live.steady = 0;
            if (navigator.vibrate) navigator.vibrate(60);

            // One sheet per live session: the camera stops and that sheet is shown for checking.
            await new Promise(r => setTimeout(r, 300));
            CourseScanner.stopLive(true);
            CourseScanner.showLiveReview(row);
        } catch (err) {
            console.error(err);
            CourseScanner.setLiveStatus('Could not read the sheet. Try again.', 'red', 0);
        } finally {
            live.capturing = false;
        }
    },

    // ---------- Scoring ----------

    scoreRow: (row, cap) => {
        const cfg = CourseScanner.cfg;
        let raw = 0, bonus = 0, blank = 0, multi = 0;
        row.answers.forEach((a, i) => {
            if (a === BLANK) blank++;
            else if (a === MULTIPLE) multi++;
            else if (a === cfg.key[i]) {
                if (cfg.bonus[i]) bonus++;
                else raw++;
            }
        });
        return { raw, bonus, blank, multi, final: Math.min(cap, raw + bonus) };
    },

    duplicateIds: () => {
        const counts = {};
        CourseScanner.rows.forEach(r => {
            if (r.ok && r.studentId) counts[r.studentId] = (counts[r.studentId] || 0) + 1;
        });
        return new Set(Object.keys(counts).filter(id => counts[id] > 1));
    },

    // ---------- Review list ----------

    scoreHtml: (row) => {
        const cfg = CourseScanner.cfg;
        const s = CourseScanner.scoreRow(row, cfg.cap);
        return `<span class="text-lg font-black text-gray-800 font-mono">${fmt(s.final)}</span><span class="text-xs text-gray-500"> / ${fmt(cfg.cap)}</span>` +
            `<div class="text-[10px] text-gray-500">${s.raw} correct${s.bonus ? ` + ${s.bonus} bonus` : ''}</div>`;
    },

    flagsHtml: (row, dups) => {
        const s = CourseScanner.scoreRow(row, CourseScanner.cfg.cap);
        const badge = (cls, text) => `<span class="text-[10px] font-bold px-2 py-0.5 rounded border ${cls}">${text}</span>`;
        const out = [];
        if (!row.studentId) out.push(badge('bg-amber-50 text-amber-800 border-amber-300', 'No student matched - pick one'));
        else if (dups.has(row.studentId)) out.push(badge('bg-red-50 text-red-700 border-red-300', 'Duplicate - another sheet has this student'));
        if (s.multi) out.push(badge('bg-amber-50 text-amber-800 border-amber-300', `${s.multi} double-shaded`));
        if (s.blank) out.push(badge('bg-gray-100 text-gray-600 border-gray-300', `${s.blank} blank`));
        const st = row.saveState;
        if (st === 'saved') out.push(badge('bg-green-50 text-green-800 border-green-300', '<i class="fa-solid fa-cloud-arrow-up mr-1"></i>Saved'));
        else if (st === 'saving') out.push(badge('bg-blue-50 text-blue-700 border-blue-300', '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Saving...'));
        else if (st === 'pending' || st === 'dirty') out.push(badge('bg-blue-50 text-blue-700 border-blue-300', 'Saves in a moment'));
        else if (st === 'error') out.push(badge('bg-amber-50 text-amber-800 border-amber-300', 'Not uploaded yet - kept on this device, retrying'));
        else if (st === 'key') out.push(badge('bg-amber-50 text-amber-800 border-amber-300', 'Waiting: answer key changed'));
        else if (st === 'conflict' && row.conflict) {
            out.push(`<div class="w-full mt-1 p-2 rounded border border-red-300 bg-red-50 text-[11px] text-red-800">
                <div class="font-bold">This student already has a different saved sheet (score ${fmt(row.conflict.existingScore)}). This sheet would give ${fmt(row.conflict.newScore)}.</div>
                <div class="mt-1.5 flex flex-wrap gap-2">
                    <button type="button" class="scn-replace-btn px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold" data-row="${row.id}">Replace the saved sheet</button>
                    <button type="button" class="scn-keep-btn px-2 py-1 rounded bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 font-bold" data-row="${row.id}">Keep saved, discard this</button>
                </div></div>`);
        }
        return out.join(' ');
    },

    rowBorder: (row, dups) => {
        if (!row.ok) return 'border-red-300';
        if (dups.has(row.studentId)) return 'border-red-400';
        if (!row.studentId) return 'border-amber-400';
        return 'border-gray-200';
    },

    answerSelectHtml: (row, q) => {
        const cfg = CourseScanner.cfg;
        const a = row.answers[q];
        const tone = a === cfg.key[q] ? 'border-green-400 bg-green-50' : (a >= 0 || a === MULTIPLE ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white');
        const opts = [
            `<option value="${BLANK}"${a === BLANK ? ' selected' : ''}>-</option>`,
            `<option value="${MULTIPLE}"${a === MULTIPLE ? ' selected' : ''}>x2</option>`
        ].concat(Array.from({ length: cfg.c }, (_, k) => `<option value="${k}"${a === k ? ' selected' : ''}>${LETTERS[k]}</option>`));
        return `<label class="flex items-center gap-1 text-[11px]">
            <span class="w-8 text-right font-bold text-gray-500">${q + 1}${cfg.bonus[q] ? '<span class="text-amber-600" title="Bonus">*</span>' : ''}</span>
            <select class="scn-answer-select w-full px-1 py-0.5 border rounded text-xs ${tone}" data-row="${row.id}" data-q="${q}" aria-label="Question ${q + 1} answer">${opts.join('')}</select>
        </label>`;
    },

    rowHtml: (row, dups, idp = 'scn') => {
        const live = idp !== 'scn';
        const head = `
            <div class="flex items-start justify-between gap-2">
                <div class="text-[11px] font-bold text-gray-500 truncate">${esc(row.fileName)}</div>
                ${live ? '' : `<button type="button" class="scn-remove-btn text-gray-400 hover:text-red-600 transition" data-row="${row.id}" aria-label="Remove this sheet"><i class="fa-solid fa-trash"></i></button>`}
            </div>`;

        if (!row.ok) {
            return `<div class="bg-white border ${CourseScanner.rowBorder(row, dups)} rounded-lg p-3" data-card="${row.id}">
                ${head}
                <div class="mt-1 text-xs font-bold text-red-700">${esc(row.error)}</div>
                ${row.photoUrl ? `<details class="mt-2"><summary class="text-xs font-bold text-blue-700 cursor-pointer">View photo</summary><img src="${row.photoUrl}" alt="Photo that could not be read" class="mt-2 w-full max-h-[60vh] object-contain border rounded"></details>` : ''}
            </div>`;
        }

        const studentOptions = ['<option value="">- Select student -</option>'].concat(
            CourseScanner.students.map(s => {
                const label = `${s.Name || ''}${s.Student_Number ? ` (${s.Student_Number})` : ''}`;
                return `<option value="${esc(s.User_ID)}"${s.User_ID === row.studentId ? ' selected' : ''}>${esc(label)}</option>`;
            })
        ).join('');

        const answers = row.answers.map((_, q) => CourseScanner.answerSelectHtml(row, q)).join('');

        return `<div class="bg-white border ${CourseScanner.rowBorder(row, dups)} rounded-lg p-3" data-card="${row.id}">
            ${head}
            <div class="mt-2 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div class="sm:col-span-3">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1" for="${idp}Stu${row.id}">Student No.</label>
                    <input type="text" id="${idp}Stu${row.id}" class="scn-stuno-input w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" data-row="${row.id}" value="${esc(row.studentText)}" maxlength="12">
                </div>
                <div class="sm:col-span-6">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1" for="${idp}Sel${row.id}">Student</label>
                    <select id="${idp}Sel${row.id}" class="scn-student-select w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white" data-row="${row.id}">${studentOptions}</select>
                </div>
                <div class="sm:col-span-3 sm:text-right" data-role="score">${CourseScanner.scoreHtml(row)}</div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1" data-role="flags">${CourseScanner.flagsHtml(row, dups)}</div>
            <details class="mt-2">
                <summary class="text-xs font-bold text-blue-700 cursor-pointer">Review photo and answers</summary>
                <img data-role="img" src="${row.overlayUrl}" alt="Scanned sheet with detected answers" class="mt-2 w-full max-h-[70vh] object-contain border rounded bg-gray-100">
                <p class="mt-1 text-[10px] text-gray-500">Green = correct, red = wrong or double-shaded, blue = correct choice that was missed. Fix any misread answer below.</p>
                <div class="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-x-2 gap-y-1">${answers}</div>
            </details>
        </div>`;
    },

    renderRows: () => {
        const box = $('scnRows');
        if (!box || !CourseScanner.cfg) return;
        const dups = CourseScanner.duplicateIds();
        box.innerHTML = CourseScanner.rows.length
            ? CourseScanner.rows.map(r => CourseScanner.rowHtml(r, dups)).join('')
            : '<div class="text-sm text-gray-500 italic text-center py-8">No sheets scanned yet. Take a photo or choose photos above.</div>';
        CourseScanner.updateSaveInfo();
    },

    // Refreshes the score, flags and borders after an edit, without closing any open review panel.
    refreshCards: () => {
        const dups = CourseScanner.duplicateIds();
        CourseScanner.rows.forEach(row => {
            if (!row.ok) return;
            document.querySelectorAll(`[data-card="${row.id}"]`).forEach(card => {
                card.querySelector('[data-role="score"]').innerHTML = CourseScanner.scoreHtml(row);
                card.querySelector('[data-role="flags"]').innerHTML = CourseScanner.flagsHtml(row, dups);
                card.className = `bg-white border ${CourseScanner.rowBorder(row, dups)} rounded-lg p-3`;
            });
        });
        CourseScanner.updateSaveInfo();
    },

    updateSaveInfo: () => {
        const info = $('scnSaveInfo');
        const btn = $('scnSaveBtn');
        if (!info || !btn) return;
        const okRows = CourseScanner.rows.filter(r => r.ok);
        const dups = CourseScanner.duplicateIds();
        const count = (fn) => okRows.filter(fn).length;
        const saved = count(r => r.saveState === 'saved');
        const waiting = count(r => ['pending', 'saving', 'dirty', 'error', 'key'].includes(r.saveState));
        const conflicts = count(r => r.saveState === 'conflict');
        const noStudent = count(r => !r.studentId);
        const dupRows = count(r => r.studentId && dups.has(r.studentId));
        const parts = [`${saved} saved to the database`];
        if (waiting) parts.push(`${waiting} waiting to upload`);
        if (conflicts) parts.push(`${conflicts} already saved earlier - choose`);
        if (noStudent) parts.push(`${noStudent} need a student`);
        if (dupRows) parts.push(`${dupRows} duplicate (remove or reassign)`);
        if (navigator.onLine === false) parts.push('offline - will upload when back online');
        const orphans = CourseScanner.orphans();
        if (orphans.length) parts.push(`${orphans.length} unsent from an earlier visit`);
        info.textContent = parts.join(' | ');

        const queued = ScanQueue.forCourse(CourseScanner.courseId).filter(e => !e.conflict && !e.needsKey).length;
        btn.disabled = CourseScanner.flushing || queued === 0;
        btn.innerHTML = CourseScanner.flushing
            ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Uploading...'
            : `<i class="fa-solid fa-cloud-arrow-up mr-2"></i> Upload now${queued ? ` (${queued})` : ''}`;

        // Decisions that cannot be shown on a sheet card.
        const box = $('scnSyncActions');
        if (box) {
            const keyWait = ScanQueue.forCourse(CourseScanner.courseId).filter(e => e.needsKey);
            const orphanConflicts = orphans.filter(e => e.conflict);
            const html = [];
            if (keyWait.length) {
                html.push(`<div class="w-full p-2 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900"><b>The answer key is different from the one saved before.</b> ${keyWait[0].needsKey} earlier sheet(s) would be graded again with the new key.
                    <button type="button" id="scnRegradeBtn" class="ml-2 px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold">Grade earlier sheets again</button></div>`);
            }
            if (orphanConflicts.length) {
                html.push(`<div class="w-full p-2 rounded border border-red-300 bg-red-50 text-xs text-red-800"><b>${orphanConflicts.length} sheet(s) from an earlier visit already have a different saved sheet.</b>
                    <button type="button" id="scnOrphanReplaceBtn" class="ml-2 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold">Replace saved</button>
                    <button type="button" id="scnOrphanKeepBtn" class="ml-1 px-2 py-1 rounded bg-white border border-gray-300 text-gray-800 font-bold">Keep saved, discard these</button></div>`);
            }
            box.innerHTML = html.join('');
            box.classList.toggle('hidden', html.length === 0);
        }
    },

    // ---------- Saving ----------

    // Sheets are saved by themselves: each ready sheet goes into the cache (ScanQueue) and is uploaded a few
    // seconds later. The cache entry is deleted only when the server confirms the save.
    save: async () => { await CourseScanner.flush(true); },

    snapshot: (cfg) => ({
        mode: cfg.mode, examId: cfg.examId || '', title: cfg.title, term: cfg.term, category: cfg.category,
        date: cfg.date, n: cfg.n, c: cfg.c, key: cfg.key.slice(), bonus: cfg.bonus.slice(), maxRegular: cfg.maxRegular
    }),

    groupKey: (e) => JSON.stringify([e.courseId, e.cfg.mode, e.cfg.examId, e.cfg.title, e.cfg.term, e.cfg.category, e.cfg.n, e.cfg.c, e.cfg.key, e.cfg.bonus]),

    rowByScan: (scanId) => CourseScanner.rows.find(r => r.scanId === scanId),

    // Puts every ready sheet that is new or edited into the cache.
    syncQueue: () => {
        const cfg = CourseScanner.cfg;
        if (!cfg) return;
        const dups = CourseScanner.duplicateIds();
        CourseScanner.rows.forEach(row => {
            if (!row.ok || (row.saveState && row.saveState !== 'dirty')) return;
            if (!row.scanId) row.scanId = crypto.randomUUID();
            if (!row.studentId || dups.has(row.studentId)) {
                if (row.saveState === 'dirty') {
                    ScanQueue.remove([row.scanId]);
                    row.saveState = '';
                }
                return;
            }
            ScanQueue.put({
                scanId: row.scanId,
                courseId: CourseScanner.courseId,
                cfg: CourseScanner.snapshot(row.cfg || cfg),
                studentId: row.studentId,
                studentNo: row.studentText,
                originalAnswers: row.original && row.original.length ? row.original : row.answers.slice(),
                answers: row.answers.slice(),
                replace: Boolean(row.replace),
                // The sheet was uploaded for another student first: that earlier upload is undone.
                removeStudent: row.savedStudentId && row.savedStudentId !== row.studentId ? row.savedStudentId : null
            });
            // Low-resolution photo for later review (kept on the phone until the sheet is confirmed saved).
            ScanPhotos.keep(row.scanId, CourseScanner.courseId, row.photoUrl, row.result && row.result.H);
            row.cfg = row.cfg || cfg;
            row.saveState = 'pending';
            row.attempts = 0;
        });
    },

    // Called after any change: waits until the lecturer stops editing, longer while a live review is open.
    markChange: () => {
        CourseScanner.lastChange = Date.now();
        CourseScanner.syncQueue();
        CourseScanner.refreshCards();
        CourseScanner.scheduleFlush();
    },

    scheduleFlush: () => {
        clearTimeout(CourseScanner.flushTimer);
        const wait = (CourseScanner.liveReviewRow ? LIVE_REVIEW_HOLD_MS : AUTO_SAVE_MS) - (Date.now() - CourseScanner.lastChange);
        CourseScanner.flushTimer = setTimeout(() => CourseScanner.autoFlush(), Math.max(300, wait));
    },

    // Timer callback: holds back while a live review is still open and being edited.
    autoFlush: () => {
        if (CourseScanner.liveReviewRow && Date.now() - CourseScanner.lastChange < LIVE_REVIEW_HOLD_MS) {
            CourseScanner.scheduleFlush();
            return;
        }
        CourseScanner.flush();
    },

    // The assessment for this setup: found, or created (and for a typed key also added to Manage Exams).
    ensureTarget: async (courseId, cfg) => {
        const tkey = JSON.stringify([courseId, cfg.mode, cfg.examId, cfg.title, cfg.term, cfg.category]);
        const ts = new Date().getTime();
        const [assessRes, classExamRes] = await Promise.all([
            apiFetch(`/api/assessments?courseId=${courseId}&_t=${ts}`),
            apiFetch(`/api/class-exams?courseId=${courseId}&_t=${ts}`)
        ]);
        const assessments = assessRes.assessments || [];
        if (courseId === CourseScanner.courseId) {
            CourseScanner.assessments = assessments;
            CourseScanner.classExams = classExamRes.classExams || [];
        }
        let found = CourseScanner.findAssessment(cfg, assessments, classExamRes.classExams || []);
        if (found) {
            CourseScanner.targets.set(tkey, found.Assessment_ID);
            return { id: found.Assessment_ID, max: Number(found.Max_Score) };
        }

        if (cfg.mode === 'typed' && !CourseScanner.examsMade.has(tkey)) {
            const choices = LETTERS.slice(0, cfg.c).split('');
            const examData = cfg.key.map((k, i) => [0, `Question ${i + 1}`, choices, choices[k], '', false]);
            await apiFetch('/api/exams', {
                method: 'POST',
                body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: cfg.title, examData })
            });
            CourseScanner.examsMade.add(tkey);
        }
        const res = await apiFetch('/api/assessments', {
            method: 'POST',
            body: JSON.stringify({
                assessmentId: null, courseId, term: cfg.term, category: cfg.category,
                title: cfg.title, maxScore: cfg.maxRegular, date: cfg.date
            })
        });
        CourseScanner.targets.set(tkey, res.assessmentId);
        return { id: res.assessmentId, max: Number(cfg.maxRegular) };
    },

    setSaveState: (entries, state, extra = {}) => {
        entries.forEach(e => {
            const row = CourseScanner.rowByScan(e.scanId);
            if (row) Object.assign(row, { saveState: state }, extra);
        });
    },

    // Uploads one group of cached sheets that share the same answer key and assessment.
    uploadGroup: async (group) => {
        const first = group[0];
        const { courseId, cfg } = first;
        try {
            const target = await CourseScanner.ensureTarget(courseId, cfg);
            const res = await apiFetch('/api/scan-sheets/save', {
                method: 'POST',
                body: JSON.stringify({
                    courseId,
                    assessmentId: target.id,
                    title: cfg.title,
                    term: cfg.term,
                    category: cfg.category,
                    numQuestions: cfg.n,
                    numChoices: cfg.c,
                    answerKey: cfg.key,
                    bonus: cfg.bonus,
                    allowRegrade: group.some(e => e.allowRegrade),
                    removals: group.filter(e => e.removeStudent).map(e => ({ studentId: e.removeStudent, scanId: e.scanId })),
                    sheets: group.map(e => ({
                        scanId: e.scanId, studentId: e.studentId, studentNo: e.studentNo,
                        originalAnswers: e.originalAnswers, answers: e.answers, replace: Boolean(e.replace)
                    }))
                })
            });

            if (res.needsConfirm) {
                group.forEach(e => ScanQueue.update(e.scanId, { needsKey: res.regradeCount }));
                CourseScanner.setSaveState(group, 'key');
                return;
            }
            if (!res.success) throw new Error(res.error || 'Failed to save.');

            const conflicts = new Map((res.conflicts || []).map(c => [c.studentId, c]));
            const done = [];
            group.forEach(e => {
                const c = conflicts.get(e.studentId);
                if (c) {
                    ScanQueue.update(e.scanId, { conflict: c });
                    CourseScanner.setSaveState([e], 'conflict', { conflict: c });
                } else {
                    done.push(e);
                }
            });
            // The server confirmed these: the cached copies are deleted now (unless edited again meanwhile).
            ScanQueue.removeIfSame(done);
            ScanPhotos.saved(done.map(e => ({ scanId: e.scanId, courseId, assessmentId: target.id, studentId: e.studentId }))).catch(() => {});
            done.forEach(e => {
                const row = CourseScanner.rowByScan(e.scanId);
                if (!row) return;
                Object.assign(row, { replace: false, savedStudentId: e.studentId, conflict: null, error: '' });
                if (row.saveState !== 'dirty') row.saveState = 'saved';
            });
            if (courseId === CourseScanner.courseId && CourseScanner.cfg && CourseScanner.cfg.title === cfg.title && Number.isFinite(target.max)) {
                CourseScanner.cfg.cap = target.max;
            }
        } catch (err) {
            group.forEach(e => {
                const attempts = (e.attempts || 0) + 1;
                ScanQueue.update(e.scanId, { attempts, lastError: err.message || 'Upload failed' });
            });
            CourseScanner.setSaveState(group, 'error', { error: err.message || 'Upload failed' });
        }
    },

    // Uploads everything waiting in the cache. force = the lecturer pressed Upload now: try again even if
    // earlier attempts failed.
    flush: async (force = false) => {
        if (CourseScanner.flushing) {
            CourseScanner.flushAgain = true;
            return;
        }
        CourseScanner.flushing = true;
        CourseScanner.saving = true;
        CourseScanner.updateSaveInfo();
        try {
            do {
                CourseScanner.flushAgain = false;
                CourseScanner.syncQueue();
                if (force) ScanQueue.all().filter(e => e.attempts).forEach(e => ScanQueue.update(e.scanId, { attempts: 0 }));
                const waiting = ScanQueue.all().filter(e => !e.conflict && !e.needsKey && (e.attempts || 0) < MAX_ATTEMPTS);
                const groups = new Map();
                waiting.forEach(e => {
                    const k = CourseScanner.groupKey(e);
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k).push(e);
                });
                for (const group of groups.values()) {
                    for (let i = 0; i < group.length; i += UPLOAD_CHUNK) {
                        CourseScanner.setSaveState(group.slice(i, i + UPLOAD_CHUNK), 'saving');
                        CourseScanner.refreshCards();
                        await CourseScanner.uploadGroup(group.slice(i, i + UPLOAD_CHUNK));
                    }
                }
                force = false;
                if (CourseScanner.rows.some(r => r.saveState === 'dirty')) CourseScanner.flushAgain = true;
            } while (CourseScanner.flushAgain);
        } finally {
            CourseScanner.flushing = false;
            CourseScanner.saving = false;
            CourseScanner.refreshCards();
            CourseScanner.updateSaveInfo();
        }
        // Failed uploads are tried again by themselves.
        const retry = ScanQueue.all().some(e => !e.conflict && !e.needsKey && (e.attempts || 0) > 0 && (e.attempts || 0) < MAX_ATTEMPTS);
        if (retry) {
            clearTimeout(CourseScanner.flushTimer);
            CourseScanner.flushTimer = setTimeout(() => CourseScanner.flush(), RETRY_MS);
        }
    },

    // Lecturer's choice for a sheet that has a saved twin: replace the saved one, or drop this scan.
    resolveConflict: async (row, replace) => {
        if (!row || !row.scanId) return;
        if (replace) {
            row.replace = true;
            row.saveState = 'dirty';
            CourseScanner.syncQueue();
            await CourseScanner.flush(true);
        } else {
            ScanQueue.remove([row.scanId]);
            CourseScanner.revokeRow(row);
            CourseScanner.rows = CourseScanner.rows.filter(r => r !== row);
            CourseScanner.renderRows();
            CourseScanner.markChange();
        }
    },

    // Sheets in the cache that no longer have a row on screen (from an earlier visit).
    orphans: () => ScanQueue.forCourse(CourseScanner.courseId).filter(e => !CourseScanner.rowByScan(e.scanId)),

    resolveOrphans: async (replace) => {
        const list = CourseScanner.orphans().filter(e => e.conflict);
        if (!replace) ScanQueue.remove(list.map(e => e.scanId));
        else list.forEach(e => ScanQueue.update(e.scanId, { conflict: null, replace: true, attempts: 0 }));
        await CourseScanner.flush(true);
    },

    // The answer key of this assessment differs from the one saved earlier: earlier sheets get graded again.
    allowRegrade: async () => {
        ScanQueue.forCourse(CourseScanner.courseId).filter(e => e.needsKey)
            .forEach(e => ScanQueue.update(e.scanId, { needsKey: null, allowRegrade: true, attempts: 0 }));
        CourseScanner.rows.filter(r => r.saveState === 'key').forEach(r => { r.saveState = 'pending'; });
        await CourseScanner.flush(true);
    },

    // ---------- Events ----------

    getRow: (el) => CourseScanner.rows.find(r => String(r.id) === String(el.dataset.row)),

    handleClicks: async (e) => {
        if (e.target.closest('#openScannerBtn')) {
            await CourseScanner.open();
            return;
        }
        if (!e.target.closest('#scannerModal')) return;

        if (e.target.closest('#closeScannerBtn') || e.target.id === 'closeScannerBg') CourseScanner.close();

        const keyBtn = e.target.closest('.scn-key-btn');
        if (keyBtn) CourseScanner.setKey(Number(keyBtn.dataset.q), Number(keyBtn.dataset.k));

        if (e.target.closest('#scnKeyQuickBtn')) CourseScanner.applyQuickKey();
        if (e.target.closest('#scnPrintBtn')) await CourseScanner.printSheet();
        if (e.target.closest('#scnStartBtn')) await CourseScanner.startScanning();
        if (e.target.closest('#scnBackBtn')) {
            CourseScanner.stopLive();
            CourseScanner.showView('setup');
        }
        if (e.target.closest('#scnTabScan')) {
            CourseScanner.setAlert('');
            CourseScanner.showView(CourseScanner.lastWork || 'setup');
        }
        if (e.target.closest('#scnTabSaved')) {
            CourseScanner.stopLive();
            CourseScanner.setAlert('');
            CourseScanner.showView('saved');
            await CourseScanRecords.load();
        }
        if (e.target.closest('#scnLiveBtn')) await CourseScanner.startLive();
        if (e.target.closest('#scnLiveStopBtn')) CourseScanner.stopLive();
        if (e.target.closest('#scnCaptureAgainBtn')) {
            // Keep the first capture until the new one succeeds, then replace it.
            const old = CourseScanner.liveReviewRow;
            CourseScanner.renderRows();
            CourseScanner.liveReviewRow = null;
            CourseScanner.flush();
            await CourseScanner.startLive();
            CourseScanner.live.replacing = CourseScanner.live.stream ? old : null;
        }
        if (e.target.closest('#scnAfterDoneBtn')) CourseScanner.stopLive();
        if (e.target.closest('#scnLiveCaptureBtn')) await CourseScanner.liveCapture(CourseScanner.live.prev);
        if (e.target.closest('#scnCameraBtn')) $('scnCameraInput').click();
        if (e.target.closest('#scnUploadBtn')) $('scnFileInput').click();
        if (e.target.closest('#scnSaveBtn')) await CourseScanner.save();
        if (e.target.closest('#scnRegradeBtn')) await CourseScanner.allowRegrade();
        if (e.target.closest('#scnOrphanReplaceBtn')) await CourseScanner.resolveOrphans(true);
        if (e.target.closest('#scnOrphanKeepBtn')) await CourseScanner.resolveOrphans(false);
        const replaceBtn = e.target.closest('.scn-replace-btn');
        if (replaceBtn) await CourseScanner.resolveConflict(CourseScanner.getRow(replaceBtn), true);
        const keepBtn = e.target.closest('.scn-keep-btn');
        if (keepBtn) await CourseScanner.resolveConflict(CourseScanner.getRow(keepBtn), false);

        const removeBtn = e.target.closest('.scn-remove-btn');
        if (removeBtn) {
            const row = CourseScanner.getRow(removeBtn);
            if (row) {
                if (row.scanId && row.saveState !== 'saved') ScanQueue.remove([row.scanId]);
                CourseScanner.revokeRow(row);
                CourseScanner.rows = CourseScanner.rows.filter(r => r !== row);
                CourseScanner.renderRows();
                CourseScanner.markChange();   // a sheet that was a duplicate may be ready now
            }
        }
    },

    handleChanges: async (e) => {
        const t = e.target;
        if (!t.closest || !t.closest('#scannerModal')) return;

        if (t.name === 'scnMode') {
            CourseScanner.mode = t.value === 'typed' ? 'typed' : 'exam';
            CourseScanner.refreshSetup();
            return;
        }
        if (t.id === 'scnExamSelect' || t.id === 'scnTerm' || t.id === 'scnCategory' || t.id === 'scnDate') {
            CourseScanner.refreshSetup();
            return;
        }
        if (t.id === 'scnTypedN') {
            const n = Math.min(MAX_QUESTIONS, Math.max(1, parseInt(t.value, 10) || 1));
            t.value = n;
            CourseScanner.typed.n = n;
            CourseScanner.renderKeyGrid();
            CourseScanner.refreshSetup();
            return;
        }
        if (t.id === 'scnTypedC') {
            CourseScanner.typed.c = Math.min(MAX_CHOICES, Math.max(2, parseInt(t.value, 10) || 4));
            CourseScanner.renderKeyGrid();
            CourseScanner.refreshSetup();
            return;
        }
        if (t.id === 'scnCameraInput' || t.id === 'scnFileInput') {
            const files = Array.from(t.files || []);
            t.value = '';
            await CourseScanner.processFiles(files);
            return;
        }

        const row = t.dataset ? CourseScanner.getRow(t) : null;
        if (!row) return;

        if (t.classList.contains('scn-student-select')) {
            row.studentId = t.value;
            row.saveState = row.saveState ? 'dirty' : '';
            CourseScanner.markChange();
        } else if (t.classList.contains('scn-stuno-input')) {
            row.studentText = t.value.trim();
            row.studentId = CourseScanner.matchStudent(row.studentText);
            row.saveState = row.saveState ? 'dirty' : '';
            document.querySelectorAll(`.scn-student-select[data-row="${row.id}"]`).forEach(sel => { sel.value = row.studentId; });
            CourseScanner.markChange();
        } else if (t.classList.contains('scn-answer-select')) {
            const q = Number(t.dataset.q);
            row.answers[q] = parseInt(t.value, 10);
            row.saveState = row.saveState ? 'dirty' : '';
            t.outerHTML = CourseScanner.answerSelectHtml(row, q).match(/<select[\s\S]*<\/select>/)[0];
            CourseScanner.markChange();
            try {
                await CourseScanner.renderPreview(row);
                document.querySelectorAll(`[data-card="${row.id}"] [data-role="img"]`).forEach(img => { img.src = row.overlayUrl; });
            } catch (err) {
                console.error(err);
            }
        }
    },

    handleInputs: (e) => {
        const t = e.target;
        if (t.id === 'scnTypedTitle') CourseScanner.refreshSetup();
    }
};
