// Advance Year Level: moves every registered student up one year level for the next academic year.
// Flow: choose the new academic year and the highest year level -> Preview (counts) -> Advance (confirm). The last run can be undone.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { getTerm } from './current-term.js';

const FIELD = 'w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm';
const LABEL = 'block text-xs font-bold text-gray-500 uppercase tracking-wider';

// The academic year after the current term's (the term is set in Admin tools).
const defaultAY = () => {
    const start = Number(getTerm().ay.slice(0, 4)) + 1;
    return `${start}-${start + 1}`;
};

const call = (body) => apiFetch('/api/advance-year-level', {
    method: 'POST',
    body: JSON.stringify({ ...body, lecturerId: AppState.user && AppState.user.User_ID })
});

const $ = (id) => document.getElementById(id);
const close = () => UI.closeOverlay('yaModal');

// Programs whose highest year differs from the default (rows appear after Preview).
const programMaxValues = () => {
    const rows = document.querySelectorAll('#yaPrograms select[data-program]');
    if (!rows.length) return undefined;   // not shown yet: the server uses the remembered ones
    const out = {};
    const def = $('yaMax') ? $('yaMax').value : '';
    rows.forEach(sel => { if (sel.value !== def) out[sel.dataset.program] = Number(sel.value); });
    return out;
};

const values = () => ({
    academicYear: $('yaAY').value.trim(),
    maxYear: Number($('yaMax').value),
    programMax: programMaxValues(),
    markGraduated: Boolean($('yaGrad') && $('yaGrad').checked),
    reactivationUntil: $('yaUntil') ? $('yaUntil').value : ''
});

// A collapsible list (names only, capped by the server at 300).
const listHtml = (title, items, total) => {
    if (!items || !items.length) return '';
    return `<details class="mt-3 border border-gray-200 rounded-md"><summary class="cursor-pointer px-3 py-2 text-xs font-bold text-gray-700">${escapeHtml(title)} (${total})</summary>
        <ul class="max-h-40 overflow-y-auto px-3 pb-2 text-xs text-gray-700 space-y-0.5">${items.join('')}</ul>${total > items.length ? `<p class="px-3 pb-2 text-[11px] text-gray-500">Showing the first ${items.length}.</p>` : ''}</details>`;
};

// One row per program with its own "highest year" (default follows the box above).
const programsHtml = (r) => {
    const list = r.programs || [];
    if (!list.length) return '';
    const opts = (cur) => [1, 2, 3, 4, 5, 6, 7].map(n => `<option${n === cur ? ' selected' : ''}>${n}</option>`).join('');
    return `<div id="yaPrograms" class="mt-3 border border-gray-200 rounded-md p-3">
        <p class="text-xs font-bold text-gray-700 mb-1">Highest year per program</p>
        <p class="text-[11px] text-gray-500 mb-2">Set 5 for programs that run five years. Preview again after changing. Remembered for next time.</p>
        <div class="space-y-1.5 max-h-48 overflow-y-auto">${list.map((p, i) => `<div class="flex items-center gap-2">
            <label for="yaPg${i}" class="min-w-0 flex-1 text-xs text-gray-700 truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)} <span class="text-gray-400">(${p.count})</span></label>
            <select id="yaPg${i}" data-program="${escapeHtml(p.name)}" class="w-16 border border-gray-300 rounded-md p-1.5 text-base">${opts(p.maxYear)}</select></div>`).join('')}</div></div>`;
};

const showSummary = (r) => {
    const box = $('yaResult');
    const adv = (r.advanceList || []).map(s => `<li>${escapeHtml(s.name || '')}: ${escapeHtml(s.from || '-')} &rarr; ${escapeHtml(s.to || '-')}</li>`);
    const grad = (r.graduatingList || []).map(s => `<li>${escapeHtml(s.name || '')} (year ${escapeHtml(s.year || '-')})</li>`);
    const none = (r.noYearList || []).map(n => `<li>${escapeHtml(n || '')}</li>`);
    box.innerHTML = `
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-md bg-green-50 border border-green-200 p-2"><div class="text-xl font-bold text-green-700">${r.advance}</div><div class="text-[10px] font-bold uppercase text-green-700">Will advance</div><div class="text-[10px] text-green-700">${r.deactivate} set Inactive</div></div>
            <div class="rounded-md bg-gray-50 border border-gray-200 p-2"><div class="text-xl font-bold text-gray-700">${r.graduating}</div><div class="text-[10px] font-bold uppercase text-gray-600">Graduating (year ${r.maxYear})</div></div>
            <div class="rounded-md bg-amber-50 border border-amber-200 p-2"><div class="text-xl font-bold text-amber-700">${r.unrecognized}</div><div class="text-[10px] font-bold uppercase text-amber-700">No year set</div></div>
        </div>
        ${programsHtml(r)}
        ${listHtml('Students who will advance', adv, r.advance)}${listHtml('Graduating students (unchanged)', grad, r.graduating)}${listHtml('Students with no year set (unchanged)', none, r.unrecognized)}
        ${r.graduating ? `<label class="mt-3 flex items-start gap-2 text-xs text-gray-700"><input type="checkbox" id="yaGrad" class="mt-0.5"><span>Also mark the ${r.graduating} graduating student${r.graduating === 1 ? '' : 's'} as <b>Graduated</b>. They can no longer sign in. Undo restores their status.</span></label>` : ''}
        ${r.alreadyDone ? `<p class="mt-3 text-xs font-bold text-red-600">Year levels were already advanced for ${escapeHtml($('yaAY').value.trim())}.</p>` : ''}`;
    box.classList.remove('hidden');
    $('yaApplyBtn').disabled = !r.advance || r.alreadyDone;
};

