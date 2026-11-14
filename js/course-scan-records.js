// js/course-scan-records.js
// "Saved Scans" tab of the Scan Answer Sheets dialog: every scanned sheet that was saved can be opened
// again to see the class results (correct / wrong / blank / double-shaded), find questions that were
// missed by many students, and correct a student's answers later when the reader missed a shaded circle.
// A correction recalculates the score and updates it in the assessment (Record Scores) at once.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';
import { CourseScanReview, keyOfSheet } from './course-scan-review.js';
import { gradeScanSet } from './scan-grade.js';
import { itemLabel } from './scan-items.js';

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
    onlyAttention: false,
    busy: false,

    init: () => {
        document.addEventListener('click', CourseScanRecords.handleClicks);
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
            CourseScanRecords.onlyAttention = false;
            CourseScanRecords.setAlert('');
            CourseScanRecords.renderDetail();
        } catch (err) {
            CourseScanRecords.setAlert(err.message || 'Failed to open the saved scan.', false);
            CourseScanRecords.renderList();
        }
    },

    // Mixed question types: score every sheet with its set's items; per question count right / wrong / blank.
    analyzeMixed: (session, sheets) => {
        const max = session.Max_Score;
        const sets = session.Set_Keys || [];
        const graded = sheets.map(sheet => { const k = keyOfSheet(session, sheet); return { sheet, g: gradeScanSet(k.set, sheet.Answers, sheet.Marks, max) }; });
        const scores = graded.map(x => x.g.score);
        const total = (field) => graded.reduce((sum, x) => sum + x.g[field], 0);
        const questions = (sets[0] ? sets[0].items : []).map(it0 => {
            const tally = [0, 0, 0, 0];
            graded.forEach(({ sheet, g }) => {
                const set = sets[sheet.Set_No || 0] || sets[0];
                const idx = set.items.findIndex(x => x.o === it0.o);
                const st = idx >= 0 && g.per[idx] ? g.per[idx].state : '';
                if (st === 'right') tally[0]++; else if (st === 'blank') tally[2]++; else if (st === 'wrong' || st === 'partial') tally[1]++;
            });
            return { q: it0.no - 1, label: itemLabel(it0), key: '', bonus: it0.b, counts: tally, right: tally[0], pct: sheets.length ? tally[0] / sheets.length : 0, multiSet: true, manual: it0.t === 'manual' };
        });
        return {
            key: [], bonus: [], max, c: 0, graded, questions, count: sheets.length,
            average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
            highest: scores.length ? Math.max(...scores) : 0, lowest: scores.length ? Math.min(...scores) : 0,
            correct: total('raw') + total('bonus'), wrong: total('wrong'), blank: total('blank'), multiple: total('multiple'),
            edited: sheets.filter(s => s.Edited).length
        };
    },

    // Counts per sheet, class totals and per-question answer counts, all from the saved answers.
    analyze: () => {
        const { session, sheets } = CourseScanRecords.detail;
        const key = session.Answer_Key;
        const bonus = session.Bonus_Flags.map(Boolean);
        const max = session.Max_Score;
        const c = session.Num_Choices;
        const multiSet = (session.Set_Keys || []).length > 1;

        if (session.Layout) return CourseScanRecords.analyzeMixed(session, sheets);

        const graded = sheets.map(sheet => { const k = keyOfSheet(session, sheet); return { sheet, g: grade(sheet.Answers, k.key, k.bonus, max) }; });
        const scores = graded.map(x => x.g.score);
        const total = (field) => graded.reduce((sum, x) => sum + x.g[field], 0);

        const questions = key.map((k, q) => {
            const counts = Array(c + 2).fill(0);   // choices..., blank, double
            if (multiSet) {
                // With printed sets, question q is a different question on each set: count by Set A's question
                // number and report right / wrong / blank / double (the letters differ between sets).
                const tally = [0, 0, 0, 0];
                sheets.forEach(sheet => {
                    const sk = (session.Set_Keys || [])[sheet.Set_No || 0];
                    const pos = sk && sk.order ? sk.order.indexOf(q) : q;
                    if (pos < 0) return;
                    const a = sheet.Answers[pos];
                    const kk = keyOfSheet(session, sheet).key[pos];
                    if (a === BLANK) tally[2]++; else if (a === MULTIPLE) tally[3]++; else if (a === kk) tally[0]++; else tally[1]++;
                });
                return { q, key: k, bonus: bonus[q], counts: tally, right: tally[0], pct: sheets.length ? tally[0] / sheets.length : 0, multiSet: true };
            }
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

    // Sheets in list order (respecting the "needs attention" filter), the order used by the reviewer's Next / Previous.
    visibleSheets: () => {
        const a = CourseScanRecords.analyze();
        return a.graded.filter(x => !CourseScanRecords.onlyAttention || CourseScanRecords.needsAttention(x)).map(x => x.sheet);
    },

    needsAttention: (x) => x.g.blank > 0 || x.g.multiple > 0 || x.g.pending > 0 || Boolean(x.sheet.Edited),

    badge: (cls, text) => `<span class="text-[10px] font-bold px-2 py-0.5 rounded border ${cls}">${text}</span>`,

    questionTable: (a) => {
        const rows = a.questions.map(item => {
            const pct = Math.round(item.pct * 100);
            const parts = item.multiSet ? `<b class="text-green-700">right ${item.counts[0]}</b> | wrong ${item.counts[1]} | blank ${item.counts[2]} | x2 ${item.counts[3]}` : item.counts.map((n, i) => {
                const label = i < a.c ? LETTERS[i] : (i === a.c ? 'blank' : 'x2');
                return i === item.key ? `<b class="text-green-700">${label} ${n}</b>` : `${label} ${n}`;
            }).join(' | ');
            return `
                <div class="grid grid-cols-12 items-center gap-1 text-[11px] py-1 border-b border-gray-100">
                    <span class="col-span-1 text-right font-bold text-gray-600">${item.label || item.q + 1}${item.bonus ? '<span class="text-amber-600" title="Bonus">*</span>' : ''}</span>
                    <span class="col-span-1 text-center font-black text-green-700">${item.multiSet ? '' : LETTERS[item.key]}</span>
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
            .map(item => `<span class="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">Q${item.label || item.q + 1} ${Math.round(item.pct * 100)}%</span>`).join('');
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
                ${noneRight.length ? `<div class="mt-1 p-2 rounded bg-amber-50 border border-amber-300 text-[11px] font-bold text-amber-800">Nobody got ${noneRight.map(i => `Q${i.label || i.q + 1}`).join(', ')} right. Check that the answer key is correct.</div>` : ''}
                ${CourseScanRecords.questionTable(a)}
            </details>

            <div class="flex items-center justify-between mb-2">
                <div class="text-xs font-bold text-gray-600 uppercase tracking-wider">Students</div>
                <button type="button" id="scrFilterBtn" class="px-3 py-1 rounded text-[11px] font-bold border transition ${CourseScanRecords.onlyAttention ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}" aria-pressed="${CourseScanRecords.onlyAttention}">Only needing attention</button>
            </div>
            <div class="space-y-2">${cards}</div>
        `);
    },

    // One student: a compact row. Tapping it opens the full-screen reviewer (photo crops + corrections).
    sheetCard: (x, a) => {
        const { sheet, g } = x;
        const id = sheet.Sheet_ID;
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
            <button type="button" class="scr-row-btn w-full text-left bg-white border ${attention ? 'border-amber-300' : 'border-gray-200'} rounded-lg p-3 flex items-center gap-3" data-sheet="${esc(id)}" aria-label="Review ${esc(sheet.Name || 'student')}">
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-bold text-gray-800 truncate">${esc(sheet.Name || 'Unknown student')}</span>
                    <span class="block text-[11px] text-gray-500">${esc(sheet.Student_Number || '')}${sheet.Student_No_Read ? ` | scanned number ${esc(sheet.Student_No_Read)}` : ''}</span>
                    <span class="mt-1 flex flex-wrap gap-1">${badges}</span>
                </span>
                <span class="text-right shrink-0">
                    <span class="block"><span class="text-lg font-black font-mono text-gray-800">${fmt(g.score)}</span><span class="text-xs text-gray-500"> / ${maxText}</span></span>
                    <span class="block text-[10px] text-gray-400"><i class="fa-regular fa-image mr-1" aria-hidden="true"></i>${sheet.Photo_File_ID ? 'photo' : 'no photo'}</span>
                </span>
                <i class="fa-solid fa-chevron-right text-gray-300" aria-hidden="true"></i>
            </button>`;
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

        const rowBtn = e.target.closest('.scr-row-btn');
        if (rowBtn) {
            const { detail } = CourseScanRecords;
            if (!detail) return;
            const order = CourseScanRecords.visibleSheets();
            CourseScanReview.open({
                detail, order, sheetId: rowBtn.dataset.sheet,
                onChange: () => { if (CourseScanRecords.detail === detail) CourseScanRecords.renderDetail(); }
            });
        }
    }
};
