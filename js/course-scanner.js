// js/course-scanner.js
// Lecturer tool (Course Actions > Scan Answer Sheets): prints the bubble answer sheet, reads photos of
// the shaded sheets (omr-scan.js), matches each sheet to a student by the shaded student number, and
// saves the scores into an assessment (Record Scores). Layout lives in components-scanner.js.
import { apiFetch, AppState } from './globals.js';
import { CourseSummary } from './course-summary.js';
import { UI } from './ui-feedback.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml as esc } from './html-utils.js';
import { buildSheetHtml, MAX_QUESTIONS, MAX_CHOICES } from './omr-sheet.js';
import { scanImage, drawOverlay, BLANK, MULTIPLE } from './omr-scan.js';

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

    init: () => {
        document.addEventListener('click', CourseScanner.handleClicks);
        document.addEventListener('change', CourseScanner.handleChanges);
        document.addEventListener('input', CourseScanner.handleInputs);
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

    showView: (name) => {
        $('scnSetupView')?.classList.toggle('hidden', name !== 'setup');
        $('scnScanView')?.classList.toggle('hidden', name !== 'scan');
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
        await CourseScanner.load();
    },

    close: () => {
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
            items.push({ idx, bonus: Boolean(q[5]), c: choices.length });
        });
        return {
            n: items.length,
            c: Math.max(2, ...items.map(i => i.c)),
            key: items.map(i => i.idx),
            bonus: items.map(i => i.bonus),
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
    findAssessment: (cfg) => {
        if (cfg.mode === 'exam') {
            const link = CourseScanner.classExams.find(ce => ce.Exam_ID === cfg.examId && ce.Assessment_ID);
            const linked = link ? CourseScanner.assessments.find(a => a.Assessment_ID === link.Assessment_ID) : null;
            if (linked) return linked;
        }
        return CourseScanner.assessments.find(a => norm(a.Title) === norm(cfg.title) && a.Term === cfg.term) || null;
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
            cfg = { mode: 'exam', examId: exam.Exam_ID, title: String(exam.Title || '').trim(), n: a.n, c: a.c, key: a.key, bonus: a.bonus, maxRegular, skipped: a.skipped };
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

    printSheet: () => {
        const cfg = CourseScanner.getConfig();
        if (!cfg.ok) {
            CourseScanner.setAlert(cfg.error, false);
            return;
        }
        CourseScanner.setAlert('');
        const html = buildSheetHtml({
            title: cfg.title,
            subtitle: CourseScanner.courseLabel(),
            n: cfg.n,
            c: cfg.c,
            paper: val('scnPaper') || 'letter'
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
        }

        progress.classList.add('hidden');
        CourseScanner.busy = false;
    },

    buildRow: async (file) => {
        const cfg = CourseScanner.cfg;
        const result = await scanImage(file, cfg.n, cfg.c);
        const row = {
            id: CourseScanner.nextRowId++,
            fileName: file.name || 'Photo',
            ok: result.ok,
            error: result.error || '',
            saved: false,
            answers: [],
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
        if (row.saved) out.push(badge('bg-green-50 text-green-800 border-green-300', 'Saved'));
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

    rowHtml: (row, dups) => {
        const head = `
            <div class="flex items-start justify-between gap-2">
                <div class="text-[11px] font-bold text-gray-500 truncate">${esc(row.fileName)}</div>
                <button type="button" class="scn-remove-btn text-gray-400 hover:text-red-600 transition" data-row="${row.id}" aria-label="Remove this sheet"><i class="fa-solid fa-trash"></i></button>
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
                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1" for="scnStu${row.id}">Student No.</label>
                    <input type="text" id="scnStu${row.id}" class="scn-stuno-input w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500" data-row="${row.id}" value="${esc(row.studentText)}" maxlength="12">
                </div>
                <div class="sm:col-span-6">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1" for="scnSel${row.id}">Student</label>
                    <select id="scnSel${row.id}" class="scn-student-select w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white" data-row="${row.id}">${studentOptions}</select>
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
            const card = document.querySelector(`[data-card="${row.id}"]`);
            if (!card || !row.ok) return;
            card.querySelector('[data-role="score"]').innerHTML = CourseScanner.scoreHtml(row);
            card.querySelector('[data-role="flags"]').innerHTML = CourseScanner.flagsHtml(row, dups);
            card.className = `bg-white border ${CourseScanner.rowBorder(row, dups)} rounded-lg p-3`;
        });
        CourseScanner.updateSaveInfo();
    },

    readyRows: () => {
        const dups = CourseScanner.duplicateIds();
        return CourseScanner.rows.filter(r => r.ok && r.studentId && !dups.has(r.studentId));
    },

    updateSaveInfo: () => {
        const info = $('scnSaveInfo');
        const btn = $('scnSaveBtn');
        if (!info || !btn) return;
        const okRows = CourseScanner.rows.filter(r => r.ok);
        const dups = CourseScanner.duplicateIds();
        const noStudent = okRows.filter(r => !r.studentId).length;
        const dupRows = okRows.filter(r => dups.has(r.studentId)).length;
        const ready = okRows.length - noStudent - dupRows;
        const parts = [`${ready} ready to save`];
        if (noStudent) parts.push(`${noStudent} need a student`);
        if (dupRows) parts.push(`${dupRows} duplicate (remove or reassign)`);
        info.textContent = parts.join(' | ');
        btn.disabled = CourseScanner.saving || ready === 0 || dupRows > 0;
    },

    // ---------- Saving ----------

    save: async () => {
        const cfg = CourseScanner.cfg;
        if (!cfg || CourseScanner.saving) return;
        const rows = CourseScanner.readyRows();
        const skipped = CourseScanner.rows.filter(r => r.ok).length - rows.length;
        if (!rows.length) return;

        if (skipped > 0) {
            const ok = await UI.confirm({
                title: 'Some sheets will not be saved',
                message: `${skipped} sheet${skipped === 1 ? ' has' : 's have'} no student selected and will be left out. Save the other ${rows.length}?`,
                confirmText: 'Save'
            });
            if (!ok) return;
        }

        const btn = $('scnSaveBtn');
        const originalHtml = btn.innerHTML;
        CourseScanner.saving = true;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
        CourseScanner.setAlert('');

        try {
            const ts = new Date().getTime();
            const [assessRes, classExamRes] = await Promise.all([
                apiFetch(`/api/assessments?courseId=${CourseScanner.courseId}&_t=${ts}`),
                apiFetch(`/api/class-exams?courseId=${CourseScanner.courseId}&_t=${ts}`)
            ]);
            CourseScanner.assessments = assessRes.assessments || [];
            CourseScanner.classExams = classExamRes.classExams || [];

            // Scores already recorded for this assessment are kept; scanned ones are added or replace.
            let assessment = CourseScanner.findAssessment(cfg);
            const existing = new Map();
            if (assessment) {
                const data = await apiFetch(`/api/assessment-scores?assessmentId=${assessment.Assessment_ID}&_t=${ts}`);
                (data.scores || []).forEach(s => existing.set(s.Student_ID, Number(s.Score)));
            }
            const max = assessment ? Number(assessment.Max_Score) : cfg.maxRegular;
            const incoming = rows.map(r => ({ studentId: r.studentId, score: CourseScanner.scoreRow(r, max).final }));
            const replaced = incoming.filter(i => existing.has(i.studentId) && existing.get(i.studentId) !== i.score).length;
            if (replaced > 0) {
                const ok = await UI.confirm({
                    title: 'Replace existing scores?',
                    message: `${replaced} student${replaced === 1 ? ' already has a different score' : 's already have different scores'} in "${assessment.Title}". The scanned score${replaced === 1 ? '' : 's'} will replace ${replaced === 1 ? 'it' : 'them'}.`,
                    confirmText: 'Replace and save',
                    danger: true
                });
                if (!ok) return;
            }

            // A typed answer key is also stored as an exam in Manage Exams (once).
            if (cfg.mode === 'typed' && !CourseScanner.createdExamId) {
                const choices = LETTERS.slice(0, cfg.c).split('');
                const examData = cfg.key.map((k, i) => [0, `Question ${i + 1}`, choices, choices[k], '', false]);
                const res = await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: cfg.title, examData })
                });
                CourseScanner.createdExamId = res.examId || true;
            }

            let assessmentId;
            if (assessment) {
                assessmentId = assessment.Assessment_ID;
            } else {
                const res = await apiFetch('/api/assessments', {
                    method: 'POST',
                    body: JSON.stringify({
                        assessmentId: null,
                        courseId: CourseScanner.courseId,
                        term: cfg.term,
                        category: cfg.category,
                        title: cfg.title,
                        maxScore: cfg.maxRegular,
                        date: cfg.date
                    })
                });
                assessmentId = res.assessmentId;
            }

            incoming.forEach(i => existing.set(i.studentId, i.score));
            const scores = Array.from(existing, ([studentId, score]) => ({ studentId, score }));
            await apiFetch('/api/assessment-scores', {
                method: 'POST',
                body: JSON.stringify({ assessmentId, scores })
            });

            rows.forEach(r => { r.saved = true; });
            const list = await apiFetch(`/api/assessments?courseId=${CourseScanner.courseId}&_t=${new Date().getTime()}`);
            CourseScanner.assessments = list.assessments || [];
            const fresh = CourseScanner.findAssessment(cfg);
            if (fresh) cfg.cap = Number(fresh.Max_Score);
            CourseScanner.refreshCards();

            const msg = `Saved ${incoming.length} score${incoming.length === 1 ? '' : 's'} to "${cfg.title}".`;
            CourseScanner.setAlert(msg, true);
            UI.success(msg);
        } catch (err) {
            CourseScanner.setAlert(err.message || 'Failed to save scores.', false);
        } finally {
            CourseScanner.saving = false;
            btn.innerHTML = originalHtml;
            CourseScanner.updateSaveInfo();
        }
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
        if (e.target.closest('#scnPrintBtn')) CourseScanner.printSheet();
        if (e.target.closest('#scnStartBtn')) await CourseScanner.startScanning();
        if (e.target.closest('#scnBackBtn')) CourseScanner.showView('setup');
        if (e.target.closest('#scnCameraBtn')) $('scnCameraInput').click();
        if (e.target.closest('#scnUploadBtn')) $('scnFileInput').click();
        if (e.target.closest('#scnSaveBtn')) await CourseScanner.save();

        const removeBtn = e.target.closest('.scn-remove-btn');
        if (removeBtn) {
            const row = CourseScanner.getRow(removeBtn);
            if (row) {
                CourseScanner.revokeRow(row);
                CourseScanner.rows = CourseScanner.rows.filter(r => r !== row);
                CourseScanner.renderRows();
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
            row.saved = false;
            CourseScanner.refreshCards();
        } else if (t.classList.contains('scn-stuno-input')) {
            row.studentText = t.value.trim();
            row.studentId = CourseScanner.matchStudent(row.studentText);
            row.saved = false;
            const select = document.getElementById(`scnSel${row.id}`);
            if (select) select.value = row.studentId;
            CourseScanner.refreshCards();
        } else if (t.classList.contains('scn-answer-select')) {
            const q = Number(t.dataset.q);
            row.answers[q] = parseInt(t.value, 10);
            row.saved = false;
            t.outerHTML = CourseScanner.answerSelectHtml(row, q).match(/<select[\s\S]*<\/select>/)[0];
            CourseScanner.refreshCards();
            try {
                await CourseScanner.renderPreview(row);
                const img = document.querySelector(`[data-card="${row.id}"] [data-role="img"]`);
                if (img) img.src = row.overlayUrl;
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
