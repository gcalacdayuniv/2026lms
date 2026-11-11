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

const INPUT = 'w-full border-0 border-b border-gray-300 focus:border-indigo-500 focus:ring-0 outline-none px-1 py-1.5 text-sm bg-transparent';
const CELL = 'eb-cell w-full px-2 py-1.5 text-xs border border-transparent focus:border-indigo-500 focus:bg-white bg-transparent outline-none rounded-none disabled:bg-gray-100 disabled:text-gray-300';

export const ExamBuilder = {
    s: null,
    root: null,
    draftTimer: null,

    // ---------- Open / close ----------

    // options: { examId?, title?, onSaved? }
    open: async (options = {}) => {
        const root = ExamBuilder.mount();
        ExamBuilder.s = {
            examId: options.examId || null,
            title: options.title || '',
            view: store.get(VIEW_KEY) === 'sheet' ? 'sheet' : 'form',
            questions: [],
            dirty: false,
            saving: false,
            onSaved: options.onSaved || null
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
        root.className = 'hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4';
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
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full ${s.view === 'sheet' ? 'sm:max-w-7xl' : 'sm:max-w-3xl'} h-full sm:h-[94vh] relative z-10 sheet-panel app-page flex flex-col overflow-hidden" id="ebPanel">
                <div class="flex items-center gap-3 px-4 py-3 border-b app-page-header shrink-0">
                    <h3 class="text-lg font-bold text-gray-800 flex-1 min-w-0 truncate"><i class="fa-solid fa-wand-magic-sparkles text-indigo-600 mr-2" aria-hidden="true"></i>${s.examId ? 'Edit Exam' : 'Create Exam'}</h3>
                    <button type="button" id="closeExamBuilderBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="px-4 pt-3 pb-2 shrink-0 bg-white border-b">
                    <input type="text" id="ebTitle" maxlength="120" value="${esc(s.title)}" placeholder="Exam title (this is the name in Record Scores)" aria-label="Exam title" class="w-full text-lg font-bold border-0 border-b-2 border-gray-300 focus:border-indigo-600 focus:ring-0 outline-none px-1 py-1.5 bg-transparent">
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <div class="flex w-full sm:w-auto bg-gray-100 rounded-lg p-1" role="group" aria-label="Builder view">
                            ${tab('form', 'fa-list-check', 'Form')}
                            ${tab('sheet', 'fa-table', 'Spreadsheet')}
                        </div>
                        <span id="ebCount" class="text-xs font-bold text-gray-500"></span>
                        <div class="ml-auto flex items-center gap-1.5">
                            <button type="button" id="ebImportBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-import mr-1" aria-hidden="true"></i>Import CSV</button>
                            <button type="button" id="ebExportBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-export mr-1" aria-hidden="true"></i>Export CSV</button>
                            <input type="file" id="ebCsvInput" accept=".csv,text/csv" class="hidden">
                        </div>
                    </div>
                    ${s.examId ? '<p class="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Editing changes the exam for students who have not taken it yet. Scores already recorded are not recalculated.</p>' : ''}
                    <div id="ebAlert" class="hidden mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700" role="alert"></div>
                </div>
                <div id="ebBody" class="flex-1 min-h-0 overflow-auto bg-indigo-50/60 p-3 sm:p-4"></div>
                <div class="shrink-0 border-t bg-white px-3 py-2 flex flex-wrap items-center gap-2" style="padding-bottom:max(0.5rem,env(safe-area-inset-bottom))">
                    <div class="flex items-center gap-1.5 flex-1 min-w-0">
                        <span class="text-[11px] font-bold text-gray-500 uppercase hidden sm:inline">Add</span>
                        <button type="button" data-add="mc" class="eb-add px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold transition whitespace-nowrap"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Multiple choice</button>
                        <button type="button" data-add="tf" class="eb-add px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold transition whitespace-nowrap"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>T/F</button>
                        <button type="button" data-add="id" class="eb-add px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold transition whitespace-nowrap"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Identification</button>
                        <button type="button" data-add="enum" class="eb-add px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold transition whitespace-nowrap"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Enumeration</button>
                    </div>
                    <button type="button" id="ebSaveBtn" class="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-md text-sm font-bold shadow-sm transition disabled:opacity-50"><i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save exam</button>
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
            return '<div class="text-center text-sm text-gray-500 py-10">No questions yet. Use the Add buttons below.</div>';
        }
        return `<div class="max-w-2xl mx-auto space-y-3" id="ebCards">${s.questions.map((q, i) => ExamBuilder.cardHtml(q, i)).join('')}</div>`;
    },

    cardHtml: (q, i) => {
        const s = ExamBuilder.s;
        const typeOptions = M.TYPES.map(t => `<option value="${t.id}" ${q.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('');
        let answerArea = '';
        if (q.type === 'mc') {
            answerArea = `
                <div class="mt-3 space-y-1.5">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Choices <span class="normal-case font-normal">- tap the circle of the correct one</span></p>
                    ${q.options.map((o, k) => `
                        <div class="flex items-center gap-2 rounded ${q.correct === k ? 'bg-green-50' : ''}">
                            <input type="radio" name="ebc-${q.id}" class="eb-correct w-5 h-5 shrink-0 text-green-600 focus:ring-green-500" data-i="${k}" ${q.correct === k ? 'checked' : ''} aria-label="Mark choice ${M.letter(k)} as the correct answer">
                            <span class="w-4 shrink-0 text-xs font-bold text-gray-400">${M.letter(k)}</span>
                            <input type="text" class="${INPUT} eb-field" data-col="o${k}" value="${esc(o)}" placeholder="Choice ${M.letter(k)}" aria-label="Choice ${M.letter(k)}">
                            <button type="button" class="eb-opt-del shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 ${q.options.length <= M.MIN_OPTIONS ? 'invisible' : ''}" data-i="${k}" aria-label="Remove choice ${M.letter(k)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </div>`).join('')}
                    ${q.options.length < M.MAX_OPTIONS ? '<button type="button" class="eb-opt-add text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add choice</button>' : ''}
                </div>`;
        } else if (q.type === 'tf') {
            const btn = (v) => `<button type="button" class="eb-tf flex-1 py-3 rounded-lg border-2 text-sm font-black transition ${q.tf === v ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300'}" data-v="${v}" aria-pressed="${q.tf === v}">${q.tf === v ? '<i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>' : ''}${v}</button>`;
            answerArea = `
                <div class="mt-3">
                    <p class="text-[11px] font-bold text-gray-500 uppercase mb-1.5">Correct answer</p>
                    <div class="flex gap-2">${btn('True')}${btn('False')}</div>
                </div>`;
        } else if (q.type === 'enum') {
            answerArea = `
                <div class="mt-3 space-y-1.5">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Items to list <span class="normal-case font-normal">- ${M.pointsOf(q)} point${M.pointsOf(q) === 1 ? '' : 's'}, 1 for each correct item</span></p>
                    ${q.items.map((it, k) => `
                        <div class="flex items-center gap-2">
                            <span class="w-6 shrink-0 text-right text-xs font-bold text-gray-400">${k + 1}.</span>
                            <input type="text" class="${INPUT} eb-field eb-item" data-i="${k}" value="${esc(it)}" placeholder="Item ${k + 1}" aria-label="Item ${k + 1}">
                            <button type="button" class="eb-item-del shrink-0 w-8 h-8 text-gray-400 hover:text-red-600 ${q.items.length <= M.MIN_ITEMS ? 'invisible' : ''}" data-i="${k}" aria-label="Remove item ${k + 1}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                        </div>`).join('')}
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                        ${q.items.length < M.MAX_ITEMS ? '<button type="button" class="eb-item-add text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add item</button>' : '<span></span>'}
                        <label class="text-xs font-bold text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" class="eb-ordered rounded text-indigo-600 focus:ring-indigo-500" ${q.ordered ? 'checked' : ''}> Order matters</label>
                    </div>
                    <p class="text-[11px] text-gray-500">Capital letters are ignored. ${q.ordered ? 'The student must list the items in this order.' : 'The student can list the items in any order.'}</p>
                </div>`;
        } else {
            answerArea = `
                <div class="mt-3">
                    <p class="text-[11px] font-bold text-gray-500 uppercase">Correct answer <span class="normal-case font-normal">- the student's answer must match this, capital letters ignored</span></p>
                    <input type="text" class="${INPUT} eb-field" data-col="answer" value="${esc(q.answer)}" placeholder="Type the exact answer" aria-label="Correct answer">
                </div>`;
        }
        return `
            <div class="eb-card bg-white rounded-xl border border-gray-200 border-l-4 border-l-transparent focus-within:border-l-indigo-600 shadow-sm p-3 sm:p-4" data-qid="${q.id}">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                    <span class="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">Q${i + 1}</span>
                    <select class="eb-type text-xs font-bold border border-gray-300 rounded-md px-2 py-1.5 bg-white" aria-label="Question type">${typeOptions}</select>
                    <label class="text-[11px] font-bold text-gray-500 flex items-center gap-1">Part
                        <input type="number" min="0" max="99" class="eb-field w-14 border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" data-col="part" value="${q.part}" aria-label="Part number">
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
        const head = ['#', 'Part', 'Type', 'Question', ...Array.from({ length: M.MAX_OPTIONS }, (_, k) => `Choice ${M.letter(k)}`), 'Answer', 'Explanation', 'Bonus', ''];
        const widths = ['w-10', 'w-16', 'w-44', 'min-w-[260px]', ...Array(M.MAX_OPTIONS).fill('min-w-[130px]'), 'min-w-[200px]', 'min-w-[180px]', 'w-14', 'w-20'];
        return `
            <p class="text-[11px] text-gray-500 mb-2">Type straight into the cells. Copy rows from Excel or Google Sheets and paste them into any cell: they fill to the right and down, and add rows as needed. Enter moves down. For an enumeration, type the items in Answer separated by |.</p>
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
            const on = q.type === 'mc';
            return `<td class="border border-gray-200 p-0 ${on ? '' : 'bg-gray-100'}"><input type="text" class="${CELL}" data-col="o${k}" value="${on ? esc(q.options[k] || '') : ''}" ${on ? '' : 'disabled'} aria-label="Choice ${M.letter(k)}"></td>`;
        }).join('');
        let answerCell;
        if (q.type === 'mc') {
            const letters = q.options.map((o, k) => (o.trim() ? `<option value="${M.letter(k)}" ${q.correct === k ? 'selected' : ''}>${M.letter(k)}: ${esc(o.trim().slice(0, 18))}</option>` : '')).join('');
            answerCell = `<select class="${CELL} eb-answer-sel" data-col="answer" aria-label="Correct choice"><option value="">- pick -</option>${letters}</select>`;
        } else if (q.type === 'tf') {
            answerCell = `<select class="${CELL} eb-answer-sel" data-col="answer" aria-label="Correct answer"><option value="">- pick -</option><option ${q.tf === 'True' ? 'selected' : ''}>True</option><option ${q.tf === 'False' ? 'selected' : ''}>False</option></select>`;
        } else if (q.type === 'enum') {
            answerCell = `<input type="text" class="${CELL}" data-col="answer" value="${esc(M.cellText(q, 'answer'))}" placeholder="item 1 | item 2 | item 3" aria-label="Items, separated by |">`;
        } else {
            answerCell = `<input type="text" class="${CELL}" data-col="answer" value="${esc(q.answer)}" aria-label="Correct answer">`;
        }
        return `
            <tr data-qid="${q.id}" class="eb-row">
                <td class="border border-gray-200 bg-gray-50 text-center font-bold text-gray-500 px-1">${i + 1}</td>
                <td class="border border-gray-200 p-0"><input type="number" min="0" max="99" class="${CELL}" data-col="part" value="${q.part}" aria-label="Part"></td>
                <td class="border border-gray-200 p-0"><select class="${CELL} eb-type" data-col="type" aria-label="Type">${typeOptions}</select></td>
                <td class="border border-gray-200 p-0"><textarea rows="1" class="${CELL} resize-none" data-col="text" aria-label="Question">${esc(q.text)}</textarea></td>
                ${optCells}
                <td class="border border-gray-200 p-0">${answerCell}</td>
                <td class="border border-gray-200 p-0"><input type="text" class="${CELL}" data-col="expl" value="${esc(q.expl)}" aria-label="Explanation"></td>
                <td class="border border-gray-200 text-center"><input type="checkbox" class="eb-bonus rounded text-amber-600" ${q.bonus ? 'checked' : ''} aria-label="Bonus question"></td>
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
                const hasContent = q.text.trim() || q.answer.trim() || q.options.some(o => o.trim());
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
        if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'radio') return;
        const q = ExamBuilder.qOf(t);
        if (!q) return;
        if (t.classList.contains('eb-item')) {
            q.items[parseInt(t.dataset.i, 10)] = t.value;
            ExamBuilder.touch();
            ExamBuilder.updateCount();
            return;
        }
        const col = t.dataset.col;
        if (!col) return;
        M.setCell(q, col, t.value);
        ExamBuilder.touch();
        if (col === 'answer' && q.type === 'enum') ExamBuilder.updateCount();
    },

    onChange: (e) => {
        const s = ExamBuilder.s;
        if (!s) return;
        const t = e.target;
        if (t.id === 'ebCsvInput') {
            const file = t.files && t.files[0];
            t.value = '';
            if (file) ExamBuilder.importCsv(file);
            return;
        }
        const q = ExamBuilder.qOf(t);
        if (!q) return;
        const inSheet = s.view === 'sheet';

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

    onKeydown: (e) => {
        const s = ExamBuilder.s;
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

    importCsv: async (file) => {
        const s = ExamBuilder.s;
        if (!s) return;
        try {
            const text = await file.text();
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
            UI.error('Could not read that file.');
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
        const bonus = M.blankQuestion('mc', 0);
        bonus.text = 'BONUS: Which company created JavaScript?';
        bonus.options = ['Netscape', 'Microsoft', 'Sun Microsystems', 'IBM'];
        bonus.correct = 0;
        bonus.bonus = true;
        ExamBuilder.download('exam_template.csv', M.toCsv([mc, tf, id, en, eo, bonus]));
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
            if (s.examId) {
                await apiFetch('/api/exams/update', {
                    method: 'POST',
                    body: JSON.stringify({ examId: s.examId, title: s.title.trim(), examData })
                });
            } else {
                await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: s.title.trim(), examData })
                });
            }
            store.del(draftKey(s.examId));
            s.dirty = false;
            const done = s.onSaved;
            ExamBuilder.close(true);
            UI.success('Exam saved');
            if (done) await done();
        } catch (err) {
            s.saving = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save exam';
            ExamBuilder.showProblems([{ id: null, message: err.message || 'Could not save the exam. Try again.' }]);
        }
    }
};
