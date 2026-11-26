// js/print-prefs.js
// The paper size a lecturer prints on. A4 unless they chose otherwise. The choice is saved on the server (per user),
// so it follows them to any phone or computer; this device also keeps a copy so the dialog opens instantly and
// still works offline.
import { apiFetch, AppState, apiPost } from './globals.js';

const KEY = 'lms_print_paper';
const VALID = ['a4', 'letter', 'legal'];
export const DEFAULT_PAPER = 'a4';

const local = () => {
    try { const v = localStorage.getItem(KEY); return VALID.includes(v) ? v : null; } catch (e) { return null; }
};

// What to show right now (this device's copy, else A4).
export const currentPaper = () => local() || DEFAULT_PAPER;

// Asks the server for the saved choice and refreshes this device's copy. Resolves with the paper to use.
export const loadPaper = async () => {
    const uid = AppState.user && AppState.user.User_ID;
    if (!uid) return currentPaper();
    try {
        const r = await apiFetch(`/api/my-prefs?userId=${encodeURIComponent(uid)}&_t=${Date.now()}`);
        if (VALID.includes(r.paper)) {
            try { localStorage.setItem(KEY, r.paper); } catch (e) { /* storage unavailable */ }
            return r.paper;
        }
        // Nothing saved on the server yet: keep this device's earlier choice (if any) and save it there.
        const mine = local();
        if (mine) savePaper(mine);
    } catch (e) { /* offline: use the copy on this device */ }
    return currentPaper();
};

export const savePaper = (paper) => {
    if (!VALID.includes(paper)) return;
    try { localStorage.setItem(KEY, paper); } catch (e) { /* storage unavailable */ }
    const uid = AppState.user && AppState.user.User_ID;
    if (!uid) return;
    apiPost('/api/my-prefs', { userId: uid, paper }).catch(() => { /* retried next time it is changed */ });
};

// Wires a <select> to the preference: shows the saved choice, saves on change.
export const bindPaperSelect = async (select) => {
    if (!select) return;
    select.value = currentPaper();
    if (!select.dataset.paperBound) {
        select.dataset.paperBound = '1';
        select.addEventListener('change', () => savePaper(select.value));
    }
    const fresh = await loadPaper();
    if (select.value !== fresh && !select.dataset.userChanged) select.value = fresh;
};
