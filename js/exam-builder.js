// js/exam-builder.js
// Full-screen Exam Builder: write an exam like a Google Form (Form view) or like a spreadsheet (Sheet view).
// Both views edit the same questions. It saves in the existing exam format through /api/exams and /api/exams/update.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import * as M from './exam-builder-model.js';

const ROOT_ID = 'examBuilderModal';
const VIEW_KEY = 'exam_builder_view';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
};

const draftKey = (examId) => `exam_builder_draft_${AppState.user ? AppState.user.User_ID : ''}_${examId || 'new'}`;

const ADD_LABEL = { mc: 'Multiple choice', multi: 'Multi-answer', tf: 'T/F', id: 'Identification', num: 'Numeric', enum: 'Enumeration', order: 'Ordering', match: 'Matching', essay: 'Essay' };

const INPUT = 'w-full border-0 border-b border-gray-300 focus:border-indigo-500 focus:ring-0 outline-none px-1 py-1.5 text-sm bg-transparent';
const CELL = 'eb-cell w-full px-2 py-1.5 text-xs border border-transparent focus:border-indigo-500 focus:bg-white bg-transparent outline-none rounded-none disabled:bg-gray-100 disabled:text-gray-300';

export const ExamBuilder = {
    s: null,
    root: null,
    draftTimer: null,

    // ---------- Open / close ----------

    // options: { examId?, title?, onSaved?, classLink? }  classLink: { enabled, term, category, fromDate, toDate, audience, linked } shows the Record Scores panel
    open: async (options = {}) => {
        const root = ExamBuilder.mount();
        ExamBuilder.s = {
            examId: options.examId || null,
            title: options.title || '',
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
                if (d && Array.isArray(d.questions) && d.questions.length && window.confirm('You have an unsaved draft of this exam on this device. Restore it?')) {
                    s.title = d.title || s.title;
                    s.questions = d.questions;
                    s.dirty = true;
                } else {
                    store.del(draftKey(s.examId));
                }
            } catch (e) { store.del(draftKey(s.examId)); }
        }

        ExamBuilder.renderShell();
        ExamBuilder.renderBody();
    },

    close: (force = false) => {
        const s = ExamBuilder.s;
        if (!force && s && s.dirty && !window.confirm('Close without saving? Your changes stay as a draft on this device.')) return;
        ExamBuilder.flushDraft();
        if (ExamBuilder.root) ExamBuilder.root.classList.add('hidden');
        ExamBuilder.s = null;
    },

    // ---------- Draft ----------

    touch: () => {
        const s = ExamBuilder.s;
        if (!s) return;
        s.dirty = true;
        clearTimeout(ExamBuilder.draftTimer);
        ExamBuilder.draftTimer = setTimeout(ExamBuilder.flushDraft, 600);
    },

    flushDraft: () => {
        clearTimeout(ExamBuilder.draftTimer);
        const s = ExamBuilder.s;
        if (!s || !s.dirty || s.saving) return;
        store.set(draftKey(s.examId), JSON.stringify({ title: s.title, questions: s.questions, t: Date.now() }));
    },

    // ---------- Shell ----------

    mount: () => {
        if (ExamBuilder.root && ExamBuilder.root.isConnected) return ExamBuilder.root;
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.className = 'hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0';
        document.body.appendChild(root);
        root.addEventListener('click', ExamBuilder.onClick);
        root.addEventListener('input', ExamBuilder.onInput);
        root.addEventListener('change', ExamBuilder.onChange);
        root.addEventListener('paste', ExamBuilder.onPaste);
        root.addEventListener('keydown', ExamBuilder.onKeydown);
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
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeExamBuilderBg"></div>
            <div class="bg-white rounded-none shadow-xl w-full h-full relative z-10 sheet-panel app-page flex flex-col overflow-hidden" id="ebPanel">
                <div class="flex items-center gap-3 px-4 py-3 border-b app-page-header shrink-0">
                    <h3 class="text-lg font-bold text-gray-800 flex-1 min-w-0 truncate"><i class="fa-solid fa-wand-magic-sparkles text-indigo-600 mr-2" aria-hidden="true"></i>${s.examId ? 'Edit Exam' : 'Create Exam'}</h3>
                    <button type="button" id="closeExamBuilderBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="px-4 pt-3 pb-2 shrink-0 bg-white border-b">
                    <input type="text" id="ebTitle" maxlength="120" value="${esc(s.title)}" placeholder="Exam title (this is the name in Record Scores)" aria-label="Exam title" class="w-full text-lg font-bold border-0 border-b-2 border-gray-300 focus:border-indigo-600 focus:ring-0 outline-none px-1 py-1.5 bg-transparent">
                    ${ExamBuilder.linkPanel()}
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <div class="flex w-full sm:w-auto bg-gray-100 rounded-lg p-1" role="group" aria-label="Builder view">
                            ${tab('form', 'fa-list-check', 'Form')}
                            ${tab('sheet', 'fa-table', 'Spreadsheet')}
                        </div>
                        <span id="ebCount" class="text-xs font-bold text-gray-500"></span>
                        <div class="ml-auto flex items-center gap-1.5">
                            <button type="button" id="ebImportBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-import mr-1" aria-hidden="true"></i>Import CSV / Excel</button>
                            <button type="button" id="ebTemplateBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-download mr-1" aria-hidden="true"></i>Template</button>
                            <button type="button" id="ebExportBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-export mr-1" aria-hidden="true"></i>Export CSV</button>
                            <input type="file" id="ebCsvInput" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="hidden">
                        </div>
                    </div>
                    ${s.examId ? '<p class="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Editing changes the exam for students who have not taken it yet. Scores already recorded are not recalculated.</p>' : ''}
                    <div id="ebAlert" class="hidden mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700" role="alert"></div>
                </div>
                <div id="ebBody" class="flex-1 min-h-0 overflow-auto bg-indigo-50/60 p-3 sm:p-4"></div>
                <div class="shrink-0 border-t bg-white px-3 py-2 flex flex-wrap items-center gap-2" style="padding-bottom:max(0.5rem,env(safe-area-inset-bottom))">
                    <div class="flex-1 min-w-0"></div>
                    <button type="button" id="ebSaveBtn" class="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-md text-sm font-bold shadow-sm transition disabled:opacity-50"><i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save exam</button>
                </div>
                <button type="button" id="ebFab" aria-label="Add question" aria-haspopup="dialog" class="absolute right-5 w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 flex justify-center items-center focus:outline-none focus-visible:ring-4 ring-purple-300 transition-colors z-20" style="bottom:calc(4.5rem + env(safe-area-inset-bottom))"><i class="fa-solid fa-plus text-2xl" aria-hidden="true"></i></button>
                <div id="ebTypeModal" class="hidden absolute inset-0 z-30 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Choose question type">
                    <div class="absolute inset-0 bg-gray-900 bg-opacity-50" id="closeEbTypeBg"></div>
                    <div class="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-lg shadow-xl max-h-full overflow-y-auto">
                        <div class="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
                            <h4 class="font-bold text-gray-800">Add question</h4>
                            <button type="button" id="closeEbTypeBtn" aria-label="Close" class="text-gray-400 hover:text-gray-800"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                            ${M.TYPES.map(t => `<button type="button" data-add="${t.id}" class="eb-add flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold text-center transition"><i class="fa-solid ${t.icon} text-xl" aria-hidden="true"></i>${ADD_LABEL[t.id] || t.label}</button>`).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
    },

    updateCount: () => {
        const s = ExamBuilder.s;
        const el = ExamBuilder.root && ExamBuilder.root.querySelector('#ebCount');
        if (!s || !el) return;
        const bonus = s.questions.filter(q => q.bonus).length;
        const regular = s.questions.length - bonus;
        const points = s.questions.filter(q => !q.bonus).reduce((sum, q) => sum + M.pointsOf(q), 0);
        el.textContent = `${regular} question${regular === 1 ? '' : 's'}${points !== regular ? ` (${points} points)` : ''}${bonus ? ` + ${bonus} bonus` : ''}`;
    },

    renderBody: (focusSel) => {
        const s = ExamBuilder.s;
        const body = ExamBuilder.root.querySelector('#ebBody');
        body.innerHTML = s.view === 'sheet' ? ExamBuilder.sheetHtml() : ExamBuilder.formHtml();
        ExamBuilder.updateCount();
        if (focusSel) {
            const el = body.querySelector(focusSel);
            if (el) {
                el.focus();
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    },

    // ---------- Form view ----------

    formHtml: () => {
        const s = ExamBuilder.s;
        if (s.questions.length === 0) {
            return '<div class="text-center text-sm text-gray-500 py-10">No questions yet. Tap the + button to add one.</div>';
        }
        return `<div class="max-w-2xl mx-auto space-y-3" id="ebCards">${s.questions.map((q, i) => ExamBuilder.cardHtml(q, i)).join('')}</div>`;
    },

    cardHtml: (q, i) => {
        const s = ExamBuilder.s;
        const typeOptions = M.TYPES.map(t => `<option value="${t.id}" ${q.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('');
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
                    <span class="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">Q${i + 1}</span>
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
                </div>
                <textarea rows="2" class="eb-field w-full border border-gray-200 focus:border-indigo-500 focus:ring-0 outline-none rounded-md px-2 py-2 text-sm bg-gray-50 focus:bg-white" data-col="text" placeholder="Question" aria-label="Question">${esc(q.text)}</textarea>
                ${answerArea}
                <input type="text" class="${INPUT} eb-field mt-3 text-xs" data-col="expl" value="${esc(q.expl)}" placeholder="Explanation shown after the answer (optional)" aria-label="Explanation">
                <div class="mt-2 pt-2 border-t border-gray-100 flex items-center justify-end gap-1 text-gray-500">
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

    sheetHtml: () => {
        const s = ExamBuilder.s;
        const head = ['#', 'Part', 'Type', 'Question', ...Array.from({ length: M.MAX_OPTIONS }, (_, k) => `Choice ${M.letter(k)}`), 'Answer', 'Explanation', 'Bonus', 'Points', ''];
        const widths = ['w-10', 'w-16', 'w-44', 'min-w-[260px]', ...Array(M.MAX_OPTIONS).fill('min-w-[130px]'), 'min-w-[200px]', 'min-w-[180px]', 'w-14', 'w-16', 'w-20'];
        return `
            <p class="text-[11px] text-gray-500 mb-2">Type straight into the cells. Copy rows from Excel or Google Sheets and paste them into any cell: they fill to the right and down, and add rows as needed. Enter moves down. Choice A-H hold the choices; for Matching type each pair as <b>left | right</b> (wrong extra choices go in Answer, separated by |). Answer: a letter for multiple choice, letters like <b>A, C</b> for multiple answer, items separated by | for enumeration and ordering, <b>9.8 ± 0.1</b> for numeric. Use " / " for alternative answers. Leave Points empty for the default.</p>
            <div class="bg-white border border-gray-300 rounded-md overflow-auto">
                <table class="border-collapse text-xs" id="ebSheet">
                    <thead class="sticky top-0 z-10">
                        <tr>${head.map((h, k) => `<th class="${widths[k]} bg-gray-100 border border-gray-300 px-2 py-1.5 text-left font-bold text-gray-600 whitespace-nowrap">${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody>${s.questions.map((q, i) => ExamBuilder.rowHtml(q, i)).join('')}</tbody>
                </table>
            </div>`;
    },

    rowHtml: (q, i) => {
        const s = ExamBuilder.s;
        const typeOptions = M.SHEET_TYPES.map(t => `<option value="${t.key}" ${M.typeKey(q) === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
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
                <td class="border border-gray-200 bg-gray-50 text-center font-bold text-gray-500 px-1">${i + 1}</td>
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
        s.questions.splice(index, 0, q);
        ExamBuilder.touch();
        ExamBuilder.renderBody(`[data-qid="${q.id}"] [data-col="text"]`);
    },

    onClick: async (e) => {
        const s = ExamBuilder.s;
        if (!s) return;
        const t = e.target;

        if (t.closest('#closeExamBuilderBtn') || t.id === 'closeExamBuilderBg') { ExamBuilder.close(); return; }
        if (t.closest('#ebSaveBtn')) { await ExamBuilder.save(); return; }
        if (t.closest('#ebImportBtn')) { ExamBuilder.root.querySelector('#ebCsvInput').click(); return; }
        if (t.closest('#ebExportBtn')) { ExamBuilder.exportCsv(); return; }
        if (t.closest('#ebTemplateBtn')) { ExamBuilder.downloadTemplate(); return; }
        if (t.closest('#ebFab')) { ExamBuilder.toggleTypes(true); return; }
        if (t.closest('#closeEbTypeBtn') || t.id === 'closeEbTypeBg') { ExamBuilder.toggleTypes(false); return; }

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

        const actBtn = t.closest('.eb-act');
        if (actBtn) {
            const act = actBtn.dataset.act;
            if (act === 'del') {
                const hasContent = q.text.trim() || q.answer.trim() || q.options.some(o => o.trim()) || q.items.some(o => o.trim()) || q.pairs.some(p => p.l.trim() || p.r.trim());
                if (hasContent && !window.confirm(`Delete question ${i + 1}?`)) return;
                s.questions.splice(i, 1);
                ExamBuilder.touch();
                ExamBuilder.renderBody();
            } else if (act === 'dup') {
                const copy = JSON.parse(JSON.stringify(q));
                copy.id = M.newId();
                ExamBuilder.insertQuestion(copy, i + 1);
            } else if ((act === 'up' && i > 0) || (act === 'down' && i < s.questions.length - 1)) {
                const j = act === 'up' ? i - 1 : i + 1;
                [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]];
                ExamBuilder.touch();
                ExamBuilder.renderBody(`.eb-card[data-qid="${q.id}"] [data-act="${act}"]`);
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
        const m = ExamBuilder.root && ExamBuilder.root.querySelector('#ebTypeModal');
        if (!m) return;
        m.classList.toggle('hidden', !open);
        if (open) { const b = m.querySelector('.eb-add'); if (b) b.focus(); }
        else { const f = ExamBuilder.root.querySelector('#ebFab'); if (f) f.focus(); }
    },

    onKeydown: (e) => {
        const s = ExamBuilder.s;
        if (s && e.key === 'Escape') {
            const m = ExamBuilder.root.querySelector('#ebTypeModal');
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

    // Pasting rows copied from a spreadsheet: fills cells to the right and rows downward.
    onPaste: (e) => {
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
                UI.error('No questions found in that file. Use the template for the right columns.');
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

    download: (filename, text) => {
        const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ---------- Save ----------

    showProblems: (problems) => {
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
    linkPanel: () => {
        const l = ExamBuilder.s.link;
        if (!l) return '';
        const opt = (v, label, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
        const cats = [['MajorExam', 'Major Exam'], ['Written', 'Written (Quiz/Long)'], ['Narrative', 'Written (Narrative)'], ['Individual', 'Written (Individual)'], ['Performance', 'Performance (Task)'], ['Report', 'Performance (Report)']];
        const lab = 'block text-[10px] font-bold text-indigo-700 uppercase mb-1';
        const inp = 'w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-bold';
        return `
            <details id="ebLinkPanel" class="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg" ${l.enabled ? 'open' : ''}>
                <summary class="px-3 py-2 text-xs font-black text-indigo-900 cursor-pointer select-none"><i class="fa-solid fa-link mr-1" aria-hidden="true"></i>Record Scores &amp; this class <span id="ebLinkState" class="font-medium text-indigo-700">${l.enabled ? '(will be linked when saved)' : '(not linked)'}</span></summary>
                <div class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label class="sm:col-span-2 lg:col-span-3 flex items-center gap-2 text-xs font-black text-indigo-900 cursor-pointer"><input type="checkbox" id="ebLinkOn" class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" ${l.enabled ? 'checked' : ''}> Link &amp; enable for this class and record the scores</label>
                    <div><label class="${lab}" for="ebLinkTerm">Record scores term</label>
                        <select id="ebLinkTerm" class="${inp}">${opt('MidTerm', 'Mid Term', l.term)}${opt('FinalTerm', 'Final Term', l.term)}</select></div>
                    <div><label class="${lab}" for="ebLinkCategory">Assessment category</label>
                        <select id="ebLinkCategory" class="${inp}">${cats.map(c => opt(c[0], c[1], l.category)).join('')}</select></div>
                    <div><label class="${lab}" for="ebLinkWho">Who can take it</label>
                        <select id="ebLinkWho" class="${inp}">${l.linked ? opt('keep', 'Keep current students', l.audience) : ''}${opt('blind', 'Legally Blind students only', l.audience)}${opt('all', 'All students', l.audience)}</select></div>
                    <div><label class="${lab}" for="ebLinkTime">Time limit (minutes)</label><input type="number" id="ebLinkTime" min="1" max="600" step="1" placeholder="No limit" class="${inp}" value="${esc(l.timeLimit ?? '')}"></div>
                    <div><label class="${lab}" for="ebLinkFrom">Available from</label><input type="date" id="ebLinkFrom" class="${inp}" value="${esc(l.fromDate || '')}"></div>
                    <div><label class="${lab}" for="ebLinkTo">Available until</label><input type="date" id="ebLinkTo" class="${inp}" value="${esc(l.toDate || '')}"></div>
                    <p class="sm:col-span-2 lg:col-span-3 text-[11px] text-indigo-800">The exam title above is the name shown in Record Scores. You can pick individual students later with Link &amp; Assign Students.</p>
                </div>
            </details>`;
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
            if (st) st.textContent = l.enabled ? '(will be linked when saved)' : '(not linked)';
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
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true"></i>Saving...';
        try {
            const examData = s.questions.map(M.toRow);
            let savedId = s.examId;
            if (s.examId) {
                await apiFetch('/api/exams/update', {
                    method: 'POST',
                    body: JSON.stringify({ examId: s.examId, title: s.title.trim(), examData })
                });
            } else {
                const made = await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: s.title.trim(), examData })
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
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save exam';
            ExamBuilder.showProblems([{ id: null, message: err.message || 'Could not save the exam. Try again.' }]);
        }
    }
};
