// Sign-in screen: "Forgot password?" opens a modal. A student either gets a new password by email (four details must match)
// or asks their lecturer in a second modal (one field: username, student number, email or contact number).
import { apiFetch } from './globals.js';

const $ = (id) => document.getElementById(id);
const open = (id, focusId) => { $(id)?.classList.remove('hidden'); setTimeout(() => $(focusId)?.focus(), 50); };
const close = (id) => $(id)?.classList.add('hidden');
const show = (id, text, ok) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `p-3 rounded text-sm font-medium ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`;
};
const hide = (id) => $(id)?.classList.add('hidden');

document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#forgotOpenBtn')) {
        hide('forgotMsg');
        open('forgotModal', 'fpLastName');
    } else if (t.closest('#forgotCloseBtn') || t.id === 'forgotBg') {
        close('forgotModal');
    } else if (t.closest('#askLecturerOpenBtn')) {
        hide('lecturerResetMsg');
        open('lecturerResetModal', 'lrIdentifier');
    } else if (t.closest('#lecturerResetCloseBtn') || t.id === 'lecturerResetBg') {
        close('lecturerResetModal');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('lecturerResetModal') && !$('lecturerResetModal').classList.contains('hidden')) close('lecturerResetModal');
    else close('forgotModal');
});

// Email me a new password: last name, student number, email and contact number must all match the account.
document.addEventListener('submit', async (e) => {
    if (e.target.id === 'forgotForm') {
        e.preventDefault();
        const val = (id) => ($(id)?.value || '').trim();
        const body = { lastName: val('fpLastName'), studentNumber: val('fpStudentNumber'), email: val('fpEmail'), contact: val('fpContact') };
        if (Object.values(body).some(v => !v)) { show('forgotMsg', 'Fill in all four details.', false); return; }
        const send = $('fpSendBtn');
        send.disabled = true;
        try {
            const r = await apiFetch('/api/forgot-password', { method: 'POST', body: JSON.stringify(body) });
            show('forgotMsg', `${r.message} Check your inbox (and spam). If nothing arrives, ask your lecturer.`, true);
        } catch (err) {
            show('forgotMsg', err.message || 'Could not send the request.', false);
        } finally {
            send.disabled = false;
        }
    } else if (e.target.id === 'lecturerResetForm') {
        e.preventDefault();
        const identifier = ($('lrIdentifier')?.value || '').trim();
        if (!identifier) { show('lecturerResetMsg', 'Type your username, student number, email or contact number.', false); $('lrIdentifier')?.focus(); return; }
        const send = $('lrSendBtn');
        send.disabled = true;
        try {
            const r = await apiFetch('/api/request-password-reset', { method: 'POST', body: JSON.stringify({ identifier }) });
            show('lecturerResetMsg', `${r.message} Your lecturer will give you a temporary password. Change it after you sign in.`, true);
        } catch (err) {
            show('lecturerResetMsg', err.message || 'Could not send the request.', false);
        } finally {
            send.disabled = false;
        }
    }
});
