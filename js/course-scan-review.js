// js/course-scan-review.js
// Full-screen reviewer of saved answer sheets, one student at a time (Previous / Next / student picker).
// Every question is one row in two columns: on the left the photo of that question's row cut out of the
// student's sheet, on the right the choices to correct the answer by hand. Only the photo of the student on
// screen is downloaded (and kept on the device for 7 days, see PhotoCache), never the whole class.
import { apiPost } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';
import { PhotoCache, ScanPhotos } from './course-scan-photos.js';
import { answerRows, writtenLayout } from './omr-sheet.js';
import { gradeScanSet } from './scan-grade.js';
import { questionPoints } from './grading.js';
import { cellLabels, cellName, codeText, itemLabel, geoFor, writtenItems, rowType } from './scan-items.js';
import { cropBoxes, alignRows, writtenBoxes, drawCrops, setBox, drawCrop, straightenLegacy, RECT_LAYOUT } from './omr-crop.js';

const LETTERS = 'ABCDE';
const BLANK = -1;
const MULTIPLE = -2;
const fmt = (n) => Number(Number(n).toFixed(2));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const label = (a) => (a === BLANK ? 'blank' : a === MULTIPLE ? 'double' : LETTERS[a] || '?');

// Key and bonus flags of the printed set this sheet belongs to (Set A / the session key when there are no sets).
export const keyOfSheet = (session, sheet) => {
    const s = (session.Set_Keys || [])[sheet && sheet.Set_No > 0 ? sheet.Set_No : 0];
    return s ? { key: s.key, bonus: s.bonus.map(Boolean), set: s } : { key: session.Answer_Key, bonus: (session.Bonus_Flags || []).map(Boolean) };
};
const SET_LETTERS = 'ABCDEF';

const grade = (answers, key, bonus, max) => {
    let raw = 0, bonusPoints = 0, wrong = 0, blank = 0, multiple = 0;
    answers.forEach((a, i) => {
        if (a === BLANK) blank++;
        else if (a === MULTIPLE) multiple++;
        else if (a === key[i]) { if (bonus[i]) bonusPoints++; else raw++; }
        else wrong++;
    });
    const cap = max == null ? Infinity : Number(max);
    return { raw, bonus: bonusPoints, wrong, blank, multiple, score: Math.min(cap, raw + bonusPoints) };
};

// Score of one sheet: mixed-type sheets (session.Layout) by their set's items, plain sheets by key and bonus flags.
const gradeSheet = (session, sheet, answers, marks) => {
    const sk = keyOfSheet(session, sheet);
    if (session.Layout && sk.set) {
        const g = gradeScanSet(sk.set, answers, marks, session.Max_Score);
        return { raw: g.raw, bonus: g.bonus, wrong: g.wrong, blank: g.blank, multiple: g.multiple, pending: g.pending, score: g.score, points: true };
    }
    return grade(answers, sk.key, sk.bonus, session.Max_Score);
};
const sameMarks = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

const $ = (id) => document.getElementById(id);

