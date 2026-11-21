// Sign-in screen: a student who forgot the password asks their lecturer to reset it.
import { apiFetch } from './globals.js';

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#forgotPwdBtn');
    if (!btn) return;
    const idInput = document.getElementById('loginIdentifier');
    const errorDiv = document.getElementById('loginError'), info = document.getElementById('loginInfo');
    errorDiv.classList.add('hidden');
    info.classList.add('hidden');
    const identifier = idInput ? idInput.value.trim() : '';
    if (!identifier) {
        errorDiv.textContent = 'Type your username, student number or email above first, then ask for a reset.';
        errorDiv.classList.remove('hidden');
        if (idInput) idInput.focus();
        return;
    }
    btn.disabled = true;
    try {
        const r = await apiFetch('/api/request-password-reset', { method: 'POST', body: JSON.stringify({ identifier }) });
        info.textContent = `${r.message} Your lecturer will give you a temporary password. Change it after you sign in.`;
        info.classList.remove('hidden');
    } catch (err) {
        errorDiv.textContent = err.message || 'Could not send the request.';
        errorDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
    }
});
