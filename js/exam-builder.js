// js/exam-builder.js
// Full-screen Exam Builder: write an exam like a Google Form (Form view) or like a spreadsheet (Sheet view).
// Both views edit the same questions. It saves in the existing exam format through /api/exams and /api/exams/update.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import * as M from './exam-builder-model.js';
import { escapeHtml as esc } from './html-utils.js';
import { downloadCsv } from './download-utils.js';

const ROOT_ID = 'examBuilderModal';
const VIEW_KEY = 'exam_builder_view';

const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
};

const draftKey = (examId) => `exam_builder_draft_${AppState.user ? AppState.user.User_ID : ''}_${examId || 'new'}`;

// Question types an answer sheet can hold (shaded and scanned) and the ones written by hand (marked by the lecturer).
const SCAN_TYPES = ['mc', 'multi', 'tf', 'num', 'order', 'match'];
const BASE_OF = { multia: 'multi', enumo: 'enum', ordera: 'order' };
const isScanType = (key) => SCAN_TYPES.includes(BASE_OF[key] || key);
const GROUPS = [{ scan: true, label: 'Scannable (shaded on the answer sheet)' }, { scan: false, label: 'Written (marked by hand)' }];
const grouped = (list, keyOf, optionHtml) => GROUPS.map(g => {
    const items = list.filter(t => isScanType(keyOf(t)) === g.scan);
    return items.length ? `<optgroup label="${g.label}">${items.map(optionHtml).join('')}</optgroup>` : '';
}).join('');

const SAVE_HTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span class="hidden sm:inline ml-1.5">Save exam</span>';
const ADD_LABEL = { mc: 'Multiple choice', multi: 'Multi-answer', tf: 'T/F', id: 'Identification', num: 'Numeric', enum: 'Enumeration', order: 'Ordering', match: 'Matching', essay: 'Essay' };

const INPUT = 'w-full border-0 border-b border-gray-300 focus:border-indigo-500 focus:ring-0 outline-none px-1 py-1.5 text-sm bg-transparent';
const CELL = 'eb-cell w-full px-2 py-1.5 text-xs border border-transparent focus:border-indigo-500 focus:bg-white bg-transparent outline-none rounded-none disabled:bg-gray-100 disabled:text-gray-300';