export const CourseScanReview = {
    detail: null,       // { session, sheets } (shared with the list, so a save shows there at once)
    order: [],          // sheets in the order of the list
    idx: 0,
    drafts: {},         // sheetId -> answers being edited (kept while moving between students)
    markDrafts: {},     // sheetId -> points typed for questions marked by hand
    rows: [],           // answerRows(n, c) of the open scan
    bitmap: null,       // photo of the student on screen
    token: 0,           // guards against a slow photo arriving after the student changed
    onChange: null,
    busy: false,
    keyHandler: null,

    open: ({ detail, order, sheetId, onChange }) => {
        CourseScanReview.close(true);
        CourseScanReview.detail = detail;
        CourseScanReview.order = order && order.length ? order : detail.sheets;
        CourseScanReview.idx = Math.max(0, CourseScanReview.order.findIndex(s => s.Sheet_ID === sheetId));
        CourseScanReview.drafts = {};
        CourseScanReview.markDrafts = {};
        CourseScanReview.onChange = onChange || null;
        const { session } = detail;
        const sk0 = (session.Set_Keys || [])[0];
        const nSets = session.Layout && sk0 && sk0.items ? geoFor((session.Set_Keys || []).length, sk0.items) : (session.Set_Keys || []).length;
        CourseScanReview.geo = nSets;
        CourseScanReview.lay = session.Layout && sk0 && sk0.items ? writtenLayout(session.Layout, nSets, writtenItems(sk0.items)) : null;
        CourseScanReview.rows = session.Layout ? answerRows(session.Layout, nSets) : answerRows(session.Num_Questions, session.Num_Choices, nSets);
        PhotoCache.purge().catch(() => {});
        if (!document.getElementById('scrvExtraStyle')) {
            const st = document.createElement('style');
            st.id = 'scrvExtraStyle';
            st.textContent = '.scrv-img.is-multi{border:2px solid #6366f1;background:#eef2ff}.scrv-opts.is-multi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.3rem;padding:.35rem;border:2px solid #c7d2fe;border-radius:.8rem;background:#eef2ff}.scrv-opts.is-multi .scrv-opt{height:2.2rem}.scrv-set{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:.6rem;align-items:center;padding:.55rem .75rem;background:#eef2ff;border-bottom:1px solid #c7d2fe;border-left:4px solid #6366f1}.scrv-setl{display:flex;gap:.3rem}.scrv-setc{flex:1;min-width:0;height:2.5rem;border-radius:.6rem;border:2px solid #c7d2fe;background:#fff;color:#6b7280;font-weight:800;display:flex;align-items:center;justify-content:center}.scrv-setc.is-on{background:#4f46e5;border-color:#4f46e5;color:#fff}html[data-theme="dark"] .scrv-set,html[data-theme="dark"] .scrv-opts.is-multi,html[data-theme="dark"] .scrv-img.is-multi{background:#1e2440;border-color:#4f46e5}';
            document.head.appendChild(st);
        }

        const wrap = document.createElement('div');
        wrap.id = 'scrReview';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Review answer sheets');
        wrap.className = 'fixed inset-0 flex flex-col bg-gray-50 fade-in';
        wrap.style.cssText = 'z-index:200';   // above the scanner dialog (76), below confirm (300) and toasts (400)
        wrap.innerHTML = `
            <div class="scrv-top">
                <div class="max-w-4xl mx-auto w-full px-2 sm:px-6 pt-2 pb-2">
                    <div class="flex items-center gap-1">
                        <button type="button" id="scrvClose" aria-label="Close review" class="app-page-close text-white/90 hover:text-white"><i class="fa-solid fa-arrow-left text-xl" aria-hidden="true"></i></button>
                        <div class="min-w-0 flex-1">
                            <div id="scrvName" class="font-black text-white text-base leading-tight truncate"></div>
                            <div id="scrvSub" class="text-[11px] text-blue-100 truncate"></div>
                        </div>
                        <div id="scrvScore" class="text-white font-black font-mono text-lg shrink-0 pr-2"></div>
                    </div>
                    <div class="scrv-nav">
                        <button type="button" id="scrvPrev" class="scrv-step" aria-label="Previous student"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                        <select id="scrvPick" class="scrv-pick" aria-label="Choose student"></select>
                        <button type="button" id="scrvNext" class="scrv-step" aria-label="Next student"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                    </div>
                </div>
            </div>
            <div id="scrvNote" class="hidden"></div>
            <div id="scrvBody" class="flex-1 overflow-y-auto" style="-webkit-overflow-scrolling:touch"></div>
            <div class="scrv-foot">
                <div class="max-w-4xl mx-auto w-full px-3 py-2 flex items-center gap-2">
                    <div id="scrvPreview" class="flex-1 min-w-0 text-xs font-bold text-gray-700"></div>
                    <button type="button" id="scrvReset" class="scrv-btn scrv-btn-ghost hidden">Reset</button>
                    <button type="button" id="scrvSave" class="scrv-btn scrv-btn-primary" disabled>Save</button>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        wrap.addEventListener('click', CourseScanReview.onClick);
        wrap.addEventListener('input', (e) => {
            const t = e.target;
            if (!t.classList || !t.classList.contains('scrv-mark')) return;
            const sheet = CourseScanReview.current();
            if (!sheet) return;
            const marks = { ...CourseScanReview.marksOf(sheet) };
            const v = t.value.trim();
            if (v === '' || !Number.isFinite(Number(v))) delete marks[t.dataset.i];
            else marks[t.dataset.i] = Math.max(0, Number(v));
            CourseScanReview.markDrafts[sheet.Sheet_ID] = marks;
            CourseScanReview.refresh();
        });
        wrap.querySelector('#scrvPick').addEventListener('change', (e) => CourseScanReview.go(Number(e.target.value)));
        CourseScanReview.keyHandler = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) CourseScanReview.requestClose(); };
        document.addEventListener('keydown', CourseScanReview.keyHandler);

        CourseScanReview.fillPicker();
        CourseScanReview.show();
        wrap.querySelector('#scrvClose').focus();
    },

    current: () => CourseScanReview.order[CourseScanReview.idx],
    draftOf: (sheet) => CourseScanReview.drafts[sheet.Sheet_ID] || sheet.Answers,
    marksOf: (sheet) => CourseScanReview.markDrafts[sheet.Sheet_ID] || sheet.Marks || {},
    dirty: (sheet) => !same(CourseScanReview.draftOf(sheet), sheet.Answers) || !sameMarks(CourseScanReview.marksOf(sheet), sheet.Marks),
    anyDirty: () => CourseScanReview.order.some(s => CourseScanReview.dirty(s)),

    fillPicker: () => {
        const sel = $('scrvPick');
        if (!sel) return;
        const { session } = CourseScanReview.detail;
        sel.innerHTML = CourseScanReview.order.map((s, i) => {
            const g = gradeSheet(session, s, CourseScanReview.draftOf(s), CourseScanReview.marksOf(s));
            return `<option value="${i}"${i === CourseScanReview.idx ? ' selected' : ''}>${i + 1}. ${esc(s.Name || 'Unknown student')} — ${fmt(g.score)}${CourseScanReview.dirty(s) ? ' •' : ''}</option>`;
        }).join('');
    },

    go: (i) => {
        const n = CourseScanReview.order.length;
        if (i < 0 || i >= n || i === CourseScanReview.idx) { CourseScanReview.fillPicker(); return; }
        CourseScanReview.idx = i;
        CourseScanReview.fillPicker();
        CourseScanReview.show();
        const body = $('scrvBody');
        if (body) body.scrollTop = 0;
    },

    // ---------- Drawing ----------

    rowHtml: (sheet, q) => {
        const { session } = CourseScanReview.detail;
        const cell = session.Layout ? session.Layout[q] : ['a', session.Num_Choices];
        const mixed = Boolean(session.Layout);
        const labels = mixed ? cellLabels(cell) : Array.from({ length: session.Num_Choices }, (_, k) => LETTERS[k]);
        const name = mixed ? cellName(session.Layout, q) : String(q + 1);
        const sk = keyOfSheet(session, sheet);
        const key = sk.key[q];
        const cur = CourseScanReview.draftOf(sheet)[q];
        const orig = sheet.Original_Answers[q];
        const bonus = Boolean(sk.bonus[q]);
        const tone = cur === key ? 'is-right' : 'is-wrong';
        const isOn = (k) => (cell[0] === 'm' ? cur >= 1000 && ((cur - 1000) & (1 << k)) !== 0 : cur === k);
        const isKey = (k) => (cell[0] === 'm' ? key >= 1000 && ((key - 1000) & (1 << k)) !== 0 : k === key);
        const opts = labels.map((l, k) => {
            const cls = ['scrv-opt', isOn(k) ? 'is-on' : '', isKey(k) ? 'is-key' : ''].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-q="${q}" data-k="${k}" aria-pressed="${isOn(k)}" aria-label="Question ${name} choice ${l}${isKey(k) ? ' (answer key)' : ''}">${l}</button>`;
        }).join('');
        const note = [
            `key ${mixed ? codeText(cell, key) : LETTERS[key]}${bonus ? ' (bonus)' : ''}`,
            cur === BLANK ? '<b class="text-gray-600">blank</b>' : cur === MULTIPLE ? '<b class="text-amber-700">double-shaded: pick one</b>' : '',
            orig !== cur ? `<span class="text-amber-700 font-bold">scanned: ${mixed ? codeText(cell, orig) : label(orig)}</span>` : ''
        ].filter(Boolean).join(' · ');
        return `
            <div class="scrv-row ${tone}" data-row="${q}">
                <div class="scrv-img${labels.length > 5 ? ' is-multi' : ''}">
                    <span class="scrv-qn">${name}</span>
                    <canvas data-crop="${q}" width="10" height="2" aria-hidden="true"></canvas>
                    <div class="scrv-ph" data-ph="${q}"></div>
                </div>
                <div class="scrv-side">
                    <div class="scrv-opts${labels.length > 5 ? ' is-multi' : ''}" role="group" aria-label="Question ${name} answer">${opts}</div>
                    <div class="scrv-note" data-note="${q}">${note}</div>
                </div>
            </div>`;
    },

    // Which set (version) of the exam this sheet was shaded for: the SET row of the photo and the letters.
    setHtml: (sheet) => {
        const { session } = CourseScanReview.detail;
        const n = (session.Set_Keys || []).length;
        if (n < 2) return '';
        const cur = sheet.Set_No > 0 ? sheet.Set_No : 0;
        return `<div class="scrv-set"><div class="scrv-img"><span class="scrv-qn">SET</span><canvas data-setcrop width="10" height="2" aria-hidden="true"></canvas></div>
            <div class="scrv-setl" role="group" aria-label="Set of this sheet">${Array.from({ length: n }, (_, k) => `<span class="scrv-setc${k === cur ? ' is-on' : ''}">${SET_LETTERS[k]}</span>`).join('')}</div></div>`;
    },

    // A question written on the paper (identification, enumeration, essay) sits in the list in its own number order:
    // the photo of the lines on the left, check / wrong on the right (points can also be typed when it is worth more than 1).
    writtenHtml: (sheet, it, i) => {
        const pts = questionPoints(it.row), m = CourseScanReview.marksOf(sheet)[i];
        const label = itemLabel(it);
        const typed = pts > 1 ? `<input type="number" min="0" max="${pts}" step="0.5" inputmode="decimal" class="scrv-mark w-full mt-1 px-2 py-1 border border-gray-300 rounded text-sm bg-white" data-i="${i}" value="${m !== undefined ? m : ''}" placeholder="points / ${fmt(pts)}" aria-label="Points for question ${label}">` : '';
        return `
            <div class="scrv-row" data-w="${i}">
                <div class="scrv-img is-multi">
                    <span class="scrv-qn">${label}</span>
                    <canvas data-wcrop="${i}" width="10" height="2" aria-hidden="true"></canvas>
                    <div class="scrv-ph" data-wph="${i}"></div>
                </div>
                <div class="scrv-side">
                    <div class="scrv-opts" role="group" aria-label="Question ${label} marked by hand">
                        <button type="button" class="scrv-opt scrv-wm" data-wm="${i}" data-v="ok" aria-label="Question ${label} correct"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
                        <button type="button" class="scrv-opt scrv-wm" data-wm="${i}" data-v="no" aria-label="Question ${label} wrong"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </div>
                    ${typed}
                    <div class="scrv-note" data-wnote="${i}"></div>
                </div>
            </div>`;
    },

    // Items marked by hand of the open sheet: [{ it, i }] in question order.
    manualOf: (sheet) => {
        const { session } = CourseScanReview.detail;
        if (!session.Layout) return [];
        const sk = keyOfSheet(session, sheet);
        return (sk.set ? sk.set.items : []).map((it, i) => ({ it, i })).filter(x => x.it.t === 'manual');
    },

    // Scanned rows and hand-marked questions in one list, ordered by question number.
    listHtml: (sheet) => {
        const { session } = CourseScanReview.detail;
        const manual = CourseScanReview.manualOf(sheet).slice();
        const out = [];
        CourseScanReview.rows.forEach(r => {
            const no = session.Layout ? Number(session.Layout[r.q][2]) : 0;
            while (manual.length && manual[0].it.no < no) { const x = manual.shift(); out.push(CourseScanReview.writtenHtml(sheet, x.it, x.i)); }
            out.push(CourseScanReview.rowHtml(sheet, r.q));
        });
        manual.forEach(x => out.push(CourseScanReview.writtenHtml(sheet, x.it, x.i)));
        return out.join('');
    },

    // Sets the marks of a hand-marked question: right = full points, wrong = 0; the same button again clears it.
    markWritten: (i, v) => {
        const sheet = CourseScanReview.current();
        if (!sheet) return;
        const x = CourseScanReview.manualOf(sheet).find(m => m.i === i);
        if (!x) return;
        const pts = questionPoints(x.it.row), marks = { ...CourseScanReview.marksOf(sheet) };
        const want = v === 'ok' ? pts : 0, cur = marks[i];
        if (cur !== undefined && Number(cur) === want) delete marks[i]; else marks[i] = want;
        CourseScanReview.markDrafts[sheet.Sheet_ID] = marks;
        const inp = document.querySelector(`#scrvBody .scrv-mark[data-i="${i}"]`);
        if (inp) inp.value = marks[i] !== undefined ? marks[i] : '';
        CourseScanReview.refresh();
    },

    show: async () => {
        const sheet = CourseScanReview.current();
        const { session } = CourseScanReview.detail;
        if (!sheet) return;
        const mine = ++CourseScanReview.token;
        if (CourseScanReview.bitmap) { try { CourseScanReview.bitmap.close(); } catch (e) { /* ignore */ } CourseScanReview.bitmap = null; }

        $('scrvName').textContent = sheet.Name || 'Unknown student';
        $('scrvSub').textContent = `${(session.Set_Keys || []).length > 1 ? `Set ${SET_LETTERS[sheet.Set_No > 0 ? sheet.Set_No : 0]} · ` : ''}${sheet.Student_Number || ''}${sheet.Student_No_Read ? ` · scanned ${sheet.Student_No_Read}` : ''} · ${CourseScanReview.idx + 1} of ${CourseScanReview.order.length}`;
        $('scrvPrev').disabled = CourseScanReview.idx === 0;
        $('scrvNext').disabled = CourseScanReview.idx === CourseScanReview.order.length - 1;

        $('scrvBody').innerHTML = `<div class="max-w-4xl mx-auto w-full">${CourseScanReview.setHtml(sheet)}${CourseScanReview.listHtml(sheet)}</div>`;
        CourseScanReview.refresh();

        const note = $('scrvNote');
        const setNote = (html, cls = '') => {
            if (!note) return;
            note.className = html ? `scrv-banner ${cls}` : 'hidden';
            note.innerHTML = html || '';
        };
        const phs = () => document.querySelectorAll('#scrvBody [data-ph], #scrvBody [data-wph]');

        if (!sheet.Photo_File_ID && !(sheet.Scan_ID && await ScanPhotos.local(sheet.Scan_ID))) {
            setNote('No photo was saved for this sheet. You can still correct the answers.', 'is-info');
            phs().forEach(p => { p.textContent = 'no photo'; p.classList.add('is-empty'); });
            return;
        }
        setNote('');
        phs().forEach(p => p.classList.add('is-loading'));
        try {
            let { blob, layout, source } = await PhotoCache.get(sheet);
            if (mine !== CourseScanReview.token) return;
            if (layout !== RECT_LAYOUT) {
                // Older plain photo: find the sheet in it and straighten it here, once; the result is kept for 7 days.
                const fixed = await straightenLegacy(blob, session.Layout || session.Num_Questions, session.Num_Choices, CourseScanReview.geo);
                if (mine !== CourseScanReview.token) return;
                if (fixed) {
                    blob = fixed; layout = RECT_LAYOUT;
                    PhotoCache.put(sheet.Photo_File_ID, blob, layout).catch(() => {});
                }
            }
            const bitmap = await createImageBitmap(blob);
            if (mine !== CourseScanReview.token) { bitmap.close(); return; }
            CourseScanReview.bitmap = bitmap;
            if (layout === RECT_LAYOUT) {
                const align = alignRows(bitmap, CourseScanReview.rows);   // cut where the rows really are in this photo
                CourseScanReview.rows.forEach(r => {
                    const canvas = document.querySelector(`#scrvBody canvas[data-crop="${r.q}"]`);
                    if (canvas) { drawCrops(canvas, bitmap, cropBoxes(r, align)); canvas.classList.add('is-ready'); }
                });
                CourseScanReview.manualOf(sheet).forEach(({ it, i }) => {
                    const canvas = document.querySelector(`#scrvBody canvas[data-wcrop="${i}"]`);
                    const boxes = CourseScanReview.lay ? writtenBoxes(CourseScanReview.lay, { no: it.no, span: it.span ?? it.sp, type: rowType(it.row || []) === 'essay' ? 'essay' : 'id' }) : [];
                    if (canvas && boxes.length) { drawCrops(canvas, bitmap, boxes); canvas.classList.add('is-ready'); }
                });
                const sc = document.querySelector('#scrvBody canvas[data-setcrop]');
                if (sc) { drawCrop(sc, bitmap, setBox((session.Set_Keys || []).length)); sc.classList.add('is-ready'); }
                phs().forEach(p => p.remove());
                if (source === 'old-cache') setNote('Could not reach the server, showing the copy kept on this device.', 'is-info');
            } else {
                // Older photo (not straightened): rows cannot be cut out, show the whole sheet on top instead.
                phs().forEach(p => { p.textContent = 'see photo above'; p.classList.remove('is-loading'); p.classList.add('is-empty'); });
                const url = URL.createObjectURL(blob);
                const body = $('scrvBody');
                const box = document.createElement('div');
                box.className = 'scrv-whole';
                box.innerHTML = `<img alt="Scanned answer sheet" src="${url}">`;
                box.querySelector('img').onload = () => setTimeout(() => URL.revokeObjectURL(url), 30000);
                body.insertBefore(box, body.firstChild);
                setNote('The sheet could not be located in this older photo, so the whole sheet is shown. Scan it again to get per-question crops.', 'is-info');
            }
        } catch (err) {
            if (mine !== CourseScanReview.token) return;
            phs().forEach(p => { p.classList.remove('is-loading'); p.classList.add('is-empty'); p.textContent = 'not loaded'; });
            setNote(`The photo could not be loaded (${esc((err && err.message) || 'offline')}). <button type="button" id="scrvRetry" class="underline font-black">Try again</button>`, 'is-warn');
        }
    },

    // Updates colours, scanned/key note, score and buttons for the open sheet without redrawing the photos.
    refresh: () => {
        const sheet = CourseScanReview.current();
        if (!sheet) return;
        const { session } = CourseScanReview.detail;
        const { key, bonus } = keyOfSheet(session, sheet);
        const draft = CourseScanReview.draftOf(sheet);
        const g = gradeSheet(session, sheet, draft, CourseScanReview.marksOf(sheet));
        const maxText = session.Max_Score == null ? '?' : fmt(session.Max_Score);

        $('scrvScore').textContent = `${fmt(g.score)}/${maxText}`;
        $('scrvPreview').textContent = `${(session.Set_Keys || []).length > 1 ? `Set ${SET_LETTERS[sheet.Set_No || 0]}: ` : ''}${g.raw} ${g.points ? 'pts' : 'correct'}${g.bonus ? ` + ${g.bonus} bonus` : ''}, ${g.wrong} wrong, ${g.blank} blank${g.multiple ? `, ${g.multiple} double` : ''}${g.pending ? `, ${g.pending} to mark` : ''}`;
        const dirty = CourseScanReview.dirty(sheet);
        const save = $('scrvSave');
        save.disabled = !dirty || session.Max_Score == null || CourseScanReview.busy;
        save.textContent = dirty ? 'Save' : (sheet.Edited ? 'Saved' : 'Save');
        $('scrvReset').classList.toggle('hidden', same(draft, sheet.Original_Answers));

        draft.forEach((cur, q) => {
            const row = document.querySelector(`#scrvBody [data-row="${q}"]`);
            if (!row) return;
            const cell = session.Layout ? session.Layout[q] : null;
            row.classList.toggle('is-right', cur === key[q]);
            row.classList.toggle('is-wrong', cur !== key[q]);
            row.querySelectorAll('.scrv-opt').forEach(b => {
                const kk = Number(b.dataset.k);
                const on = cell && cell[0] === 'm' ? cur >= 1000 && ((cur - 1000) & (1 << kk)) !== 0 : kk === cur;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            const orig = sheet.Original_Answers[q];
            const noteEl = row.querySelector('[data-note]');
            if (noteEl) {
                noteEl.innerHTML = [
                    `key ${cell ? codeText(cell, key[q]) : LETTERS[key[q]]}${bonus[q] ? ' (bonus)' : ''}`,
                    cur === BLANK ? '<b class="text-gray-600">blank</b>' : cur === MULTIPLE ? '<b class="text-amber-700">double-shaded: pick one</b>' : '',
                    orig !== cur ? `<span class="text-amber-700 font-bold">scanned: ${cell ? codeText(cell, orig) : label(orig)}</span>` : ''
                ].filter(Boolean).join(' · ');
            }
        });
        const marks = CourseScanReview.marksOf(sheet);
        CourseScanReview.manualOf(sheet).forEach(({ it, i }) => {
            const card = document.querySelector(`#scrvBody [data-w="${i}"]`);
            if (!card) return;
            const pts = questionPoints(it.row), m = marks[i];
            const has = m !== undefined && m !== null && m !== '' && Number.isFinite(Number(m));
            const full = has && Number(m) >= pts, none = has && Number(m) <= 0;
            card.classList.toggle('is-right', full);
            card.classList.toggle('is-wrong', has && !full);
            card.querySelectorAll('.scrv-wm').forEach(b => { const on = b.dataset.v === 'ok' ? full : none; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
            const n = card.querySelector('[data-wnote]');
            if (n) n.innerHTML = has ? `${fmt(Number(m))} / ${fmt(pts)}${it.b ? ' (bonus)' : ''}` : `<b class="text-amber-700">not marked yet</b> · ${fmt(pts)} pt${pts === 1 ? '' : 's'}`;
        });
        // Keep the picker's mark and score for this student current.
        const opt = $('scrvPick') && $('scrvPick').options[CourseScanReview.idx];
        if (opt) opt.textContent = `${CourseScanReview.idx + 1}. ${sheet.Name || 'Unknown student'} — ${fmt(g.score)}${dirty ? ' •' : ''}`;
    },

    // ---------- Actions ----------

    choose: (q, k) => {
        const sheet = CourseScanReview.current();
        if (!sheet) return;
        const draft = CourseScanReview.draftOf(sheet).slice();
        const { session } = CourseScanReview.detail;
        if (session.Layout && session.Layout[q][0] === 'm') {
            // Multiple answer: every tap turns one choice on or off.
            const cur = draft[q] >= 1000 ? draft[q] - 1000 : 0;
            const next = cur ^ (1 << k);
            draft[q] = next ? 1000 + next : BLANK;
        } else {
            // Tapping the chosen letter again clears the answer (blank).
            draft[q] = draft[q] === k ? BLANK : k;
        }
        CourseScanReview.drafts[sheet.Sheet_ID] = draft;
        CourseScanReview.refresh();
    },

    reset: () => {
        const sheet = CourseScanReview.current();
        if (!sheet) return;
        CourseScanReview.drafts[sheet.Sheet_ID] = sheet.Original_Answers.slice();
        delete CourseScanReview.markDrafts[sheet.Sheet_ID];
        if (sheet.Marks && Object.keys(sheet.Marks).length) CourseScanReview.markDrafts[sheet.Sheet_ID] = { ...sheet.Marks };
        CourseScanReview.refresh();
    },

    save: async () => {
        const sheet = CourseScanReview.current();
        if (!sheet || CourseScanReview.busy) return;
        const draft = CourseScanReview.draftOf(sheet);
        if (!CourseScanReview.dirty(sheet)) return;
        const { session: sess } = CourseScanReview.detail;
        const marks = CourseScanReview.marksOf(sheet);
        CourseScanReview.busy = true;
        const btn = $('scrvSave');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
        try {
            const res = await apiPost('/api/scan-sheets/correct', { sheetId: sheet.Sheet_ID, answers: draft, marks: sess.Layout ? marks : undefined });
            sheet.Answers = draft.slice();
            sheet.Marks = { ...marks };
            delete CourseScanReview.markDrafts[sheet.Sheet_ID];
            sheet.Score = res.score;
            sheet.Edited = res.edited ? 1 : 0;
            delete CourseScanReview.drafts[sheet.Sheet_ID];
            UI.success(`${sheet.Name || 'Student'} saved: ${fmt(res.score)} (updated in Record Scores)`);
            if (CourseScanReview.onChange) CourseScanReview.onChange();
        } catch (err) {
            UI.error(err.message || 'Failed to save the correction.');
        } finally {
            CourseScanReview.busy = false;
            btn.textContent = 'Save';
            CourseScanReview.refresh();
        }
    },

    requestClose: async () => {
        if (CourseScanReview.anyDirty()) {
            const ok = await UI.confirm({ title: 'Discard unsaved corrections?', message: 'Some students have corrections that are not saved yet.', confirmText: 'Discard', danger: true });
            if (!ok) return;
        }
        CourseScanReview.close();
    },

    close: (silent = false) => {
        const wrap = $('scrReview');
        if (wrap) wrap.remove();
        if (CourseScanReview.keyHandler) document.removeEventListener('keydown', CourseScanReview.keyHandler);
        CourseScanReview.keyHandler = null;
        CourseScanReview.token++;
        if (CourseScanReview.bitmap) { try { CourseScanReview.bitmap.close(); } catch (e) { /* ignore */ } CourseScanReview.bitmap = null; }
        if (!silent && CourseScanReview.onChange) CourseScanReview.onChange();
        CourseScanReview.drafts = {};
    },

    onClick: (e) => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        const wm = t.closest('.scrv-wm');
        if (wm) { CourseScanReview.markWritten(Number(wm.dataset.wm), wm.dataset.v); return; }
        const opt = t.closest('.scrv-opt');
        if (opt) { CourseScanReview.choose(Number(opt.dataset.q), Number(opt.dataset.k)); return; }
        if (t.closest('#scrvPrev')) { CourseScanReview.go(CourseScanReview.idx - 1); return; }
        if (t.closest('#scrvNext')) { CourseScanReview.go(CourseScanReview.idx + 1); return; }
        if (t.closest('#scrvSave')) { CourseScanReview.save(); return; }
        if (t.closest('#scrvReset')) { CourseScanReview.reset(); return; }
        if (t.closest('#scrvClose')) { CourseScanReview.requestClose(); return; }
        if (t.closest('#scrvRetry')) { CourseScanReview.show(); }
    }
};
