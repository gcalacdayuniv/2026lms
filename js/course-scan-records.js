// js/course-scan-records.js
// "Saved Scans" tab of the Scan Answer Sheets dialog: every scanned sheet that was saved can be opened
// again to see the class results (correct / wrong / blank / double-shaded), find questions that were
// missed by many students, and correct a student's answers later when the reader missed a shaded circle.
// A correction recalculates the score and updates it in the assessment (Record Scores) at once.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const LETTERS = 'ABCDE';
const BLANK = -1;
const MULTIPLE = -2;
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
const fmt = (n) => Number(Number(n).toFixed(2));

// D1 stores CURRENT_TIMESTAMP in UTC as "YYYY-MM-DD HH:MM:SS".
const when = (text) => {
    const d = new Date(`${String(text || '').replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const answerLabel = (a) => (a === BLANK ? 'blank' : a === MULTIPLE ? 'x2' : LETTERS[a] || '?');

// Same rules as the server: bonus questions add points and the total never goes above the max.
const grade = (answers, key, bonus, max) => {
    let raw = 0, bonusPoints = 0, wrong = 0, blank = 0, multiple = 0;
    answers.forEach((a, i) => {
        if (a === BLANK) blank++;
        else if (a === MULTIPLE) multiple++;
        else if (a === key[i]) {
            if (bonus[i]) bonusPoints++;
            else raw++;
        } else wrong++;
    });
    const cap = max == null ? Infinity : Number(max);
    return { raw, bonus: bonusPoints, wrong, blank, multiple, score: Math.min(cap, raw + bonusPoints) };
};

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export const CourseScanRecords = {
    courseId: '',
    sessions: [],
    detail: null,          // { session, sheets } while one saved scan is open
    openIds: new Set(),    // sheets whose answer editor is open
    drafts: {},            // sheetId -> answers being edited
    onlyAttention: false,
    busy: false,

    init: () => {
        document.addEventListener('click', CourseScanRecords.handleClicks);
        document.addEventListener('change', CourseScanRecords.handleChanges);
    },

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

    // Keeps the scroll position when the list is drawn again after an edit.
    paint: (html) => {
        const body = $('scnSavedBody');
        if (!body) return;
        const top = body.scrollTop;
        body.innerHTML = html;
        body.scrollTop = top;
    },

    // ---------- Saved scan list ----------

    load: async () => {
        CourseScanRecords.courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        CourseScanRecords.detail = null;
        CourseScanRecords.drafts = {};
        CourseScanRecords.openIds = new Set();
        CourseScanRecords.paint('<div class="text-sm text-gray-500 italic text-center py-10">Loading saved scans...</div>');
        try {
            const res = await apiFetch(`/api/scan-sessions?courseId=${CourseScanRecords.courseId}&_t=${new Date().getTime()}`);
            CourseScanRecords.sessions = res.sessions || [];
        } catch (err) {
            CourseScanRecords.setAlert(err.message || 'Failed to load saved scans.', false);
            CourseScanRecords.sessions = [];
        }
        CourseScanRecords.renderList();
    },

    renderList: () => {
        const sessions = CourseScanRecords.sessions;
        if (!sessions.length) {
            CourseScanRecords.paint(`
                <div class="text-center py-10 text-sm text-gray-500">
                    <i class="fa-solid fa-clipboard-check text-3xl text-gray-300 mb-3"></i>
                    <p class="font-bold text-gray-700">No saved scans yet</p>
                    <p class="text-xs mt-1">Sheets saved from the Scan tab appear here for review and correction.</p>
                </div>`);
            return;
        }
        CourseScanRecords.paint(`<div class="space-y-2">${sessions.map(s => `
            <div class="bg-white border border-gray-200 rounded-lg p-3">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="text-sm font-black text-gray-800 truncate">${esc(s.Title || 'Untitled')}</div>
                        <div class="text-[11px] text-gray-500">${esc(TERM_LABELS[s.Term] || s.Term || '')}${s.Category ? ` | ${esc(CATEGORY_LABELS[s.Category] || s.Category)}` : ''} | ${s.Num_Questions} questions</div>
                        <div class="text-[11px] text-gray-500">Last saved ${esc(when(s.Updated_At))}</div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-lg font-black font-mono text-gray-800">${s.Sheets}</div>
                        <div class="text-[10px] text-gray-500 uppercase font-bold">sheet${s.Sheets === 1 ? '' : 's'}</div>
                    </div>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-1">
                    ${s.Edited ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-300">${s.Edited} corrected by hand</span>` : ''}
                    ${s.Max_Score == null ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-300">Assessment was deleted</span>' : `<span class="text-[10px] font-bold px-2 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-300">max ${fmt(s.Max_Score)}</span>`}
                </div>
                <div class="mt-2 flex gap-2">
                    <button type="button" class="scr-open-btn flex-1 bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-md text-xs font-bold transition" data-session="${esc(s.Session_ID)}">Open</button>
                    <button type="button" class="scr-delete-btn px-3 py-2 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-700 rounded-md text-xs font-bold transition" data-session="${esc(s.Session_ID)}" aria-label="Delete saved scan ${esc(s.Title || '')}"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`).join('')}</div>`);
    },

    deleteSession: async (sessionId) => {
        const s = CourseScanRecords.sessions.find(x => x.Session_ID === sessionId);
        const ok = await UI.confirm({
            title: 'Delete saved scan?',
            message: `The stored answers of ${s ? s.Sheets : 'all'} sheet${s && s.Sheets === 1 ? '' : 's'} will be removed. Scores already recorded in Record Scores stay as they are.`,
            confirmText: 'Delete',
            danger: true
        });
        if (!ok) return;
        try {
            await apiFetch('/api/scan-sessions', { method: 'DELETE', body: JSON.stringify({ sessionId }) });
            UI.success('Saved scan deleted.');
            await CourseScanRecords.load();
        } catch (err) {
            CourseScanRecords.setAlert(err.message || 'Failed to delete.', false);
        }
    },

    // ---------- One saved scan ----------

    openSession: async (sessionId) => {
        CourseScanRecords.paint('<div class="text-sm text-gray-500 italic text-center py-10">Opening...</div>');
        try {
            const res = await apiFetch(`/api/scan-sheets?sessionId=${sessionId}&_t=${new Date().getTime()}`);
            CourseScanRecords.detail = { session: res.session, sheets: res.sheets || [] };
            CourseScanRecords.drafts = {};
            CourseScanRecords.openIds = new Set();
            CourseScanRecords.onlyAttention = false;
            CourseScanRecords.setAlert('');
            CourseScanRecords.renderDetail();
        } catch (err) {
            CourseScanRecords.setAlert(err.message || 'Failed to open the saved scan.', false);
            CourseScanRecords.renderList();
        }
    },

    // Counts per sheet, class totals and per-question answer counts, all from the saved answers.
    analyze: () => {
        const { session, sheets } = CourseScanRecords.detail;
        const key = session.Answer_Key;
        const bonus = session.Bonus_Flags.map(Boolean);
        const max = session.Max_Score;
        const c = session.Num_Choices;

        const graded = sheets.map(sheet => ({ sheet, g: grade(sheet.Answers, key, bonus, max) }));
        const scores = graded.map(x => x.g.score);
        const total = (field) => graded.reduce((sum, x) => sum + x.g[field], 0);

        const questions = key.map((k, q) => {
            const counts = Array(c + 2).fill(0);   // choices..., blank, double
            sheets.forEach(sheet => {
                const a = sheet.Answers[q];
                if (a === BLANK) counts[c]++;
                else if (a === MULTIPLE) counts[c + 1]++;
                else if (a >= 0 && a < c) counts[a]++;
            });
            const right = counts[k];
            return { q, key: k, bonus: bonus[q], counts, right, pct: sheets.length ? right / sheets.length : 0 };
        });

        return {
            key, bonus, max, c, graded, questions,
            count: sheets.length,
            average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
            highest: scores.length ? Math.max(...scores) : 0,
            lowest: scores.length ? Math.min(...scores) : 0,
            correct: total('raw') + total('bonus'),
            wrong: total('wrong'),
            blank: total('blank'),
            multiple: total('multiple'),
            edited: sheets.filter(s => s.Edited).length
        };
    },

    needsAttention: (x) => x.g.blank > 0 || x.g.multiple > 0 || Boolean(x.sheet.Edited),

    badge: (cls, text) => `<span class="text-[10px] font-bold px-2 py-0.5 rounded border ${cls}">${text}</span>`,

    questionTable: (a) => {
        const rows = a.questions.map(item => {
            const pct = Math.round(item.pct * 100);
            const parts = item.counts.map((n, i) => {
                const label = i < a.c ? LETTERS[i] : (i === a.c ? 'blank' : 'x2');
                return i === item.key ? `<b class="text-green-700">${label} ${n}</b>` : `${label} ${n}`;
            }).join(' | ');
            return `
                <div class="grid grid-cols-12 items-center gap-1 text-[11px] py-1 border-b border-gray-100">
                    <span class="col-span-1 text-right font-bold text-gray-600">${item.q + 1}${item.bonus ? '<span class="text-amber-600" title="Bonus">*</span>' : ''}</span>
                    <span class="col-span-1 text-center font-black text-green-700">${LETTERS[item.key]}</span>
                    <div class="col-span-3 h-2 bg-gray-200 rounded overflow-hidden"><div class="h-2 ${pct < 40 ? 'bg-red-500' : pct < 70 ? 'bg-amber-500' : 'bg-green-500'}" style="width:${pct}%"></div></div>
                    <span class="col-span-1 text-right font-mono font-bold">${pct}%</span>
                    <span class="col-span-6 text-gray-600">${parts}</span>
                </div>`;
        }).join('');
        return `<div class="mt-2">${rows}</div>`;
    },

    renderDetail: () => {
        const detail = CourseScanRecords.detail;
        if (!detail) return;
        const { session } = detail;
        const a = CourseScanRecords.analyze();
        const maxText = session.Max_Score == null ? '?' : fmt(session.Max_Score);

        const hardest = a.questions.slice().sort((x, y) => x.pct - y.pct || x.q - y.q).slice(0, 5)
            .map(item => `<span class="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">Q${item.q + 1} ${Math.round(item.pct * 100)}%</span>`).join('');
        const noneRight = a.count >= 3 ? a.questions.filter(item => item.right === 0) : [];

        const visible = a.graded.filter(x => !CourseScanRecords.onlyAttention || CourseScanRecords.needsAttention(x));
        const cards = visible.length
            ? visible.map(x => CourseScanRecords.sheetCard(x, a)).join('')
            : '<div class="text-sm text-gray-500 italic text-center py-6">No sheets need attention.</div>';

        CourseScanRecords.paint(`
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div class="min-w-0">
                    <div class="text-sm font-black text-gray-800 truncate">${esc(session.Title || 'Untitled')}</div>
                    <div class="text-[11px] text-gray-500">${esc(TERM_LABELS[session.Term] || session.Term || '')} | ${session.Num_Questions} questions | max ${maxText} | saved ${esc(when(session.Updated_At))}</div>
                </div>
                <button type="button" id="scrBackBtn" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition"><i class="fa-solid fa-arrow-left mr-1"></i> All saved scans</button>
            </div>
            ${session.Max_Score == null ? '<div class="mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700">The assessment of this scan was deleted, so corrections cannot be saved.</div>' : ''}

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div class="bg-blue-50 border border-blue-200 rounded p-2 text-center"><div class="text-lg font-black font-mono text-blue-800">${a.count}</div><div class="text-[10px] font-bold text-blue-700 uppercase">Sheets</div></div>
                <div class="bg-gray-50 border border-gray-200 rounded p-2 text-center"><div class="text-lg font-black font-mono text-gray-800">${fmt(a.average)}</div><div class="text-[10px] font-bold text-gray-500 uppercase">Average / ${maxText}</div></div>
                <div class="bg-gray-50 border border-gray-200 rounded p-2 text-center"><div class="text-lg font-black font-mono text-gray-800">${fmt(a.highest)} - ${fmt(a.lowest)}</div><div class="text-[10px] font-bold text-gray-500 uppercase">Highest - lowest</div></div>
                <div class="bg-amber-50 border border-amber-200 rounded p-2 text-center"><div class="text-lg font-black font-mono text-amber-800">${a.edited}</div><div class="text-[10px] font-bold text-amber-700 uppercase">Corrected by hand</div></div>
            </div>
            <div class="flex flex-wrap gap-1 mb-3">
                ${CourseScanRecords.badge('bg-green-50 text-green-800 border-green-300', `${a.correct} correct answers`)}
                ${CourseScanRecords.badge('bg-red-50 text-red-700 border-red-300', `${a.wrong} wrong`)}
                ${CourseScanRecords.badge('bg-gray-100 text-gray-600 border-gray-300', `${a.blank} blank`)}
                ${CourseScanRecords.badge('bg-amber-50 text-amber-800 border-amber-300', `${a.multiple} double-shaded`)}
            </div>

            <details class="mb-3 bg-white border border-gray-200 rounded-lg p-3">
                <summary class="text-xs font-bold text-blue-700 cursor-pointer">Question analysis (how many got each question right)</summary>
                <div class="mt-2 text-[11px] text-gray-600">Hardest questions: ${hardest || 'none'}</div>
                ${noneRight.length ? `<div class="mt-1 p-2 rounded bg-amber-50 border border-amber-300 text-[11px] font-bold text-amber-800">Nobody got ${noneRight.map(i => `Q${i.q + 1}`).join(', ')} right. Check that the answer key is correct.</div>` : ''}
                ${CourseScanRecords.questionTable(a)}
            </details>

            <div class="flex items-center justify-between mb-2">
                <div class="text-xs font-bold text-gray-600 uppercase tracking-wider">Students</div>
                <button type="button" id="scrFilterBtn" class="px-3 py-1 rounded text-[11px] font-bold border transition ${CourseScanRecords.onlyAttention ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}" aria-pressed="${CourseScanRecords.onlyAttention}">Only needing attention</button>
            </div>
            <div class="space-y-2">${cards}</div>
        `);
    },

    sheetCard: (x, a) => {
        const { sheet, g } = x;
        const id = sheet.Sheet_ID;
        const open = CourseScanRecords.openIds.has(id);
        const maxText = a.max == null ? '?' : fmt(a.max);
        const attention = CourseScanRecords.needsAttention(x);
        const b = CourseScanRecords.badge;
        const badges = [
            b('bg-green-50 text-green-800 border-green-300', `${g.raw} correct`),
            g.bonus ? b('bg-teal-50 text-teal-800 border-teal-300', `+${g.bonus} bonus`) : '',
            b('bg-red-50 text-red-700 border-red-300', `${g.wrong} wrong`),
            g.blank ? b('bg-gray-100 text-gray-600 border-gray-300', `${g.blank} blank`) : '',
            g.multiple ? b('bg-amber-50 text-amber-800 border-amber-300', `${g.multiple} double-shaded`) : '',
            sheet.Edited ? b('bg-amber-100 text-amber-900 border-amber-400', 'Corrected by hand') : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="bg-white border ${attention ? 'border-amber-300' : 'border-gray-200'} rounded-lg p-3" data-sheet-card="${esc(id)}">
                <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <div class="text-sm font-bold text-gray-800 truncate">${esc(sheet.Name || 'Unknown student')}</div>
                        <div class="text-[11px] text-gray-500">${esc(sheet.Student_Number || '')}${sheet.Student_No_Read ? ` | scanned number ${esc(sheet.Student_No_Read)}` : ''}</div>
                    </div>
                    <div class="text-right shrink-0"><span class="text-lg font-black font-mono text-gray-800">${fmt(g.score)}</span><span class="text-xs text-gray-500"> / ${maxText}</span></div>
                </div>
                <div class="mt-1 flex flex-wrap gap-1">${badges}</div>
                <button type="button" class="scr-toggle-btn mt-2 text-xs font-bold text-blue-700 hover:underline" data-sheet="${esc(id)}" aria-expanded="${open}">${open ? 'Hide answers' : 'Review / correct answers'}</button>
                ${open ? CourseScanRecords.editor(sheet, a) : ''}
            </div>`;
    },

    // Answer editor of one sheet: every question with its current answer, the scanned read when it differs.
    editor: (sheet, a) => {
        const id = sheet.Sheet_ID;
        const draft = CourseScanRecords.drafts[id] || sheet.Answers;
        const cells = draft.map((cur, q) => {
            const orig = sheet.Original_Answers[q];
            const options = [
                `<option value="${BLANK}"${cur === BLANK ? ' selected' : ''}>-</option>`,
                `<option value="${MULTIPLE}"${cur === MULTIPLE ? ' selected' : ''}>x2</option>`
            ].concat(Array.from({ length: a.c }, (_, k) => `<option value="${k}"${cur === k ? ' selected' : ''}>${LETTERS[k]}</option>`)).join('');
            const tone = cur === a.key[q] ? 'border-green-400 bg-green-50' : 'border-red-300 bg-red-50';
            return `<label class="text-[11px]">
                <span class="flex items-center gap-1"><span class="w-7 text-right font-bold text-gray-500">${q + 1}${a.bonus[q] ? '<span class="text-amber-600" title="Bonus">*</span>' : ''}</span>
                <select class="scr-answer-select w-full px-1 py-0.5 border rounded text-xs ${tone}" data-sheet="${esc(id)}" data-q="${q}" aria-label="Question ${q + 1} answer">${options}</select></span>
                <span class="block ml-8 text-[9px] text-gray-400">key ${LETTERS[a.key[q]]}${orig !== cur ? ` | <span class="text-amber-700 font-bold">scanned: ${answerLabel(orig)}</span>` : ''}</span>
            </label>`;
        }).join('');

        const changed = !sameList(draft, sheet.Answers);
        const differsFromScan = !sameList(draft, sheet.Original_Answers);
        const g = grade(draft, a.key, a.bonus, a.max);
        return `
            <div class="mt-2 pt-2 border-t border-gray-200">
                <p class="text-[11px] text-gray-500 mb-2">Compare with the paper sheet. Change any answer the reader missed, then save: the score is recalculated and updated in Record Scores.</p>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">${cells}</div>
                <div class="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div class="flex-1 text-xs font-bold text-gray-700" data-role="preview">Score: ${fmt(g.score)} / ${a.max == null ? '?' : fmt(a.max)} (${g.raw} correct${g.bonus ? ` + ${g.bonus} bonus` : ''}, ${g.wrong} wrong, ${g.blank} blank, ${g.multiple} double-shaded)</div>
                    <button type="button" class="scr-reset-btn px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-xs font-bold transition ${differsFromScan ? '' : 'hidden'}" data-sheet="${esc(id)}" data-role="reset">Reset to scanned answers</button>
                    <button type="button" class="scr-save-btn px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-xs font-bold transition disabled:opacity-50" data-sheet="${esc(id)}" data-role="save" ${changed ? '' : 'disabled'}>Save correction</button>
                </div>
            </div>`;
    },

    findSheet: (id) => (CourseScanRecords.detail ? CourseScanRecords.detail.sheets.find(s => s.Sheet_ID === id) : null),

    // Edits one answer without redrawing the list: updates the preview, button state and colour only.
    updateEditor: (sheetId) => {
        const sheet = CourseScanRecords.findSheet(sheetId);
        const card = document.querySelector(`[data-sheet-card="${CSS.escape(sheetId)}"]`);
        if (!sheet || !card) return;
        const { session } = CourseScanRecords.detail;
        const key = session.Answer_Key;
        const bonus = session.Bonus_Flags.map(Boolean);
        const draft = CourseScanRecords.drafts[sheetId] || sheet.Answers;
        const g = grade(draft, key, bonus, session.Max_Score);

        card.querySelector('[data-role="preview"]').textContent =
            `Score: ${fmt(g.score)} / ${session.Max_Score == null ? '?' : fmt(session.Max_Score)} (${g.raw} correct${g.bonus ? ` + ${g.bonus} bonus` : ''}, ${g.wrong} wrong, ${g.blank} blank, ${g.multiple} double-shaded)`;
        card.querySelector('[data-role="save"]').disabled = sameList(draft, sheet.Answers);
        card.querySelector('[data-role="reset"]').classList.toggle('hidden', sameList(draft, sheet.Original_Answers));
        card.querySelectorAll('.scr-answer-select').forEach(sel => {
            const q = Number(sel.dataset.q);
            sel.className = `scr-answer-select w-full px-1 py-0.5 border rounded text-xs ${draft[q] === key[q] ? 'border-green-400 bg-green-50' : 'border-red-300 bg-red-50'}`;
        });
    },

    saveCorrection: async (sheetId) => {
        const sheet = CourseScanRecords.findSheet(sheetId);
        const draft = CourseScanRecords.drafts[sheetId];
        if (!sheet || !draft || CourseScanRecords.busy) return;
        CourseScanRecords.busy = true;
        const btn = document.querySelector(`.scr-save-btn[data-sheet="${CSS.escape(sheetId)}"]`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
        }
        try {
            const res = await apiFetch('/api/scan-sheets/correct', {
                method: 'POST',
                body: JSON.stringify({ sheetId, answers: draft })
            });
            sheet.Answers = draft.slice();
            sheet.Score = res.score;
            sheet.Edited = res.edited ? 1 : 0;
            delete CourseScanRecords.drafts[sheetId];
            CourseScanRecords.renderDetail();
            CourseScanRecords.setAlert(`Saved. ${sheet.Name || 'Student'} now has ${fmt(res.score)} (also updated in Record Scores).`, true);
        } catch (err) {
            CourseScanRecords.setAlert(err.message || 'Failed to save the correction.', false);
            CourseScanRecords.renderDetail();
        } finally {
            CourseScanRecords.busy = false;
        }
    },

    // ---------- Events ----------

    handleClicks: async (e) => {
        if (!e.target.closest || !e.target.closest('#scnSavedView')) return;

        const openBtn = e.target.closest('.scr-open-btn');
        if (openBtn) {
            await CourseScanRecords.openSession(openBtn.dataset.session);
            return;
        }
        const delBtn = e.target.closest('.scr-delete-btn');
        if (delBtn) {
            await CourseScanRecords.deleteSession(delBtn.dataset.session);
            return;
        }
        if (e.target.closest('#scrBackBtn')) {
            CourseScanRecords.setAlert('');
            await CourseScanRecords.load();
            return;
        }
        if (e.target.closest('#scrFilterBtn')) {
            CourseScanRecords.onlyAttention = !CourseScanRecords.onlyAttention;
            CourseScanRecords.renderDetail();
            return;
        }

        const toggle = e.target.closest('.scr-toggle-btn');
        if (toggle) {
            const id = toggle.dataset.sheet;
            if (CourseScanRecords.openIds.has(id)) {
                CourseScanRecords.openIds.delete(id);
                delete CourseScanRecords.drafts[id];
            } else {
                CourseScanRecords.openIds.add(id);
                const sheet = CourseScanRecords.findSheet(id);
                if (sheet) CourseScanRecords.drafts[id] = sheet.Answers.slice();
            }
            CourseScanRecords.renderDetail();
            return;
        }

        const resetBtn = e.target.closest('.scr-reset-btn');
        if (resetBtn) {
            const id = resetBtn.dataset.sheet;
            const sheet = CourseScanRecords.findSheet(id);
            if (sheet) {
                CourseScanRecords.drafts[id] = sheet.Original_Answers.slice();
                CourseScanRecords.renderDetail();
            }
            return;
        }

        const saveBtn = e.target.closest('.scr-save-btn');
        if (saveBtn) await CourseScanRecords.saveCorrection(saveBtn.dataset.sheet);
    },

    handleChanges: (e) => {
        const t = e.target;
        if (!t.classList || !t.classList.contains('scr-answer-select')) return;
        const id = t.dataset.sheet;
        const sheet = CourseScanRecords.findSheet(id);
        if (!sheet) return;
        if (!CourseScanRecords.drafts[id]) CourseScanRecords.drafts[id] = sheet.Answers.slice();
        CourseScanRecords.drafts[id][Number(t.dataset.q)] = parseInt(t.value, 10);
        CourseScanRecords.updateEditor(id);
    }
};