export const ExamBuilder = {
    s: null,
    root: null,
    draftTimer: null,

    // ---------- Open / close ----------

    // options: { examId?, title?, onSaved?, classLink? }  classLink: { enabled, term, category, fromDate, toDate, audience, linked } shows the Record Scores panel
    // The course line printed on papers is the Course Title of one of the lecturer's classes.
    courses: null,
    courseOptions: () => {
        const s = ExamBuilder.s || {};
        const titles = [...new Set((ExamBuilder.courses || []).map(c => String(c.CourseTitle || '').trim()).filter(Boolean))];
        if (s.course && !titles.includes(s.course)) titles.unshift(s.course);
        return `<option value="">No course line</option>` + titles.map(t => `<option value="${esc(t)}"${t === s.course ? ' selected' : ''}>${esc(t)}</option>`).join('');
    },
    loadCourses: async () => {
        try {
            if (!ExamBuilder.courses) {
                const d = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer&_t=${Date.now()}`);
                ExamBuilder.courses = d.courses || [];
            }
            const s = ExamBuilder.s;
            if (!s) return;
            // a new exam made from a class page starts with that class
            if (!s.examId && !s.course) {
                const id = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
                const here = ExamBuilder.courses.find(c => String(c.Course_ID) === id);
                if (here) s.course = String(here.CourseTitle || '').trim();
            }
            const sel = ExamBuilder.root && ExamBuilder.root.querySelector('#ebCourse');
            if (sel) sel.innerHTML = ExamBuilder.courseOptions();
        } catch (e) { /* the list stays as it is; the saved course line still shows */ }
    },

    open: async (options = {}) => {
        const root = ExamBuilder.mount();
        ExamBuilder.s = {
            examId: options.examId || null,
            title: options.title || '',
            course: options.course || '',
            view: store.get(VIEW_KEY) === 'sheet' ? 'sheet' : 'form',
            questions: [],
            dirty: false,
            saving: false,
            onSaved: options.onSaved || null,
            link: options.classLink ? { ...options.classLink } : null
        };
        const s = ExamBuilder.s;
        root.classList.remove('hidden');
        ExamBuilder.renderShell();
        const body = root.querySelector('#ebBody');
        body.innerHTML = '<div class="text-center py-10 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

        try {
            if (options.preset) {
                s.title = options.preset.title || s.title;
                s.questions = options.preset.questions;
                s.dirty = true;
            } else if (s.examId) {
                const data = await apiFetch(`/api/exam-data?examId=${encodeURIComponent(s.examId)}&_t=${Date.now()}`);
                let rows = [];
                try { rows = JSON.parse((data.exam && data.exam.ExamData) || '[]'); } catch (e) { rows = []; }
                s.title = (data.exam && data.exam.Title) || s.title;
                s.course = String((data.exam && data.exam.Course) || s.course || '').trim();
                s.questions = M.fromExamData(rows);
            } else {
                s.questions = [M.blankQuestion('mc', 0)];
            }
        } catch (err) {
            UI.error(err.message || 'Could not open the exam.');
            ExamBuilder.close(true);
            return;
        }

        // A draft kept on this device from an earlier, unsaved session.
        const saved = options.preset ? null : store.get(draftKey(s.examId));
        if (saved) {
            try {
                const d = JSON.parse(saved);
                if (d && Array.isArray(d.questions) && d.questions.length && await UI.confirm({ title: 'Restore draft', message: 'You have an unsaved draft of this exam on this device. Restore it?', confirmText: 'Restore' })) {
                    s.title = d.title || s.title;
                    if (typeof d.course === 'string') s.course = d.course;
                    s.questions = d.questions;
                    s.dirty = true;
                } else {
                    store.del(draftKey(s.examId));
                }
            } catch (e) { store.del(draftKey(s.examId)); }
        }

        if (!s.questions.some(q => q.id === s.openId)) s.openId = s.questions.length ? s.questions[0].id : null;
        ExamBuilder.renderShell();
        ExamBuilder.renderBody();
        ExamBuilder.loadCourses();
    },

    close: async (force = false) => {
        const s = ExamBuilder.s;
        if (!force && s && s.dirty && !(await UI.confirm({ title: 'Close without saving?', message: 'Your changes stay as a draft on this device.', confirmText: 'Close' }))) return;
        ExamBuilder.cancelChunks();
        ExamBuilder.flushDraft();
        ExamBuilder.cellTarget = null;
        ExamBuilder.root?.querySelector('#ebCellEditor')?.classList.add('hidden');
        if (ExamBuilder.root) ExamBuilder.root.classList.add('hidden');
        ExamBuilder.s = null;
    },

    // ---------- Draft ----------

    touch: () => {
        const s = ExamBuilder.s;
        if (!s) return;
        s.dirty = true;
        ExamBuilder.setNote('unsaved');
        clearTimeout(ExamBuilder.draftTimer);
        ExamBuilder.draftTimer = setTimeout(() => (window.requestIdleCallback ? window.requestIdleCallback(ExamBuilder.flushDraft, { timeout: 3000 }) : ExamBuilder.flushDraft()), 1000);
    },

    flushDraft: () => {
        clearTimeout(ExamBuilder.draftTimer);
        const s = ExamBuilder.s;
        if (!s || !s.dirty || s.saving) return;
        store.set(draftKey(s.examId), JSON.stringify({ title: s.title, course: s.course, questions: s.questions, t: Date.now() }));
        ExamBuilder.setNote('draft');
    },

    // Status next to the question count: unsaved (amber), draft kept on this device (green), saving (blue).
    setNote: (state) => {
        const note = ExamBuilder.root && ExamBuilder.root.querySelector('#ebDraftNote');
        if (!note) return;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const look = {
            unsaved: ['text-amber-600', '<i class="fa-solid fa-circle text-[6px] mr-1 align-middle" aria-hidden="true"></i>Unsaved changes'],
            draft: ['text-green-600', `<i class="fa-solid fa-check mr-1" aria-hidden="true"></i>Draft kept on this device ${time}`],
            saving: ['text-blue-600', '<i class="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true"></i>Saving...']
        }[state];
        note.className = `text-[11px] font-bold ${look[0]}`;
        note.innerHTML = look[1];
    },

    // ---------- Shell ----------

    mount: () => {
        if (ExamBuilder.root && ExamBuilder.root.isConnected) return ExamBuilder.root;
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.className = 'hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0';
        document.body.appendChild(root);
        if (!document.getElementById('ebPerfStyle')) {
            const st = document.createElement('style');
            st.id = 'ebPerfStyle';
            // Cards that are scrolled out of view are not laid out or painted (big saving on long exams, esp. phones).
            st.textContent = `#${ROOT_ID} .eb-sum{content-visibility:auto;contain-intrinsic-size:auto 64px}#${ROOT_ID} #ebBody{overscroll-behavior:contain}`;
            document.head.appendChild(st);
        }
        root.addEventListener('click', ExamBuilder.onClick);
        root.addEventListener('input', ExamBuilder.onInput);
        root.addEventListener('change', ExamBuilder.onChange);
        root.addEventListener('paste', ExamBuilder.onPaste);
        root.addEventListener('keydown', ExamBuilder.onKeydown);
        root.addEventListener('focusin', ExamBuilder.onCellFocus);
        ExamBuilder.root = root;
        return root;
    },

    renderShell: () => {
        const s = ExamBuilder.s;
        const root = ExamBuilder.root;
        const tab = (v, icon, label) => `
            <button type="button" data-view="${v}" class="eb-view-btn flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-md transition ${s.view === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}" aria-pressed="${s.view === v}">
                <i class="fa-solid ${icon} mr-1" aria-hidden="true"></i>${label}
            </button>`;
        root.innerHTML = `
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60" id="closeExamBuilderBg"></div>
            <div class="bg-white rounded-none shadow-xl w-full h-full relative z-10 sheet-panel app-page flex flex-col overflow-hidden" id="ebPanel">
                <div class="flex items-center gap-3 px-4 py-3 border-b app-page-header shrink-0">
                    <div class="flex-1 min-w-0 flex flex-col gap-1">
                        <input type="text" id="ebTitle" maxlength="120" value="${esc(s.title)}" placeholder="Exam title (the name shown in Record Scores)" aria-label="Exam title" class="w-full min-w-0 text-base sm:text-lg font-bold text-gray-800 border-0 border-b-2 border-gray-300 focus:border-indigo-600 focus:ring-0 outline-none px-1 py-1 bg-transparent">
                        <select id="ebCourse" aria-label="Course (printed above the title on papers and answer sheets)" class="w-full min-w-0 text-xs sm:text-sm text-gray-600 border-0 border-b border-gray-200 focus:border-indigo-600 focus:ring-0 outline-none px-1 py-0.5 bg-transparent">${ExamBuilder.courseOptions()}</select>
                    </div>
                    <button type="button" id="ebSaveBtn" aria-label="Save exam" class="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-3 sm:px-4 py-2 rounded-md text-sm font-bold shadow-sm transition disabled:opacity-50">${SAVE_HTML}</button>
                    <button type="button" id="closeExamBuilderBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="px-4 pt-3 pb-2 shrink-0 bg-white border-b">
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="flex w-full sm:w-auto bg-gray-100 rounded-lg p-1" role="group" aria-label="Builder view">
                            ${tab('form', 'fa-list-check', 'Form')}
                            ${tab('sheet', 'fa-table', 'Spreadsheet')}
                        </div>
                        <span id="ebCount" class="text-xs font-bold text-gray-500"></span>
                        <span id="ebDraftNote" class="text-[11px] text-gray-400" aria-live="polite"></span>
                        <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                            ${ExamBuilder.linkButton()}
                            <button type="button" id="ebImportBtn" class="whitespace-nowrap px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-import mr-1" aria-hidden="true"></i>Import CSV / Excel</button>
                            <button type="button" id="ebExportBtn" class="whitespace-nowrap px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-export mr-1" aria-hidden="true"></i>Export CSV</button>
                            <input type="file" id="ebCsvInput" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="hidden">
                        </div>
                    </div>
                    ${ExamBuilder.linkPanel()}
                    ${s.examId ? '<p class="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Editing changes the exam for students who have not taken it yet. Scores already recorded are not recalculated.</p>' : ''}
                    <div id="ebAlert" class="hidden mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700" role="alert"></div>
                </div>
                <div id="ebBody" class="flex-1 min-h-0 overflow-auto bg-indigo-50/60 p-3 sm:p-4"></div>
                <div id="ebFabWrap" class="absolute right-4 z-20 flex flex-col items-end gap-3" style="bottom:calc(1rem + env(safe-area-inset-bottom))">
                    <div id="ebFabBackdrop" class="hidden" style="position:fixed;inset:0;z-index:-1;background:rgba(17,24,39,.35)" aria-hidden="true"></div>
                    <div id="ebFabMenu" role="menu" aria-label="Add question" class="hidden flex-col items-end gap-2.5 overflow-y-auto overflow-x-hidden pr-0.5" style="max-height:calc(100vh - 8.5rem);max-height:calc(100dvh - 8.5rem)">
                        ${GROUPS.map(g => `<p class="text-[10px] font-black uppercase tracking-wider text-white/90 mt-1 first:mt-0" style="text-shadow:0 1px 3px rgba(0,0,0,.6)">${g.scan ? 'Shaded on the sheet' : 'Written by hand'}</p>${M.TYPES.filter(t => isScanType(t.id) === g.scan).map(t => `<button type="button" role="menuitem" data-add="${t.id}" tabindex="-1" class="eb-add flex items-center gap-2 group focus:outline-none"><span class="px-2.5 py-1 rounded-md bg-gray-900 text-white text-xs font-bold shadow-md whitespace-nowrap">${ADD_LABEL[t.id] || t.label}</span><span class="w-10 h-10 shrink-0 rounded-full ${g.scan ? 'bg-purple-600 hover:bg-purple-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white shadow-lg flex items-center justify-center group-focus-visible:ring-4 ring-white/70 transition"><i class="fa-solid ${t.icon}" aria-hidden="true"></i></span></button>`).join('')}`).join('')}
                    </div>
                    <button type="button" id="ebFab" aria-label="Add question" aria-haspopup="menu" aria-expanded="false" aria-controls="ebFabMenu" title="Add question" class="w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 flex justify-center items-center focus:outline-none focus-visible:ring-4 ring-purple-300 transition-colors"><i id="ebFabIcon" class="fa-solid fa-plus text-2xl transition-transform duration-200" aria-hidden="true"></i></button>
                </div>
            </div>`;
    },

    // Several edits in a row repaint the counter once per frame.
    updateCount: () => {
        if (ExamBuilder.countFrame) return;
        const run = () => { ExamBuilder.countFrame = 0; ExamBuilder.paintCount(); };
        ExamBuilder.countFrame = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16);
    },

    paintCount: () => {
        const s = ExamBuilder.s;
        const el = ExamBuilder.root && ExamBuilder.root.querySelector('#ebCount');
        if (!s || !el) return;
        const bonus = s.questions.filter(q => q.bonus).length;
        const regular = s.questions.length - bonus;
        const points = s.questions.filter(q => !q.bonus).reduce((sum, q) => sum + M.pointsOf(q), 0);
        el.textContent = `${regular} question${regular === 1 ? '' : 's'}${points !== regular ? ` (${points} points)` : ''}${bonus ? ` + ${bonus} bonus` : ''}`;
    },

    // The first cards appear at once; the rest are added in small batches so a long exam opens without freezing the device.
    FIRST_CHUNK: 12,
    CHUNK: 8,

    renderBody: (focusSel) => {
        const s = ExamBuilder.s;
        const body = ExamBuilder.root.querySelector('#ebBody');
        ExamBuilder.cancelChunks();
        const first = ExamBuilder.FIRST_CHUNK;
        // Spreadsheet: the table scrolls inside the visible area (its scroll bars always on screen); form: the list scrolls,
        // with room at the bottom so the + button never covers the last card.
        const sheetView = s.view === 'sheet';
        body.classList.toggle('overflow-auto', !sheetView);
        body.classList.toggle('overflow-hidden', sheetView);
        body.style.paddingBottom = sheetView ? '4.75rem' : '6rem';
        body.innerHTML = sheetView ? ExamBuilder.sheetHtml(first) : ExamBuilder.formHtml(first);
        ExamBuilder.startChunks(first);
        ExamBuilder.updateCount();
        if (focusSel) {
            let el = body.querySelector(focusSel);
            if (!el && ExamBuilder.chunk) { ExamBuilder.finishRender(); el = body.querySelector(focusSel); }
            if (el) {
                el.focus({ preventScroll: true });
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    },

    startChunks: (from) => {
        const s = ExamBuilder.s;
        if (!s || from >= s.questions.length) { ExamBuilder.chunk = null; return; }
        const c = { from, timer: null };
        ExamBuilder.chunk = c;
        const step = () => {
            if (ExamBuilder.chunk !== c || !ExamBuilder.s) return;
            ExamBuilder.appendChunk(ExamBuilder.CHUNK);
            if (ExamBuilder.chunk === c) c.timer = setTimeout(step, 24);
        };
        c.timer = setTimeout(step, 24);
    },

    appendChunk: (n) => {
        const c = ExamBuilder.chunk, s = ExamBuilder.s;
        if (!c || !s) return;
        const sheet = s.view === 'sheet';
        const host = ExamBuilder.root.querySelector(sheet ? '#ebSheet tbody' : '#ebCards');
        const list = s.questions.slice(c.from, c.from + n);
        if (host && list.length) {
            host.insertAdjacentHTML('beforeend', list.map((q, k) => (sheet ? ExamBuilder.rowHtml(q, c.from + k) : ExamBuilder.cardHtml(q, c.from + k))).join(''));
        }
        c.from += list.length;
        if (!host || c.from >= s.questions.length) { clearTimeout(c.timer); ExamBuilder.chunk = null; }
    },

    // Renders whatever is still waiting (before anything that needs every card: add, delete, move, save).
    finishRender: () => {
        while (ExamBuilder.chunk) ExamBuilder.appendChunk(1000);
    },

    cancelChunks: () => {
        if (ExamBuilder.chunk) clearTimeout(ExamBuilder.chunk.timer);
        ExamBuilder.chunk = null;
    },

    // Q1, Q2 ... after a card was added, removed or moved.
    numberCards: () => {
        const cards = ExamBuilder.root.querySelectorAll('#ebCards .eb-card');
        cards.forEach((card, i) => {
            const qn = card.querySelector('.eb-qn');
            if (qn) qn.textContent = `Q${i + 1}`;
            const up = card.querySelector('[data-act="up"]'), down = card.querySelector('[data-act="down"]');
            if (up) up.disabled = i === 0;
            if (down) down.disabled = i === cards.length - 1;
        });
    },

    // ---------- Form view ----------

    formHtml: (limit = Infinity) => {
        const s = ExamBuilder.s;
        if (s.questions.length === 0) {
            return '<div class="text-center text-sm text-gray-500 py-10">No questions yet. Tap the + button to add one.</div>';
        }
        return `<div class="max-w-2xl mx-auto space-y-3" id="ebCards">${s.questions.slice(0, limit).map((q, i) => ExamBuilder.cardHtml(q, i)).join('')}</div>`;
    },

    // Form view shows ONE question open for editing; the others are a light one-line summary (far fewer elements on
    // the page, so long exams stay smooth). Tap a summary to edit it.
    cardHtml: (q, i) => (q.id === ExamBuilder.s.openId ? ExamBuilder.fullCardHtml(q, i) : ExamBuilder.summaryHtml(q, i)),

    summaryHtml: (q, i) => {
        const s = ExamBuilder.s;
        const type = (M.TYPES.find(t => t.id === q.type) || {}).label || '';
        const pts = M.pointsOf(q);
        const text = String(q.text || '').trim();
        const last = i === s.questions.length - 1;
        return `
            <div class="eb-card eb-sum bg-white rounded-xl border border-gray-200 border-l-4 border-l-transparent hover:border-l-indigo-400 shadow-sm pl-1 pr-1 py-1 flex items-center gap-1" data-qid="${q.id}">
                <button type="button" class="eb-open flex-1 min-w-0 flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-indigo-50/60 focus:outline-none focus-visible:ring-2 ring-indigo-400" aria-expanded="false" aria-label="Edit question ${i + 1}">
                    <span class="eb-qn shrink-0 text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">Q${i + 1}</span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm ${text ? 'text-gray-800' : 'text-gray-400 italic'}">${text ? esc(text) : 'No question text yet'}</span>
                        <span class="block text-[11px] text-gray-500 truncate">${esc(type)} &middot; Part ${q.part + 1} &middot; ${pts} pt${pts === 1 ? '' : 's'}${q.bonus ? ' &middot; <b class="text-amber-700">Bonus</b>' : ''}</span>
                    </span>
                </button>
                <button type="button" class="eb-act shrink-0 w-8 h-8 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move question up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
                <button type="button" class="eb-act shrink-0 w-8 h-8 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30" data-act="down" ${last ? 'disabled' : ''} aria-label="Move question down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
                <button type="button" class="eb-act shrink-0 w-8 h-8 rounded text-gray-500 hover:bg-red-50 hover:text-red-600" data-act="del" aria-label="Delete question"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
            </div>`;
    },

    // Opens one question for editing and folds the one that was open.
    openCard: (qid, quiet = false) => {
        const s = ExamBuilder.s;
        if (!s || s.view !== 'form' || s.openId === qid) return;
        ExamBuilder.finishRender();
        const prev = s.openId;
        s.openId = qid;
        if (prev) ExamBuilder.refreshCard(prev);
        ExamBuilder.refreshCard(qid);
        if (quiet) return;
        const card = ExamBuilder.root.querySelector(`.eb-card[data-qid="${qid}"]`);
        if (card) {
            card.scrollIntoView({ block: 'nearest' });
            card.querySelector('[data-col="text"]')?.focus({ preventScroll: true });
        }
    },

    closeCard: (qid) => {
        const s = ExamBuilder.s;
        if (!s || s.openId !== qid) return;
        s.openId = null;
        ExamBuilder.refreshCard(qid);
        ExamBuilder.root.querySelector(`.eb-card[data-qid="${qid}"] .eb-open`)?.focus({ preventScroll: true });
    },

    fullCardHtml: (q, i) => {
        const s = ExamBuilder.s;
        const typeOptions = grouped(M.TYPES, t => t.id, t => `<option value="${t.id}" ${q.type === t.id ? 'selected' : ''}>${t.label}</option>`);
        let answerArea = '';
        const pts = M.pointsOf(q);
        const ptsText = `${pts} point${pts === 1 ? '' : 's'}`;
        const optionsEditor = (multi) => `
                <div class="mt-3 space-y-1.5">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Choices <span class="normal-case font-normal">- ${multi ? 'tick every correct one' : 'tap the circle of the correct one'}</span></p>
                    ${q.options.map((o, k) => {
                        const on = multi ? q.corrects.includes(k) : q.correct === k;
                        const mark = multi
                            ? `<input type="checkbox" class="eb-correct-multi w-5 h-5 shrink-0 rounded text-green-600 focus:ring-green-500" data-i="${k}" ${on ? 'checked' : ''} aria-label="Mark choice ${M.letter(k)} as a correct answer">`
                            : `<input type="radio" name="ebc-${q.id}" class="eb-correct w-5 h-5 shrink-0 text-green-600 focus:ring-green-500" data-i="${k}" ${on ? 'checked' : ''} aria-label="Mark choice ${M.letter(k)} as the correct answer">`;
                        return `
                        <div class="flex items-center gap-2 rounded ${on ? 'bg-green-50' : ''}">
                            ${mark}
                            <span class="w-4 shrink-0 text-xs font-bold text-gray-400">${M.letter(k)}</span>
                            <input type="text" class="${INPUT} eb-field" data-col="o${k}" value="${esc(o)}" placeholder="Choice ${M.letter(k)}" aria-label="Choice ${M.letter(k)}">
                            <button type="button" class="eb-opt-del shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 ${q.options.length <= M.MIN_OPTIONS ? 'invisible' : ''}" data-i="${k}" aria-label="Remove choice ${M.letter(k)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </div>`;
                    }).join('')}
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        ${q.options.length < M.MAX_OPTIONS ? '<button type="button" class="eb-opt-add text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add choice</button>' : '<span></span>'}
                        ${multi ? `<label class="text-xs font-bold text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" class="eb-mode rounded text-indigo-600 focus:ring-indigo-500" ${q.mode === 'all' ? 'checked' : ''}> All or nothing</label>` : ''}
                    </div>
                    ${multi ? `<p class="text-[11px] text-gray-500">${q.mode === 'all' ? 'Full points only when exactly the correct choices are ticked.' : 'Partial credit: each correct tick earns a share, each wrong tick takes one away (never below 0).'}</p>` : ''}
                </div>`;
        const itemsEditor = (isOrder) => `
                <div class="mt-3 space-y-1.5">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">${isOrder ? 'Items in the correct order' : 'Items to list'} <span class="normal-case font-normal">- ${ptsText}${isOrder ? '' : ', 1 for each correct item'}</span></p>
                    ${q.items.map((it, k) => `
                        <div class="flex items-center gap-2">
                            <span class="w-6 shrink-0 text-right text-xs font-bold text-gray-400">${k + 1}.</span>
                            <input type="text" class="${INPUT} eb-field eb-item" data-i="${k}" value="${esc(it)}" placeholder="${isOrder ? 'Step' : 'Item'} ${k + 1}" aria-label="Item ${k + 1}">
                            <button type="button" class="eb-item-del shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 ${q.items.length <= M.MIN_ITEMS ? 'invisible' : ''}" data-i="${k}" aria-label="Remove item ${k + 1}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </div>`).join('')}
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                        ${q.items.length < M.MAX_ITEMS ? '<button type="button" class="eb-item-add text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add item</button>' : '<span></span>'}
                        ${isOrder
                            ? `<label class="text-xs font-bold text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" class="eb-mode rounded text-indigo-600 focus:ring-indigo-500" ${q.mode === 'all' ? 'checked' : ''}> All or nothing</label>`
                            : `<label class="text-xs font-bold text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" class="eb-ordered rounded text-indigo-600 focus:ring-indigo-500" ${q.ordered ? 'checked' : ''}> Order matters</label>`}
                    </div>
                    <p class="text-[11px] text-gray-500">${isOrder
                        ? `Students see these shuffled and put them in order. ${q.mode === 'all' ? 'Full points only for the exact order.' : 'Partial credit for each item in the right place.'}`
                        : `Capital letters are ignored. ${q.ordered ? 'The student must list the items in this order.' : 'The student can list the items in any order.'} Accept another spelling with " / ", for example <b>CPU / processor</b>.`}</p>
                </div>`;

        if (q.type === 'mc') {
            answerArea = optionsEditor(false);
        } else if (q.type === 'multi') {
            answerArea = optionsEditor(true);
        } else if (q.type === 'tf') {
            const btn = (v) => `<button type="button" class="eb-tf flex-1 py-3 rounded-lg border-2 text-sm font-black transition ${q.tf === v ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300'}" data-v="${v}" aria-pressed="${q.tf === v}">${q.tf === v ? '<i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>' : ''}${v}</button>`;
            answerArea = `
                <div class="mt-3">
                    <p class="text-[11px] font-bold text-gray-500 uppercase mb-1.5">Correct answer</p>
                    <div class="flex gap-2">${btn('True')}${btn('False')}</div>
                </div>`;
        } else if (q.type === 'enum') {
            answerArea = itemsEditor(false);
        } else if (q.type === 'order') {
            answerArea = itemsEditor(true);
        } else if (q.type === 'match') {
            answerArea = `
                <div class="mt-3 space-y-1.5">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Pairs <span class="normal-case font-normal">- ${ptsText}, 1 for each correct pair. Students see the right-hand side shuffled.</span></p>
                    ${q.pairs.map((p, k) => `
                        <div class="flex items-center gap-2">
                            <span class="w-6 shrink-0 text-right text-xs font-bold text-gray-400">${k + 1}.</span>
                            <input type="text" class="${INPUT} eb-pair" data-i="${k}" data-side="l" value="${esc(p.l)}" placeholder="Left item" aria-label="Pair ${k + 1}, left item">
                            <i class="fa-solid fa-arrow-right text-gray-300 shrink-0" aria-hidden="true"></i>
                            <input type="text" class="${INPUT} eb-pair" data-i="${k}" data-side="r" value="${esc(p.r)}" placeholder="Matches with" aria-label="Pair ${k + 1}, matching item">
                            <button type="button" class="eb-pair-del shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 ${q.pairs.length <= M.MIN_PAIRS ? 'invisible' : ''}" data-i="${k}" aria-label="Remove pair ${k + 1}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </div>`).join('')}
                    ${q.pairs.length < M.MAX_PAIRS ? '<button type="button" class="eb-pair-add text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add pair</button>' : ''}
                    <div class="pt-1">
                        <p class="text-[11px] font-bold text-gray-500 uppercase">Extra wrong choices <span class="normal-case font-normal">- optional, separate with |</span></p>
                        <input type="text" class="${INPUT} eb-extra" value="${esc(q.extra.join(' | '))}" placeholder="Decoy 1 | Decoy 2" aria-label="Extra wrong choices">
                    </div>
                </div>`;
        } else if (q.type === 'num') {
            answerArea = `
                <div class="mt-3 grid grid-cols-2 gap-3">
                    <div>
                        <p class="text-[11px] font-bold text-gray-500 uppercase">Correct number</p>
                        <input type="text" inputmode="decimal" class="${INPUT} eb-field" data-col="answer" value="${esc(M.cellText(q, 'answer').replace(/\s*±.*$/, ''))}" placeholder="9.8" aria-label="Correct number">
                    </div>
                    <div>
                        <p class="text-[11px] font-bold text-gray-500 uppercase">Accept within +/-</p>
                        <input type="text" inputmode="decimal" class="${INPUT} eb-tol" value="${esc(q.tol)}" placeholder="0 (exact)" aria-label="Tolerance">
                    </div>
                    <p class="col-span-2 text-[11px] text-gray-500">An answer is correct when it is within the tolerance of the number. Example: 9.8 with +/- 0.1 accepts 9.7 to 9.9.</p>
                </div>`;
        } else if (q.type === 'essay') {
            answerArea = `
                <div class="mt-3">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Model answer or rubric <span class="normal-case font-normal">- only you see this. You score essays by hand in Grade Essays.</span></p>
                    <textarea rows="3" class="eb-field w-full border border-gray-200 focus:border-indigo-500 focus:ring-0 outline-none rounded-md px-2 py-2 text-sm bg-gray-50 focus:bg-white mt-1" data-col="answer" placeholder="Key points a good answer should include" aria-label="Model answer or rubric">${esc(q.answer)}</textarea>
                    <label class="block text-[11px] font-bold text-gray-500 uppercase mt-3" for="ebLong-${q.id}">Writing space on the printed answer sheet</label>
                    <select id="ebLong-${q.id}" class="eb-long mt-1 w-full sm:w-auto border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"><option value="short" ${q.long ? '' : 'selected'}>Short: 3 lines</option><option value="long" ${q.long ? 'selected' : ''}>Long: 6 lines</option></select>
                </div>`;
        } else {
            answerArea = `
                <div class="mt-3">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Correct answer <span class="normal-case font-normal">- capital letters ignored. Accept other answers with " / ", for example <b>CPU / processor</b></span></p>
                    <input type="text" class="${INPUT} eb-field" data-col="answer" value="${esc(q.answer)}" placeholder="Type the exact answer" aria-label="Correct answer">
                </div>`;
        }
        return `
            <div class="eb-card bg-white rounded-xl border border-gray-200 border-l-4 border-l-transparent focus-within:border-l-indigo-600 shadow-sm p-3 sm:p-4" data-qid="${q.id}">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                    <span class="eb-qn text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">Q${i + 1}</span>
                    <select class="eb-type text-xs font-bold border border-gray-300 rounded-md px-2 py-1.5 bg-white" aria-label="Question type">${typeOptions}</select>
                    <label class="text-[11px] font-bold text-gray-500 flex items-center gap-1">Part
                        <input type="number" min="1" max="99" class="eb-field w-14 border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" data-col="part" value="${q.part + 1}" aria-label="Part number">
                    </label>
                    <label class="text-[11px] font-bold text-gray-500 flex items-center gap-1">Points
                        <input type="text" inputmode="decimal" class="eb-field w-16 border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" data-col="points" value="${esc(q.points)}" placeholder="${M.defaultPoints(q)}" aria-label="Points for this question">
                    </label>
                    <label class="ml-auto text-[11px] font-bold ${q.bonus ? 'text-amber-800' : 'text-gray-500'} flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" class="eb-bonus rounded text-amber-600 focus:ring-amber-500" ${q.bonus ? 'checked' : ''}> Bonus
                    </label>
                    <button type="button" class="eb-fold h-8 px-2 rounded text-[11px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 flex items-center gap-1" aria-label="Minimize question ${i + 1}" title="Minimize"><i class="fa-solid fa-chevron-up" aria-hidden="true"></i>Minimize</button>
                </div>
                <textarea rows="2" class="eb-field w-full border border-gray-200 focus:border-indigo-500 focus:ring-0 outline-none rounded-md px-2 py-2 text-sm bg-gray-50 focus:bg-white" data-col="text" placeholder="Question" aria-label="Question">${esc(q.text)}</textarea>
                ${answerArea}
                <input type="text" class="${INPUT} eb-field mt-3 text-xs" data-col="expl" value="${esc(q.expl)}" placeholder="Explanation shown after the answer (optional)" aria-label="Explanation">
                <div class="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1 text-gray-500">
                    <button type="button" class="eb-act h-9 px-3 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold" data-act="addsame" aria-label="Add a new ${esc((M.TYPES.find(t => t.id === q.type) || {}).label || 'question')} question after question ${i + 1}"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>${esc((ADD_LABEL[q.type]) || (M.TYPES.find(t => t.id === q.type) || {}).label || 'Question')}</button>
                    <span class="flex-1"></span>
                    <button type="button" class="eb-act w-9 h-9 rounded hover:bg-gray-100 disabled:opacity-30" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move question up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
                    <button type="button" class="eb-act w-9 h-9 rounded hover:bg-gray-100 disabled:opacity-30" data-act="down" ${i === s.questions.length - 1 ? 'disabled' : ''} aria-label="Move question down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
                    <button type="button" class="eb-act w-9 h-9 rounded hover:bg-gray-100" data-act="dup" aria-label="Duplicate question"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
                    <button type="button" class="eb-act w-9 h-9 rounded hover:bg-red-50 hover:text-red-600" data-act="del" aria-label="Delete question"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
                </div>
            </div>`;
    },

    refreshCard: (qid, focusSel) => {
        const s = ExamBuilder.s;
        const i = s.questions.findIndex(q => q.id === qid);
        const old = ExamBuilder.root.querySelector(`.eb-card[data-qid="${qid}"]`);
        if (i < 0 || !old) return;
        old.outerHTML = ExamBuilder.cardHtml(s.questions[i], i);
        if (focusSel) ExamBuilder.root.querySelector(`.eb-card[data-qid="${qid}"] ${focusSel}`)?.focus();
    },

    // ---------- Spreadsheet view ----------

    sheetHtml: (limit = Infinity) => {
        const s = ExamBuilder.s;
        const head = ['#', 'Part', 'Type', 'Question', ...Array.from({ length: M.MAX_OPTIONS }, (_, k) => `Choice ${M.letter(k)}`), 'Answer', 'Explanation', 'Bonus', 'Points', ''];
        const widths = ['w-10 min-w-[2.5rem]', 'w-16', 'min-w-[160px] sm:min-w-[230px]', 'min-w-[260px]', ...Array(M.MAX_OPTIONS).fill('min-w-[130px]'), 'min-w-[200px]', 'min-w-[180px]', 'w-14', 'w-16', 'w-20'];
        return `
            <div class="flex flex-col h-full">
            <p class="sm:hidden text-[11px] font-semibold text-gray-500 px-1 pb-1"><i class="fa-solid fa-arrows-left-right" aria-hidden="true"></i> Swipe sideways to see all columns</p>
            <div class="bg-white border border-gray-300 rounded-md overflow-auto flex-1 min-h-0">
                <table class="border-collapse text-xs" id="ebSheet">
                    <thead class="sticky top-0 z-10">
                        <tr>${head.map((h, k) => `<th class="${widths[k]} ${k === 0 ? 'sticky left-0 z-20 shadow-[1px_0_0_#d1d5db]' : ''} bg-gray-100 border border-gray-300 px-2 py-1.5 text-left font-bold text-gray-600 whitespace-nowrap">${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody>${s.questions.slice(0, limit).map((q, i) => ExamBuilder.rowHtml(q, i)).join('')}</tbody>
                </table>
            </div>
            </div>`;
    },

    rowHtml: (q, i) => {
        const s = ExamBuilder.s;
        const typeOptions = grouped(M.SHEET_TYPES, t => t.key, t => `<option value="${t.key}" ${M.typeKey(q) === t.key ? 'selected' : ''}>${t.label}</option>`);
        const optCells = Array.from({ length: M.MAX_OPTIONS }, (_, k) => {
            const on = q.type === 'mc' || q.type === 'multi' || q.type === 'match';
            const ph = q.type === 'match' ? 'left | right' : '';
            return `<td class="border border-gray-200 p-0 ${on ? '' : 'bg-gray-100'}"><input type="text" class="${CELL}" data-col="o${k}" value="${on ? esc(M.cellText(q, `o${k}`)) : ''}" placeholder="${ph}" ${on ? '' : 'disabled'} aria-label="${q.type === 'match' ? `Pair ${k + 1}` : `Choice ${M.letter(k)}`}"></td>`;
        }).join('');
        let answerCell;
        if (q.type === 'mc') {
            const letters = q.options.map((o, k) => (o.trim() ? `<option value="${M.letter(k)}" ${q.correct === k ? 'selected' : ''}>${M.letter(k)}: ${esc(o.trim().slice(0, 18))}</option>` : '')).join('');
            answerCell = `<select class="${CELL} eb-answer-sel" data-col="answer" aria-label="Correct choice"><option value="">- pick -</option>${letters}</select>`;
        } else if (q.type === 'tf') {
            answerCell = `<select class="${CELL} eb-answer-sel" data-col="answer" aria-label="Correct answer"><option value="">- pick -</option><option ${q.tf === 'True' ? 'selected' : ''}>True</option><option ${q.tf === 'False' ? 'selected' : ''}>False</option></select>`;
        } else {
            const hint = {
                multi: 'A, C', enum: 'item 1 | item 2 | item 3', order: 'first | second | third',
                match: 'extra wrong choices (optional)', num: '9.8 ± 0.1', essay: 'model answer / rubric'
            }[q.type] || '';
            answerCell = `<input type="text" class="${CELL}" data-col="answer" value="${esc(M.cellText(q, 'answer'))}" placeholder="${hint}" aria-label="Correct answer">`;
        }
        return `
            <tr data-qid="${q.id}" class="eb-row">
                <td class="eb-rownum sticky left-0 z-[5] shadow-[1px_0_0_#d1d5db] border border-gray-200 bg-gray-50 text-center font-bold text-gray-500 px-1">${i + 1}</td>
                <td class="border border-gray-200 p-0"><input type="number" min="1" max="99" class="${CELL}" data-col="part" value="${q.part + 1}" aria-label="Part"></td>
                <td class="border border-gray-200 p-0"><select class="${CELL} eb-type" data-col="type" aria-label="Type">${typeOptions}</select></td>
                <td class="border border-gray-200 p-0"><textarea rows="1" class="${CELL} resize-none" data-col="text" aria-label="Question">${esc(q.text)}</textarea></td>
                ${optCells}
                <td class="border border-gray-200 p-0">${answerCell}</td>
                <td class="border border-gray-200 p-0"><input type="text" class="${CELL}" data-col="expl" value="${esc(q.expl)}" aria-label="Explanation"></td>
                <td class="border border-gray-200 text-center"><input type="checkbox" class="eb-bonus rounded text-amber-600" ${q.bonus ? 'checked' : ''} aria-label="Bonus question"></td>
                <td class="border border-gray-200 p-0"><input type="text" inputmode="decimal" class="${CELL}" data-col="points" value="${esc(q.points)}" placeholder="${M.defaultPoints(q)}" aria-label="Points"></td>
                <td class="border border-gray-200 text-center whitespace-nowrap">
                    <button type="button" class="eb-act w-7 h-7 text-gray-500 hover:text-indigo-600" data-act="dup" aria-label="Duplicate row"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
                    <button type="button" class="eb-act w-7 h-7 text-gray-500 hover:text-red-600" data-act="del" aria-label="Delete row"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
                </td>
            </tr>`;
    },

    refreshRow: (qid) => {
        const s = ExamBuilder.s;
        const i = s.questions.findIndex(q => q.id === qid);
        const old = ExamBuilder.root.querySelector(`tr[data-qid="${qid}"]`);
        if (i < 0 || !old) return;
        const tmp = document.createElement('tbody');
        tmp.innerHTML = ExamBuilder.rowHtml(s.questions[i], i);
        old.replaceWith(tmp.firstElementChild);
    },

    // ---------- Events ----------

    qOf: (el) => {
        const s = ExamBuilder.s;
        const host = el.closest('[data-qid]');
        if (!s || !host) return null;
        return s.questions.find(q => q.id === host.dataset.qid) || null;
    },

    insertQuestion: (q, index) => {
        const s = ExamBuilder.s;
        ExamBuilder.finishRender();
        const host = s.view === 'form' ? ExamBuilder.root.querySelector('#ebCards') : null;
        const prevOpen = s.openId;
        if (s.view === 'form') s.openId = q.id;
        s.questions.splice(index, 0, q);
        ExamBuilder.touch();
        if (!host) { ExamBuilder.renderBody(`[data-qid="${q.id}"] [data-col="text"]`); return; }
        // card view: only the new card is built, the others stay as they are
        const tmp = document.createElement('div');
        tmp.innerHTML = ExamBuilder.cardHtml(q, index);
        host.insertBefore(tmp.firstElementChild, host.children[index] || null);
        if (prevOpen && prevOpen !== q.id) ExamBuilder.refreshCard(prevOpen);
        ExamBuilder.numberCards();
        ExamBuilder.updateCount();
        const el = host.querySelector(`[data-qid="${q.id}"] [data-col="text"]`);
        if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    },

    onClick: async (e) => {
        const s = ExamBuilder.s;
        if (!s) return;
        const t = e.target;

        if (t.closest('#closeExamBuilderBtn') || t.id === 'closeExamBuilderBg') { ExamBuilder.close(); return; }
        if (t.closest('#ebSaveBtn')) { await ExamBuilder.save(); return; }
        if (t.closest('#ebImportBtn')) { ExamBuilder.root.querySelector('#ebCsvInput').click(); return; }
        if (t.closest('#ebExportBtn')) { ExamBuilder.exportCsv(); return; }
        if (t.closest('#ebLinkBtn')) { ExamBuilder.toggleLink(); return; }
        if (t.closest('#ebFab')) { const m = ExamBuilder.root.querySelector('#ebFabMenu'); ExamBuilder.toggleTypes(m.classList.contains('hidden')); return; }
        if (t.id === 'ebFabBackdrop') { ExamBuilder.toggleTypes(false); return; }

        const viewBtn = t.closest('.eb-view-btn');
        if (viewBtn) {
            const view = viewBtn.dataset.view;
            if (view !== s.view) {
                s.view = view;
                store.set(VIEW_KEY, view);
                ExamBuilder.renderShell();
                ExamBuilder.renderBody();
            }
            return;
        }

        const addBtn = t.closest('.eb-add');
        if (addBtn) {
            ExamBuilder.toggleTypes(false);
            const last = s.questions[s.questions.length - 1];
            ExamBuilder.insertQuestion(M.blankQuestion(addBtn.dataset.add, last ? last.part : 0), s.questions.length);
            return;
        }

        const q = ExamBuilder.qOf(t);
        if (!q) return;
        const i = s.questions.indexOf(q);

        const openBtn = t.closest('.eb-open');
        if (openBtn) { const c = openBtn.closest('.eb-card'); if (c) ExamBuilder.openCard(c.dataset.qid); return; }
        const foldBtn = t.closest('.eb-fold');
        if (foldBtn) { const c = foldBtn.closest('.eb-card'); if (c) ExamBuilder.closeCard(c.dataset.qid); return; }
        const actBtn = t.closest('.eb-act');
        if (actBtn) {
            const act = actBtn.dataset.act;
            if (act === 'del') {
                const hasContent = q.text.trim() || q.answer.trim() || q.options.some(o => o.trim()) || q.items.some(o => o.trim()) || q.pairs.some(p => p.l.trim() || p.r.trim());
                if (hasContent && !(await UI.confirm({ title: 'Delete question', message: `Delete question ${i + 1}?`, confirmText: 'Delete', danger: true }))) return;
                ExamBuilder.finishRender();
                s.questions.splice(i, 1);
                ExamBuilder.touch();
                const card = s.view === 'form' ? ExamBuilder.root.querySelector(`#ebCards .eb-card[data-qid="${q.id}"]`) : null;
                if (card && s.questions.length) { card.remove(); ExamBuilder.numberCards(); ExamBuilder.updateCount(); }
                else ExamBuilder.renderBody();
            } else if (act === 'addsame') {
                // a blank question of the same type and part, right after this one
                ExamBuilder.insertQuestion(M.blankQuestion(q.type, q.part), i + 1);
            } else if (act === 'dup') {
                const copy = JSON.parse(JSON.stringify(q));
                copy.id = M.newId();
                ExamBuilder.insertQuestion(copy, i + 1);
            } else if ((act === 'up' && i > 0) || (act === 'down' && i < s.questions.length - 1)) {
                ExamBuilder.finishRender();
                const j = act === 'up' ? i - 1 : i + 1;
                [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]];
                ExamBuilder.touch();
                const card = s.view === 'form' ? ExamBuilder.root.querySelector(`#ebCards .eb-card[data-qid="${q.id}"]`) : null;
                if (card) {
                    // swap the two cards in place
                    if (act === 'up') card.parentNode.insertBefore(card, card.previousElementSibling);
                    else card.parentNode.insertBefore(card.nextElementSibling, card);
                    ExamBuilder.numberCards();
                    const btn = card.querySelector(`[data-act="${act}"]`);
                    if (btn) { btn.focus({ preventScroll: true }); card.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
                } else ExamBuilder.renderBody(`.eb-card[data-qid="${q.id}"] [data-act="${act}"]`);
            }
            return;
        }

        if (t.closest('.eb-item-add')) {
            if (q.items.length < M.MAX_ITEMS) q.items.push('');
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id, `.eb-item[data-i="${q.items.length - 1}"]`);
            return;
        }
        const delItem = t.closest('.eb-item-del');
        if (delItem) {
            if (q.items.length > M.MIN_ITEMS) {
                q.items.splice(parseInt(delItem.dataset.i, 10), 1);
                ExamBuilder.touch();
                ExamBuilder.refreshCard(q.id);
                ExamBuilder.updateCount();
            }
            return;
        }

        if (t.closest('.eb-pair-add')) {
            if (q.pairs.length < M.MAX_PAIRS) q.pairs.push({ l: '', r: '' });
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id, `.eb-pair[data-i="${q.pairs.length - 1}"][data-side="l"]`);
            ExamBuilder.updateCount();
            return;
        }
        const delPair = t.closest('.eb-pair-del');
        if (delPair) {
            if (q.pairs.length > M.MIN_PAIRS) {
                q.pairs.splice(parseInt(delPair.dataset.i, 10), 1);
                ExamBuilder.touch();
                ExamBuilder.refreshCard(q.id);
                ExamBuilder.updateCount();
            }
            return;
        }

        if (t.closest('.eb-opt-add')) {
            if (q.options.length < M.MAX_OPTIONS) q.options.push('');
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id, `[data-col="o${q.options.length - 1}"]`);
            return;
        }
        const delOpt = t.closest('.eb-opt-del');
        if (delOpt) {
            const k = parseInt(delOpt.dataset.i, 10);
            if (q.options.length > M.MIN_OPTIONS) {
                q.options.splice(k, 1);
                if (q.correct === k) q.correct = -1;
                else if (q.correct > k) q.correct -= 1;
                q.corrects = q.corrects.filter(c => c !== k).map(c => (c > k ? c - 1 : c));
                ExamBuilder.touch();
                ExamBuilder.refreshCard(q.id);
            }
            return;
        }
        const tfBtn = t.closest('.eb-tf');
        if (tfBtn) {
            q.tf = tfBtn.dataset.v;
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id);
            return;
        }
        if (t.classList.contains('eb-correct')) {
            q.correct = parseInt(t.dataset.i, 10);
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id);
        }
    },

    onInput: (e) => {
        const s = ExamBuilder.s;
        if (!s) return;
        const t = e.target;
        if (t.id === 'ebTitle') { s.title = t.value; ExamBuilder.touch(); return; }
        if (t.id === 'ebCourse') { s.course = t.value; ExamBuilder.touch(); return; }
        if (ExamBuilder.onLinkField(t)) return;
        if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'radio') return;
        const q = ExamBuilder.qOf(t);
        if (!q) return;
        if (t.classList.contains('eb-item')) {
            q.items[parseInt(t.dataset.i, 10)] = t.value;
            ExamBuilder.touch();
            ExamBuilder.updateCount();
            return;
        }
        if (t.classList.contains('eb-pair')) {
            const pair = q.pairs[parseInt(t.dataset.i, 10)];
            if (pair) pair[t.dataset.side] = t.value;
            ExamBuilder.touch();
            ExamBuilder.updateCount();
            return;
        }
        if (t.classList.contains('eb-extra')) {
            q.extra = M.splitItems(t.value);
            ExamBuilder.touch();
            return;
        }
        if (t.classList.contains('eb-tol')) {
            q.tol = t.value.trim();
            ExamBuilder.touch();
            return;
        }
        const col = t.dataset.col;
        if (!col) return;
        M.setCell(q, col, t.value);
        ExamBuilder.touch();
        if (col === 'points' || (col === 'answer' && (q.type === 'enum' || q.type === 'order'))) ExamBuilder.updateCount();
    },

    onChange: (e) => {
        const s = ExamBuilder.s;
        if (!s) return;
        const t = e.target;
        if (ExamBuilder.onLinkField(t)) return;
        if (t.id === 'ebCsvInput') {
            const file = t.files && t.files[0];
            t.value = '';
            if (file) ExamBuilder.importCsv(file);
            return;
        }
        const q = ExamBuilder.qOf(t);
        if (!q) return;
        const inSheet = s.view === 'sheet';

        if (t.classList.contains('eb-correct-multi')) {
            const k = parseInt(t.dataset.i, 10);
            q.corrects = t.checked ? [...new Set([...q.corrects, k])] : q.corrects.filter(c => c !== k);
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id);
            return;
        }
        if (t.classList.contains('eb-long')) {
            q.long = t.value === 'long';
            ExamBuilder.touch();
            return;
        }
        if (t.classList.contains('eb-mode')) {
            q.mode = t.checked ? 'all' : 'partial';
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id);
            return;
        }

        if (t.classList.contains('eb-ordered')) {
            q.ordered = t.checked;
            ExamBuilder.touch();
            ExamBuilder.refreshCard(q.id);
            return;
        }

        if (t.classList.contains('eb-bonus')) {
            q.bonus = t.checked;
            ExamBuilder.touch();
            ExamBuilder.updateCount();
            if (!inSheet) ExamBuilder.refreshCard(q.id);
            return;
        }
        if (t.classList.contains('eb-type')) {
            M.changeType(q, t.value);
            ExamBuilder.touch();
            ExamBuilder.updateCount();
            inSheet ? ExamBuilder.refreshRow(q.id) : ExamBuilder.refreshCard(q.id);
            return;
        }
        if (t.classList.contains('eb-answer-sel')) {
            M.setCell(q, 'answer', t.value);
            ExamBuilder.touch();
            return;
        }
        // A finished edit of a choice in the sheet: refresh the row so the Answer list shows the new text.
        if (inSheet && /^o\d$/.test(t.dataset.col || '')) {
            const sel = t.closest('tr').querySelector('.eb-answer-sel');
            if (sel && q.type === 'mc') {
                sel.innerHTML = '<option value="">- pick -</option>' + q.options.map((o, k) => (o.trim()
                    ? `<option value="${M.letter(k)}" ${q.correct === k ? 'selected' : ''}>${M.letter(k)}: ${esc(o.trim().slice(0, 18))}</option>` : '')).join('');
            }
        }
    },

    toggleTypes: (open) => {
        const r = ExamBuilder.root;
        const m = r && r.querySelector('#ebFabMenu');
        if (!m) return;
        m.classList.toggle('hidden', !open);
        m.classList.toggle('flex', open);
        r.querySelector('#ebFabBackdrop').classList.toggle('hidden', !open);
        const f = r.querySelector('#ebFab');
        f.setAttribute('aria-expanded', open ? 'true' : 'false');
        r.querySelector('#ebFabIcon').style.transform = open ? 'rotate(45deg)' : '';
        if (open) { const b = m.querySelector('.eb-add'); if (b) b.focus(); }
        else if (m.contains(document.activeElement)) f.focus();
    },

    onKeydown: (e) => {
        const s = ExamBuilder.s;
        if (s && e.key === 'Escape') {
            const m = ExamBuilder.root.querySelector('#ebFabMenu');
            if (m && !m.classList.contains('hidden')) { e.stopPropagation(); ExamBuilder.toggleTypes(false); return; }
        }
        if (!s || e.key !== 'Enter' || e.shiftKey) return;
        const t = e.target;
        if (t.classList && t.classList.contains('eb-item')) {
            // Enter in an enumeration item moves to the next item, or adds one after the last.
            e.preventDefault();
            const q = ExamBuilder.qOf(t);
            const k = parseInt(t.dataset.i, 10);
            if (!q) return;
            if (k >= q.items.length - 1) {
                if (q.items.length >= M.MAX_ITEMS) return;
                q.items.push('');
                ExamBuilder.touch();
                ExamBuilder.refreshCard(q.id, `.eb-item[data-i="${q.items.length - 1}"]`);
            } else {
                t.closest('.eb-card').querySelector(`.eb-item[data-i="${k + 1}"]`)?.focus();
            }
            return;
        }
        if (t.classList && t.classList.contains('eb-pair')) {
            e.preventDefault();
            const q = ExamBuilder.qOf(t);
            const k = parseInt(t.dataset.i, 10);
            if (!q) return;
            if (t.dataset.side === 'l') {
                t.closest('.eb-card').querySelector(`.eb-pair[data-i="${k}"][data-side="r"]`)?.focus();
            } else if (k >= q.pairs.length - 1) {
                if (q.pairs.length >= M.MAX_PAIRS) return;
                q.pairs.push({ l: '', r: '' });
                ExamBuilder.touch();
                ExamBuilder.refreshCard(q.id, `.eb-pair[data-i="${q.pairs.length - 1}"][data-side="l"]`);
            } else {
                t.closest('.eb-card').querySelector(`.eb-pair[data-i="${k + 1}"][data-side="l"]`)?.focus();
            }
            return;
        }
        if (s.view !== 'sheet') return;
        const col = t.dataset && t.dataset.col;
        if (!col || t.tagName === 'SELECT') return;
        e.preventDefault();
        const row = t.closest('tr');
        const next = row && row.nextElementSibling;
        const cell = next && next.querySelector(`[data-col="${col}"]:not([disabled])`);
        if (cell) cell.focus();
    },

    // ---------- Full-screen cell editor (touch screens, spreadsheet view) ----------
    // The cells are small, so on a phone the keyboard covers what you are typing. Tapping a text cell opens
    // a full-screen box with the same text; every keystroke is copied back into the cell.

    cellTarget: null,
    editorSkip: 0,

    onCellFocus: (e) => {
        const s = ExamBuilder.s, t = e.target;
        if (!s || s.view !== 'sheet' || !t.matches || !t.matches('#ebSheet input[type="text"][data-col], #ebSheet textarea[data-col]')) return;
        if (t.disabled || Date.now() < ExamBuilder.editorSkip || !window.matchMedia('(pointer: coarse)').matches) return;
        ExamBuilder.openCellEditor(t);
    },

    cellLabel: (cell) => {
        return cell.getAttribute('aria-label') || cell.dataset.col;
    },

    openCellEditor: (cell) => {
        const root = ExamBuilder.root;
        let ed = root.querySelector('#ebCellEditor');
        if (!ed) {
            ed = document.createElement('div');
            ed.id = 'ebCellEditor';
            ed.className = 'fixed inset-0 z-[90] bg-white flex flex-col w-full max-w-full overflow-hidden';
            ed.setAttribute('role', 'dialog');
            ed.setAttribute('aria-modal', 'true');
            ed.innerHTML = `
                <div class="flex items-center gap-1 px-2 py-2 border-b border-gray-200 min-w-0">
                    <button type="button" id="closeEbCellEditor" aria-label="Close" class="shrink-0 w-10 h-10 rounded text-gray-600 hover:bg-gray-100"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
                    <select id="ebCellQ" aria-label="Go to question" class="shrink-0 h-10 w-[4.5rem] px-1 rounded-md border border-gray-300 bg-gray-50 text-sm font-black text-indigo-700"></select>
                    <select id="ebCellCol" aria-label="Go to field" class="flex-1 min-w-0 h-10 px-1 rounded-md border border-gray-300 bg-gray-50 text-sm font-bold text-gray-800 truncate"></select>
                    <h3 id="ebCellTitle" class="sr-only"></h3>
                    <button type="button" id="ebCellPrev" aria-label="Previous field" class="shrink-0 w-8 h-10 rounded text-gray-600 hover:bg-gray-100"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                    <button type="button" id="ebCellNext" aria-label="Next field" class="shrink-0 w-8 h-10 rounded text-gray-600 hover:bg-gray-100"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                    <button type="button" id="ebCellDone" aria-label="Done" class="shrink-0 w-11 h-10 rounded-md bg-indigo-600 text-white"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
                </div>
                <div id="ebCellExtras" class="px-3 py-2 border-b border-gray-200 space-y-2 bg-gray-50"></div>
                <textarea id="ebCellText" class="flex-1 w-full p-4 text-base outline-none resize-none" aria-labelledby="ebCellTitle"></textarea>`;
            root.appendChild(ed);
            ed.addEventListener('click', (ev) => {
                if (ev.target.closest('#closeEbCellEditor') || ev.target.closest('#ebCellDone')) ExamBuilder.closeCellEditor();
                else if (ev.target.closest('#ebCellPrev')) ExamBuilder.stepCell(-1);
                else if (ev.target.closest('#ebCellNext')) ExamBuilder.stepCell(1);
            });
            ed.addEventListener('click', (ev) => ExamBuilder.onEditorPick(ev));
            ed.querySelector('#ebCellQ').addEventListener('change', (ev) => ExamBuilder.gotoQuestion(parseInt(ev.target.value, 10)));
            ed.querySelector('#ebCellCol').addEventListener('change', (ev) => {
                const cur = ExamBuilder.cellTarget;
                const next = cur && ExamBuilder.rowFields(cur)[parseInt(ev.target.value, 10)];
                if (!next) return;
                ExamBuilder.onChange({ target: cur });
                ExamBuilder.openCellEditor(next);
            });
            ed.querySelector('#ebCellText').addEventListener('input', (ev) => {
                const c = ExamBuilder.cellTarget;
                if (!c) return;
                c.value = ev.target.value;
                c.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        ExamBuilder.cellTarget = cell;
        cell.blur();
        ed.classList.remove('hidden');
        ed.querySelector('#ebCellTitle').textContent = ExamBuilder.cellLabel(cell);
        const rows = [...root.querySelectorAll('#ebSheet tbody tr')];
        const here = rows.indexOf(cell.closest('tr'));
        ed.querySelector('#ebCellQ').innerHTML = rows.map((_, i) => `<option value="${i}" ${i === here ? 'selected' : ''}>Q${i + 1}</option>`).join('');
        ExamBuilder.renderEditorExtras();
        ed.querySelector('#ebCellCol').innerHTML = ExamBuilder.rowFields(cell).map((f, i) => `<option value="${i}" ${f === cell ? 'selected' : ''}>${esc(ExamBuilder.cellLabel(f))}</option>`).join('');
        const ta = ed.querySelector('#ebCellText');
        ta.value = cell.value;
        ta.placeholder = cell.placeholder || '';
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
        window.scrollTo(0, 0);
    },

    // Jump to another question (same field when it can be edited there, otherwise the Question text).
    gotoQuestion: (idx) => {
        const cur = ExamBuilder.cellTarget;
        if (!cur) return;
        const rows = [...ExamBuilder.root.querySelectorAll('#ebSheet tbody tr')];
        const row = rows[idx];
        if (!row) return;
        ExamBuilder.onChange({ target: cur });
        const col = cur.dataset.col;
        const pick = row.querySelector(`input[type="text"][data-col="${col}"]:not([disabled]), textarea[data-col="${col}"]:not([disabled])`) || row.querySelector('textarea[data-col="text"]');
        if (pick) ExamBuilder.openCellEditor(pick);
    },

    // Answer picker and Bonus Yes/No for the question being edited.
    renderEditorExtras: () => {
        const box = ExamBuilder.root.querySelector('#ebCellExtras');
        const cell = ExamBuilder.cellTarget;
        const q = cell && ExamBuilder.qOf(cell);
        if (!box || !q) return;
        const btn = (attrs, on, label) => `<button type="button" ${attrs} aria-pressed="${on}" class="min-h-[40px] px-3 rounded-md border text-sm font-bold ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-700'}">${label}</button>`;
        let answer = '';
        if (q.type === 'mc' || q.type === 'multi') {
            const chosen = q.type === 'mc' ? (q.correct >= 0 ? [q.correct] : []) : q.corrects;
            const chips = q.options.map((o, k) => (o.trim() ? btn(`data-pick="${k}"`, chosen.includes(k), `${M.letter(k)}<span class="font-normal"> ${esc(o.trim().slice(0, 14))}</span>`) : '')).join('');
            answer = `<div><p class="text-[11px] font-bold text-gray-500 uppercase">Correct answer${q.type === 'multi' ? ' (tick all)' : ''}</p><div class="flex flex-wrap gap-2 mt-1">${chips || '<span class="text-xs text-gray-500">Type the choices first.</span>'}</div></div>`;
        } else if (q.type === 'tf') {
            answer = `<div><p class="text-[11px] font-bold text-gray-500 uppercase">Correct answer</p><div class="flex gap-2 mt-1">${btn('data-tf="True"', q.tf === 'True', 'True')}${btn('data-tf="False"', q.tf === 'False', 'False')}</div></div>`;
        }
        const bonus = `<div class="flex items-center gap-2"><span class="text-[11px] font-bold text-gray-500 uppercase">Bonus</span>${btn('data-bonus="yes"', !!q.bonus, 'Yes')}${btn('data-bonus="no"', !q.bonus, 'No')}</div>`;
        box.innerHTML = answer + bonus;
    },

    onEditorPick: (ev) => {
        const cell = ExamBuilder.cellTarget;
        const q = cell && ExamBuilder.qOf(cell);
        const b = ev.target.closest && ev.target.closest('[data-pick], [data-tf], [data-bonus]');
        if (!q || !b) return;
        const row = cell.closest('tr');
        if (b.dataset.bonus) {
            q.bonus = b.dataset.bonus === 'yes';
            const cb = row.querySelector('.eb-bonus');
            if (cb) cb.checked = q.bonus;
            ExamBuilder.updateCount();
        } else if (b.dataset.tf) {
            M.setCell(q, 'answer', b.dataset.tf);
        } else {
            const k = parseInt(b.dataset.pick, 10);
            if (q.type === 'mc') q.correct = q.correct === k ? -1 : k;
            else q.corrects = q.corrects.includes(k) ? q.corrects.filter(i => i !== k) : [...q.corrects, k];
        }
        ExamBuilder.touch();
        // keep the sheet's own Answer cell in step
        const ans = row.querySelector('[data-col="answer"]');
        if (ans) {
            if (ans.tagName === 'SELECT') {
                if (q.type === 'mc') ans.innerHTML = '<option value="">- pick -</option>' + q.options.map((o, i) => (o.trim() ? `<option value="${M.letter(i)}" ${q.correct === i ? 'selected' : ''}>${M.letter(i)}: ${esc(o.trim().slice(0, 18))}</option>` : '')).join('');
                else ans.value = q.tf;
            } else ans.value = M.cellText(q, 'answer');
        }
        ExamBuilder.renderEditorExtras();
    },

    closeCellEditor: () => {
        const ed = ExamBuilder.root && ExamBuilder.root.querySelector('#ebCellEditor');
        const cell = ExamBuilder.cellTarget;
        ExamBuilder.cellTarget = null;
        if (ed) ed.classList.add('hidden');
        if (cell && cell.isConnected) {
            ExamBuilder.editorSkip = Date.now() + 400;      // focusing the cell again must not reopen the editor
            ExamBuilder.onChange({ target: cell });
            cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    },

    // The text fields of a row that can be typed into (Question, Choice A.., Explanation), left to right.
    rowFields: (cell) => [...cell.closest('tr').querySelectorAll('input[type="text"][data-col]:not([disabled]), textarea[data-col]:not([disabled])')].filter(c => c.dataset.col !== 'points'),

    // Previous / next text field in the same row (Question, Choice A, B, ... Explanation).
    stepCell: (dir) => {
        const cur = ExamBuilder.cellTarget;
        if (!cur) return;
        const cells = ExamBuilder.rowFields(cur);
        const next = cells[cells.indexOf(cur) + dir];
        if (!next) return;
        ExamBuilder.onChange({ target: cur });
        ExamBuilder.openCellEditor(next);
    },

    // Pasting rows copied from a spreadsheet: fills cells to the right and rows downward.
    onPaste: (e) => {
        ExamBuilder.finishRender();
        const s = ExamBuilder.s;
        if (!s || s.view !== 'sheet') return;
        const t = e.target;
        const col = t.dataset && t.dataset.col;
        if (!col) return;
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return;   // one plain value: normal paste
        e.preventDefault();
        const q = ExamBuilder.qOf(t);
        if (!q) return;

        const rows = M.parsePaste(text).filter(r => r.some(c => c !== ''));
        const startRow = s.questions.indexOf(q);
        const startCol = M.COLUMNS.indexOf(col);
        rows.forEach((cells, r) => {
            let target = s.questions[startRow + r];
            if (!target) {
                const last = s.questions[s.questions.length - 1];
                target = M.blankQuestion('mc', last ? last.part : 0);
                s.questions.push(target);
            }
            cells.forEach((value, c) => {
                const name = M.COLUMNS[startCol + c];
                if (name) M.setCell(target, name, value);
            });
        });
        ExamBuilder.touch();
        ExamBuilder.renderBody();
        UI.success(`Pasted ${rows.length} row${rows.length === 1 ? '' : 's'}`);
    },

    // ---------- CSV ----------

    // Reads the first sheet of an Excel file as CSV text. The reader library loads only when an Excel file is picked.
    excelToCsv: async (file) => {
        if (!window.XLSX) {
            await new Promise((resolve, reject) => {
                const tag = document.createElement('script');
                tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                tag.onload = resolve;
                tag.onerror = () => reject(new Error('The Excel reader could not be loaded. Check your connection, or save the sheet as CSV and import that.'));
                document.head.appendChild(tag);
            });
        }
        const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = book.Sheets[book.SheetNames[0]];
        if (!sheet) return '';
        return window.XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    },

    importCsv: async (file) => {
        const s = ExamBuilder.s;
        if (!s) return;
        try {
            const text = /\.xlsx?$/i.test(file.name) ? await ExamBuilder.excelToCsv(file) : await file.text();
            const { questions, skipped } = M.fromCsvText(text);
            if (!questions.length) {
                UI.error('No questions found in that file. Use Export CSV for the right columns.');
                return;
            }
            const onlyBlank = s.questions.length === 1 && !s.questions[0].text.trim();
            s.questions = onlyBlank ? questions : s.questions.concat(questions);
            if (!s.title.trim()) s.title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
            ExamBuilder.touch();
            ExamBuilder.renderShell();
            ExamBuilder.renderBody();
            UI.success(`Imported ${questions.length} question${questions.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} empty row${skipped === 1 ? '' : 's'}` : ''}. Check them, then save.`);
        } catch (err) {
            UI.error(err && err.message && /Excel reader/.test(err.message) ? err.message : 'Could not read that file.');
        }
    },

    exportCsv: () => {
        const s = ExamBuilder.s;
        if (!s || !s.questions.length) { UI.error('There are no questions to export yet.'); return; }
        const name = (s.title.trim() || 'exam').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'exam';
        ExamBuilder.download(`${name}.csv`, M.toCsv(s.questions));
    },

    // The sample file shown in Manage Exams: one example of every question type.
    downloadTemplate: () => {
        const mc = M.blankQuestion('mc', 0);
        mc.text = 'What does CPU stand for?';
        mc.options = ['Central Processing Unit', 'Control Processing Unit', 'Computer Personal Unit', 'Central Power Unit'];
        mc.correct = 0;
        mc.expl = 'The CPU is the main processor of a computer.';
        const tf = M.blankQuestion('tf', 1);
        tf.text = 'The binary number system uses only 0 and 1.';
        tf.tf = 'True';
        tf.expl = 'Binary is a base-2 system.';
        const id = M.blankQuestion('id', 2);
        id.text = 'Name the protocol used for secure web traffic (abbreviation).';
        id.answer = 'HTTPS';
        const en = M.blankQuestion('enum', 3);
        en.text = 'List the three primary colors of light.';
        en.items = ['Red', 'Green', 'Blue'];
        en.expl = 'Each correct item is worth 1 point, in any order.';
        const eo = M.blankQuestion('enum', 3);
        eo.text = 'List the first three planets from the Sun, in order.';
        eo.items = ['Mercury', 'Venus', 'Earth'];
        eo.ordered = true;
        const multi = M.blankQuestion('multi', 1);
        multi.text = 'Which of these are programming languages?';
        multi.options = ['Python', 'HTML', 'Java', 'Excel'];
        multi.corrects = [0, 2];
        multi.points = '2';
        multi.expl = 'Partial credit: wrong ticks take points away.';
        const num = M.blankQuestion('num', 2);
        num.text = 'What is the acceleration due to gravity in m/s^2 (nearest tenth)?';
        num.answer = '9.8';
        num.tol = '0.1';
        const alt = M.blankQuestion('id', 2);
        alt.text = 'What does the "P" in CPU stand for?';
        alt.answer = 'Processing / Processor';
        const order = M.blankQuestion('order', 3);
        order.text = 'Put the software development steps in order.';
        order.items = ['Plan', 'Design', 'Build', 'Test', 'Deploy'];
        const match = M.blankQuestion('match', 3);
        match.text = 'Match each device to its job.';
        match.pairs = [{ l: 'Keyboard', r: 'Input' }, { l: 'Monitor', r: 'Output' }, { l: 'SSD', r: 'Storage' }];
        match.extra = ['Power'];
        const essay = M.blankQuestion('essay', 4);
        essay.text = 'Explain in a few sentences why backups matter.';
        essay.answer = 'Mentions data loss, recovery and keeping copies in another place.';
        essay.points = '10';
        const bonus = M.blankQuestion('mc', 0);
        bonus.text = 'BONUS: Which company created JavaScript?';
        bonus.options = ['Netscape', 'Microsoft', 'Sun Microsystems', 'IBM'];
        bonus.correct = 0;
        bonus.bonus = true;
        ExamBuilder.download('exam_template.csv', M.toCsv([mc, tf, id, alt, en, eo, multi, num, order, match, essay, bonus]));
    },

    download: (filename, text) => downloadCsv(filename, text),

    // ---------- Save ----------

    showProblems: (problems) => {
        ExamBuilder.finishRender();
        const firstProblem = problems.find(p => p.id);
        if (firstProblem) ExamBuilder.openCard(firstProblem.id, true);
        const box = ExamBuilder.root.querySelector('#ebAlert');
        if (!problems.length) { box.classList.add('hidden'); box.textContent = ''; return; }
        box.innerHTML = problems.slice(0, 6).map(p => `<div>${esc(p.message)}</div>`).join('') + (problems.length > 6 ? `<div>...and ${problems.length - 6} more.</div>` : '');
        box.classList.remove('hidden');
        ExamBuilder.root.querySelectorAll('.eb-card, .eb-row').forEach(el => el.classList.remove('ring-2', 'ring-red-400', 'bg-red-50'));
        problems.forEach(p => {
            if (!p.id) return;
            ExamBuilder.root.querySelector(`[data-qid="${p.id}"]`)?.classList.add('ring-2', 'ring-red-400');
        });
        const first = problems.find(p => p.id);
        if (first) ExamBuilder.root.querySelector(`[data-qid="${first.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else ExamBuilder.root.querySelector('#ebTitle')?.focus();
    },

    // The same information as Link & Assign Students, filled in while creating the exam.
    linkButton: () => {
        const l = ExamBuilder.s.link;
        if (!l) return '';
        return `<button type="button" id="ebLinkBtn" aria-expanded="${ExamBuilder.s.linkOpen ? 'true' : 'false'}" aria-controls="ebLinkPanel" class="whitespace-nowrap px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-pen-to-square mr-1" aria-hidden="true"></i>Record Scores<span id="ebLinkState" class="${l.enabled ? '' : 'hidden'} ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] leading-none align-middle">ON</span></button>`;
    },
    toggleLink: () => {
        const s = ExamBuilder.s;
        s.linkOpen = !s.linkOpen;
        const p = ExamBuilder.root.querySelector('#ebLinkPanel');
        if (p) p.classList.toggle('hidden', !s.linkOpen);
        ExamBuilder.root.querySelector('#ebLinkBtn').setAttribute('aria-expanded', s.linkOpen ? 'true' : 'false');
    },
    linkPanel: () => {
        const l = ExamBuilder.s.link;
        if (!l) return '';
        const opt = (v, label, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
        const cats = [['MajorExam', 'Major Exam'], ['Written', 'Written (Quiz/Long)'], ['Narrative', 'Written (Narrative)'], ['Individual', 'Written (Individual)'], ['Performance', 'Performance (Task)'], ['Report', 'Performance (Report)']];
        const lab = 'block text-[10px] font-bold text-indigo-700 uppercase mb-1';
        const inp = 'w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-bold';
        return `
            <div id="ebLinkPanel" class="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg ${ExamBuilder.s.linkOpen ? '' : 'hidden'}">
                <div class="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label class="sm:col-span-2 lg:col-span-3 flex items-center gap-2 text-xs font-black text-indigo-900 cursor-pointer"><input type="checkbox" id="ebLinkOn" class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" ${l.enabled ? 'checked' : ''}> Link &amp; enable for this class and record the scores</label>
                    <div><label class="${lab}" for="ebLinkTerm">Record scores term</label>
                        <select id="ebLinkTerm" class="${inp}">${opt('MidTerm', 'Mid Term', l.term)}${opt('FinalTerm', 'Final Term', l.term)}</select></div>
                    <div><label class="${lab}" for="ebLinkCategory">Assessment category</label>
                        <select id="ebLinkCategory" class="${inp}">${cats.map(c => opt(c[0], c[1], l.category)).join('')}</select></div>
                    <div><label class="${lab}" for="ebLinkWho">Who can take it</label>
                        <select id="ebLinkWho" class="${inp}">${l.linked ? opt('keep', 'Keep current students', l.audience) : ''}${opt('blind', 'Legally Blind students only', l.audience)}${opt('all', 'All students', l.audience)}</select></div>
                    <div><label class="${lab}" for="ebLinkTime">Time limit (minutes)</label><input type="number" id="ebLinkTime" min="1" max="600" step="1" placeholder="No limit" class="${inp}" value="${esc(l.timeLimit ?? '')}"></div>
                    <div><label class="${lab}" for="ebLinkFrom">Opens (date &amp; time, GMT+8)</label><input type="datetime-local" id="ebLinkFrom" class="${inp}" value="${esc(l.fromDate || '')}"></div>
                    <div><label class="${lab}" for="ebLinkTo">Closes (date &amp; time, GMT+8)</label><input type="datetime-local" id="ebLinkTo" class="${inp}" value="${esc(l.toDate || '')}"></div>
                    <p class="sm:col-span-2 lg:col-span-3 text-[11px] text-indigo-800">The exam title above is the name shown in Record Scores. You can pick individual students later with Link &amp; Assign Students.</p>
                </div>
            </div>`;
    },

    // Keeps the Record Scores panel fields in the builder state.
    onLinkField: (t) => {
        const s = ExamBuilder.s;
        const l = s && s.link;
        if (!l) return false;
        const map = { ebLinkTime: 'timeLimit', ebLinkOn: 'enabled', ebLinkTerm: 'term', ebLinkCategory: 'category', ebLinkWho: 'audience', ebLinkFrom: 'fromDate', ebLinkTo: 'toDate' };
        const key = map[t.id];
        if (!key) return false;
        l[key] = t.id === 'ebLinkOn' ? t.checked : t.value;
        if (t.id === 'ebLinkOn') {
            const st = ExamBuilder.root.querySelector('#ebLinkState');
            if (st) st.classList.toggle('hidden', !l.enabled);
        }
        ExamBuilder.touch();
        return true;
    },

    save: async () => {
        const s = ExamBuilder.s;
        if (!s || s.saving) return;
        const problems = M.validate(s.title, s.questions);
        ExamBuilder.showProblems(problems);
        if (problems.length) return;

        const btn = ExamBuilder.root.querySelector('#ebSaveBtn');
        s.saving = true;
        ExamBuilder.setNote('saving');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span class="hidden sm:inline ml-1.5">Saving...</span>';
        try {
            const examData = s.questions.map(M.toRow);
            let savedId = s.examId;
            if (s.examId) {
                await apiFetch('/api/exams/update', {
                    method: 'POST',
                    body: JSON.stringify({ examId: s.examId, title: s.title.trim(), course: s.course.trim(), examData })
                });
            } else {
                const made = await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: s.title.trim(), course: s.course.trim(), examData })
                });
                savedId = made && made.examId;
            }
            store.del(draftKey(s.examId));
            s.dirty = false;
            const done = s.onSaved;
            ExamBuilder.close(true);
            UI.success('Exam saved');
            if (done) await done({ examId: savedId, link: s.link && s.link.enabled ? s.link : null });
        } catch (err) {
            s.saving = false;
            btn.disabled = false;
            btn.innerHTML = SAVE_HTML;
            ExamBuilder.showProblems([{ id: null, message: err.message || 'Could not save the exam. Try again.' }]);
        }
    }
};
