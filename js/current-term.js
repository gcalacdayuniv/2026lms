// The current academic term (Academic Year + Semester). An admin lecturer sets it by hand from Admin tools;
// until one is set it follows the calendar in GMT+8. The value is cached so screens can read it at once.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';

export const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];
const KEY = 'current_term_cache';

// Calendar fallback in GMT+8: Aug-Dec 1st semester, Jan-May 2nd, Jun-Jul Summer.
export const calendarTerm = (now = new Date()) => {
    const d = new Date(now.getTime() + 8 * 3600 * 1000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    if (m >= 8) return { ay: `${y}-${y + 1}`, sem: '1st Semester', source: 'calendar' };
    return { ay: `${y - 1}-${y}`, sem: m <= 5 ? '2nd Semester' : 'Summer', source: 'calendar' };
};

let term = null;
const read = () => {
    try { const t = JSON.parse(localStorage.getItem(KEY) || 'null'); if (t && t.ay && t.sem) return t; } catch (e) { /* no cache */ }
    return null;
};
const save = (t) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* private mode */ } };

export const getTerm = () => term || (term = read()) || calendarTerm();

const apply = (t) => {
    const before = JSON.stringify(getTerm());
    term = { ay: t.ay, sem: t.sem, source: t.source || 'calendar', updatedBy: t.updatedBy || null, updatedAt: t.updatedAt || null };
    save(term);
    if (JSON.stringify(term) !== before) document.dispatchEvent(new CustomEvent('term-changed', { detail: term }));
    return term;
};

// Fetch the shared value; keep the cached one if offline.
export const loadTerm = async () => {
    try {
        const r = await apiFetch('/api/current-term');
        if (r && r.ay) return apply(r);
    } catch (e) { /* offline: use the cache or the calendar */ }
    return getTerm();
};

// ---- the Admin tools dialog ----
const $ = (id) => document.getElementById(id);
const close = () => { const m = $('ctModal'); if (m) m.remove(); };
const FIELD = 'w-full border border-gray-300 rounded-md p-2 text-base focus:ring-2 focus:ring-blue-500 outline-none';
const LABEL = 'block text-xs font-bold text-gray-500 uppercase tracking-wider';

const note = (t) => t.source === 'set'
    ? `Set by hand${t.updatedAt ? ` on ${escapeHtml(String(t.updatedAt).slice(0, 10))}` : ''}.`
    : 'Not set by hand yet, so it follows the calendar (GMT+8).';

const open = async () => {
    close();
    const t = await loadTerm();
    const m = document.createElement('div');
    m.id = 'ctModal';
    m.className = 'fixed inset-0 z-[70] flex items-center justify-center fade-in p-4';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Current academic term');
    m.innerHTML = `<div id="ctBg" class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
        <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 relative z-10">
            <h3 class="text-lg font-bold text-gray-800 mb-1"><i class="fa-solid fa-calendar-check text-blue-600 mr-2" aria-hidden="true"></i>Current academic term</h3>
            <p class="text-xs text-gray-600 mb-4">Everyone sees this term as the current one: the class list filter, new classes and student re-activation.</p>
            <div id="ctError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>
            <label for="ctAY" class="${LABEL}">Academic year</label>
            <input id="ctAY" type="text" inputmode="numeric" maxlength="9" placeholder="2026-2027" value="${escapeHtml(t.ay)}" class="${FIELD} mb-3">
            <label for="ctSem" class="${LABEL}">Semester</label>
            <select id="ctSem" class="${FIELD} mb-2">${SEMESTERS.map(s => `<option${s === t.sem ? ' selected' : ''}>${s}</option>`).join('')}</select>
            <p id="ctNote" class="text-xs text-gray-500 mb-4">${note(t)}</p>
            <div class="flex flex-wrap justify-end gap-2">
                <button type="button" id="ctResetBtn" class="px-3 py-2 min-h-[44px] text-sm font-bold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Use calendar</button>
                <button type="button" id="ctCloseBtn" class="px-3 py-2 min-h-[44px] text-sm font-bold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Close</button>
                <button type="button" id="ctSaveBtn" class="px-4 py-2 min-h-[44px] text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700">Save</button>
            </div>
        </div>`;
    document.body.appendChild(m);
    $('ctAY').focus();
};

const send = async (body) => {
    const err = $('ctError');
    err.classList.add('hidden');
    try {
        const r = await apiFetch('/api/current-term', { method: 'POST', body: JSON.stringify({ ...body, userId: AppState.user && AppState.user.User_ID }) });
        apply(r);
        $('ctAY').value = r.ay; $('ctSem').value = r.sem; $('ctNote').innerHTML = note(r);
        UI.success(`Current term: AY ${r.ay}, ${r.sem}`);
    } catch (e) {
        err.textContent = (e && e.message) || 'Could not save the term.';
        err.classList.remove('hidden');
    }
};

document.addEventListener('click', (e) => {
    if (e.target.closest('#openCtModalBtn')) { open(); return; }
    if (e.target.closest('#ctCloseBtn') || e.target.id === 'ctBg') { close(); return; }
    if (e.target.closest('#ctSaveBtn')) { send({ ay: $('ctAY').value.trim(), sem: $('ctSem').value }); return; }
    if (e.target.closest('#ctResetBtn')) send({ reset: true });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('ctModal')) close(); });
