// js/course-scan-review.js
// Full-screen reviewer of saved answer sheets, one student at a time (Previous / Next / student picker).
// Every question is one row in two columns: on the left the photo of that question's row cut out of the
// student's sheet, on the right the choices to correct the answer by hand. Only the photo of the student on
// screen is downloaded (and kept on the device for 7 days, see PhotoCache), never the whole class.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';
import { PhotoCache, ScanPhotos } from './course-scan-photos.js';
import { answerRows } from './omr-sheet.js';
import { cropBox, drawCrop, straightenLegacy, RECT_LAYOUT } from './omr-crop.js';

const LETTERS = 'ABCDE';
const BLANK = -1;
const MULTIPLE = -2;
const fmt = (n) => Number(Number(n).toFixed(2));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const label = (a) => (a === BLANK ? 'blank' : a === MULTIPLE ? 'double' : LETTERS[a] || '?');

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

const $ = (id) => document.getElementById(id);

export const CourseScanReview = {
    detail: null,       // { session, sheets } (shared with the list, so a save shows there at once)
    order: [],          // sheets in the order of the list
    idx: 0,
    drafts: {},         // sheetId -> answers being edited (kept while moving between students)
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
        CourseScanReview.onChange = onChange || null;
        const { session } = detail;
        CourseScanReview.rows = answerRows(session.Num_Questions, session.Num_Choices);
        PhotoCache.purge().catch(() => {});

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
        wrap.querySelector('#scrvPick').addEventListener('change', (e) => CourseScanReview.go(Number(e.target.value)));
        CourseScanReview.keyHandler = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) CourseScanReview.requestClose(); };
        document.addEventListener('keydown', CourseScanReview.keyHandler);

        CourseScanReview.fillPicker();
        CourseScanReview.show();
        wrap.querySelector('#scrvClose').focus();
    },

    current: () => CourseScanReview.order[CourseScanReview.idx],
    draftOf: (sheet) => CourseScanReview.drafts[sheet.Sheet_ID] || sheet.Answers,
    dirty: (sheet) => !same(CourseScanReview.draftOf(sheet), sheet.Answers),
    anyDirty: () => CourseScanReview.order.some(s => CourseScanReview.dirty(s)),

    fillPicker: () => {
        const sel = $('scrvPick');
        if (!sel) return;
        const { session } = CourseScanReview.detail;
        const key = session.Answer_Key, bonus = session.Bonus_Flags.map(Boolean);
        sel.innerHTML = CourseScanReview.order.map((s, i) => {
            const g = grade(CourseScanReview.draftOf(s), key, bonus, session.Max_Score);
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
        const c = session.Num_Choices;
        const key = session.Answer_Key[q];
        const cur = CourseScanReview.draftOf(sheet)[q];
        const orig = sheet.Original_Answers[q];
        const bonus = Boolean(session.Bonus_Flags[q]);
        const tone = cur === key ? 'is-right' : 'is-wrong';
        const opts = Array.from({ length: c }, (_, k) => {
            const cls = ['scrv-opt', cur === k ? 'is-on' : '', k === key ? 'is-key' : ''].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-q="${q}" data-k="${k}" aria-pressed="${cur === k}" aria-label="Question ${q + 1} choice ${LETTERS[k]}${k === key ? ' (answer key)' : ''}">${LETTERS[k]}</button>`;
        }).join('');
        const note = [
            `key ${LETTERS[key]}${bonus ? ' (bonus)' : ''}`,
            cur === BLANK ? '<b class="text-gray-600">blank</b>' : cur === MULTIPLE ? '<b class="text-amber-700">double-shaded: pick one</b>' : '',
            orig !== cur ? `<span class="text-amber-700 font-bold">scanned: ${label(orig)}</span>` : ''
        ].filter(Boolean).join(' · ');
        return `
            <div class="scrv-row ${tone}" data-row="${q}">
                <div class="scrv-img">
                    <span class="scrv-qn">${q + 1}</span>
                    <canvas data-crop="${q}" width="10" height="2" aria-hidden="true"></canvas>
                    <div class="scrv-ph" data-ph="${q}"></div>
                </div>
                <div class="scrv-side">
                    <div class="scrv-opts" role="group" aria-label="Question ${q + 1} answer">${opts}</div>
                    <div class="scrv-note" data-note="${q}">${note}</div>
                </div>
            </div>`;
    },

    show: async () => {
        const sheet = CourseScanReview.current();
        const { session } = CourseScanReview.detail;
        if (!sheet) return;
        const mine = ++CourseScanReview.token;
        if (CourseScanReview.bitmap) { try { CourseScanReview.bitmap.close(); } catch (e) { /* ignore */ } CourseScanReview.bitmap = null; }

        $('scrvName').textContent = sheet.Name || 'Unknown student';
        $('scrvSub').textContent = `${sheet.Student_Number || ''}${sheet.Student_No_Read ? ` · scanned ${sheet.Student_No_Read}` : ''} · ${CourseScanReview.idx + 1} of ${CourseScanReview.order.length}`;
        $('scrvPrev').disabled = CourseScanReview.idx === 0;
        $('scrvNext').disabled = CourseScanReview.idx === CourseScanReview.order.length - 1;

        $('scrvBody').innerHTML = `<div class="max-w-4xl mx-auto w-full">${CourseScanReview.rows.map(r => CourseScanReview.rowHtml(sheet, r.q)).join('')}</div>`;
        CourseScanReview.refresh();

        const note = $('scrvNote');
        const setNote = (html, cls = '') => {
            if (!note) return;
            note.className = html ? `scrv-banner ${cls}` : 'hidden';
            note.innerHTML = html || '';
        };
        const phs = () => document.querySelectorAll('#scrvBody [data-ph]');

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
                const fixed = await straightenLegacy(blob, session.Num_Questions, session.Num_Choices);
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
                CourseScanReview.rows.forEach(r => {
                    const canvas = document.querySelector(`#scrvBody canvas[data-crop="${r.q}"]`);
                    if (canvas) { drawCrop(canvas, bitmap, cropBox(r, session.Num_Choices)); canvas.classList.add('is-ready'); }
                });
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
        const key = session.Answer_Key, bonus = session.Bonus_Flags.map(Boolean);
        const draft = CourseScanReview.draftOf(sheet);
        const g = grade(draft, key, bonus, session.Max_Score);
        const maxText = session.Max_Score == null ? '?' : fmt(session.Max_Score);

        $('scrvScore').textContent = `${fmt(g.score)}/${maxText}`;
        $('scrvPreview').textContent = `${g.raw} correct${g.bonus ? ` + ${g.bonus} bonus` : ''}, ${g.wrong} wrong, ${g.blank} blank${g.multiple ? `, ${g.multiple} double` : ''}`;
        const dirty = !same(draft, sheet.Answers);
        const save = $('scrvSave');
        save.disabled = !dirty || session.Max_Score == null || CourseScanReview.busy;
        save.textContent = dirty ? 'Save' : (sheet.Edited ? 'Saved' : 'Save');
        $('scrvReset').classList.toggle('hidden', same(draft, sheet.Original_Answers));

        draft.forEach((cur, q) => {
            const row = document.querySelector(`#scrvBody [data-row="${q}"]`);
            if (!row) return;
            row.classList.toggle('is-right', cur === key[q]);
            row.classList.toggle('is-wrong', cur !== key[q]);
            row.querySelectorAll('.scrv-opt').forEach(b => {
                const on = Number(b.dataset.k) === cur;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            const orig = sheet.Original_Answers[q];
            const noteEl = row.querySelector('[data-note]');
            if (noteEl) {
                noteEl.innerHTML = [
                    `key ${LETTERS[key[q]]}${bonus[q] ? ' (bonus)' : ''}`,
                    cur === BLANK ? '<b class="text-gray-600">blank</b>' : cur === MULTIPLE ? '<b class="text-amber-700">double-shaded: pick one</b>' : '',
                    orig !== cur ? `<span class="text-amber-700 font-bold">scanned: ${label(orig)}</span>` : ''
                ].filter(Boolean).join(' · ');
            }
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
        // Tapping the chosen letter again clears the answer (blank).
        draft[q] = draft[q] === k ? BLANK : k;
        CourseScanReview.drafts[sheet.Sheet_ID] = draft;
        CourseScanReview.refresh();
    },

    reset: () => {
        const sheet = CourseScanReview.current();
        if (!sheet) return;
        CourseScanReview.drafts[sheet.Sheet_ID] = sheet.Original_Answers.slice();
        CourseScanReview.refresh();
    },

    save: async () => {
        const sheet = CourseScanReview.current();
        if (!sheet || CourseScanReview.busy) return;
        const draft = CourseScanReview.draftOf(sheet);
        if (same(draft, sheet.Answers)) return;
        CourseScanReview.busy = true;
        const btn = $('scrvSave');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
        try {
            const res = await apiFetch('/api/scan-sheets/correct', { method: 'POST', body: JSON.stringify({ sheetId: sheet.Sheet_ID, answers: draft }) });
            sheet.Answers = draft.slice();
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