const refreshLast = (last) => {
    const b = $('yaUndoBtn');
    if (!b) return;
    b.classList.toggle('hidden', !last);
    if (last) b.textContent = `Undo last advance (${last.academicYear || 'no label'}, ${last.advanced} students)`;
};

const open = async () => {
    close();
    const dlg = UI.overlay({ id: 'yaModal', label: 'Advance year level', z: 70, padClass: 'p-0 sm:p-4', panelClass: 'bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 max-h-full sm:max-h-[90vh] overflow-y-auto', html: `
            <div class="flex items-center gap-3 mb-4 border-b pb-3">
                <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-turn-up text-orange-600 mr-2" aria-hidden="true"></i>Advance Year Level</h3>
                <button id="yaCloseBtn" type="button" aria-label="Close" class="text-gray-400 hover:text-gray-800"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
            </div>
            <p class="text-xs text-gray-600 mb-3">Moves every registered student up one year level (1 &rarr; 2, 2nd &rarr; 3rd). Students already at the highest level, or with no year, are left unchanged. Classes limited to a target year follow the new level.</p>
            <p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 mb-4"><b>Advanced students are set Inactive</b> and cannot sign in until reactivated: when you set them Active, when you enroll them in a class of the new term, or after they request reactivation at the login screen (you will see "Reactivation requested" on their row). Other statuses (Suspended, UD, Dropped...) still cannot sign in either.</p>
            <div class="space-y-4">
                <div id="yaError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                <div class="grid grid-cols-2 gap-4">
                    <div><label class="${LABEL}" for="yaAY">New academic year</label><input type="text" id="yaAY" maxlength="9" inputmode="numeric" class="${FIELD}" value="${defaultAY()}" placeholder="2027-2028"></div>
                    <div><label class="${LABEL}" for="yaMax">Highest year level</label>
                        <select id="yaMax" class="${FIELD}">${[2, 3, 4, 5, 6].map(n => `<option${n === 4 ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
                </div>
                <div><label class="${LABEL}" for="yaUntil">Reactivation requests allowed until (optional)</label><input type="date" id="yaUntil" class="${FIELD}"></div>
                <button type="button" id="yaPreviewBtn" class="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 py-2.5 px-4 rounded-md font-bold text-sm">Preview</button>
                <div id="yaResult" class="hidden"></div>
                <button type="button" id="yaApplyBtn" disabled class="w-full bg-orange-600 text-white py-2.5 px-4 rounded-md hover:bg-orange-700 shadow-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Advance all students</button>
                <button type="button" id="yaUndoBtn" class="hidden w-full border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 py-2 px-4 rounded-md font-bold text-xs"></button>
            </div>
        ` });
    const m = dlg.el;
    try { refreshLast((await call({ mode: 'preview', ...values() })).last); } catch (e) { /* undo button stays hidden */ }
};

const fail = (e) => { const x = $('yaError'); x.textContent = e.message || 'Something went wrong'; x.classList.remove('hidden'); };

const preview = async () => {
    $('yaError').classList.add('hidden');
    $('yaApplyBtn').disabled = true;
    try { const r = await call({ mode: 'preview', ...values() }); showSummary(r); refreshLast(r.last); } catch (e) { fail(e); }
};

const apply = async () => {
    const v = values();
    $('yaError').classList.add('hidden');
    const ok = await UI.confirm({
        title: 'Advance all students?',
        message: `Every student's year level goes up by one for ${v.academicYear} and they are set Inactive until reactivated${v.markGraduated ? ' and graduating students are marked Graduated' : ''}. You can undo the latest run afterwards.`,
        confirmText: 'Advance', danger: true
    });
    if (!ok) return;
    const b = $('yaApplyBtn');
    b.disabled = true; b.textContent = 'Advancing...';
    try {
        const r = await call({ mode: 'apply', ...v });
        UI.success(`${r.advance} students advanced${r.graduated ? `, ${r.graduated} marked Graduated` : ''}`);
        b.textContent = 'Advance all students';
        await preview();
        $('yaApplyBtn').disabled = true;
    } catch (e) { fail(e); b.textContent = 'Advance all students'; b.disabled = false; }
};

const undo = async () => {
    const ok = await UI.confirm({ title: 'Undo the last advance?', message: 'Year levels from the latest run go back to their old values. Levels edited since then are kept.', confirmText: 'Undo', danger: true });
    if (!ok) return;
    try { const r = await call({ mode: 'undo' }); UI.success(`${r.restored} students restored`); await preview(); } catch (e) { fail(e); }
};

document.addEventListener('click', (e) => {
    if (e.target.closest('#openYaModalBtn')) { open(); return; }
    if (e.target.closest('#yaCloseBtn')) { close(); return; }
    if (e.target.closest('#yaPreviewBtn')) { preview(); return; }
    if (e.target.closest('#yaApplyBtn')) { apply(); return; }
    if (e.target.closest('#yaUndoBtn')) undo();
});
document.addEventListener('change', (e) => {
    // Any change to the limits needs a fresh Preview before applying.
    if (e.target.id === 'yaMax' || e.target.closest('#yaPrograms') || e.target.id === 'yaAY') { const b = $('yaApplyBtn'); if (b) b.disabled = true; }
});

export const YearAdvance = { open, close };
