// Students who forgot their password ask their lecturer; the lecturer sees the requests in Manage Users.
import { apiFetch, AppState, apiPost } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';

const $ = (id) => document.getElementById(id);
let requests = [];

const load = async () => {
    const me = AppState.user && AppState.user.User_ID;
    if (!me) return [];
    try {
        const r = await apiFetch(`/api/password-reset-requests?lecturerId=${encodeURIComponent(me)}&_t=${Date.now()}`);
        requests = r.requests || [];
    } catch (e) { requests = []; }
    return requests;
};

// The red number on the Manage Users tile.
export const refreshResetBadge = async () => {
    await load();
    const n = String(requests.length);
    const b = $('muReqBadge');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !requests.length); }
    const d = $('adminToolsBadge');
    if (d) { d.textContent = n; d.classList.toggle('hidden', !requests.length); d.classList.toggle('inline-flex', !!requests.length); }
    const t = $('adminTabBadge');
    if (t) {
        t.textContent = n; t.classList.toggle('hidden', !requests.length); t.classList.toggle('flex', !!requests.length);
        const btn = t.closest('button');
        if (btn) btn.setAttribute('aria-label', requests.length ? `Admin, ${n} password reset request${requests.length > 1 ? 's' : ''}` : 'Admin');
    }
};

const when = (iso) => { try { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch (e) { return ''; } };

const paint = () => {
    const panel = $('muResetPanel');
    if (!panel) return;
    if (!requests.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="border border-amber-300 bg-amber-50 rounded-md p-3">
        <p class="text-sm font-bold text-gray-800 mb-2"><i class="fa-solid fa-key text-amber-600 mr-1.5" aria-hidden="true"></i>Password reset requests (${requests.length})</p>
        <ul class="space-y-2 max-h-48 overflow-y-auto">${requests.map(r => `<li class="bg-white border border-amber-200 rounded-md p-2 flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1"><p class="text-sm font-bold text-gray-800 truncate">${escapeHtml(r.Name || r.Username)}</p>
            <p class="text-xs text-gray-500 truncate">${escapeHtml(r.Student_Number || '')}${r.Classes ? ' &bull; ' + escapeHtml(r.Classes) : ''} &bull; ${escapeHtml(when(r.Requested_At))}</p></div>
            <button type="button" class="pr-reset min-h-[44px] px-3 text-xs font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700" data-id="${escapeHtml(r.User_ID)}">Reset password</button>
            <button type="button" class="pr-dismiss min-h-[44px] px-3 text-xs font-bold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200" data-id="${escapeHtml(r.User_ID)}">Dismiss</button></li>`).join('')}</ul></div>`;
};

const drop = (id) => { requests = requests.filter(r => r.User_ID !== id); paint(); refreshResetBadge(); };

document.addEventListener('click', async (e) => {
    if (e.target.closest('#openMuModalBtn')) { await load(); paint(); return; }
    const reset = e.target.closest('.pr-reset');
    if (reset) {
        const id = reset.dataset.id;
        if (!(await UI.confirm({ title: 'Reset password', message: "Reset this student's password? A temporary password will be emailed to the student (shown to you only if the email cannot be sent).", confirmText: 'Reset', danger: true }))) return;
        reset.disabled = true;
        try {
            const res = await apiPost('/api/reset-student-password', { studentId: id });
            drop(id);
            if (res.emailed) UI.success(`New password emailed to ${res.email}.`);
                    else await UI.confirm({ title: 'Temporary password', message: `The email could not be sent (no email on file or mail not set up).\n\nNew password: ${res.tempPassword}\n\nGive it to the student now; it is not shown again. They should change it after signing in.`, confirmText: 'Done' });
        } catch (err) { UI.error('Failed to reset password: ' + err.message); reset.disabled = false; }
        return;
    }
    const dismiss = e.target.closest('.pr-dismiss');
    if (dismiss) {
        try { await apiPost('/api/dismiss-password-request', { studentId: dismiss.dataset.id }); drop(dismiss.dataset.id); }
        catch (err) { UI.error(err.message || 'Could not dismiss'); }
    }
});
